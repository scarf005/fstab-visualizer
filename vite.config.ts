import { defineConfig } from "vite"
import deno from "@deno/vite-plugin"
import solid from "vite-plugin-solid"

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [deno(), solid()],
})
