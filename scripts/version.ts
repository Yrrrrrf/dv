/** Validate the package metadata used by the existing version pipeline step. */
import value from "../deno.json" with { type: "json" };
export const root = new URL("../", import.meta.url);

export function metadata() {
  for (
    const key of [
      "name",
      "version",
      "description",
      "license",
      "author",
    ] as const
  ) {
    if (typeof value[key] !== "string" || !value[key]) {
      throw new Error(`Missing package metadata: ${key}`);
    }
  }
  return {
    name: value.name,
    version: value.version,
    description: value.description,
    license: value.license,
    author: value.author,
  };
}

if (import.meta.main) metadata();
