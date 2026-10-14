/**
 * Command execution and workflow composition.
 *
 * @example
 * ```ts
 * import { exec } from "@yrrrrrf/dv";
 * await exec(["deno", "check", "mod.ts"], { cwd: ["apps/*"], parallel: true });
 * ```
 *
 * Run the ./bin entrypoint for the CLI. Importing this module never starts a process,
 * reads a project config, installs signal handlers, or requires Just.
 * @module
 */
export { batch, exec, ExecutionError, plan } from "./execution/exec.ts";
export { discover, globRegex } from "./fs/discovery.ts";
export { RemovalError, rm } from "./fs/remove.ts";
export type { RemovalResult, RemoveOptions } from "./fs/remove.ts";
export { createPipeline, formatRecipes, PipelineError } from "./pipeline.ts";
export type {
  Pipeline,
  PipelineEvent,
  PipelineOptions,
  PipelineResult,
  RecipeInfo,
  Task,
  TaskContext,
  TaskResult,
} from "./pipeline.ts";
export {
  builtInParsers,
  resolveParser,
  stripAnsi,
} from "./execution/parsers.ts";
export { banner, formatCommand, quoteArgument } from "./terminal/format.ts";
export { isInteractive } from "./terminal/io.ts";
export { choose, readInput } from "./terminal/prompts.ts";
export type {
  Choice,
  InputOptions,
  PromptOptions,
} from "./terminal/prompts.ts";
export { createReporter } from "./terminal/reporting.ts";
export { filePath } from "./fs/paths.ts";
export { listJust, menuJust, readJust, recipesFromDump } from "./just/mod.ts";
export type { JustMenuOptions, JustParameter, JustRecipe } from "./just/mod.ts";
export { parseArgs } from "./cli/args.ts";
export { main, VERSION } from "./cli/mod.ts";
export type * from "./execution/types.ts";

export { matrix, planMatrix } from "./execution/matrix.ts";
export type { MatrixOptions, MatrixRule } from "./execution/matrix.ts";
export {
  conciseCommand,
  formatDuration,
  resultBadge,
} from "./terminal/reporting.ts";

export { chooseRecipe } from "./terminal/menu.ts";
