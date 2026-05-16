/// <reference lib="deno.ns" />

import { chromium } from "npm:playwright@^1.56.1"

const [target = "http://127.0.0.1:4173/", output = "dist/thumbnail.webp"] =
  Deno.args

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000))
  }
  return btoa(binary)
}

const decodeBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

const waitFor = async (url: string) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`server not ready: ${url}`)
}

await waitFor(target)
await Deno.mkdir(output.includes("/") ? output.replace(/\/[^/]+$/, "") : ".", {
  recursive: true,
})

const browser = await chromium.launch({ args: ["--no-sandbox"] })
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  })
  await page.goto(target, { waitUntil: "networkidle" })
  const png = await page.screenshot({ type: "png" })
  const webp = await page.evaluate(async (source) => {
    const image = new Image()
    image.src = `data:image/png;base64,${source}`
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext("2d")!.drawImage(image, 0, 0)
    return canvas.toDataURL("image/webp", 0.86).replace(
      /^data:image\/webp;base64,/,
      "",
    )
  }, encodeBase64(png))
  await Deno.writeFile(output, decodeBase64(webp))
} finally {
  await browser.close()
}
