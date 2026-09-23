import { isInteractive, write } from "./terminal.ts";
import {
  clip,
  color,
  displayWidth,
  environment,
  plain,
  supportsColor,
} from "./style.ts";
import { compareGroups, groupColor } from "./recipes.ts";

/** Values stay independent of styled labels, groups and argument signatures. */
export interface Choice {
  value: string;
  label: string;
  description?: string;
  group?: string;
  args?: string;
}
export interface PromptOptions {
  signal?: AbortSignal;
  interactive?: boolean;
}
export interface InputOptions extends PromptOptions {
  initial?: string;
  suggestions?: readonly string[];
  hint?: string;
  validate?: (value: string) => string | undefined;
}

const cancelled = () => new Error("Selection cancelled");
export function requireInteractive(options: PromptOptions = {}): void {
  if (options.signal?.aborted) throw cancelled();
  if (
    options.interactive === false || !isInteractive() ||
    environment("TERM") === "dumb"
  ) {
    throw new Error(
      "Selection requires an interactive terminal; invoke a recipe directly instead",
    );
  }
}
function positions(text: string, query: string): number[] | undefined {
  const chars = [...plain(text).toLowerCase()], found: number[] = [];
  let at = 0;
  for (const char of query.toLowerCase()) {
    at = chars.indexOf(char, at);
    if (at < 0) return;
    found.push(at++);
  }
  return found;
}
function rank(choice: Choice, query: string): number {
  if (!query) return 0;
  query = query.toLowerCase();
  const names = [choice.label, choice.value].map((v) => plain(v).toLowerCase());
  if (names.includes(query)) return 0;
  if (names.some((n) => n.startsWith(query))) return 1;
  if (names.some((n) => n.includes(query))) return 2;
  const gaps = names.map((n) => positions(n, query)).filter((v) =>
    v !== undefined
  );
  if (gaps.length) {
    return 3 +
      Math.min(...gaps.map((v) => ((v.at(-1) ?? 0) - v.length + 1) / 10000));
  }
  return query.split(/\s+/).every((word) =>
      positions(
        `${choice.label} ${choice.group ?? ""} ${choice.description ?? ""}`,
        word,
      )
    )
    ? 5
    : Infinity;
}
function highlighted(text: string, query: string, selected: boolean): string {
  const found = new Set(positions(text, query));
  return [...plain(text)].map((char, i) =>
    color(char, query && found.has(i) ? "1;4;36" : selected ? "1;36" : "1")
  ).join("");
}

