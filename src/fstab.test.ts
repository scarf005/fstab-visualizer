/// <reference lib="deno.ns" />

import {
  decodeFstabEscapes,
  explainField,
  fieldLabel,
  parseFstab,
  prettifyFstab,
} from "./fstab.ts"
import type { Diagnostic, Field } from "./fstab.ts"

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const assertEquals = <T>(actual: T, expected: T) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
  }
}

const messages = (diagnostics: Diagnostic[]) =>
  diagnostics.map((item) => item.message)

const field = (name: Field["name"], text: string): Field => ({
  name,
  text,
  start: 0,
  end: text.length,
})

Deno.test("parses valid entry fields", () => {
  const parsed = parseFstab("UUID=x / ext4 defaults 0 1")
  assertEquals(parsed.diagnostics, [])
  assertEquals(
    parsed.lines[0].fields.map((item) => item.text),
    ["UUID=x", "/", "ext4", "defaults", "0", "1"],
  )
})

Deno.test("tracks columns", () => {
  const parsed = parseFstab("  /dev/sda1  /mnt  ext4  rw  0  2")
  assertEquals(
    parsed.lines[0].fields.map((item) => item.start),
    [2, 13, 19, 25, 29, 32],
  )
})

Deno.test("parses blank lines", () => {
  const parsed = parseFstab("   ")
  assertEquals(parsed.lines[0].kind, "blank")
  assertEquals(parsed.diagnostics, [])
})

Deno.test("parses full-line comments", () => {
  const parsed = parseFstab("  # comment")
  assertEquals(parsed.lines[0].kind, "comment")
  assertEquals(parsed.diagnostics, [])
})

Deno.test("keeps inline comments valid", () => {
  const parsed = parseFstab("UUID=x / ext4 defaults 0 1 # root")
  assertEquals(parsed.diagnostics, [])
})

Deno.test("prettify keeps inline comments", () => {
  assertEquals(
    prettifyFstab("UUID=x / ext4 defaults 0 1 # root"),
    "UUID=x / ext4 defaults 0 1 # root",
  )
})

Deno.test("prettify aligns fields", () => {
  assertEquals(
    prettifyFstab("UUID=x / ext4 defaults 0 1\n/dev/sda1 /mnt ext4 rw 0 2"),
    "UUID=x    /    ext4 defaults 0 1\n/dev/sda1 /mnt ext4 rw       0 2",
  )
})

Deno.test("prettify preserves blank and comment lines", () => {
  assertEquals(
    prettifyFstab("# a\n\n/dev/sda1 / ext4 defaults 0 1"),
    "# a\n\n/dev/sda1 / ext4 defaults 0 1",
  )
})

Deno.test("reports all missing fields", () => {
  const parsed = parseFstab("/dev/sda1 /mnt ext4")
  assertEquals(messages(parsed.diagnostics), [
    "missing options",
    "missing dump",
    "missing fsck",
  ])
})

Deno.test("reports extra fields", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 defaults 0 1 extra")
  assertEquals(messages(parsed.diagnostics), ["extra field: extra"])
})

Deno.test("reports invalid dump", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 defaults x 1")
  assertEquals(messages(parsed.diagnostics), ["dump must be 0 or 1"])
})

Deno.test("warns unusual dump", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 defaults 2 1")
  assertEquals(messages(parsed.diagnostics), ["dump usually 0 or 1"])
})

Deno.test("reports invalid fsck", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 defaults 0 x")
  assertEquals(messages(parsed.diagnostics), ["fsck must be 0, 1, or 2"])
})

Deno.test("warns unusual fsck", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 defaults 0 9")
  assertEquals(messages(parsed.diagnostics), ["fsck usually 0, 1, or 2"])
})

Deno.test("warns relative mount point", () => {
  const parsed = parseFstab("/dev/sda1 mnt ext4 defaults 0 2")
  assertEquals(messages(parsed.diagnostics), [
    "mount point usually starts with /",
  ])
})

Deno.test("allows none mount point", () => {
  const parsed = parseFstab("tmpfs none tmpfs defaults 0 0")
  assertEquals(parsed.diagnostics, [])
})

Deno.test("warns duplicate option", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 rw,rw 0 1")
  assertEquals(messages(parsed.diagnostics), ["duplicate option: rw"])
})

Deno.test("warns ro/rw conflict", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 ro,rw 0 1")
  assertEquals(messages(parsed.diagnostics), ["ro and rw both set"])
})

Deno.test("warns user/nouser conflict", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 user,nouser 0 1")
  assertEquals(messages(parsed.diagnostics), ["user and nouser both set"])
})

Deno.test("warns auto/noauto conflict", () => {
  const parsed = parseFstab("/dev/sda1 / ext4 auto,noauto 0 1")
  assertEquals(messages(parsed.diagnostics), ["auto and noauto both set"])
})

Deno.test("warns swap fsck", () => {
  const parsed = parseFstab("UUID=x none swap sw 0 2")
  assertEquals(messages(parsed.diagnostics), ["swap fsck is 0"])
})

Deno.test("decodes fstab octal escapes", () => {
  assertEquals(decodeFstabEscapes("/mnt/My\\040Disk"), "/mnt/My Disk")
})

Deno.test("explains source", () => {
  assertEquals(explainField(field("spec", "UUID=abc")), "UUID abc")
  assertEquals(
    explainField(field("spec", "LABEL=My\\040Disk")),
    "label My Disk",
  )
  assertEquals(explainField(field("spec", "server:/export")), "remote source")
})

Deno.test("explains mount point", () => {
  assertEquals(
    explainField(field("file", "/mnt/My\\040Disk")),
    "mount /mnt/My Disk",
  )
})

Deno.test("explains fs type", () => {
  assertEquals(explainField(field("vfstype", "ext4")), "ext4")
  assertEquals(explainField(field("vfstype", "weirdfs")), "type weirdfs")
})

Deno.test("explains options", () => {
  assertEquals(
    explainField(field("mntops", "defaults,noatime,uid=1000,x-unknown")),
    "defaults: rw,suid,dev,exec,auto,nouser,async; noatime: skip access time; uid=1000: user id; x-unknown",
  )
})

Deno.test("explains dump and fsck", () => {
  assertEquals(explainField(field("freq", "0")), "no dump")
  assertEquals(explainField(field("freq", "1")), "dump")
  assertEquals(explainField(field("passno", "0")), "no fsck")
  assertEquals(explainField(field("passno", "1")), "fsck first")
  assertEquals(explainField(field("passno", "2")), "fsck later")
})

Deno.test("labels fields", () => {
  assertEquals(fieldLabel("spec"), "source")
  assertEquals(fieldLabel("file"), "mount point")
  assertEquals(fieldLabel("vfstype"), "fs type")
  assertEquals(fieldLabel("mntops"), "options")
  assertEquals(fieldLabel("freq"), "dump")
  assertEquals(fieldLabel("passno"), "fsck")
})
