import { batch, exec, ExecutionError } from "./exec.ts";
import { RemovalError, rm } from "./remove.ts";
import { matrix } from "./matrix.ts";
import type { MatrixOptions, MatrixRule } from "./matrix.ts";
import { formatDuration, plain } from "./reporting.ts";
import { choose, color, write } from "./terminal.ts";
import { parseArgs } from "./cli/args.ts";
import { withSignals } from "./signals.ts";
import type { ExecOptions, ExecSpec, RunSummary } from "./types.ts";
import type { RemovalResult, RemoveOptions } from "./remove.ts";

/** Bound helpers passed to a TypeScript task. */
export interface TaskContext {
  options: Readonly<ExecOptions>;
  exec(command: readonly string[], options?: ExecOptions): Promise<RunSummary>;
  batch(specs: readonly ExecSpec[], options?: ExecOptions): Promise<RunSummary>;
  matrix(
    rules: readonly MatrixRule[],
    options?: MatrixOptions,
  ): Promise<RunSummary>;
  rm(paths: readonly string[], options?: RemoveOptions): Promise<RemovalResult>;
}
/** A user's workflow declaration, with no implicit filenames or tool knowledge. */
export interface Task {
  description?: string;
  group?: string;
  args?: string;
  deps?: readonly string[];
  run?: (context: TaskContext) => unknown | Promise<unknown>;
  complete?: () => readonly string[] | Promise<readonly string[]>;
  private?: boolean;
}
/** A task's complete outcome, including partial work on failure. */
export interface TaskResult {
  name: string;
  status: "completed" | "failed" | "blocked";
  durationMs: number;
  runs: RunSummary[];
  removals: RemovalResult[];
  error?: string;
}
/** Result of one dependency graph; process results remain inspectable on failure. */
export interface PipelineResult {
  task: string;
  completed: string[];
  durationMs: number;
  success: boolean;
  code: number;
  dryRun: boolean;
  tasks: TaskResult[];
  error?: string;
}
/** Observable pipeline lifecycle; command reporting still uses Reporter. */
export type PipelineEvent =
  | { type: "pipeline-start"; task: string; planned: string[]; dryRun: boolean }
  | { type: "task-start"; name: string }
  | { type: "task-finish"; result: TaskResult }
  | { type: "pipeline-finish"; result: PipelineResult };
export interface PipelineOptions extends ExecOptions {
  pipelineReporter?: (event: PipelineEvent) => void;
}
/** Failed pipelines retain all completed and blocked tasks. */
export class PipelineError extends Error {
  readonly summary: PipelineResult;
  constructor(summary: PipelineResult) {
    super(summary.error ?? `Pipeline failed with exit code ${summary.code}`);
    this.name = "PipelineError";
    this.summary = summary;
  }
}
/** Executable graph with optional terminal discovery; Just is never required here. */
export interface Pipeline {
  run(name: string, options?: PipelineOptions): Promise<PipelineResult>;
  list(): string;
  menu(options?: PipelineOptions): Promise<PipelineResult>;
  cli(args?: readonly string[]): Promise<number>;
}
/** Listing row used by both TypeScript workflows and the optional Just adapter. */
export interface RecipeInfo {
  name: string;
  group: string;
  args: string;
  description: string;
}

