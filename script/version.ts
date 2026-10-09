/** Synchronize the literal runtime version without shipping a config-file read. */
export const root = new URL("../", import.meta.url);
export async function metadata(): Promise<
  {
    name: string;
    version: string;
    description: string;
    license: string;
    author: string;
  }
> {
  const value = JSON.parse(await Deno.readTextFile(new URL("deno.json", root)));
  for (const key of ["name", "version", "description", "license", "author"]) {
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

export async function synchronizeVersion(check = false): Promise<void> {
  const { version } = await metadata();
  const path = new URL("src/version.ts", root);
  const expected =
    `/** Generated from deno.json by script/version.ts; no runtime metadata reads. */\nexport const VERSION = ${
      JSON.stringify(version)
    };\n`;
  if (check) {
    if (await Deno.readTextFile(path) !== expected) {
      throw new Error("Version is stale: run deno task version");
    }
  } else {
    await Deno.writeTextFile(path, expected);
  }
}

if (import.meta.main) await synchronizeVersion(Deno.args.includes("--check"));
