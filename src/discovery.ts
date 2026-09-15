import { basename, containedPath, relativePath, resolvePath } from "./paths.ts";
import type { DiscoverOptions, Target } from "./types.ts";

const ignored = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".deno",
  ".justcache",
]);
const escape = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compile *, **, ?, character classes and brace alternatives into a path matcher. */
export function globRegex(pattern: string): RegExp {
  let output = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          output += "(?:.*/)?";
          i++;
        } else output += ".*";
      } else output += "[^/]*";
    } else if (c === "?") output += "[^/]";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) throw new Error(`Unclosed glob character class: ${pattern}`);
      let value = pattern.slice(i + 1, end);
      if (value.startsWith("!")) value = "^" + value.slice(1);
      if (!value || value.includes("/")) {
        throw new Error(`Invalid glob character class: ${pattern}`);
      }
      output += `[${value}]`;
      i = end;
    } else if (c === "{") {
      const end = pattern.indexOf("}", i + 1);
      if (end < 0) throw new Error(`Unclosed glob alternatives: ${pattern}`);
      const choices = pattern.slice(i + 1, end).split(",");
      if (choices.some((v) => /[{}]/.test(v))) {
        throw new Error("Nested glob braces are not supported");
      }
      output += `(?:${
        choices.map((v) => globRegex(v).source.slice(1, -1)).join("|")
      })`;
      i = end;
    } else output += escape(c);
  }
  return new RegExp(`^${output}$`);
}

/** Discover deterministic, deduplicated targets without following symlink directories. */
export async function discover(
  patterns: readonly string[],
  options: DiscoverOptions = {},
): Promise<Target[]> {
  const root = resolvePath(await Deno.realPath(options.root ?? Deno.cwd()));
  const mode = options.mode ?? "glob";
  const kind = options.kind ?? "directory";
  const results = new Map<string, Target>();
  const excluded = (options.exclude ?? []).map(globRegex);
  const add = (
    path: string,
    stat: { isDirectory: boolean; isFile: boolean; isSymlink: boolean },
  ) => {
    const relative = relativePath(root, path);
    if (excluded.some((r) => r.test(relative))) return false;
    if (
      kind === "any" || (kind === "directory" && stat.isDirectory) ||
      (kind === "file" && stat.isFile)
    ) {
      results.set(path, { path, relative, name: basename(path) });
      return true;
    }
    return false;
  };
  const matchers: RegExp[] = [];
  for (const pattern of patterns) {
    if (!pattern) throw new Error("Empty path pattern");
    if (mode === "regex") {
      matchers.push(new RegExp(pattern));
      continue;
    }
    if (mode === "path" || !/[?*[{]/.test(pattern)) {
      const path = resolvePath(pattern, root);
      try {
        await containedPath(root, path, kind === "any");
        add(path, await Deno.lstat(path));
      } catch (error) {
        if (!(options.allowMissing && error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
    } else {
      // Lexically resolve before matching, so ../ cannot escape the declared root.
      matchers.push(globRegex(relativePath(root, resolvePath(pattern, root))));
    }
  }
  if (matchers.length) {
    const walk = async (directory: string): Promise<void> => {
      for await (const entry of Deno.readDir(directory)) {
        const path = resolvePath(entry.name, directory);
        const relative = relativePath(root, path);
        if (excluded.some((r) => r.test(relative))) continue;
        const matched = matchers.some((r) => r.test(relative)) &&
          add(path, entry);
        if (
          entry.isDirectory && !entry.isSymlink &&
          !(matched && options.pruneMatches) &&
          (options.includeIgnored || !ignored.has(entry.name))
        ) await walk(path);
      }
    };
    await walk(root);
  }
  return [...results.values()].sort((a, b) =>
    a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0
  );
}
