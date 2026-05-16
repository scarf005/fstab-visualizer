/// <reference lib="deno.ns" />

import { parseFstab, prettifyFstab } from "./fstab.ts"

Deno.test("parses valid entries", () => {
  const parsed = parseFstab("UUID=x / ext4 defaults 0 1")
  if (parsed.diagnostics.length !== 0) throw new Error("expected valid fstab")
  if (
    parsed.lines[0].fields.map((field) => field.text).join("|") !==
      "UUID=x|/|ext4|defaults|0|1"
  ) throw new Error("fields mismatch")
})

Deno.test("reports missing fields", () => {
  const parsed = parseFstab("/dev/sda1 /mnt ext4")
  if (!parsed.diagnostics.some((item) => item.message === "missing options")) {
    throw new Error("missing options not reported")
  }
  if (!parsed.diagnostics.some((item) => item.message === "missing fsck")) {
    throw new Error("missing fsck not reported")
  }
})

Deno.test("keeps inline comments", () => {
  const parsed = parseFstab("UUID=x / ext4 defaults 0 1 # root")
  if (parsed.diagnostics.length !== 0) throw new Error("inline comment flagged")
  if (
    prettifyFstab("UUID=x / ext4 defaults 0 1 # root") !==
      "UUID=x / ext4 defaults 0 1 # root"
  ) throw new Error("inline comment lost")
})
