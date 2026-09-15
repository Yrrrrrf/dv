import { discover } from "./discovery.ts";
import { containedPath, relativePath, resolvePath, within } from "./paths.ts";
import { write } from "./terminal.ts";
import type { MatchMode } from "./types.ts";

/** Removal always stays beneath an explicit root and never traverses symlinks. */
export interface RemoveOptions {
  root?: string;
  mode?: MatchMode;
  dryRun?: boolean;
  quiet?: boolean;
  exclude?: readonly string[];
}
/** Paths selected, removed, or rejected during removal. */
export interface RemovalResult {
  success: boolean;
  dryRun: boolean;
  paths: string[];
  removed: string[];
  failures: { path: string; error: string }[];
}
/** Failure with partial results; callers can inspect what was actually removed. */
export class RemovalError extends Error {
  readonly result: RemovalResult;
  constructor(result: RemovalResult) {
    super(`${result.failures.length} removal(s) failed`);
    this.result = result;
    this.name = "RemovalError";
  }
}
/** Remove literal paths, glob matches or regex matches; missing paths are harmless. */
export async function rm(
  patterns: readonly string[],
  options: RemoveOptions = {},
): Promise<RemovalResult> {
  if (!patterns.length) {
    throw new Error("rm requires at least one path or pattern");
  }
  const root = resolvePath(await Deno.realPath(options.root ?? Deno.cwd()));
  const targets = await discover(patterns, {
    root,
    mode: options.mode ?? "path",
    kind: "any",
    includeIgnored: true,
    allowMissing: true,
    pruneMatches: true,
    exclude: options.exclude,
  });
  if (targets.some((t) => t.path === root)) {
    throw new Error("Refusing to remove the project root");
  }
  const paths: string[] = [];
  for (const target of targets.sort((a, b) => a.path.length - b.path.length)) {
    if (!paths.some((parent) => within(parent, target.path))) {
      paths.push(target.path);
    }
  }
  const result: RemovalResult = {
    success: true,
    dryRun: options.dryRun ?? false,
    paths,
    removed: [],
    failures: [],
  };
  for (const path of paths) {
    try {
      await containedPath(root, path, true);
      if (!options.quiet) {
        write(
          `${options.dryRun ? "would prune" : "prune"}: ${
            relativePath(root, path)
          }\n`,
        );
      }
      if (!options.dryRun) {
        await Deno.remove(path, { recursive: true });
        result.removed.push(path);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        result.failures.push({ path, error: String(error) });
      }
    }
  }
  result.success = result.failures.length === 0;
  if (!options.quiet) {
    write(
      `${result.success ? "✓" : "✗"} ${
        options.dryRun ? "Removal plan" : "Workspace pruning"
      }: ${paths.length} paths, ${result.failures.length} failures.\n`,
    );
  }
  if (!result.success) throw new RemovalError(result);
  return result;
}
