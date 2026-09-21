# @yrrrrrf/dv

**Commands, composed.** A Deno CLI and TypeScript library for discovery,
heterogeneous command matrices, preparation, execution, and grouped terminal
reporting. MIT licensed. Deno 2.9.5+. No runtime dependencies, Node/Bun
launcher, or implicit project configuration file.

This is the **0.2.0 source distribution**. Registry examples apply after
publishing. The package remains `@yrrrrrf/dv` on JSR; there is no npm release in
this project.

## Two independent consumers

`example/pipeline.ts` declares its entire graph in TypeScript and imports dv.
`example/justfile` independently declares the same recipes and wires them using
Just + Nushell and dv's CLI. Neither example executes or imports the other.
There is no shared workflow declaration hidden in another file.

The Just example calls `deno run -A ../src/mod.ts`: the exact module exported by
the package's `.` entrypoint. After publication, that becomes
`deno run -A jsr:@yrrrrrf/dv`.

From the package directory:

```sh
# Deno only
deno run -A example/pipeline.ts list
deno run -A example/pipeline.ts cycle -p
deno run -A example/pipeline.ts test alpha -v
deno run -A example/pipeline.ts preview alpha

# Independent Just + Nushell wiring (tested with Just 1.58.0 / Nu 0.115.1)
just --justfile example/justfile list
just --justfile example/justfile cycle -p
just --justfile example/justfile test alpha -v
just --justfile example/justfile preview alpha

# Both respect dry-run throughout prune, prepare, checks, and build
deno run -A example/pipeline.ts cycle -pb --dry-run
just --justfile example/justfile cycle -pb --dry-run
```

From inside `example/`, use `deno run -A pipeline.ts ...` or `just ...`. The
example builds copies of the two app modules and previews them on
`127.0.0.1:9411` and `127.0.0.1:9412`.

