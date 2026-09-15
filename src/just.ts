import { discover } from "./discovery.ts";
import { exec } from "./exec.ts";
import { resolvePath } from "./paths.ts";
import { formatRecipes } from "./pipeline.ts";
import { choose, isInteractive, write } from "./terminal.ts";
import { splitArguments } from "./cli/args.ts";
import type { RecipeInfo } from "./pipeline.ts";

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
  const root = record(dump);
  if (!root.recipes || typeof root.recipes !== "object") {
    throw new Error("Unsupported Just dump: missing recipes map");
  }
  const recipes: JustRecipe[] = [];
  for (const [key, value] of Object.entries(record(root.recipes))) {
    const recipe = record(value);
    const name = typeof recipe.name === "string" ? recipe.name : key;
    const attributes = Array.isArray(recipe.attributes)
      ? recipe.attributes
      : [];
    if (
      recipe.private === true || name.startsWith("_") ||
      attributes.some((a) => a === "private" || "private" in record(a))
    ) continue;
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
  return recipes;
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
}

/** Choose a recipe and target, then dispatch through Just to preserve dependencies. */
export async function menuJust(
  justfile: string,
  options: JustMenuOptions = {},
): Promise<number> {
  if (!isInteractive()) {
    throw new Error("The Just menu requires an interactive terminal");
  }
  justfile = resolvePath(justfile);
  const root = options.root ?? justfile.slice(0, justfile.lastIndexOf("/"));
  const recipes = (await readJust(justfile)).filter((r) => r.name !== "menu");
  const name = await choose(
    "Recipe",
    recipes.map((r) => ({
      value: r.name,
      label: r.name,
      description: r.description,
    })),
  );
  const recipe = recipes.find((r) => r.name === name)!;
  const args: string[] = [];
  const patterns = options.complete?.[name];
  if (patterns) {
    const targets = await discover(patterns, { root });
    args.push(
      await choose(
        "Target",
        targets.map((t) => ({ value: t.relative, label: t.relative })),
      ),
    );
  }
  const firstPositional = recipe.parameters.findIndex((p) =>
    !p.long && !p.short
  );
  for (const [i, parameter] of recipe.parameters.entries()) {
    if (parameter.long || parameter.short) {
      const flag = parameter.long
        ? `--${parameter.long}`
        : `-${parameter.short}`;
      if (parameter.flag) {
        const enabled = await choose(flag, [{ value: "no", label: "No" }, {
          value: "yes",
          label: "Yes",
          description: parameter.help,
        }]);
        if (enabled === "yes") args.push(flag);
      } else {
        const answer = prompt(`${flag} (blank uses the recipe default):`);
        if (answer === null) throw new Error("Selection cancelled");
        if (answer) args.push(flag, answer);
      }
      continue;
    }
    if (
      i === firstPositional && patterns &&
      !/star|plus|variadic/i.test(parameter.kind)
    ) {
      continue;
    }
    if (/star|plus|variadic/i.test(parameter.kind)) {
      write(
        "Execution options: -v verbose, -p parallel, -b timing, --dry-run\n",
      );
      const answer = prompt(`${parameter.name} (optional extra arguments):`);
      if (answer === null) throw new Error("Selection cancelled");
      args.push(...splitArguments(answer));
    } else {
      const answer = prompt(
        `${parameter.name}${
          parameter.default == null ? "" : ` [${valueText(parameter.default)}]`
        }:`,
      );
      if (answer === null) throw new Error("Selection cancelled");
      if (!answer && parameter.default == null) {
        throw new Error(`Required argument: ${parameter.name}`);
      }
      if (!answer && typeof parameter.default !== "string") break;
      args.push(answer || valueText(parameter.default));
    }
  }
  const result = await exec(["just", "--justfile", justfile, name, ...args], {
    root,
    stdin: "inherit",
    parser: "raw",
    verbose: true,
    signal: options.signal,
    throwOnError: false,
  });
  return result.code;
}
