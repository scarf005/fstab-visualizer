import "./App.css"
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  explainFieldAt,
  fieldLabel,
  parseFstab,
  prettifyFstab,
} from "./fstab.ts"
import type { Diagnostic, Field, ParsedLine } from "./fstab.ts"
import { parseLsblk, verifyFstabWithLsblk } from "./lsblk.ts"

type Theme = "black" | "white"

type Hover = {
  x: number
  y: number
  text: string
}

const initial = `# /etc/fstab
UUID=8f3b1d0c-0c7d-4b0e-9a2a-1d64bdfd6f01 /     ext4 defaults,noatime 0 1
UUID=fb2d2f54-b8c1-4f2a-baba-d8a4bb3a4fd0 /home ext4 defaults        0 2
tmpfs /tmp tmpfs rw,nosuid,nodev,noexec,relatime 0 0
server:/export /mnt nfs4 noauto,x-systemd.automount 0 0`

const fieldTitle = (field: Field, column = field.start) =>
  `${fieldLabel(field.name)}: ${explainFieldAt(field, column)}`

const tokenClass = (field: Field, extra = false) =>
  `tok ${extra ? "extra" : field.name}`

const renderTail = (tail: string) => {
  const match = tail.match(/^(\s+)(#.*)$/)
  return match ? [match[1], <span class="comment">{match[2]}</span>] : [tail]
}

const renderFields = (line: ParsedLine) => {
  const tokens = [
    ...line.fields.map((field) => ({ field, extra: false })),
    ...line.extra.map((field) => ({ field, extra: true })),
  ]
  let cursor = 0
  return tokens.flatMap(({ field, extra }) => {
    const before = line.raw.slice(cursor, field.start)
    cursor = field.end
    return [
      before,
      <span
        class={tokenClass(field, extra)}
        title={extra ? `extra: ${field.text}` : fieldTitle(field)}
      >
        {field.text}
      </span>,
    ]
  }).concat(renderTail(line.raw.slice(cursor)))
}

const lineClass = (line: ParsedLine, diagnostics: Diagnostic[]) =>
  diagnostics.some((item) =>
      item.line === line.number && item.severity === "error"
    )
    ? "line bad"
    : diagnostics.some((item) => item.line === line.number)
    ? "line warn"
    : "line"

const charWidth = (textarea: HTMLTextAreaElement) => {
  const style = getComputedStyle(textarea)
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) return 8
  context.font =
    `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return context.measureText("M").width
}

const fieldAt = (line: ParsedLine | undefined, column: number) =>
  line?.kind === "entry"
    ? [...line.fields, ...line.extra].find((field) =>
      column >= field.start && column < field.end
    )
    : undefined

const diagnosticText = (item: Diagnostic) =>
  item.line ? `L${item.line}:${item.column} ${item.message}` : item.message

const defaultTheme = (): Theme =>
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "black"
    : "white"

function App() {
  let mirror!: HTMLPreElement
  const [text, setText] = createSignal(initial)
  const [lsblkText, setLsblkText] = createSignal("")
  const [theme, setTheme] = createSignal<Theme>(defaultTheme())
  const [hover, setHover] = createSignal<Hover | null>(null)
  const parsed = createMemo(() => parseFstab(text()))
  const lsblk = createMemo(() => parseLsblk(lsblkText()))
  const diagnostics = createMemo(() => [
    ...parsed().diagnostics,
    ...verifyFstabWithLsblk(parsed(), lsblk()),
  ])
  const errors = createMemo(() =>
    diagnostics().filter((item) => item.severity === "error").length
  )
  const warnings = createMemo(() =>
    diagnostics().filter((item) => item.severity === "warn").length
  )
  const status = createMemo(() =>
    errors() || warnings() ? `${errors()} error, ${warnings()} warn` : "ok"
  )
  const updateHover = (
    event: MouseEvent & { currentTarget: HTMLTextAreaElement },
  ) => {
    const textarea = event.currentTarget
    const style = getComputedStyle(textarea)
    const rect = textarea.getBoundingClientRect()
    const left = parseFloat(style.paddingLeft)
    const top = parseFloat(style.paddingTop)
    const lineHeight = parseFloat(style.lineHeight)
    const line = Math.floor(
      (event.clientY - rect.top - top + textarea.scrollTop) / lineHeight,
    )
    const column = Math.floor(
      (event.clientX - rect.left - left + textarea.scrollLeft) /
        charWidth(textarea),
    )
    const field = fieldAt(parsed().lines[line], column)
    setHover(
      field
        ? {
          x: event.clientX + 10,
          y: event.clientY + 10,
          text: fieldTitle(field, column),
        }
        : null,
    )
  }

  return (
    <main data-theme={theme()}>
      <header>
        <h1>fstab</h1>
        <select
          aria-label="theme"
          value={theme()}
          onInput={(event) => setTheme(event.currentTarget.value as Theme)}
        >
          <option value="black">black</option>
          <option value="white">white</option>
        </select>
        <button type="button" onClick={() => setText(prettifyFstab(text()))}>
          prettify
        </button>
        <strong class={errors() ? "bad" : warnings() ? "warn" : "ok"}>
          {status()}
        </strong>
      </header>

      <section class="editor">
        <pre ref={mirror} class="highlight" aria-hidden="true"><code>
          <For each={parsed().lines}>{(line) => (
            <div class={lineClass(line, diagnostics())}>
              <Show when={line.kind === "entry"} fallback={<span class={line.kind}>{line.raw || " "}</span>}>
                {renderFields(line)}
              </Show>
            </div>
          )}</For>
        </code></pre>
        <textarea
          aria-label="fstab"
          spellcheck={false}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
          onMouseMove={updateHover}
          onMouseLeave={() => setHover(null)}
          onScroll={(event) => {
            mirror.scrollTop = event.currentTarget.scrollTop
            mirror.scrollLeft = event.currentTarget.scrollLeft
          }}
        />
        <Show when={hover()}>
          {(item) => (
            <output
              class="tip"
              style={{ left: `${item().x}px`, top: `${item().y}px` }}
            >
              {item().text}
            </output>
          )}
        </Show>
      </section>

      <section class="lsblk">
        <label for="lsblk">lsblk -f</label>
        <textarea
          id="lsblk"
          aria-label="lsblk -f"
          spellcheck={false}
          value={lsblkText()}
          onInput={(event) => setLsblkText(event.currentTarget.value)}
        />
      </section>

      <Show when={diagnostics().length}>
        <ul>
          <For each={diagnostics()}>
            {(item) => <li class={item.severity}>{diagnosticText(item)}</li>}
          </For>
        </ul>
      </Show>
    </main>
  )
}

export default App
