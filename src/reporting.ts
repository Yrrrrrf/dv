import type {
  CommandResult,
  ExecOptions,
  PlannedCommand,
  Reporter,
} from "./types.ts";
import { resolvePath } from "./paths.ts";
import { stripAnsi } from "./parsers.ts";
import { clip, displayWidth, plain, sanitize, supportsColor } from "./style.ts";
export { displayWidth, plain } from "./style.ts";
import { color, formatCommand, quoteArgument, write } from "./terminal.ts";

/** Compact timing shared by suites and pipelines. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function clamp(text: string, width: number): string {
  return clip(text, width);
}
const styledLog = (text: string): string => {
  const value = sanitize(text, supportsColor());
  return value.includes("\x1b[") ? value + "\x1b[0m" : value;
};
const pad = (text: string, width: number): string =>
  plain(text) + " ".repeat(Math.max(0, width - displayWidth(text)));

/** Human preview. Exact reproducible commands remain available through formatCommand. */
export function conciseCommand(plan: PlannedCommand): string {
  const args = plan.command.map((arg, i) => {
    if (i === 0 && /(?:^|[/\\])deno(?:\.exe)?$/.test(arg)) return "deno";
    if (arg.startsWith(plan.root + "/")) return arg.slice(plan.root.length + 1);
    return arg;
  });
  return args.map((arg) =>
    /^[\w@./:=,+*-]+$/.test(arg) ? arg : quoteArgument(arg)
  ).join(" ");
}

/** Explicit counts only; a successful process is not evidence of zero diagnostics. */
export function resultBadge(result: CommandResult): string {
  const stats = Object.entries(result.diagnostics)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => `${value} ${key}`).join(", ");
  const status = result.aborted
    ? (result.code === 124 ? "timed out" : "cancelled")
    : !result.success
    ? `exit ${result.code}`
    : result.gate?.success === false
    ? "gate failed"
    : "✓ success";
  return `${stats ? `(${stats})` : status}${
    stats && status !== "✓ success" ? ` · ${status}` : ""
  } (${formatDuration(result.durationMs)})`;
}

interface Row {
  plan: PlannedCommand;
  started?: number;
  result?: CommandResult;
  skipped?: string;
  tail: string[];
}

/** Render grouped rows in declaration order; never reorder by completion time. */
function rowsText(
  rows: readonly Row[],
  frame: string,
  width: number,
): string[] {
  const engines = rows.map((r) => r.plan.engine ?? r.plan.parser);
  const names = rows.map((r) => r.plan.name);
  const ew = Math.min(24, Math.max(0, ...engines.map(displayWidth)));
  const nw = Math.min(24, Math.max(0, ...names.map(displayWidth)));
  const groups = [...new Set(rows.map((r) => r.plan.group ?? "WORKSPACE"))];
  return groups.flatMap((group, gi) => [
    ...(gi ? [""] : []),
    color(`[${plain(group)}]`, 35),
    ...rows.filter((r) => (r.plan.group ?? "WORKSPACE") === group).map((r) => {
      const status = r.result
        ? resultBadge(r.result)
        : r.skipped
        ? `skipped · ${r.skipped}`
        : r.started !== undefined
        ? `${frame} running (${formatDuration(performance.now() - r.started)})`
        : "pending";
      const line = clamp(
        `  ❯❯ ${pad(clamp(r.plan.engine ?? r.plan.parser, ew), ew)} ${
          pad(clamp(r.plan.name, nw), nw)
        } ${status}`,
        width,
      );
      return line.replace("❯❯", color("❯❯", 36))
        .replace(
          /(\d+) (passed|failed|errors|warnings|skipped)/g,
          (text, count: string, label: string) =>
            color(
              text,
              Number(count) === 0
                ? 90
                : label === "passed"
                ? 32
                : label === "warnings" || label === "skipped"
                ? 33
                : 31,
            ),
        )
        .replace("✓ success", color("✓ success", 32));
    }),
  ]);
}

