/** Command-line frontend for @yrrrrrf/dv. Importing it performs no work. */
import { batch, exec, ExecutionError } from "../exec.ts";
import { matrix } from "../matrix.ts";
import { RemovalError, rm } from "../remove.ts";
import { banner, write } from "../terminal.ts";
import { parseArgs } from "./args.ts";
import { withSignals } from "../signals.ts";
import type { RemoveOptions } from "../remove.ts";

/** Package version, shared by the CLI and public API. */
export const VERSION = "0.2.0";
/** CLI help, kept beside the actual option parser. */
export const HELP = `dv ${VERSION} — commands, composed.

  dv exec [target] [options] -- <executable> [arguments...]
  dv batch --specs '[{"command":["deno","check","mod.ts"]}]' [options]
  dv matrix --rules '[{"packages":"apps/*","pattern":"apps/*/mod.ts","command":["deno","check","{file}"]}]' [options]
  dv rm --paths '["build","coverage"]' [options]
  dv rm [--glob | --regex] [--root path] [--dry-run] <paths...>
  dv list [--justfile path] [--json]
  dv menu [--justfile path] [--complete recipe patterns...]
  dv banner <text...>

Execution:
  --title text             Suite heading (default RUN)
  --group text             Display group; independent of cwd
  --engine text            Engine label; independent of parser
  --name text              Target label; independent of cwd
  --label text             Concise command description
  --report auto|plain|stream  Live grouped, static grouped, or event stream
  --commands concise|full|none  Human preview or exact shell replay
  --logs group|stream      Verbose logs per completed command or live stream
  --filter text            Select multiple targets by name/path substring
  --before JSON            Sequential preparation command specs before workers
  --skip reason            Intentionally skip a command with an explanation
  --scope selected|declared Matrix target selection or full declared scope
  --match first|all        Matrix rule ownership; default first
  --max-errors N           Fail the gate above observed errors
  --max-warnings N         Fail the gate above observed warnings
  --min-score N            Fail the gate below observed score
  --cwd paths...           Directory paths/globs; default current directory
  --root path              Root for discovery and {root}; default current directory
  --mode path|glob|regex    Directory/file matching mode; default glob
  --exclude patterns...    Excluded project-relative glob patterns
  --select one|all         Enable target selection; missing target prompts or selects all
  --target name            Explicit target (or use the positional target)
  -A, --all                Select all targets, including --select one
  -p, --parallel           Run independent children concurrently
  -j, --jobs N             Enable concurrency with a maximum of N children
  -v, --verbose            Show captured tool logs; grouped unless --logs stream
  -b, --benchmark          Include aggregate child time; ordinary timings always shown
  --files patterns...      Expand a standalone {files} token into file arguments
  --env KEY=value          Repeatable child environment override
  --parser name            auto, raw, svelte-check, typescript, deno-test, deno-fmt, deno-lint, vitest, biome, fallow, vite
  --timeout ms             Per-child timeout (exit 124)
  --max-output bytes       Capture limit per stream; default 2097152
  --stdin inherit|null     Default null; inherited stdin requires sequential work
  --shell sh|nu|powershell  Shell for copyable display only
  --fail-fast              Stop scheduling on failure; active children finish
  --dry-run                Print the resolved execution plan without spawning
  --no-interactive         Reject any selection requiring a prompt
  --json                   Emit a machine-readable result, without terminal reporting
  --quiet                  Suppress the default reporter

Arguments after -- are passed unchanged, except explicit {root}, {cwd}, {name},
and {files} placeholders. Unknown commands use raw output and real process status.
Just is needed only by list/menu. Import createPipeline for TypeScript wiring.
`;