Just composes recipes with explicit Nushell calls and argv spreads, checking the
exit status before the next dependency. This preserves quoted values and
forwards flags to every stage. See the
[Just manual](https://just.systems/man/en/) for its recipe and argument model.
dv itself does not require Nushell or Just; only the Just consumer does.

## Grouped output

Illustrative output (durations vary):

```text
◆ TEST
  deno test apps/alpha/mod_test.ts
  deno test apps/beta/mod_test.ts

[APPS]
  ❯❯ deno test alpha (1 passed, 0 failed, 0 skipped) (24ms)
  ❯❯ deno test beta  (1 passed, 0 failed, 0 skipped) (22ms)

✓ Completed: TEST · 2 commands, 0 failed, 0 skipped (total: 26ms)
```

Rows remain in declaration order within groups, even when children finish out of
order. Cwd, package identity, engine label, and parser are separate. Ordinary
results always include elapsed time; `-b` also shows aggregate child time.
Source files are never counted and presented as checker-verified files. Missing
metrics remain absent. A silent successful check displays `✓ success`.

- `--report auto` (default): live pending/running/result rows on suitable
  terminals; static grouped output in CI, redirected output, dumb or small
  terminals.
- `--report plain`: grouped append-only output without cursor movement.
- `--report stream`: start/completion events with live output when eligible.
- `-v`: grouped captured logs when each recognized command finishes.
- `-v --logs stream`: live per-target verbose logs, useful for persistent
  processes.
- `--commands concise|full|none`: human preview, exact shell replay, or no
  manifest.
- `--shell sh|nu|powershell`: affects full command display only, never
  execution.
- `-r, --raw`: direct interactive execution with inherited stdio, full TTY
  interactivity, no test-suite framing, and clean Ctrl-C shutdown (default for
  `--select one`).
- `--no-raw`: disable raw execution even when `--select one` is active.
- `--quiet`: silence the built-in reporter.
- `--json`: machine-readable results, no built-in terminal output or selection
  prompt.

Unknown tools retain live output. URL lines remain visible for readiness.
Successful recognized commands expose bounded warning excerpts. Failures show a
labeled tail of captured output; `-v` shows the retained capture. Common
`file.ts:line:column` diagnostics become OSC 8 links on terminals. Logs are
sanitized for terminal control sequences; unmodified per-stream bytes are
decoded into structured results until the capture limit is reached.

The live view refreshes at most every 100ms between events. It restores the
cursor on normal completion, cancellation, and errors, and falls back to static
output when the terminal becomes too small. Width handling covers common wide
characters; complex joined emoji may still vary across terminal implementations.

## Interactive execution (Dev and preview servers)

For persistent, interactive servers like `run` (`vite dev`, `deno run`) or
`preview` (`vite preview`):

- **Default for `--select one`**: Targeting a single application via
  `--select one` automatically enters **raw mode**. Target selection
  (interactive menu or positional argument) runs first, and stdio is handed
  directly to the selected child.
- **Direct TTY & input**: Standard input, output, and error streams are
  inherited (`inherit`), enabling internal keyboard shortcuts (e.g. Vite's `h`,
  `r`, `q`), native terminal colors, and cursor manipulation.
- **No test-suite framing**: Diagnostic banners (`◆ TITLE`), duration timers,
  and live spinners are silenced so the server's output is unhindered.
- **Clean `Ctrl-C` shutdown**: Stopping the interactive server via `Ctrl-C`
  (SIGINT / exit code 130) is treated as normal completion (`code: 0`,
  `success: true`), avoiding red failure boxes or recipe failures. Real server
  crashes (exit code 1) continue to propagate their error exit codes.
- **Explicit override**: Pass `-r` or `--raw` to force raw mode on any
  execution, or `--no-raw` to retain the dashboard format with `--select one`.

## Commands and API

```sh
deno run -A src/mod.ts exec --title TYPES --cwd 'apps/*' -- deno check mod.ts
deno run -A src/mod.ts exec alpha --select one --cwd 'apps/*' -- deno run mod.ts
deno run -A src/mod.ts batch --title CHECK --specs '[
  {"command":["deno","fmt","--check","src"]},
  {"command":["deno","lint","src"]}
]' -p
deno run -A src/mod.ts rm --paths '["build","coverage"]' --dry-run
deno run -A src/mod.ts --help
```

```ts
import { batch, exec, plan, rm } from "jsr:@yrrrrrf/dv";

await exec(["deno", "check", "mod.ts"], {
  title: "TYPES",
  cwd: ["apps/*"],
  parallel: true,
  jobs: 4,
});
await batch([
  { command: ["deno", "fmt", "--check", "src"], engine: "deno fmt" },
  { command: ["deno", "lint", "src"], engine: "deno lint" },
], { title: "CHECK", parallel: true });
await plan(["deno", "check", "{files}"], { files: ["src/**/*.ts"] });
await rm(["build", "coverage"], { dryRun: true });
```

`exec()` / `batch()` accept argv vectors. Shell evaluation only occurs when the
caller explicitly invokes a shell. Arguments after CLI `--` remain intact except
for explicit `{root}`, `{cwd}`, `{name}`, and standalone `{files}` substitution.
The first executable `deno` resolves to the running `Deno.execPath()`.

Directory/file flags are vectors: `--cwd`, `--files`, `--exclude`. Put a
positional target before vectors. Repeat flags to extend a vector, or use
`--cwd=-leading-dash`. Files expand to separate absolute argv entries and are
discovered relative to root, not separately within each selected cwd.

`id`, `targetName` (`--name`), `group`, `engine`, and `label` describe commands.
`label` can replace a long command preview; it never changes the executed argv.
`parser` is independent of `engine`. Batch-only options are `parallel`, `jobs`,
`dryRun`, `failFast`, `throwOnError`, and `before`.

## Declarative matrices

A matrix classifies packages by matching files or directories, then produces
ordinary batch command specifications. Package roots are explicit and may be
nested arbitrarily. There is no fixed SDK/apps layout or depth limit.

```ts
import { matrix } from "jsr:@yrrrrrf/dv";

await matrix([
  {
    packages: ["sdk/*"],
    pattern: "sdk/**/*.svelte.ts",
    engine: "svelte-check-native",
    cwd: "{root}",
    command: [
      "deno",
      "run",
      "-A",
      "npm:svelte-check-native",
      "--tsconfig",
      "sdk/tsconfig.json",
      "--config",
      "{package}/vite.config.ts",
    ],
  },
  {
    packages: ["sdk/*"],
    pattern: "sdk/**/src/mod.ts",
    engine: "deno",
    command: ["deno", "check", "{file}"],
  },
], { title: "TYPES", parallel: true });
```

The same declaration is available directly to Just/Nushell:

```nu
let rules = [
    {packages: 'apps/*', pattern: 'apps/*/src/App.vue', engine: vue-tsc,
     cwd: '{root}', command: [deno run -A 'npm:vue-tsc@3.3.11' -p '{package}/tsconfig.json' --noEmit]}
    {packages: 'apps/*', pattern: 'apps/*/src/App.tsx', engine: tsc,
     cwd: '{root}', command: [deno run -A 'npm:typescript@6/tsc' -p '{package}/tsconfig.json' --noEmit]}
]
^deno run -A ../src/mod.ts matrix --title TYPES --rules ($rules | to json --raw) -p
```

Rule fields: `packages`, `pattern`, `command`, optional `id`, `cwd`, `group`,
`engine`, `label`, `parser`, `env`, `skip`, and `gate`.

- Patterns and package globs are root-relative; they are globs regardless of
  exec's `mode`. Every matched file/directory must be within the classified
  package.
- Default `match: "first"` / `--match first`: the first matching rule owns a
  package.
- `match: "all"`: run all applicable rules, with separate command identities.
- `{package}`: absolute package root; default cwd is `{package}`.
- `{file}`: first matching entry in deterministic path order.
- Standalone `{files}`: all matching entries as individual arguments.
- `{name}`, `{relative}`, `{root}`: package basename, relative package path,
  root.
- `scope: "selected"` (default) respects an explicit target; otherwise all
  packages.
- `scope: "declared"` / `--scope declared` ignores forwarded target selection,
  useful for a full type gate alongside a selected app build.
- `filter` / `--filter` selects by path/name substring in either scope.
- No applicable targets is an error. `skip: "reason"` explicitly records an
  intentionally omitted target. Use exclusions to avoid generated output.

`planMatrix()` returns command specifications without starting processes.

## Preparation and quality policies

Use `before` for sequential prerequisite command specs completed once per batch,
before parallel workers start. Preparation defaults to the workspace root, even
when the main commands target multiple app directories. Its specs can declare
other cwd/env values. A failure blocks every main command and retains its
original code and results in `RunSummary.preparation`.

```ts
await exec(["deno", "check", "mod.ts"], {
  cwd: ["apps/*"],
  parallel: true,
  before: [{ command: ["deno", "install"] }],
});
```

```sh
deno run -A src/mod.ts exec --cwd 'apps/*' \
  --before '[{"command":["deno","install"]}]' -- deno check mod.ts
```

Commands are discovered/planned before preparation runs. Preparation may install
compatibility dependencies, but cannot create missing target directories or
input files required by discovery. Dry-run plans both phases and executes
neither. There is no global preparation cache; installation/pruning cannot leave
stale "already prepared" state inside dv. Shared filesystem setup finishes
before fan-out.

Workspace-specific compatibility code belongs to its consumer. GWA can wire
`ensureNodeCompat()` before each relevant gate through its own task/helper
command; dv does not pin GWA tools or patch their packages. A child cannot
export environment changes back to its parent: pass discovered values via `env`
/ `--env`, or perform setup and execution inside the same process. See
`example/gwa.md` for the boundary.

Optional policies: `gate: { maxErrors: 0, maxWarnings: 0, minScore: 80 }`, or
`--max-errors`, `--max-warnings`, `--min-score`. Use only relevant thresholds. A
missing/truncated metric fails the requested policy with an explanation.
`CommandResult.code` and `.success` retain process status; `.gate` records the
separate policy outcome. `RunSummary.success/code` include policy failures (code
1).

## TypeScript pipeline lifecycle

```ts
import { createPipeline } from "jsr:@yrrrrrf/dv";

const pipeline = createPipeline({
  test: { run: ({ exec }) => exec(["deno", "test"]) },
  check: { run: ({ exec }) => exec(["deno", "check", "src/mod.ts"]) },
  ci: { deps: ["test", "check"] },
  build: { deps: ["ci"], run: ({ exec }) => exec(["deno", "run", "build.ts"]) },
});
Deno.exit(await pipeline.cli());
```

`TaskContext` provides bound `exec`, `batch`, `matrix`, `rm`, and `options`.
Graph validation happens before tasks execute. Dependencies run in declaration
order, once per invocation. `parallel` controls child commands, never implicitly
reorders gates. Task groups/descriptions/signatures and completion callbacks
drive `list()` / `menu()`. A task's `args` string is display metadata, not a
custom argument parser; CLI workflow arguments use dv's shared option parser.

`PipelineResult` includes `success`, `code`, `dryRun`, `completed`, duration,
and per-task outcomes with command runs, removals, errors, and blocked work.
Failures throw `PipelineError` with `.summary`, unless `throwOnError: false`.
Bound helper failures prevent successful completion even if a callback catches
one. `pipelineReporter` receives pipeline-start, task-start, task-finish,
pipeline-finish. The normal CLI emits complete JSON on success and failure and
preserves child codes. Arbitrary callback side effects must honor
`options.dryRun` themselves.

Both consumers use the same per-suite reporter. TypeScript additionally has an
in-process overall pipeline heading/summary. Just's separate invocations do not
share a global live dashboard. `just cycle --json` emits newline-delimited JSON
(one result per dv invocation); TypeScript emits one nested pipeline result.
Tests compare their normalized command plans/results, not wall-clock durations
or those intentionally different outer envelopes.

## Selection, discovery, removal

Without `select`, exec/batch execute the full declared directory scope and
ignore forwarded targets. `select: "all"` defaults to all but honors a target;
`select: "one"` automatically accepts a sole target, otherwise requires explicit
selection or a terminal. `--all` is separate from `--parallel`. Exact relative
paths win over basenames, and ambiguous basenames fail instead of guessing.

Globs support `*`, `**`, `?`, character classes, and non-nested brace
alternatives. `mode: "regex"` uses JavaScript regexes over slash-separated
root-relative paths. Discovery is sorted and deduplicated, skips descending
dependency/VCS directories, and never follows directory symlinks. Literal paths
remain usable. All paths stay inside the declared root. `exclude` always uses
globs.

`rm()` defaults to literal path mode, allows missing paths, deduplicates nested
removals, rejects the project root, and refuses symlink ancestor traversal. A
final symlink can be unlinked without traversing it. CLI forms:

```sh
deno run -A src/mod.ts rm --glob '**/node_modules' build dist --dry-run
deno run -A src/mod.ts rm --regex '^apps/[^/]+/coverage$'
deno run -A src/mod.ts rm --paths '["build","coverage"]' --dry-run --json
```

The `--paths` form accepts shared workflow flags, so forwarded targets cannot
accidentally become deletion operands. Only root, mode, exclude, quiet, and
dry-run apply to removal. Removal failures expose partial results through
`RemovalError`.

## Parsers, events, and cancellation

Built-in parsers cover Svelte Check/native, TypeScript/vue-tsc/tsgo, Deno
check/test/ fmt/lint, Vitest, Biome, Fallow scores, and Vite/tsdown URLs.
Detection examines the invoked tool, not arbitrary positional arguments.
Unrecognized formats remain unknown; explicit `parser: "raw"` / `--parser raw`
opts out. Other wrappers may need an explicit parser. TypeScript consumers can
supply custom synchronous `OutputParser` implementations through `parser` or
`parsers`.

`reporter` receives `plan`, `start`, `output`, `finish`, `summary`, and `close`
events. Use a shared reporter to observe the whole batch; per-spec reporters
observe that spec's child events, while the batch reporter owns
plan/summary/close. Every result retains exact argv, cwd, env, parser, process
status, timing, and output. A parser exception preserves the process result and
adds `parserError`.

Capture is bounded per stream (default 2 MiB). On overflow, the first and last
halves are retained, `truncated` is set, and diagnostic parsing is disabled. The
retained string joins those fragments without being a complete transcript. A
split UTF-8 code point may decode as a replacement character at a capture
boundary.

`--jobs N` enables bounded parallelism. `--fail-fast` stops scheduling new
children; active children finish. Timeouts return 124, cancellation 130, spawn
failures 127, and ordinary child failures preserve their exit code. API callers
can pass an AbortSignal; CLI signal handlers are installed only for the call's
lifetime.

On POSIX, ordinary noninteractive descendants run in process groups and receive
TERM followed by KILL after a grace period. Inherited stdin requires sequential
execution and signals the child directly. Windows uses taskkill with fallback.
Deliberately detached descendants are outside this contract. Linux behavior is
covered here; Windows/macOS still need native validation.

`dv list/menu --justfile ...` are optional metadata/navigation conveniences
using Just's JSON dump. The selector supports fuzzy search, arrows, Tab, Enter,
and Ctrl-C. It does not install shell completions. Flat/imported Just recipes
are supported; submodule navigation and arbitrary default-expression evaluation
are not provided. Importing dv performs no subprocess, config read, or signal
setup.

## Develop and publish

```sh
deno task check
deno task test
# Include real independent-consumer integration tests:
DV_TEST_JUST=/absolute/path/to/just DV_TEST_NU=/absolute/path/to/nu deno task test
deno publish --dry-run
```

Tests cover process cleanup, bounded concurrency/capture, argv preservation,
selection, removal, parsers, grouped/TTY reporting, matrix ownership,
preparation, quality policies, pipeline failures, and CLI/API parity.
Just/Nushell integration is optional for developers who only have Deno.

Implementation is under `src/`, tests under `test/`, and examples under
`example/`. Public modules are `src/mod.ts` (`.`) and `src/cli/mod.ts`
(`./cli`). Publishing is a separate explicit operation. See `CHANGELOG.md` for
migration notes.