// Keep a single pending read across an externally cancelled prompt. Never create
// competing stdin readers when a library caller immediately opens another prompt.
let pendingRead: Promise<string | null> | undefined;
const decoder = new TextDecoder();
async function readChunk(
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<string | null> {
  if (signal?.aborted) throw cancelled();
  pendingRead ??= (async () => {
    const buffer = new Uint8Array(4096);
    const count = await Deno.stdin.read(buffer);
    return count === null
      ? null
      : decoder.decode(buffer.subarray(0, count), { stream: true });
  })();
  let onAbort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([
      pendingRead,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(cancelled());
        if (timeoutMs !== undefined) timer = setTimeout(onAbort, timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
    pendingRead = undefined;
    return chunk;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One editor powers recipe search and argument input, including pasted input. */
async function promptEditor(
  title: string,
  choices: readonly Choice[],
  options: InputOptions,
  selection: boolean,
): Promise<string> {
  requireInteractive(options);
  let input = [...(options.initial ?? "")], cursor = input.length, index = 0;
  let error = "", escape = "", paste = false, painted = false;
  let matches: Choice[] = [], budget = 8;
  const query = () => input.join("");
  const completionStart = () => {
    let start = 0, quote = "", escaped = false;
    for (let i = 0; i < cursor; i++) {
      const char = input[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\" && quote !== "'") {
        escaped = true;
        continue;
      }
      if (quote) { if (char === quote) quote = ""; }
      else if (char === "'" || char === '"') quote = char;
      else if (/\s/.test(char)) start = i + 1;
    }
    return start;
  };
  const completionQuery = () =>
    selection
      ? query()
      : input.slice(completionStart(), cursor).join("").replace(/^["']/, "");
  const clear = () => {
    if (painted) write("\r\x1b[J");
    painted = false;
  };
  const render = () => {
    let columns = 100, rows = 24;
    try {
      ({ columns, rows } = Deno.consoleSize());
    } catch { /* fallback */ }
    columns = Math.max(1, columns - 1);
    rows = Math.max(2, rows - 1);
    budget = Math.max(1, rows - 4);
    const search = completionQuery();
    matches = choices.map((choice, order) => ({
      choice,
      order,
      score: rank(choice, search),
    }))
      .filter((m) => Number.isFinite(m.score))
      .sort((a, b) =>
        search
          ? a.score - b.score || a.order - b.order
          : compareGroups(a.choice.group ?? "", b.choice.group ?? "") ||
            a.order - b.order
      )
      .map((m) => m.choice);
    index = Math.max(0, Math.min(index, matches.length - 1));
    const prefix = clip(`${plain(title)} › `, Math.max(0, columns - 4));
    const space = Math.max(1, columns - displayWidth(prefix));
    let start = cursor;
    while (
      start > 0 &&
      displayWidth(input.slice(start - 1, cursor).join("")) < space - 1
    ) start--;
    const visibleInput = clip(input.slice(start).join(""), space);
    const lines = [color(prefix, "1;35") + visibleInput];
    const entries: { text: string; selected?: boolean }[] = [];
    let group: string | undefined;
    for (const [i, choice] of matches.entries()) {
      if (!search && choice.group && choice.group !== group) {
        group = choice.group;
        entries.push({ text: color(`[${plain(group)}]`, groupColor(group)) });
      }
      const badge = search && choice.group
        ? color(` [${plain(choice.group)}]`, groupColor(choice.group))
        : "";
      entries.push({
        selected: i === index,
        text: `${i === index ? color("❯", "1;36") : " "} ${
          highlighted(choice.label, search, i === index)
        }${choice.args ? color(` ${plain(choice.args)}`, 2) : ""}${badge}${
          choice.description
            ? color(`  ${plain(choice.description)}`, "2;3")
            : ""
        }`,
      });
    }
    const selectedRow = Math.max(0, entries.findIndex((r) => r.selected));
    const offset = Math.max(0, selectedRow - budget + 1);
    lines.push(...entries.slice(offset, offset + budget).map((r) => r.text));
    if (!entries.length) {
      lines.push(color(
        selection
          ? "  No matching recipes — edit your search"
          : "  Enter to accept",
        2,
      ));
    }
    if (rows > 4) {
      const current = matches[index];
      lines.push(
        color(
          error ||
            (selection ? current?.description ?? "" : options.hint ?? ""),
          error ? 31 : "2;3",
        ),
      );
      lines.push(
        color(
          `${matches.length ? index + 1 : 0}/${matches.length}${
            selection ? ` · ${choices.length} available` : " suggestions"
          }`,
          2,
        ),
      );
      lines.push(
        color(
          "↑/↓ choose · type to search · Tab complete · Enter accept · Esc cancel · Ctrl-U clear",
          2,
        ),
      );
    }
    clear();
    const frame = lines.slice(0, rows).map((line) =>
      clip(line, columns, supportsColor())
    );
    write(frame.join("\n") + "\n");
    const column = Math.min(
      columns - 1,
      displayWidth(prefix) + displayWidth(input.slice(start, cursor).join("")),
    );
    write(`\x1b[${frame.length}A\r${column > 0 ? `\x1b[${column}C` : ""}`);
    painted = true;
  };
  const move = (delta: number) => {
    index = Math.max(0, Math.min(matches.length - 1, index + delta));
  };
  const insert = (text: string) => {
    input.splice(cursor, 0, ...text);
    cursor += [...text].length;
    index = 0;
    error = "";
  };
  let result: string | undefined;
  Deno.stdin.setRaw(true);
  const resize = () => render();
  let resizing = false;
  try {
    try {
      Deno.addSignalListener("SIGWINCH", resize);
      resizing = true;
    } catch { /* unsupported */ }
    write("\x1b[?2004h");
    render();
    while (result === undefined) {
      let chunk = await readChunk(
        options.signal,
        escape ? (escape === "\x1b" ? 80 : 1000) : undefined,
      );
      if (chunk === null) throw cancelled();
      chunk = escape + chunk;
      escape = "";
      for (let i = 0; i < chunk.length; i++) {
        const c = String.fromCodePoint(chunk.codePointAt(i)!);
        if (c.length === 2) i++;
        if (c === "\x03" || c === "\x04") throw cancelled();
        if (c === "\x1b") {
          const rest = chunk.slice(i);
          if (rest === "\x1b") {
            escape = rest;
            break;
          }
          // deno-lint-ignore no-control-regex
          const match = rest.match(/^\x1b(?:\[[0-?]*[ -/]*[@-~]|O[A-Z])/);
          if (!match) {
            escape = rest;
            break;
          }
          const key = match[0];
          i += key.length - 1;
          if (key === "\x1b[200~") paste = true;
          else if (key === "\x1b[201~") paste = false;
          else if (!paste) {
            if (key === "\x1b[A") move(-1);
            else if (key === "\x1b[B") move(1);
            else if (key === "\x1b[C") {
              cursor = Math.min(input.length, cursor + 1);
            } else if (key === "\x1b[D") cursor = Math.max(0, cursor - 1);
            else if (["\x1b[H", "\x1bOH", "\x1b[1~"].includes(key)) cursor = 0;
            else if (["\x1b[F", "\x1bOF", "\x1b[4~"].includes(key)) {
              cursor = input.length;
            } else if (key === "\x1b[3~") {
              input.splice(cursor, 1);
              index = 0;
            } else if (key === "\x1b[5~") move(-budget);
            else if (key === "\x1b[6~") move(budget);
          }
        } else if ((c === "\r" || c === "\n") && !paste) {
          const answer = selection ? matches[index]?.value : query();
          if (answer !== undefined) {
            error = options.validate?.(answer) ?? "";
            if (!error) {
              result = answer;
              break;
            }
          }
        } else if (c === "\t" && !paste) {
          const choice = matches[index];
          if (choice) {
            if (selection) {
              input = [...choice.label];
              cursor = input.length;
            } else {
              const count = cursor - completionStart();
              input.splice(cursor - count, count, ...choice.value);
              cursor += [...choice.value].length - count;
            }
            index = 0;
          }
        } else if (c === "\x01") cursor = 0;
        else if (c === "\x05") cursor = input.length;
        else if (c === "\x15") {
          input = [];
          cursor = 0;
          index = 0;
        } else if (c === "\x17") {
          const before = input.slice(0, cursor).join("");
          const count = [...(before.match(/\S*\s*$/)?.[0] ?? "")].length;
          input.splice(cursor - count, count);
          cursor -= count;
          index = 0;
        } else if (c === "\x7f" || c === "\b") {
          if (cursor > 0) input.splice(--cursor, 1);
          index = 0;
        } else if (paste && /[\r\n\t]/.test(c)) insert(" ");
        else if (c >= " ") insert(c);
        render();
      }
    }
    return result;
  } finally {
    if (resizing) Deno.removeSignalListener("SIGWINCH", resize);
    try {
      clear();
      write("\x1b[?2004l");
    } finally {
      Deno.stdin.setRaw(false);
    }
    if (result !== undefined) {
      const label = selection
        ? choices.find((c) => c.value === result)?.label ?? result
        : result || "default";
      write(`${color("✓", 32)} ${plain(title)}: ${plain(label)}\n`);
    }
  }
}

export function choose(
  title: string,
  choices: readonly Choice[],
  options: PromptOptions = {},
): Promise<string> {
  if (!choices.length) {
    return Promise.reject(new Error(`${title}: no choices available`));
  }
  return promptEditor(title, choices, options, true);
}
export function readInput(
  title: string,
  options: InputOptions = {},
): Promise<string> {
  return promptEditor(
    title,
    (options.suggestions ?? []).map((value) => ({ value, label: value })),
    options,
    false,
  );
}
