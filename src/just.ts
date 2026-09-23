import { discover } from "./discovery.ts";
import { launchRecipe } from "./launch.ts";
import { resolvePath } from "./paths.ts";
import { formatRecipes } from "./recipes.ts";
import { quoteArgument, readInput } from "./terminal.ts";
import { chooseRecipe } from "./menu.ts";
import { requireInteractive } from "./prompts.ts";
import { splitArguments } from "./cli/args.ts";
import type { RecipeInfo } from "./recipes.ts";

/** Minimal recipe parameter metadata supplied by Just. */
export interface JustParameter {
  name: string;
  kind: string;
  default?: unknown;
  long?: string;
  short?: string;
  flag?: boolean;
  help?: string;
}
/** A visible recipe and its original metadata. */
export interface JustRecipe extends RecipeInfo {
  parameters: JustParameter[];
  attributes: unknown[];
  aliasFor?: string;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const valueText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
    ? value.map(valueText).join(" ")
    : value == null
    ? ""
    : JSON.stringify(value);

/** Read Just's structured dump without executing recipe bodies or parsing shell source. */
export function recipesFromDump(dump: unknown): JustRecipe[] {
  return readRecipes(dump, "");
}

function readRecipes(dump: unknown, prefix: string): JustRecipe[] {
  const root = record(dump);
  if (!root.recipes || typeof root.recipes !== "object") {
    throw new Error("Unsupported Just dump: missing recipes map");
  }
  const recipes: JustRecipe[] = [];
  const hidden = new Set<string>();
  for (const [key, value] of Object.entries(record(root.recipes))) {
    const recipe = record(value);
    const localName = typeof recipe.name === "string" ? recipe.name : key;
    const name = typeof recipe.namepath === "string"
      ? recipe.namepath
      : prefix + localName;
    const attributes = Array.isArray(recipe.attributes)
      ? recipe.attributes
      : [];
    if (
      recipe.private === true || localName.startsWith("_") ||
      attributes.some((a) => a === "private" || "private" in record(a))
    ) hidden.add(name);
    const parameters: JustParameter[] =
      (Array.isArray(recipe.parameters) ? recipe.parameters : []).map((p) => {
        const item = record(p);
        return {
          name: String(item.name ?? "arg"),
          kind: String(item.kind ?? "singular"),
          default: item.default,
          long: typeof item.long === "string" ? item.long : undefined,
          short: typeof item.short === "string" ? item.short : undefined,
          flag: item.flag === true,
          help: typeof item.help === "string" ? item.help : undefined,
        };
      });
    const group = attributes.map((a) => record(a).group).find((v) =>
      v !== undefined
    );
    const doc = attributes.map((a) => record(a).doc).find((v) =>
      v !== undefined
    );
    const args = parameters.map((p) => {
      if (p.long || p.short) {
        const flag = p.long ? `--${p.long}` : `-${p.short}`;
        return p.flag
          ? `[${flag}]`
          : `${flag} <${p.name}>${
            p.default == null ? "" : `=${valueText(p.default)}`
          }`;
      }
      return `${
        /star|variadic/i.test(p.kind) ? "*" : /plus/i.test(p.kind) ? "+" : ""
      }${p.name}${p.default == null ? "" : `=${valueText(p.default)}`}`;
    }).join(" ");
    recipes.push({
      name,
      group: valueText(group) || "recipes",
      description: valueText(doc ?? recipe.doc),
      args,
      parameters,
      attributes,
    });
  }
  for (const [key, value] of Object.entries(record(root.aliases))) {
    const alias = record(value);
    const localName = String(alias.name ?? key);
    const attributes = Array.isArray(alias.attributes) ? alias.attributes : [];
    if (
      localName.startsWith("_") || alias.private === true ||
      attributes.some((a) => a === "private" || "private" in record(a))
    ) continue;
    const target = recipes.find((r) =>
      r.name === prefix + String(alias.target)
    );
    if (target) {
      recipes.push({
        ...target,
        name: prefix + localName,
        aliasFor: target.name,
        description: target.description || `Alias for ${target.name}`,
        attributes,
      });
    }
  }
  for (const [name, module] of Object.entries(record(root.modules))) {
    if (!name.startsWith("_") && record(module).private !== true) {
      recipes.push(...readRecipes(module, `${prefix}${name}::`));
    }
  }
  return recipes.filter((r) => !hidden.has(r.name));
}

/** Inspect an optional Just dependency only when the caller requests Just integration. */
export async function readJust(justfile: string): Promise<JustRecipe[]> {
  const output = await new Deno.Command("just", {
    args: [
      "--justfile",
      resolvePath(justfile),
      "--dump",
      "--dump-format",
      "json",
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      new TextDecoder().decode(output.stderr) ||
        `Just metadata failed (${output.code})`,
    );
  }
  return recipesFromDump(JSON.parse(new TextDecoder().decode(output.stdout)));
}

/** Format a Just workspace's actual visible recipes. */
export async function listJust(justfile: string): Promise<string> {
  return formatRecipes(await readJust(justfile));
}

/** Completion patterns are passed by the recipe, never read from a dv config file. */
export interface JustMenuOptions {
  complete?: Readonly<Record<string, readonly string[]>>;
  root?: string;
  signal?: AbortSignal;
  interactive?: boolean;
}

/** The optional Just provider supplies metadata to the shared recipe menu. */
export async function menuJust(
  justfile: string,
  options: JustMenuOptions = {},
): Promise<number> {
  requireInteractive(options);
  justfile = resolvePath(justfile);
  const root = options.root ??
    resolvePath(".", justfile.slice(0, justfile.lastIndexOf("/")) || "/");
  const recipes = (await readJust(justfile)).filter((r) =>
    r.name.split("::").at(-1) !== "menu" &&
    r.aliasFor?.split("::").at(-1) !== "menu"
  );
  const recipe = await chooseRecipe(recipes, options);
  const patterns = options.complete?.[recipe.name];
  const targets = patterns ? await discover(patterns, { root }) : [];
  // One argv editor preserves Just's defaults, flags, variadics and empty quoted
  // strings. Completion suggests values; it never inserts a mandatory target.
  const answer = recipe.args
    ? await readInput("Arguments", {
      ...options,
      suggestions: targets.map((t) =>
        /^[\w./-]+$/.test(t.relative) ? t.relative : quoteArgument(t.relative)
      ),
      hint:
        `${recipe.args} · blank uses recipe defaults · quote arguments containing spaces`,
      validate: (text) => {
        try {
          splitArguments(text);
        } catch (error) {
          return String(error instanceof Error ? error.message : error);
        }
      },
    })
    : "";
  return await launchRecipe([
    "just",
    "--justfile",
    justfile,
    recipe.name,
    ...splitArguments(answer),
  ], {
    cwd: root,
    signal: options.signal,
  });
}
