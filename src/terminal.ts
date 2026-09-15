import type { PlannedCommand } from "./types.ts";
import { stripAnsi } from "./parsers.ts";

const encoder = new TextEncoder();
/** Write a complete string to a Deno stream, including partial writes. */
export function write(
  text: string,
  stream: "stdout" | "stderr" = "stderr",
): void {
  const bytes = encoder.encode(text);
  const writer = stream === "stdout" ? Deno.stdout : Deno.stderr;
  let offset = 0;
  while (offset < bytes.length) {
    offset += writer.writeSync(bytes.subarray(offset));
  }
}
/** Whether interactive input and terminal reporting are both available. */
export function isInteractive(): boolean {
  return Deno.stdin.isTerminal() && Deno.stderr.isTerminal();
}
/** Style only when terminal output permits color. */
export function color(text: string, code: number): string {
  return Deno.stderr.isTerminal() && !Deno.noColor
    ? `\x1b[${code}m${text}\x1b[0m`
    : text;
}
/** Print a standalone heading; execution already reports its own command headings. */
export function banner(title: string): void {
  write(color(`◆ ${title}`, 35) + "\n");
}
/** Shell-appropriate quoting for copyable display; never used to spawn processes. */
export function quoteArgument(
  value: string,
  shell: "sh" | "nu" | "powershell" = "sh",
): string {
  if (shell === "powershell") return "'" + value.replaceAll("'", "''") + "'";
  if (shell === "nu") {
    let marks = "#";
    while (value.includes(`'${marks}`)) marks += "#";
    return `r${marks}'${value}'${marks}`;
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
/** Render the resolved cwd, environment overrides, executable and arguments as one command. */
export function formatCommand(
  plan: PlannedCommand,
  shell: "sh" | "nu" | "powershell" = Deno.build.os === "windows"
    ? "powershell"
    : "sh",
): string {
  const q = (value: string) => quoteArgument(value, shell);
  const argv = plan.command.map(q).join(" ");
  const env = Object.entries(plan.env);
  if (shell === "nu") {
    const command = `^${argv}`;
    return `do { cd ${q(plan.cwd)}; ${
      env.length
        ? `with-env { ${
          env.map(([k, v]) => `${q(k)}: ${q(v)}`).join(", ")
        } } { ${command} }`
        : command
    } }`;
  }
  if (shell === "powershell") {
    // A nested scope restores cwd and only the explicitly overridden variables.
    const setup = env.map(([k, v]) =>
      `$dvEnv[${q(k)}] = [Environment]::GetEnvironmentVariable(${
        q(k)
      }, 'Process'); [Environment]::SetEnvironmentVariable(${q(k)}, ${
        q(v)
      }, 'Process');`
    ).join(" ");
    return `& { $dvEnv = @{}; Push-Location -LiteralPath ${
      q(plan.cwd)
    }; try { ${setup} & ${argv} } finally { foreach ($dvKey in $dvEnv.Keys) { [Environment]::SetEnvironmentVariable($dvKey, $dvEnv[$dvKey], 'Process') }; Pop-Location } }`;
  }
  return `(cd ${q(plan.cwd)} && ${
    env.length ? `env ${env.map(([k, v]) => q(`${k}=${v}`)).join(" ")} ` : ""
  }${argv})`;
}
export { createReporter } from "./reporting.ts";

/** Label and value for interactive completion and selection. */
export interface Choice {
  value: string;
  label: string;
  description?: string;
}
const fuzzy = (text: string, query: string): boolean => {
  let at = 0;
  text = text.toLowerCase();
  for (const char of query.toLowerCase()) {
    at = text.indexOf(char, at);
    if (at < 0) return false;
    at++;
  }
  return true;
};

function matchRank(choice: Choice, query: string): number {
  if (!query) return 0;
  const names = [choice.label, choice.value].map((name) => name.toLowerCase());
  query = query.toLowerCase();
  if (names.some((name) => name === query)) return 0;
  if (names.some((name) => name.startsWith(query))) return 1;
  if (names.some((name) => name.includes(query))) return 2;
  if (names.some((name) => fuzzy(name, query))) return 3;
  if (fuzzy(`${choice.label} ${choice.description ?? ""}`, query)) return 4;
  return Infinity;
}

/** Fuzzy selector with arrow navigation and Tab completion; Ctrl-C cancels. */
export async function choose(
  title: string,
  choices: readonly Choice[],
): Promise<string> {
  if (!choices.length) throw new Error(`${title}: no choices available`);
  if (!isInteractive()) {
    throw new Error(
      `${title}: selection requires a terminal. Choices: ${
        choices.map((c) => c.value).join(", ")
      }`,
    );
  }
  let query = "", index = 0, previousLines = 0;
  let matches = [...choices];
  const render = () => {
    if (previousLines) write(`\x1b[${previousLines}A\x1b[J`);
    matches = choices.map((choice, order) => ({
      choice,
      order,
      rank: matchRank(choice, query),
    })).filter((match) => Number.isFinite(match.rank))
      .sort((a, b) => a.rank - b.rank || a.order - b.order)
      .map((match) => match.choice);
    index = Math.max(0, Math.min(index, matches.length - 1));
    const start = Math.max(0, index - 5);
    const visible = matches.slice(start, start + 7);
    let width = 100;
    try {
      const columns = Deno.consoleSize().columns;
      if (columns > 0) width = columns;
    } catch { /* non-console fallback */ }
    const lines = [
      `${title}: ${query}`,
      ...visible.map((c, i) =>
        `${start + i === index ? "❯" : " "} ${c.label}${
          c.description ? ` — ${c.description}` : ""
        }`
      ),
      "↑/↓ choose · type to filter · Tab complete · Enter accept · Ctrl-C cancel",
    ];
    write(
      lines.map((line) =>
        stripAnsi(line).replace(/[\r\n]/g, " ").slice(
          0,
          Math.max(10, width - 2),
        )
      ).join("\n") + "\n",
    );
    previousLines = lines.length;
  };
  const decoder = new TextDecoder();
  const buffer = new Uint8Array(1024);
  let pendingEscape = "";
  Deno.stdin.setRaw(true);
  try {
    render();
    while (true) {
      const count = await Deno.stdin.read(buffer);
      if (count === null) throw new Error("Selection cancelled");
      const chunk = pendingEscape +
        decoder.decode(buffer.subarray(0, count), { stream: true });
      pendingEscape = "";
      if (chunk.includes("\x03") || chunk.includes("\x04")) {
        throw new Error("Selection cancelled");
      }
      for (let i = 0; i < chunk.length; i++) {
        const c = String.fromCodePoint(chunk.codePointAt(i)!);
        if (c.length === 2) i++;
        if (c === "\x03" || c === "\x04") {
          throw new Error("Selection cancelled");
        }
        if (c === "\x1b") {
          if (chunk.length - i < 3) {
            pendingEscape = chunk.slice(i);
            break;
          }
          const sequence = chunk.slice(i, i + 3);
          if (sequence === "\x1b[A") index = Math.max(0, index - 1);
          else if (sequence === "\x1b[B") {
            index = Math.min(matches.length - 1, index + 1);
          } else throw new Error("Selection cancelled");
          i += 2;
        } else if (c === "\r" || c === "\n") {
          if (matches[index]) return matches[index]!.value;
        } else if (c === "\t") {
          if (matches[index]) {
            query = matches[index]!.label;
            index = 0;
          }
        } else if (c === "\x7f" || c === "\b") {
          query = [...query].slice(0, -1).join("");
          index = 0;
        } else if (c >= " ") {
          query += c;
          index = 0;
        }
        render();
      }
    }
  } finally {
    Deno.stdin.setRaw(false);
  }
}
