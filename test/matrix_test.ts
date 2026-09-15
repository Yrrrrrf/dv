import { batch, exec, matrix, planMatrix } from "../src/mod.ts";
import { assert, equal, rejects, temp } from "./assert.ts";

Deno.test("matrix classifies nested packages, keeps argv boundaries and labels root-cwd commands", async () => {
  await temp(async (root) => {
    for (const name of ["one space", "two"]) {
      await Deno.mkdir(`${root}/modules/deep/${name}/src`, { recursive: true });
      await Deno.writeTextFile(`${root}/modules/deep/${name}/src/mod.ts`, "");
      await Deno.writeTextFile(`${root}/modules/deep/${name}/src/view.vue`, "");
    }
    const rules = [
      {
        packages: "modules/deep/*",
        pattern: "modules/**/src/view.vue",
        engine: "vue-tsc",
        cwd: "{root}",
        command: [
          "deno",
          "eval",
          "console.log(JSON.stringify(Deno.args))",
          "{file}",
        ],
      },
      {
        packages: "modules/deep/*",
        pattern: "modules/**/src/mod.ts",
        engine: "deno",
        command: ["deno", "check", "{file}"],
      },
    ];
    const specs = await planMatrix(rules, { root });
    equal(specs.length, 2);
    equal(specs[0]!.targetName, "one space");
    const result = await matrix(rules, {
      root,
      target: "one space",
      quiet: true,
    });
    equal(result.results.length, 1);
    equal(result.results[0]!.name, "one space");
    equal(result.results[0]!.cwd, root);
    equal(JSON.parse(result.results[0]!.stdout), [
      `${root}/modules/deep/one space/src/view.vue`,
    ]);
    equal((await planMatrix(rules, { root, match: "all" })).length, 4);
    equal(
      (await planMatrix(rules, { root, target: "two", scope: "declared" }))
        .length,
      2,
    );
    await rejects(
      () => planMatrix(rules, { root, target: "unknown" }),
      /unknown/,
    );
  });
});

Deno.test("preparation runs before workers and failure blocks every main command", async () => {
  await temp(async (root) => {
    const result = await exec([
      "deno",
      "eval",
      'console.log(Deno.readTextFileSync("ready"))',
    ], {
      root,
      quiet: true,
      before: [{
        command: ["deno", "eval", 'Deno.writeTextFileSync("ready", "ready")'],
      }],
    });
    equal(result.results[0]!.stdout, "ready\n");
    equal(result.preparation?.results.length, 1);
    const failed = await exec([
      "deno",
      "eval",
      'Deno.writeTextFileSync("bad", "bad")',
    ], {
      root,
      quiet: true,
      throwOnError: false,
      before: [{ command: ["deno", "eval", "Deno.exit(9)"] }],
    });
    equal(failed.code, 9);
    equal(failed.results.length, 0);
    equal(failed.skipped.length, 1);
    await rejects(() => Deno.stat(`${root}/bad`));
    await exec(["deno", "eval", 'Deno.writeTextFileSync("bad", "bad")'], {
      root,
      quiet: true,
      dryRun: true,
      before: [{
        command: [
          "deno",
          "eval",
          'Deno.writeTextFileSync("before-bad", "bad")',
        ],
      }],
    });
    await rejects(() => Deno.stat(`${root}/before-bad`));
  });
});

Deno.test("gate failure preserves process code, fails the batch, and unknown counts cannot pass", async () => {
  const result = await exec([
    "deno",
    "eval",
    'console.log("svelte-check found 0 errors and 3 warnings")',
  ], {
    parser: "svelte-check",
    gate: { maxWarnings: 0 },
    quiet: true,
    throwOnError: false,
  });
  equal(result.code, 1);
  equal(result.results[0]!.code, 0);
  equal(result.results[0]!.success, true);
  equal(result.results[0]!.gate?.success, false);
  const unknown = await exec(["deno", "eval", "void 0"], {
    gate: { maxErrors: 0 },
    quiet: true,
    throwOnError: false,
  });
  assert(unknown.results[0]!.gate?.reasons[0]?.includes("unavailable"));
  const skipped = await batch([{
    command: ["not-a-real-command"],
    skip: "unsupported here",
  }], { quiet: true });
  equal(skipped.results.length, 0);
  equal(skipped.skipped[0]!.skip, "unsupported here");
});

Deno.test("capture retains a late failure after a long prefix", async () => {
  const result = await exec([
    "deno",
    "eval",
    'console.log("x".repeat(10000)); console.log("FINAL FAILURE"); Deno.exit(1)',
  ], { quiet: true, throwOnError: false, maxOutputBytes: 100 });
  assert(result.results[0]!.stdout.endsWith("FINAL FAILURE\n"));
  assert(result.results[0]!.truncated);
  assert(new TextEncoder().encode(result.results[0]!.stdout).length <= 100);
});
