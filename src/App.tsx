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

type LsblkColumn = {
  name: string
  start: number
  end: number
}

const initial = `# /etc/fstab
UUID=8f3b1d0c-0c7d-4b0e-9a2a-1d64bdfd6f01 /     ext4  defaults,noatime                0 1
UUID=fb2d2f54-b8c1-4f2a-baba-d8a4bb3a4fd0 /home ext4  defaults                        0 2
tmpfs                                     /tmp  tmpfs rw,nosuid,nodev,noexec,relatime 0 0
server:/export                            /mnt  nfs4  noauto,x-systemd.automount      0 0`

const initialLsblk =
  `NAME    FSTYPE LABEL UUID                                 MOUNTPOINTS
sda
├─sda1  ext4   root  8f3b1d0c-0c7d-4b0e-9a2a-1d64bdfd6f01 /
└─sda2  ext4   home  fb2d2f54-b8c1-4f2a-baba-d8a4bb3a4fd0 /home`

const fieldTitle = (field: Field, column = field.start) =>
  `${fieldLabel(field.name)}: ${explainFieldAt(field, column)}`

const tokenClass = (field: Field, extra = false) =>
  `tok ${extra ? "extra" : field.name}`

const renderTail = (tail: string) => {
  const match = tail.match(/^(\s+)(#.*)$/)
  return match ? [match[1], <span class="comment">{match[2]}</span>] : [tail]
}

const fieldUuid = (field: Field): string | undefined =>
  field.name === "spec" && field.text.startsWith("UUID=")
    ? field.text.slice(5)
    : undefined

const renderOptionFields = (
  field: Field,
  showHover: (
    text: string,
    uuid?: string,
    key?: string,
  ) => (event: MouseEvent) => void,
  activeKey: string | null,
) => {
  let cursor = 0
  return field.text.split(",").flatMap((option, index) => {
    const start = cursor
    cursor += option.length + 1
    const text = fieldTitle(field, field.start + start)
    const key = `fstab:${field.start}:${start}`
    return [
      index ? "," : "",
      <span
        class={`mntops${activeKey === key ? " active" : ""}`}
        data-hover="1"
        onMouseMove={showHover(text, undefined, key)}
      >
        {option}
      </span>,
    ]
  })
}

const renderField = (
  field: Field,
  extra: boolean,
  showHover: (
    text: string,
    uuid?: string,
    key?: string,
  ) => (event: MouseEvent) => void,
  activeUuid: string | null,
  activeKey: string | null,
) => {
  if (field.name === "mntops" && !extra) {
    return renderOptionFields(field, showHover, activeKey)
  }

  const text = extra ? `extra: ${field.text}` : fieldTitle(field)
  const uuid = fieldUuid(field)
  const key = `fstab:${field.start}:${field.end}`
  const active = uuid && activeUuid === uuid || activeKey === key
    ? " active"
    : ""
  return (
    <span
      class={`${tokenClass(field, extra)}${active}`}
      data-hover="1"
      onMouseMove={showHover(text, uuid, key)}
    >
      {field.text}
    </span>
  )
}

const renderFields = (
  line: ParsedLine,
  showHover: (
    text: string,
    uuid?: string,
    key?: string,
  ) => (event: MouseEvent) => void,
  activeUuid: string | null,
  activeKey: string | null,
) => {
  const tokens = [
    ...line.fields.map((field) => ({ field, extra: false })),
    ...line.extra.map((field) => ({ field, extra: true })),
  ]
  let cursor = 0
  return tokens.flatMap(({ field, extra }) => {
    const before = line.raw.slice(cursor, field.start)
    cursor = field.end
    return [before, renderField(field, extra, showHover, activeUuid, activeKey)]
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

const textOffsetAt = (
  textarea: HTMLTextAreaElement,
  event: MouseEvent,
  text: string,
): number => {
  const style = getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()
  const left = parseFloat(style.paddingLeft)
  const top = parseFloat(style.paddingTop)
  const lineHeight = parseFloat(style.lineHeight)
  const lineIndex = Math.max(
    0,
    Math.floor(
      (event.clientY - rect.top - top + textarea.scrollTop) / lineHeight,
    ),
  )
  const column = Math.max(
    0,
    Math.floor(
      (event.clientX - rect.left - left + textarea.scrollLeft) /
        charWidth(textarea),
    ),
  )
  const lines = text.split("\n")
  const before = lines.slice(0, lineIndex).reduce(
    (sum, line) => sum + line.length + 1,
    0,
  )
  return Math.min(
    text.length,
    before + Math.min(column, lines[lineIndex]?.length ?? 0),
  )
}

const diagnosticText = (item: Diagnostic) =>
  item.line ? `L${item.line}:${item.column} ${item.message}` : item.message

const lsblkColumns = (text: string): LsblkColumn[] => {
  const header = text.split(/\r?\n/)[0] ?? ""
  const columns = [...header.matchAll(/\S+/g)].map((match) => ({
    name: match[0],
    start: match.index ?? 0,
  }))
  return columns.map((column, index) => ({
    ...column,
    end: columns[index + 1]?.start ?? Number.POSITIVE_INFINITY,
  }))
}

const cleanDeviceName = (value: string) =>
  value.trim().replace(/^[^A-Za-z0-9/]+/, "")

const lsblkClass = (
  column: string,
  value: string,
  activeUuid: string | null,
  activeKey: string | null,
  key: string,
) => {
  const columnKey = column.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return [
    "lsblk-token",
    `lsblk-${columnKey}`,
    column === "UUID" && value === activeUuid || activeKey === key
      ? "active"
      : "",
  ].filter(Boolean).join(" ")
}

const lsblkHelp = (column: string, value: string): string => {
  if (value === "") return `${column}: empty`
  if (column === "NAME") {
    const name = cleanDeviceName(value)
    return name ? `device ${name}; disk or partition` : "device tree"
  }
  if (column === "FSTYPE") return `filesystem type ${value}`
  if (column === "FSVER") return `filesystem version ${value}`
  if (column === "LABEL") return `filesystem label ${value}`
  if (column === "UUID") return `block device UUID ${value}`
  if (column === "FSAVAIL") return `available space ${value}`
  if (column === "FSUSE%") return `used space ${value}`
  if (column === "MOUNTPOINT" || column === "MOUNTPOINTS") {
    return value === "[SWAP]" ? "active swap" : `mounted at ${value}`
  }
  return `${column}: ${value}`
}

const renderLsblkFallback = (
  line: string,
  uuids: Set<string>,
  activeUuid: string | null,
  activeKey: string | null,
  showHover: (
    text: string,
    uuid?: string,
    key?: string,
  ) => (event: MouseEvent) => void,
) => {
  const matches = [...line.matchAll(/[0-9A-Fa-f]{4,}(?:-[0-9A-Fa-f]{4,})+/g)]
  let cursor = 0
  return matches.flatMap((match) => {
    const uuid = match[0]
    const start = match.index ?? 0
    const before = line.slice(cursor, start)
    cursor = start + uuid.length
    const key = `lsblk:fallback:${start}`
    return uuids.has(uuid)
      ? [
        before,
        <span
          class={`lsblk-token lsblk-uuid${
            activeUuid === uuid || activeKey === key ? " active" : ""
          }`}
          data-hover="1"
          onMouseMove={showHover(`block device UUID ${uuid}`, uuid, key)}
        >
          {uuid}
        </span>,
      ]
      : [line.slice(start, cursor)]
  }).concat(line.slice(cursor))
}

const renderLsblkLine = (
  line: string,
  lineIndex: number,
  columns: LsblkColumn[],
  uuids: Set<string>,
  activeUuid: string | null,
  activeKey: string | null,
  showHover: (
    text: string,
    uuid?: string,
    key?: string,
  ) => (event: MouseEvent) => void,
) => {
  if (!columns.length) {
    return renderLsblkFallback(line, uuids, activeUuid, activeKey, showHover)
  }

  let cursor = 0
  return columns.flatMap((column) => {
    if (column.start >= line.length) return []
    const start = Math.max(cursor, column.start)
    const end = Math.min(column.end, line.length)
    const before = line.slice(cursor, start)
    const raw = line.slice(start, end)
    const value = raw.trim()
    cursor = end
    if (!raw) return [before]

    const uuid = column.name === "UUID" && uuids.has(value) ? value : undefined
    const key = `lsblk:${lineIndex}:${column.name}:${start}`
    const help = lineIndex === 0
      ? `${column.name} column`
      : lsblkHelp(column.name, value)
    return [
      before,
      <span
        class={lsblkClass(column.name, value, activeUuid, activeKey, key)}
        data-hover="1"
        onMouseMove={showHover(help, uuid, key)}
      >
        {raw}
      </span>,
    ]
  }).concat(line.slice(cursor))
}

const defaultTheme = (): Theme =>
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "black"
    : "white"

function App() {
  let mirror!: HTMLPreElement
  let textarea!: HTMLTextAreaElement
  let lsblkMirror!: HTMLPreElement
  let lsblkTextarea!: HTMLTextAreaElement
  const [text, setText] = createSignal(initial)
  const [lsblkText, setLsblkText] = createSignal(initialLsblk)
  const [theme, setTheme] = createSignal<Theme>(defaultTheme())
  const [hover, setHover] = createSignal<Hover | null>(null)
  const [activeUuid, setActiveUuid] = createSignal<string | null>(null)
  const [activeKey, setActiveKey] = createSignal<string | null>(null)
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
  const lsblkUuids = createMemo(() =>
    new Set(lsblk().devices.map((device) => device.uuid).filter(Boolean))
  )
  const columns = createMemo(() => lsblkColumns(lsblkText()))
  const showHover =
    (value: string, uuid?: string, key?: string) => (event: MouseEvent) => {
      setHover({ x: event.clientX + 10, y: event.clientY + 10, text: value })
      setActiveUuid(uuid ?? null)
      setActiveKey(key ?? null)
    }
  const hideHover = () => {
    setHover(null)
    setActiveUuid(null)
    setActiveKey(null)
  }
  const hideHoverOnBlank = (event: MouseEvent) => {
    const target = event.target
    if (target instanceof Element && target.closest("[data-hover]")) return
    hideHover()
  }
  const focusEditor = (event: MouseEvent) => {
    event.preventDefault()
    const offset = textOffsetAt(textarea, event, text())
    textarea.focus()
    textarea.setSelectionRange(offset, offset)
  }
  const focusLsblk = (event: MouseEvent) => {
    event.preventDefault()
    const offset = textOffsetAt(lsblkTextarea, event, lsblkText())
    lsblkTextarea.focus()
    lsblkTextarea.setSelectionRange(offset, offset)
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

      <section class="editor" onMouseLeave={hideHover}>
        <pre
          ref={mirror}
          class="highlight"
          aria-hidden="true"
          onMouseDown={focusEditor}
          onMouseMove={hideHoverOnBlank}
          onMouseLeave={hideHover}
          onScroll={(event) => {
            textarea.scrollTop = event.currentTarget.scrollTop
            textarea.scrollLeft = event.currentTarget.scrollLeft
          }}
        ><code>
          <For each={parsed().lines}>{(line) => (
            <div class={lineClass(line, diagnostics())}>
              <Show when={line.kind === "entry"} fallback={<span class={line.kind}>{line.raw || " "}</span>}>
                {renderFields(line, showHover, activeUuid(), activeKey())}
              </Show>
            </div>
          )}</For>
        </code></pre>
        <textarea
          ref={textarea}
          aria-label="fstab"
          spellcheck={false}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
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

      <section class="lsblk" onMouseLeave={hideHover}>
        <label for="lsblk">lsblk -f</label>
        <div class="lsblk-editor">
          <pre
            ref={lsblkMirror}
            class="lsblk-view"
            aria-hidden="true"
            onMouseDown={focusLsblk}
            onMouseMove={hideHoverOnBlank}
            onMouseLeave={hideHover}
            onScroll={(event) => {
              lsblkTextarea.scrollTop = event.currentTarget.scrollTop
              lsblkTextarea.scrollLeft = event.currentTarget.scrollLeft
            }}
          ><code>
            <For each={lsblkText().split("\n")}>{(line, index) => (
              <div class="line">
                {renderLsblkLine(
                  line,
                  index(),
                  columns(),
                  lsblkUuids(),
                  activeUuid(),
                  activeKey(),
                  showHover,
                )}
              </div>
            )}</For>
          </code></pre>
          <textarea
            ref={lsblkTextarea}
            id="lsblk"
            aria-label="lsblk -f"
            spellcheck={false}
            value={lsblkText()}
            onInput={(event) => setLsblkText(event.currentTarget.value)}
            onScroll={(event) => {
              lsblkMirror.scrollTop = event.currentTarget.scrollTop
              lsblkMirror.scrollLeft = event.currentTarget.scrollLeft
            }}
          />
        </div>
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