function terminalSize(): { columns: number; rows: number } {
  try {
    return Deno.consoleSize();
  } catch {
    return { columns: 100, rows: 24 };
  }
}
function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** OSC 8 links for common diagnostic file:line:column forms, relative to the child cwd. */
export function linkifyDiagnostics(text: string, cwd: string): string {
  if (!Deno.stderr.isTerminal() || env("TERM") === "dumb") return text;
  return text.replace(
    /((?:[A-Za-z]:)?[\w./\\-]+\.(?:tsx?|jsx?|svelte|vue)):(\d+)(?::(\d+))?/g,
    (display, path: string, line: string, column: string | undefined) => {
      const absolute = resolvePath(path, cwd);
      const url = new URL("file:///");
      url.pathname = absolute.startsWith("/") ? absolute : "/" + absolute;
      url.hash = `L${line}${column ? `C${column}` : ""}`;
      return `\x1b]8;;${url.href}\x1b\\${display}\x1b]8;;\x1b\\`;
    },
  );
}

/** Determine whether execution should bypass framing and run with direct stdio. */
export function isRawExecution(options: ExecOptions): boolean {
  return !options.dryRun &&
    (options.raw ??
      (options.select === "one" && !options.all && !options.quiet));
}

/** Borderless suite dashboard with bounded logs and append-only CI fallback. */
export function createReporter(options: ExecOptions = {}): Reporter {
  if (isRawExecution(options)) return () => {};
  let rows: Row[] = [],
    height = 0,
    timer: ReturnType<typeof setInterval> | undefined;
  let live = false, frame = 0, finished = false, title = "RUN";
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const clear = () => {
    if (height) write(`\x1b[${height}A\r\x1b[J`);
    height = 0;
  };
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (live) {
      clear();
      write("\x1b[?25h");
    }
    live = false;
  };
  const paint = () => {
    if (!live) return;
    const size = terminalSize();
    const tail = options.verbose
      ? []
      : rows.find((r) => r.started !== undefined && !r.result)?.tail.slice(
        -3,
      ) ?? [];
    const lines = [
      ...tail.map((l) =>
        `    │ ${clip(l, Math.max(1, size.columns - 8), supportsColor())}`
      ),
      ...rowsText(
        rows,
        frames[frame++ % frames.length]!,
        Math.max(1, size.columns - 2),
      ),
    ];
    // Once resized below the required viewport, permanently degrade this suite.
    if (lines.length >= size.rows - 2) {
      stop();
      return;
    }
    clear();
    write(lines.join("\n") + "\n");
    height = lines.length;
  };
  const block = (heading: string, lines: string[], cwd = Deno.cwd()) => {
    if (!lines.length) return;
    clear();
    write(
      `\n  ${plain(heading)}\n` +
        lines.map((l) => `    │ ${linkifyDiagnostics(styledLog(l), cwd)}`).join(
          "\n",
        ) + "\n\n",
    );
    paint();
  };
  return (event) => {
    if (event.type === "close") {
      stop();
      return;
    }
    const command = event.type === "output" || event.type === "start"
      ? event.command
      : event.type === "finish"
      ? event.result
      : undefined;
    const settings = {
      ...options,
      ...Object.fromEntries(
        Object.entries(command?.output ?? {}).filter(([, value]) =>
          value !== undefined
        ),
      ),
    };
    if (settings.quiet) return;
    if (event.type === "plan") {
      stop();
      finished = false;
      title = event.title;
      rows = event.planned.map((plan) => ({
        plan,
        tail: [],
        skipped: plan.skip,
      }));
      write(
        `\n${
          color(`◆ ${plain(event.title)}${event.dryRun ? " · plan" : ""}`, 35)
        }\n`,
      );
      if (options.commands !== "none") {
        for (const p of event.planned) {
          const display = options.commands === "full"
            ? formatCommand(p, options.shell)
            : p.label ?? conciseCommand(p);
          write(
            `  ${options.commands === "full" ? display : plain(display)}\n`,
          );
        }
      }
      const size = terminalSize();
      live = !event.dryRun && options.report !== "plain" &&
        options.report !== "stream" &&
        Deno.stderr.isTerminal() && !["true", "1"].includes(env("CI") ?? "") &&
        env("TERM") !== "dumb" &&
        rowsText(rows, "", size.columns).length + 3 < size.rows - 2;
      if (live) {
        write("\x1b[?25l");
        paint();
        timer = setInterval(paint, 100);
      }
      return;
    }
    if (event.type === "start") {
      const row = rows.find((r) => r.plan.id === event.command.id);
      if (row) row.started = performance.now();
      if (options.report === "stream") {
        write(
          `❯ ${plain(event.command.label ?? conciseCommand(event.command))}\n`,
        );
      }
      paint();
    } else if (event.type === "output") {
      const row = rows.find((r) => r.plan.id === event.command.id);
      const lines = event.text.split(/\r?\n/).filter(Boolean).map(styledLog);
      if (row) {
        row.tail = [
          ...row.tail,
          ...lines.map((l) => clip(l, 180, supportsColor())),
        ].slice(-5);
      }
      const stream = settings.logs === "stream" || options.report === "stream";
      // Unknown tools and readiness URLs remain observable during long-running work.
      if (
        (stream && settings.verbose) || event.command.parser === "raw" ||
        /https?:\/\//.test(event.text)
      ) {
        clear();
        for (const line of lines) {
          write(`[${plain(event.command.id)}] ${line}\n`);
        }
        paint();
      }
    } else if (event.type === "finish") {
      const r = event.result, row = rows.find((row) => row.plan.id === r.id);
      if (row) row.result = r;
      const lines = (r.stdout + "\n" + r.stderr).split(/\r?\n/).filter(Boolean);
      if (
        settings.verbose && settings.logs !== "stream" &&
        options.report !== "stream" && r.parser !== "raw"
      ) {
        block(r.label ?? conciseCommand(r), lines, r.cwd);
      } else if (!r.success && !settings.verbose && r.parser !== "raw") {
        block(`Failed: ${r.id}`, lines.slice(-15), r.cwd);
      } else if (!settings.verbose && r.parser !== "raw") {
        block(
          `Warnings: ${r.id}`,
          lines.filter((l) => /\bwarn(?:ing)?\b/i.test(stripAnsi(l))).slice(-8),
        );
      }
      if (r.gate?.reasons.length) block(`Gate: ${r.id}`, r.gate.reasons);
      if (r.parserError) block(`Parser: ${r.id}`, [r.parserError]);
      if (r.truncated) {
        block(r.id, [
          "Output truncated: retained head and tail; diagnostic totals unavailable.",
        ]);
      }
      if (options.report === "stream") {
        write(
          `${r.success && r.gate?.success !== false ? "✓" : "✗"} ${
            plain(r.id)
          } ${resultBadge(r)}\n`,
        );
      }
      paint();
    } else if (event.type === "summary") {
      const s = event.summary;
      for (const result of s.results) {
        const row = rows.find((r) => r.plan.id === result.id);
        if (row) row.result = result;
      }
      for (const p of s.skipped) {
        const row = rows.find((r) => r.plan.id === p.id);
        if (row) {
          row.skipped = p.skip ??
            (s.preparation?.success === false
              ? "preparation failed"
              : "not scheduled");
        }
      }
      stop();
      if (!s.dryRun && options.report !== "stream") {
        write("\n" + rowsText(rows, "", Infinity).join("\n") + "\n");
      }
      const failed = s.results.filter((r) =>
        !r.success || r.gate?.success === false
      ).length;
      write(
        `\n${
          s.dryRun ? "◇ Planned" : s.success ? "✓ Completed" : "✗ Failed"
        }: ${
          plain(title)
        } · ${s.planned.length} commands, ${failed} failed, ${s.skipped.length} skipped (total: ${
          formatDuration(s.durationMs)
        })\n`,
      );
      if (options.benchmark && !s.dryRun) {
        write(`  Child time: ${
          formatDuration(s.results.reduce((n, r) => n + r.durationMs, 0))
        }\n`);
      }
      finished = true;
    }
    if (finished) stop();
  };
}
