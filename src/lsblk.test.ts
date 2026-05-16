/// <reference lib="deno.ns" />

import { parseFstab } from "./fstab.ts"
import { parseLsblk, verifyFstabWithLsblk } from "./lsblk.ts"
import type { Diagnostic } from "./fstab.ts"

const assertEquals = <T>(actual: T, expected: T) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
  }
}

const messages = (diagnostics: Diagnostic[]) =>
  diagnostics.map((item) => item.message)

const table =
  `NAME        FSTYPE LABEL UUID                                 MOUNTPOINTS
sda                                                               
├─sda1      vfat   EFI   1111-2222                            /boot
└─sda2      ext4   root  aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee /
sdb                                                               
└─sdb1      ext4   data  bbbbbbbb-1111-2222-3333-cccccccccccc /mnt/data
zram0       swap         zzzzzzzz-1111-2222-3333-aaaaaaaaaaaa [SWAP]`

Deno.test("parses lsblk table", () => {
  const parsed = parseLsblk(table)
  assertEquals(parsed.diagnostics, [])
  assertEquals(parsed.devices.length, 6)
  assertEquals(parsed.devices[1], {
    name: "sda1",
    fstype: "vfat",
    label: "EFI",
    uuid: "1111-2222",
    mountpoints: ["/boot"],
  })
})

Deno.test("parses lsblk pairs", () => {
  const parsed = parseLsblk(
    'NAME="sda1" FSTYPE="ext4" LABEL="root" UUID="abc" MOUNTPOINTS="/"',
  )
  assertEquals(parsed.devices, [{
    name: "sda1",
    fstype: "ext4",
    label: "root",
    uuid: "abc",
    mountpoints: ["/"],
  }])
})

Deno.test("parses multiline mountpoints", () => {
  const parsed = parseLsblk(`NAME  FSTYPE LABEL UUID MOUNTPOINTS
sda1  ext4   root  abc  /
                            /var/lib/machines`)
  assertEquals(parsed.devices[0].mountpoints, ["/", "/var/lib/machines"])
})

Deno.test("reports missing NAME", () => {
  assertEquals(messages(parseLsblk("FSTYPE UUID\next4 abc").diagnostics), [
    "lsblk: missing NAME",
  ])
})

Deno.test("reports missing FSTYPE", () => {
  assertEquals(messages(parseLsblk("NAME UUID\nsda1 abc").diagnostics), [
    "lsblk: missing FSTYPE",
  ])
})

Deno.test("empty lsblk has no diagnostics", () => {
  assertEquals(parseLsblk("\n").diagnostics, [])
})

Deno.test("verifies UUID source", () => {
  const fstab = parseFstab(
    "UUID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee / ext4 defaults 0 1",
  )
  assertEquals(verifyFstabWithLsblk(fstab, parseLsblk(table)), [])
})

Deno.test("verifies LABEL source", () => {
  const fstab = parseFstab("LABEL=data /mnt/data ext4 defaults 0 2")
  assertEquals(verifyFstabWithLsblk(fstab, parseLsblk(table)), [])
})

Deno.test("verifies device path source", () => {
  const fstab = parseFstab("/dev/sdb1 /mnt/data ext4 defaults 0 2")
  assertEquals(verifyFstabWithLsblk(fstab, parseLsblk(table)), [])
})

Deno.test("reports missing source", () => {
  const fstab = parseFstab("UUID=missing / ext4 defaults 0 1")
  assertEquals(messages(verifyFstabWithLsblk(fstab, parseLsblk(table))), [
    "source not in lsblk",
  ])
})

Deno.test("reports filesystem mismatch", () => {
  const fstab = parseFstab("UUID=1111-2222 /boot ext4 defaults 0 2")
  assertEquals(messages(verifyFstabWithLsblk(fstab, parseLsblk(table))), [
    "lsblk fs type: vfat",
  ])
})

Deno.test("warns mountpoint mismatch", () => {
  const fstab = parseFstab(
    "UUID=bbbbbbbb-1111-2222-3333-cccccccccccc /wrong ext4 defaults 0 2",
  )
  assertEquals(messages(verifyFstabWithLsblk(fstab, parseLsblk(table))), [
    "lsblk mount: /mnt/data",
  ])
})

Deno.test("allows auto fs type", () => {
  const fstab = parseFstab("UUID=1111-2222 /boot auto defaults 0 2")
  assertEquals(verifyFstabWithLsblk(fstab, parseLsblk(table)), [])
})

Deno.test("skips tmpfs source", () => {
  const fstab = parseFstab("tmpfs /tmp tmpfs rw,nosuid,nodev 0 0")
  assertEquals(verifyFstabWithLsblk(fstab, parseLsblk(table)), [])
})

Deno.test("skips remote source", () => {
  const fstab = parseFstab("server:/export /mnt nfs4 defaults 0 0")
  assertEquals(verifyFstabWithLsblk(fstab, parseLsblk(table)), [])
})

Deno.test("skips none source", () => {
  const fstab = parseFstab("none /proc proc defaults 0 0")
  assertEquals(verifyFstabWithLsblk(fstab, parseLsblk(table)), [])
})

Deno.test("swap ignores [SWAP] mountpoint", () => {
  const fstab = parseFstab(
    "UUID=zzzzzzzz-1111-2222-3333-aaaaaaaaaaaa none swap sw 0 0",
  )
  assertEquals(verifyFstabWithLsblk(fstab, parseLsblk(table)), [])
})

Deno.test("propagates lsblk diagnostics", () => {
  const fstab = parseFstab("UUID=x / ext4 defaults 0 1")
  assertEquals(
    messages(verifyFstabWithLsblk(fstab, parseLsblk("FSTYPE\next4"))),
    [
      "lsblk: missing NAME",
    ],
  )
})
