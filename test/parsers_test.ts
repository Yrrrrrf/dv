import { resolveParser } from "../src/mod.ts";
import { assert, equal } from "./assert.ts";

Deno.test("Svelte native summaries preserve observed diagnostics", () => {
  const parser = resolveParser([
    "deno",
    "run",
    "-A",
    "npm:svelte-check-native",
  ]);
  equal(parser?.name, "svelte-check");
  equal(
    parser?.parse({
      stdout: "svelte-check found 2 errors and 3 warnings in 2 files",
      stderr: "",
      code: 1,
    }),
    { errors: 2, warnings: 3 },
  );
});
Deno.test("Vue/TypeScript and Deno diagnostics share an adapter", () => {
  for (
    const command of [
      ["deno", "check"],
      ["deno", "run", "npm:vue-tsc@3.3.11"],
      ["deno", "run", "npm:typescript@6/tsc"],
    ]
  ) {
    const parser = resolveParser(command);
    equal(parser?.name, "typescript");
    equal(
      parser?.parse({
        stdout: "TS2307 [ERROR]: missing\nTS2882 [ERROR]: missing",
        stderr: "Found 2 errors.",
        code: 1,
      }),
      { errors: 2 },
    );
  }
});
Deno.test("test parsers use test totals rather than suite totals", () => {
  const parser = resolveParser(["deno", "run", "npm:vitest"]);
  equal(
    parser?.parse({
      stdout: "Test Files  2 passed (2)\nTests  7 passed | 1 skipped (8)",
      stderr: "",
      code: 0,
    }),
    { passed: 7, failed: 0, skipped: 1 },
  );
  equal(
    resolveParser(["deno", "test"])?.parse({
      stdout: "ok | 3 passed | 0 failed | 2 ignored",
      stderr: "",
      code: 0,
    }),
    { passed: 3, failed: 0, skipped: 2 },
  );
});
Deno.test("unrecognized output remains unknown, including failed startup", () => {
  equal(resolveParser(["uv", "run", "script.py"]), undefined);
  equal(
    resolveParser(["deno", "test"])?.parse({
      stdout: "",
      stderr: "Could not resolve an import",
      code: 1,
    }),
    {},
  );
  assert(!resolveParser(["deno", "eval", 'console.log("vitest")']));
});
Deno.test("parser detection distinguishes invoked tools from their arguments", () => {
  equal(resolveParser(["echo", "vitest"]), undefined);
  equal(resolveParser(["deno", "eval", "vitest"]), undefined);
  equal(resolveParser(["deno", "--quiet", "test"])?.name, "deno-test");
  equal(
    resolveParser(["deno", "run", "--config", "config.json", "npm:vitest"])
      ?.name,
    "vitest",
  );
  equal(resolveParser(["deno", "run", "script.ts", "npm:vitest"]), undefined);
});
