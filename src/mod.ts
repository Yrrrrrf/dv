/**
 * Deno-native command execution and workflow composition.
 *
 * @example
 * ```ts
 * import { exec } from "@yrrrrrf/dv";
 * await exec(["deno", "check", "mod.ts"], { cwd: ["apps/*"], parallel: true });
 * ```
 *
 * Run this module directly for the CLI. Importing it never starts a process,
 * reads a project config, installs signal handlers, or requires Just.
 * @module
 */
export { batch, exec, ExecutionError, plan } from "./exec.ts";
export { discover, globRegex } from "./discovery.ts";
export { RemovalError, rm } from "./remove.ts";
export type { RemovalResult, RemoveOptions } from "./remove.ts";
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
export { builtInParsers, resolveParser, stripAnsi } from "./parsers.ts";
export {
  banner,
  choose,
  createReporter,
  formatCommand,
  isInteractive,
  quoteArgument,
  readInput,
} from "./terminal.ts";
export type { Choice, InputOptions, PromptOptions } from "./terminal.ts";
export { filePath } from "./paths.ts";
export { listJust, menuJust, readJust, recipesFromDump } from "./just.ts";
export type { JustMenuOptions, JustParameter, JustRecipe } from "./just.ts";
export { parseArgs } from "./cli/args.ts";
export { main, VERSION } from "./cli/mod.ts";
export type * from "./types.ts";

import { main } from "./cli/mod.ts";
if (import.meta.main) Deno.exit(await main());

export { matrix, planMatrix } from "./matrix.ts";
export type { MatrixOptions, MatrixRule } from "./matrix.ts";
export { conciseCommand, formatDuration, resultBadge } from "./reporting.ts";

export { chooseRecipe } from "./menu.ts";
