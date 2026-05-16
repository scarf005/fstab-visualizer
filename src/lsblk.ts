import type { Diagnostic, Field, ParsedFstab } from "./fstab.ts"

export type LsblkDevice = {
  name: string
  fstype: string
  label: string
  uuid: string
  mountpoints: string[]
}

export type ParsedLsblk = {
  devices: LsblkDevice[]
  diagnostics: Diagnostic[]
}

type Column = {
  name: string
  start: number
}

const pseudoTypes = new Set([
  "binfmt_misc",
  "bpf",
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "devtmpfs",
  "efivarfs",
  "fusectl",
  "hugetlbfs",
  "mqueue",
  "overlay",
  "proc",
  "pstore",
  "ramfs",
  "securityfs",
  "sysfs",
  "tmpfs",
  "tracefs",
])

const remoteTypes = new Set(["cifs", "nfs", "nfs4", "smb3", "sshfs"])

const diagnostic = (message: string): Diagnostic => ({
  line: 0,
  column: 0,
  severity: "warn",
  message,
})

const fieldDiagnostic = (
  field: Field,
  severity: Diagnostic["severity"],
  message: string,
): Diagnostic => ({
  line: 0,
  column: field.start + 1,
  severity,
  message,
})

const fstabDiagnostic = (
  line: number,
  field: Field,
  severity: Diagnostic["severity"],
  message: string,
): Diagnostic => ({
  ...fieldDiagnostic(field, severity, message),
  line,
})

const unquote = (value: string): string =>
  value.replace(/^"|"$/g, "").replace(/\\"/g, '"')

const cleanName = (name: string): string =>
  name.trim().replace(/^[^A-Za-z0-9/]+/, "")

const deviceNames = (device: LsblkDevice): string[] => {
  const name = cleanName(device.name)
  return [name, `/dev/${name}`]
}

const parseColumns = (header: string): Column[] =>
  [...header.matchAll(/\S+/g)].map((match) => ({
    name: match[0],
    start: match.index ?? 0,
  }))

const cell = (line: string, columns: Column[], name: string): string => {
  const index = columns.findIndex((column) => column.name === name)
  if (index === -1) return ""
  const start = columns[index].start
  const end = columns[index + 1]?.start ?? line.length
  return line.slice(start, end).trim()
}

const parseTable = (text: string): ParsedLsblk => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")
  if (lines.length === 0) return { devices: [], diagnostics: [] }

  const columns = parseColumns(lines[0])
  const names = new Set(columns.map((column) => column.name))
  if (!names.has("NAME")) {
    return { devices: [], diagnostics: [diagnostic("lsblk: missing NAME")] }
  }
  if (!names.has("FSTYPE")) {
    return { devices: [], diagnostics: [diagnostic("lsblk: missing FSTYPE")] }
  }

  const devices: LsblkDevice[] = []
  lines.slice(1).forEach((line) => {
    const rawName = cell(line, columns, "NAME")
    const mountpoint = cell(line, columns, "MOUNTPOINTS") ||
      cell(line, columns, "MOUNTPOINT")
    if (!rawName && mountpoint && devices.at(-1)) {
      devices.at(-1)!.mountpoints.push(mountpoint)
      return
    }
    if (!rawName) return
    devices.push({
      name: cleanName(rawName),
      fstype: cell(line, columns, "FSTYPE"),
      label: cell(line, columns, "LABEL"),
      uuid: cell(line, columns, "UUID"),
      mountpoints: mountpoint ? [mountpoint] : [],
    })
  })

  return { devices, diagnostics: [] }
}

const parsePairs = (text: string): ParsedLsblk => ({
  devices: text.split(/\r?\n/).filter((line) => line.trim() !== "").map(
    (line) => {
      const pairs = Object.fromEntries(
        [...line.matchAll(/(\w+)="((?:\\"|[^"])*)"/g)].map((match) => [
          match[1],
          unquote(`"${match[2]}"`),
        ]),
      )
      return {
        name: cleanName(pairs.NAME ?? ""),
        fstype: pairs.FSTYPE ?? "",
        label: pairs.LABEL ?? "",
        uuid: pairs.UUID ?? "",
        mountpoints: [pairs.MOUNTPOINTS ?? pairs.MOUNTPOINT ?? ""].filter(
          Boolean,
        ),
      }
    },
  ).filter((device) => device.name !== ""),
  diagnostics: [],
})

export const parseLsblk = (text: string): ParsedLsblk => {
  const trimmed = text.trim()
  if (!trimmed) return { devices: [], diagnostics: [] }
  return /(^|\n)\w+="/.test(trimmed) ? parsePairs(trimmed) : parseTable(trimmed)
}

const sourceDevice = (
  spec: string,
  devices: LsblkDevice[],
): LsblkDevice | undefined =>
  spec.startsWith("UUID=")
    ? devices.find((device) => device.uuid === spec.slice(5))
    : spec.startsWith("LABEL=")
    ? devices.find((device) =>
      device.label === spec.slice(6).replace(/\\040/g, " ")
    )
    : spec.startsWith("/dev/")
    ? devices.find((device) => deviceNames(device).includes(spec))
    : undefined

const canSkipSource = (spec: string, type: string): boolean =>
  spec === "none" || spec === "tmpfs" || spec.includes(":") ||
  pseudoTypes.has(type) ||
  remoteTypes.has(type)

export const verifyFstabWithLsblk = (
  fstab: ParsedFstab,
  lsblk: ParsedLsblk,
): Diagnostic[] => {
  if (lsblk.devices.length === 0) return lsblk.diagnostics

  const diagnostics: Diagnostic[] = []
  fstab.lines.forEach((line) => {
    if (line.kind !== "entry" || line.fields.length < 6) return

    const spec = line.fields[0]
    const mount = line.fields[1]
    const type = line.fields[2]
    const expectedType = type.text.toLowerCase()
    const device = sourceDevice(spec.text, lsblk.devices)

    if (!device && !canSkipSource(spec.text, expectedType)) {
      diagnostics.push(
        fstabDiagnostic(line.number, spec, "error", "source not in lsblk"),
      )
      return
    }
    if (!device) return

    if (
      expectedType !== "auto" && device.fstype &&
      device.fstype.toLowerCase() !== expectedType
    ) {
      diagnostics.push(
        fstabDiagnostic(
          line.number,
          type,
          "error",
          `fstab ${type.text} ≠ lsblk ${device.fstype}; set fstab type to ${device.fstype} or change the device filesystem`,
        ),
      )
    }

    const mountpoints = device.mountpoints.filter((item) => item !== "[SWAP]")
    if (
      mountpoints.length && mount.text !== "none" &&
      !mountpoints.includes(mount.text)
    ) {
      diagnostics.push(
        fstabDiagnostic(
          line.number,
          mount,
          "warn",
          `fstab mount ${mount.text} not in lsblk (${
            mountpoints.join(",")
          }); set fstab mountpoint to an lsblk path or mount the device there`,
        ),
      )
    }
  })

  return [...lsblk.diagnostics, ...diagnostics]
}