/** Run the CLI and return its exit status without terminating an importing process. */
export async function main(
  args: readonly string[] = Deno.args,
): Promise<number> {
  let json = false;
  try {
    const [command = "--help", ...rest] = args;
    if (["--help", "-h", "help"].includes(command)) {
      write(HELP, "stdout");
      return 0;
    }
    if (command === "--version" || command === "-V") {
      write(VERSION + "\n", "stdout");
      return 0;
    }
    if (command === "banner") {
      banner(rest.join(" "));
      return 0;
    }
    if (command === "exec" || command === "batch" || command === "matrix") {
      const parsed = parseArgs(rest);
      json = parsed.json;
      if (parsed.help) {
        write(HELP, "stdout");
        return 0;
      }
      if (command === "exec" && !parsed.command.length) {
        throw new Error("Use exec [options] -- <executable> [arguments...]");
      }
      if (command !== "exec" && parsed.command.length) {
        throw new Error(
          `${command} takes inline JSON declarations, not a child command`,
        );
      }
      if (command === "batch" && !parsed.specs) {
        throw new Error("batch requires --specs JSON");
      }
      if (command === "matrix" && !parsed.rules) {
        throw new Error("matrix requires --rules JSON");
      }
      const summary = await withSignals((signal) => {
        const opts = { ...parsed.options, signal, throwOnError: false };
        return command === "matrix"
          ? matrix(parsed.rules!, {
            ...opts,
            match: parsed.match,
            scope: parsed.scope,
          })
          : command === "batch"
          ? batch(parsed.specs!, opts)
          : exec(parsed.command, opts);
      });
      if (json) write(JSON.stringify(summary) + "\n", "stdout");
      return summary.code;
    }
    if (
      command === "rm" &&
      rest.some((a) => a === "--paths" || a.startsWith("--paths="))
    ) {
      const parsed = parseArgs(rest);
      json = parsed.json;
      const result = await rm(parsed.paths ?? [], {
        root: parsed.options.root,
        dryRun: parsed.options.dryRun,
        quiet: parsed.options.quiet,
        mode: parsed.options.mode ?? "path",
        exclude: parsed.options.exclude,
      });
      if (json) write(JSON.stringify(result) + "\n", "stdout");
      return 0;
    }
    if (command === "rm") {
      const options: RemoveOptions = {}, paths: string[] = [];
      let literal = false;
      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i]!;
        if (arg === "--" && !literal) {
          literal = true;
          continue;
        }
        if (!literal && (arg === "--glob" || arg === "--regex")) {
          if (options.mode) throw new Error("Choose one removal matching mode");
          options.mode = arg === "--glob" ? "glob" : "regex";
        } else if (!literal && arg === "--root") {
          options.root = rest[++i];
          if (!options.root) throw new Error("--root requires a path");
        } else if (!literal && arg === "--dry-run") options.dryRun = true;
        else if (!literal && arg === "--quiet") options.quiet = true;
        else if (!literal && arg === "--json") {
          json = true;
          options.quiet = true;
        } else if (!literal && arg.startsWith("-")) {
          throw new Error(`Unknown rm option: ${arg}`);
        } else paths.push(arg);
      }
      const result = await rm(paths, options);
      if (json) write(JSON.stringify(result) + "\n", "stdout");
      return 0;
    }
    if (command === "list" || command === "menu") {
      let justfile = "justfile";
      const complete: Record<string, string[]> = {};
      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i]!;
        if (arg === "--justfile") {
          justfile = rest[++i] ?? "";
          if (!justfile) throw new Error("--justfile requires a path");
        } else if (arg === "--json" && command === "list") json = true;
        else if (arg === "--complete" && command === "menu") {
          const name = rest[++i];
          if (!name || name.startsWith("-")) {
            throw new Error("--complete requires a recipe and patterns");
          }
          const patterns: string[] = [];
          while (i + 1 < rest.length && !rest[i + 1]!.startsWith("--")) {
            patterns.push(rest[++i]!);
          }
          if (!patterns.length) {
            throw new Error("--complete requires directory patterns");
          }
          complete[name] = [...complete[name] ?? [], ...patterns];
        } else throw new Error(`Unknown ${command} option: ${arg}`);
      }
      const { listJust, menuJust, readJust } = await import("../just.ts");
      if (command === "list") {
        write(
          json
            ? JSON.stringify(await readJust(justfile)) + "\n"
            : await listJust(justfile),
          "stdout",
        );
        return 0;
      }
      return await withSignals((signal) =>
        menuJust(justfile, { complete, signal })
      );
    }
    throw new Error(`Unknown command: ${command}. Use --help.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      write(
        JSON.stringify({
          success: false,
          error: message,
          ...(error instanceof RemovalError ? { result: error.result } : {}),
        }) + "\n",
        "stdout",
      );
    } else write(`dv: ${message}\n`);
    if (error instanceof ExecutionError) return error.summary.code;
    if (error instanceof RemovalError) return 1;
    if (message === "Selection cancelled") return 130;
    return 2;
  }
}

if (import.meta.main) Deno.exit(await main());