/** Render grouped recipe metadata without maintaining a second command registry. */
export function formatRecipes(recipes: readonly RecipeInfo[]): string {
  const style = (text: string, code: number): string =>
    Deno.stdout.isTerminal() ? color(text, code) : text;
  const groups = [...new Set(recipes.map((r) => r.group))];
  const preferred = ["meta", "dev", "test", "check", "ci", "deploy"];
  groups.sort((a, b) =>
    (preferred.includes(a) ? preferred.indexOf(a) : 99) -
      (preferred.includes(b) ? preferred.indexOf(b) : 99) || a.localeCompare(b)
  );
  const width = Math.max(
    0,
    ...recipes.map((r) => `${r.name}${r.args ? " " + r.args : ""}`.length),
  );
  return "Available recipes:\n" +
    groups.map((group) =>
      `\n    ${style(`[${group}]`, 35)}\n` +
      recipes.filter((r) => r.group === group).map((r) => {
        const signature = `${r.name}${r.args ? " " + r.args : ""}`;
        return `    ${style(signature.padEnd(width), 36)}${
          r.description ? ` # ${r.description}` : ""
        }`;
      }).join("\n")
    ).join("\n") + "\n";
}

/** Wire a dependency graph in TypeScript with the same engine used by dv exec. */
export function createPipeline(
  tasks: Readonly<Record<string, Task>>,
  defaults: PipelineOptions = {},
): Pipeline {
  const visible = () =>
    Object.entries(tasks).filter(([name, task]) =>
      !task.private && !name.startsWith("_")
    );
  const ordered = (name: string): string[] => {
    const done = new Set<string>(),
      active = new Set<string>(),
      order: string[] = [];
    const visit = (key: string) => {
      if (active.has(key)) {
        throw new Error(`Dependency cycle: ${[...active, key].join(" -> ")}`);
      }
      if (done.has(key)) return;
      const task = Object.hasOwn(tasks, key) ? tasks[key] : undefined;
      if (!task) throw new Error(`Unknown task: ${key}`);
      active.add(key);
      for (const dependency of task.deps ?? []) visit(dependency);
      active.delete(key);
      done.add(key);
      order.push(key);
    };
    visit(name);
    return order;
  };
  const pipeline: Pipeline = {
    async run(name, options = {}) {
      const start = performance.now(), completed: string[] = [];
      const base = {
        ...defaults,
        ...options,
        env: { ...defaults.env, ...options.env },
      };
      const summary: PipelineResult = {
        task: name,
        completed,
        durationMs: 0,
        success: true,
        code: 0,
        dryRun: base.dryRun ?? false,
        tasks: [],
      };
      const emit = (event: PipelineEvent) => {
        if (base.pipelineReporter) base.pipelineReporter(event);
        else if (!base.quiet) {
          if (event.type === "pipeline-start") {
            write(`\n◆ ${plain(name)}${base.dryRun ? " · plan" : ""}\n`);
          }
          if (
            event.type === "task-finish" && !event.result.runs.length &&
            !event.result.removals.length && tasks[event.result.name]?.run
          ) {
            write(
              `  ${event.result.status === "completed" ? "✓" : "✗"} ${
                plain(event.result.name)
              } (${formatDuration(event.result.durationMs)})\n`,
            );
          }
          if (event.type === "pipeline-finish") {
            write(
              `\n${summary.success ? base.dryRun ? "◇" : "✓" : "✗"} ${
                plain(name)
              }: ${completed.length} tasks ${
                base.dryRun ? "planned" : "completed"
              } (total: ${formatDuration(summary.durationMs)})\n`,
            );
            const blocked = summary.tasks.filter((t) => t.status === "blocked");
            if (blocked.length) {
              write(
                `  Blocked: ${blocked.map((t) => plain(t.name)).join(", ")}\n`,
              );
            }
          }
        }
      };
      let order: string[] = [], current: TaskResult | undefined;
      try {
        order = ordered(name);
        emit({
          type: "pipeline-start",
          task: name,
          planned: order,
          dryRun: summary.dryRun,
        });
        for (const key of order) {
          if (base.signal?.aborted) {
            throw new DOMException("Pipeline cancelled", "AbortError");
          }
          const taskStart = performance.now();
          const result: TaskResult = {
            name: key,
            status: "completed",
            durationMs: 0,
            runs: [],
            removals: [],
          };
          current = result;
          summary.tasks.push(result);
          emit({ type: "task-start", name: key });
          const merge = (overrides: ExecOptions = {}): ExecOptions => ({
            ...base,
            title: key.toUpperCase(),
            ...overrides,
            env: { ...base.env, ...overrides.env },
            throwOnError: false,
          });
          const track = async (
            work: Promise<RunSummary>,
          ): Promise<RunSummary> => {
            const run = await work;
            result.runs.push(run);
            if (!run.success) throw new ExecutionError(run);
            return run;
          };
          const context: TaskContext = {
            options: base,
            exec: (command, opts) => track(exec(command, merge(opts))),
            batch: (specs, opts) => track(batch(specs, merge(opts))),
            matrix: (rules, opts) =>
              track(
                matrix(rules, {
                  ...merge(opts),
                  match: opts?.match,
                  scope: opts?.scope,
                }),
              ),
            rm: async (paths, opts) => {
              try {
                const removal = await rm(paths, {
                  root: base.root,
                  quiet: base.quiet,
                  dryRun: base.dryRun,
                  ...opts,
                });
                result.removals.push(removal);
                return removal;
              } catch (error) {
                if (error instanceof RemovalError) {
                  result.removals.push(error.result);
                }
                throw error;
              }
            },
          };
          try {
            const returned = await tasks[key]!.run?.(context);
            if (
              returned && typeof returned === "object" &&
              "success" in returned && returned.success === false
            ) throw new Error(`Task ${key} returned an unsuccessful result`);
            // Catching a helper error cannot silently mark an unsuccessful gate as passed.
            if (
              result.runs.some((r) => !r.success) ||
              result.removals.some((r) => !r.success)
            ) throw new Error(`Task ${key} contains unsuccessful work`);
            completed.push(key);
          } catch (error) {
            result.status = "failed";
            result.error = error instanceof Error
              ? error.message
              : String(error);
            throw error;
          } finally {
            result.durationMs = performance.now() - taskStart;
            emit({ type: "task-finish", result });
          }
          current = undefined;
        }
      } catch (error) {
        summary.success = false;
        summary.code = error instanceof ExecutionError
          ? error.summary.code
          : error instanceof DOMException && error.name === "AbortError"
          ? 130
          : 1;
        summary.error = error instanceof Error ? error.message : String(error);
        if (current && current.status !== "failed") {
          current.status = "failed";
          current.error = summary.error;
        }
        for (const key of order) {
          if (!summary.tasks.some((t) => t.name === key)) {
            summary.tasks.push({
              name: key,
              status: "blocked",
              durationMs: 0,
              runs: [],
              removals: [],
              error: summary.error,
            });
          }
        }
      }
      summary.durationMs = performance.now() - start;
      emit({ type: "pipeline-finish", result: summary });
      if (!summary.success && base.throwOnError !== false) {
        throw new PipelineError(summary);
      }
      return summary;
    },
    list() {
      return formatRecipes(
        visible().map(([name, task]) => ({
          name,
          group: task.group ?? "tasks",
          args: task.args ?? "",
          description: task.description ?? "",
        })),
      );
    },
    async menu(options = {}) {
      const name = await choose(
        "Recipe",
        visible().map(([name, task]) => ({
          value: name,
          label: name,
          description: task.description,
        })),
      );
      const targets = await tasks[name]!.complete?.();
      const target = targets?.length
        ? await choose(
          "Target",
          targets.map((value) => ({ value, label: value })),
        )
        : options.target;
      return await pipeline.run(name, { ...options, target });
    },
    async cli(args = Deno.args) {
      let json = false;
      try {
        const name = args[0] ?? "list";
        if (name === "list" || name === "--help" || name === "-h") {
          write(pipeline.list(), "stdout");
          return 0;
        }
        const parsed = parseArgs(args.slice(1));
        json = parsed.json;
        if (parsed.command.length) {
          throw new Error("Pipeline arguments do not take a child command");
        }
        if (parsed.help) {
          write(pipeline.list(), "stdout");
          return 0;
        }
        const result = await withSignals((signal) =>
          name === "menu"
            ? pipeline.menu({ ...parsed.options, signal })
            : pipeline.run(name, { ...parsed.options, signal })
        );
        if (parsed.json) write(JSON.stringify(result) + "\n", "stdout");
        return result.code;
      } catch (error) {
        if (json) {
          write(
            JSON.stringify(
              error instanceof PipelineError ? error.summary : {
                success: false,
                code: 1,
                error: error instanceof Error ? error.message : String(error),
              },
            ) + "\n",
            "stdout",
          );
        } else write(`dv: ${error instanceof Error ? error.message : error}\n`);
        if (error instanceof PipelineError) return error.summary.code;
        return error instanceof ExecutionError
          ? error.summary.code
          : (error instanceof DOMException && error.name === "AbortError") ||
              (error instanceof Error &&
                error.message === "Selection cancelled")
          ? 130
          : 1;
      }
    },
  };
  return pipeline;
}
