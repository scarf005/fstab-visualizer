import "./App.css"
import { createMemo, createSignal, For, Show } from "solid-js"
import { explainField, fieldLabel, parseFstab, prettifyFstab } from "./fstab.ts"
import type { Field, ParsedLine } from "./fstab.ts"

const initial = `# /etc/fstab
UUID=8f3b1d0c-0c7d-4b0e-9a2a-1d64bdfd6f01 /     ext4 defaults,noatime 0 1
UUID=fb2d2f54-b8c1-4f2a-baba-d8a4bb3a4fd0 /home ext4 defaults        0 2
tmpfs /tmp tmpfs rw,nosuid,nodev,noexec,relatime 0 0
server:/export /mnt nfs4 noauto,x-systemd.automount 0 0`

const fieldTitle = (field: Field) =>
  `${fieldLabel(field.name)}: ${explainField(field)}`

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

const lineClass = (line: ParsedLine) =>
  line.diagnostics.some((item) => item.severity === "error")
    ? "line bad"
    : line.diagnostics.length
    ? "line warn"
    : "line"

function App() {
  const [text, setText] = createSignal(initial)
  const parsed = createMemo(() => parseFstab(text()))
  const errors = createMemo(() =>
    parsed().diagnostics.filter((item) => item.severity === "error").length
  )
  const warnings = createMemo(() =>
    parsed().diagnostics.filter((item) => item.severity === "warn").length
  )
  const status = createMemo(() =>
    errors() || warnings() ? `${errors()} error, ${warnings()} warn` : "ok"
  )

  return (
    <main>
      <header>
        <h1>fstab</h1>
        <button type="button" onClick={() => setText(prettifyFstab(text()))}>
          prettify
        </button>
        <strong class={errors() ? "bad" : warnings() ? "warn" : "ok"}>
          {status()}
        </strong>
      </header>

      <section class="grid">
        <textarea
          aria-label="fstab"
          spellcheck={false}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
        />
        <pre aria-label="highlight"><code>
          <For each={parsed().lines}>{(line) => (
            <div class={lineClass(line)}>
              <span class="ln">{line.number}</span>
              <Show when={line.kind === "entry"} fallback={<span class={line.kind}>{line.raw || " "}</span>}>
                {renderFields(line)}
              </Show>
            </div>
          )}</For>
        </code></pre>
      </section>

      <Show when={parsed().diagnostics.length}>
        <ul>
          <For each={parsed().diagnostics}>
            {(item) => (
              <li class={item.severity}>
                L{item.line}:{item.column} {item.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </main>
  )
}

export default App
