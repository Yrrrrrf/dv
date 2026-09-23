import { choose } from "./prompts.ts";
import type { PromptOptions } from "./prompts.ts";
import type { RecipeInfo } from "./recipes.ts";

/** The main menu consumes recipes, never a justfile or a workspace filename. */
export async function chooseRecipe(
  recipes: readonly RecipeInfo[],
  options: PromptOptions = {},
): Promise<RecipeInfo> {
  const name = await choose(
    "Recipe",
    recipes.map((recipe) => ({
      value: recipe.name,
      label: recipe.name,
      group: recipe.group,
      args: recipe.args,
      description: recipe.description,
    })),
    options,
  );
  return recipes.find((r) => r.name === name)!;
}

/** Completion never turns an optional target into a required argument. */
export async function chooseTarget(
  targets: readonly string[],
  options: PromptOptions = {},
): Promise<string | undefined> {
  if (!targets.length) return undefined;
  const target = await choose("Target", [
    {
      value: "",
      label: "Use recipe default",
      description: "Leave the target unspecified",
    },
    ...[...new Set(targets)].map((value) => ({ value, label: value })),
  ], options);
  return target || undefined;
}

/** Suggestions for dv workflow options, not assumptions about arbitrary recipes. */
export const workflowSuggestions: readonly string[] = [
  "--dry-run",
  "--verbose",
  "--parallel",
  "--benchmark",
  "--all",
  "--target",
  "--jobs",
  "--filter",
  "--env",
  "--raw",
  "--no-raw",
  "--report",
  "--logs",
  "--commands",
  "--quiet",
  "--timeout",
  "--fail-fast",
];
