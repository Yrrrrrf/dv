import { clip, color, displayWidth, plain } from "./style.ts";

/** Source-independent recipe metadata. Just is only one optional provider. */
export interface RecipeInfo {
  name: string;
  group: string;
  args: string;
  description: string;
}

const preferred = ["meta", "dev", "test", "check", "ci", "deploy"];
const palette = [90, 36, 32, 33, 34, 35];
export function groupColor(group: string): number {
  const index = preferred.indexOf(group);
  return index < 0 ? 36 : palette[index]!;
}
export function compareGroups(a: string, b: string): number {
  const rank = (group: string) =>
    preferred.includes(group) ? preferred.indexOf(group) : 99;
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** Both entrypoints list their own declared recipes using the same presentation. */
export function formatRecipes(recipes: readonly RecipeInfo[]): string {
  const groups = [...new Set(recipes.map((r) => r.group))].sort(compareGroups);
  const signature = (r: RecipeInfo) =>
    plain(`${r.name}${r.args ? " " + r.args : ""}`);
  const width = Math.max(0, ...recipes.map((r) => displayWidth(signature(r))));
  return "Available recipes:\n" +
    groups.map((group) =>
      `\n    ${color(`[${plain(group)}]`, groupColor(group), "stdout")}\n` +
      recipes.filter((r) => r.group === group).map((r) => {
        const text = signature(r);
        return `    ${color(text, "1;36", "stdout")}${
          " ".repeat(width - displayWidth(text))
        }${
          r.description
            ? color(` # ${clip(r.description, Infinity)}`, "2;3", "stdout")
            : ""
        }`;
      }).join("\n")
    ).join("\n") + "\n";
}
