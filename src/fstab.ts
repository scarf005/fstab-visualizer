import {
  choice,
  eof,
  map,
  optional,
  regexp,
  run,
  sepBy1,
  sequence,
} from "@nrsk/sigma"
import type { Parser } from "@nrsk/sigma"

export type FieldName =
  | "spec"
  | "file"
  | "vfstype"
  | "mntops"
  | "freq"
  | "passno"

export type Severity = "error" | "warn"

export type Diagnostic = {
  line: number
  column: number
  severity: Severity
  message: string
}

export type Field = {
  name: FieldName
  text: string
  start: number
  end: number
}

export type ParsedLine = {
  number: number
  raw: string
  kind: "blank" | "comment" | "entry"
  fields: Field[]
  extra: Field[]
  diagnostics: Diagnostic[]
}

export type ParsedFstab = {
  lines: ParsedLine[]
  diagnostics: Diagnostic[]
}

type Token = {
  text: string
  start: number
  end: number
}

type LineAst =
  | { kind: "blank" }
  | { kind: "comment" }
  | { kind: "entry"; tokens: Token[] }

export const fieldNames: FieldName[] = [
  "spec",
  "file",
  "vfstype",
  "mntops",
  "freq",
  "passno",
]

const labels: Record<FieldName, string> = {
  spec: "source",
  file: "mount point",
  vfstype: "fs type",
  mntops: "options",
  freq: "dump",
  passno: "fsck",
}

const typeHelp: Record<string, string> = {
  auto: "auto-detect",
  btrfs: "Btrfs",
  cifs: "SMB share",
  ext2: "ext2",
  ext3: "ext3",
  ext4: "ext4",
  fuse: "FUSE",
  nfs: "NFS",
  nfs4: "NFSv4",
  none: "pseudo fs",
  proc: "procfs",
  swap: "swap",
  tmpfs: "memory fs",
  vfat: "FAT",
  xfs: "XFS",
  zfs: "ZFS",
}

const optionHelp: Record<string, string> = {
  async: "async I/O",
  atime: "update access time",
  auto: "mount with -a",
  bind: "bind mount",
  defaults: "rw,suid,dev,exec,auto,nouser,async",
  dev: "device files enabled",
  discard: "TRIM",
  exec: "allow executables",
  gid: "group id",
  noatime: "skip access time",
  noauto: "skip mount -a",
  nodev: "block device files",
  noexec: "block executables",
  nosuid: "block suid/sgid",
  nouser: "root only",
  relatime: "relative access time",
  remount: "remount",
  ro: "read-only",
  rw: "read-write",
  strictatime: "strict access time",
  suid: "suid/sgid enabled",
  sync: "sync I/O",
  uid: "user id",
  user: "user mount allowed",
  users: "any user unmount",
  x_systemd_automount: "systemd automount",
}

const spaces = regexp(/[ \t]+/g, "space")
const fieldToken: Parser<Token> = map(
  regexp(/[^ \t]+/g, "field"),
  (text, span) => ({ text, start: span[0], end: span[1] }),
)
const blankLine: Parser<LineAst> = map(
  sequence(optional(spaces), eof()),
  () => ({ kind: "blank" }),
)
const commentLine: Parser<LineAst> = map(
  sequence(optional(spaces), regexp(/#.*/g, "comment"), eof()),
  () => ({ kind: "comment" }),
)
const entryLine: Parser<LineAst> = map(
  sequence(
    optional(spaces),
    sepBy1(fieldToken, spaces),
    optional(spaces),
    eof(),
  ),
  ([, tokens]) => ({ kind: "entry", tokens }),
)
const fstabLine = choice(blankLine, commentLine, entryLine)

const diagnostic = (
  line: number,
  column: number,
  severity: Severity,
  message: string,
): Diagnostic => ({ line, column, severity, message })

const isInteger = (value: string) => /^\d+$/.test(value)

const optionKey = (option: string) =>
  option.replace(/=.*/, "").replace(/-/g, "_")

const validateFields = (
  line: number,
  fields: Field[],
  extra: Field[],
): Diagnostic[] => {
  const at = (index: number) => fields[index]?.start + 1 || 1
  const get = (name: FieldName) => fields[fieldNames.indexOf(name)]?.text ?? ""
  const diagnostics: Diagnostic[] = []

  fieldNames.slice(fields.length).forEach((name) => {
    diagnostics.push(
      diagnostic(
        line,
        fields.at(-1)?.end ? fields.at(-1)!.end + 1 : 1,
        "error",
        `missing ${labels[name]}`,
      ),
    )
  })

  extra.forEach((field) =>
    diagnostics.push(
      diagnostic(line, field.start + 1, "error", `extra field: ${field.text}`),
    )
  )

  if (fields.length < 6) return diagnostics

  const spec = get("spec")
  const file = get("file")
  const type = get("vfstype")
  const options = get("mntops")
  const freq = get("freq")
  const passno = get("passno")

  if (spec === "") {
    diagnostics.push(diagnostic(line, at(0), "error", "empty source"))
  }
  if (file !== "none" && file !== "swap" && !file.startsWith("/")) {
    diagnostics.push(
      diagnostic(line, at(1), "warn", "mount point usually starts with /"),
    )
  }
  if (type === "") {
    diagnostics.push(diagnostic(line, at(2), "error", "empty fs type"))
  }
  if (options === "") {
    diagnostics.push(diagnostic(line, at(3), "error", "empty options"))
  }

  const optionList = options.split(",").filter(Boolean)
  const duplicate = optionList.find((option, index) =>
    optionList.indexOf(option) !== index
  )
  if (duplicate) {
    diagnostics.push(
      diagnostic(line, at(3), "warn", `duplicate option: ${duplicate}`),
    )
  }
  if (optionList.includes("ro") && optionList.includes("rw")) {
    diagnostics.push(diagnostic(line, at(3), "warn", "ro and rw both set"))
  }
  if (optionList.includes("user") && optionList.includes("nouser")) {
    diagnostics.push(
      diagnostic(line, at(3), "warn", "user and nouser both set"),
    )
  }
  if (optionList.includes("auto") && optionList.includes("noauto")) {
    diagnostics.push(
      diagnostic(line, at(3), "warn", "auto and noauto both set"),
    )
  }

  if (!isInteger(freq)) {
    diagnostics.push(diagnostic(line, at(4), "error", "dump must be 0 or 1"))
  } else if (!["0", "1"].includes(freq)) {
    diagnostics.push(diagnostic(line, at(4), "warn", "dump usually 0 or 1"))
  }

  if (!isInteger(passno)) {
    diagnostics.push(
      diagnostic(line, at(5), "error", "fsck must be 0, 1, or 2"),
    )
  } else if (!["0", "1", "2"].includes(passno)) {
    diagnostics.push(diagnostic(line, at(5), "warn", "fsck usually 0, 1, or 2"))
  }

  if (type === "swap" && passno !== "0") {
    diagnostics.push(diagnostic(line, at(5), "warn", "swap fsck is 0"))
  }

  return diagnostics
}

const parseLine = (raw: string, number: number): ParsedLine => {
  const parsed = run(fstabLine).with(raw)
  if (!parsed.isOk) {
    return {
      number,
      raw,
      kind: "entry",
      fields: [],
      extra: [],
      diagnostics: [
        diagnostic(number, parsed.pos + 1, "error", parsed.expected),
      ],
    }
  }
  if (parsed.value.kind !== "entry") {
    return {
      number,
      raw,
      kind: parsed.value.kind,
      fields: [],
      extra: [],
      diagnostics: [],
    }
  }

  const commentIndex = parsed.value.tokens.findIndex((token) =>
    token.text.startsWith("#")
  )
  const tokens = commentIndex === -1
    ? parsed.value.tokens
    : parsed.value.tokens.slice(0, commentIndex)
  const fields = tokens.slice(0, 6).map((token, tokenIndex): Field => ({
    ...token,
    name: fieldNames[tokenIndex],
  }))
  const extra = tokens.slice(6).map((token): Field => ({
    ...token,
    name: "passno",
  }))
  const diagnostics = validateFields(number, fields, extra)

  return { number, raw, kind: "entry", fields, extra, diagnostics }
}

export const parseFstab = (text: string): ParsedFstab => {
  const lines = text.split(/\r?\n/).map((raw, index) =>
    parseLine(raw, index + 1)
  )
  return { lines, diagnostics: lines.flatMap((line) => line.diagnostics) }
}

export const prettifyFstab = (text: string): string => {
  const parsed = parseFstab(text)
  const widths = fieldNames.map((_, index) =>
    Math.max(
      0,
      ...parsed.lines.flatMap((line) =>
        line.kind === "entry" && line.fields[index]
          ? [line.fields[index].text.length]
          : []
      ),
    )
  )

  return parsed.lines.map((line) => {
    if (line.kind !== "entry") return line.raw
    const main = line.fields.map((field, index) =>
      field.text.padEnd(widths[index])
    ).join(" ").trimEnd()
    const body = [
      ...(main ? [main] : []),
      ...line.extra.map((field) => field.text),
    ]
      .join(" ")
    const comment = line.raw.slice(line.fields.at(-1)?.end ?? 0).match(
      /^\s+#.*$/,
    )
    return comment ? `${body} ${comment[0].trimStart()}` : body
  }).join("\n")
}

export const decodeFstabEscapes = (value: string): string =>
  value.replace(
    /\\([0-7]{3})/g,
    (_, octal) => String.fromCharCode(parseInt(octal, 8)),
  )

const sourceHint = (value: string): string =>
  value.startsWith("UUID=")
    ? `UUID ${value.slice(5)}`
    : value.startsWith("LABEL=")
    ? `label ${decodeFstabEscapes(value.slice(6))}`
    : value.includes(":")
    ? "remote source"
    : value.startsWith("/")
    ? `device/path ${decodeFstabEscapes(value)}`
    : decodeFstabEscapes(value)

export const explainField = (field: Field): string => {
  if (field.name === "spec") return sourceHint(field.text)
  if (field.name === "file") return `mount ${decodeFstabEscapes(field.text)}`
  if (field.name === "vfstype") {
    return typeHelp[field.text] ?? `type ${field.text}`
  }
  if (field.name === "freq") return field.text === "0" ? "no dump" : "dump"
  if (field.name === "passno") {
    return field.text === "0"
      ? "no fsck"
      : field.text === "1"
      ? "fsck first"
      : "fsck later"
  }

  const parts = field.text.split(",").filter(Boolean)
  return parts.length === 0 ? "no options" : parts.map((part) => {
    const key = optionKey(part)
    return optionHelp[key] ? `${part}: ${optionHelp[key]}` : part
  }).join("; ")
}

export const fieldLabel = (name: FieldName): string => labels[name]
