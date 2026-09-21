import {
  batch,
  exec,
  ExecutionError,
  formatCommand,
  plan,
} from "../src/mod.ts";
import { assert, equal, rejects, temp } from "./assert.ts";

Deno.test("a reporter exception settles all active children before rejecting", async () => {
  await rejects(() =>
    batch([
      {
        command: [
          "deno",
          "eval",
          'console.log("trigger"); setInterval(() => {}, 1000)',
        ],
      },
      { command: ["deno", "eval", "setInterval(() => {}, 1000)"] },
    ], {
      parallel: true,
      jobs: 2,
      reporter: (event) => {
        if (event.type === "output") throw new Error("observer failure");
      },
    }), /observer failure/);
});

Deno.test("argv, cwd, env and metacharacters reach the child unchanged", async () => {
  await temp(async (root) => {
    await Deno.mkdir(`${root}/space dir`);
    const args = [
      "space value",
      "quote's",
      'double"quote',
      "$(touch forbidden)",
      "",
      "a\\b",
      "--flag",
    ];
    const result = await exec([
      "deno",
      "eval",
      'console.log(JSON.stringify({ args: Deno.args, cwd: Deno.cwd(), value: Deno.env.get("DV_CASE") }))',
      "--",
      ...args,
    ], {
      root,
      cwd: "space dir",
      env: { DV_CASE: "space's $value" },
      quiet: true,
    });
    const observed = JSON.parse(result.results[0]!.stdout);
    equal(observed.args, args);
    equal(
      observed.cwd.replaceAll("\\", "/"),
      `${root.replaceAll("\\", "/")}/space dir`,
    );
    equal(observed.value, "space's $value");
  });
});

Deno.test("file vectors expand to individual absolute argv entries", async () => {
  await temp(async (root) => {
    await Deno.writeTextFile(`${root}/a file.ts`, "");
    await Deno.writeTextFile(`${root}/b.ts`, "");
    const result = await exec([
      "deno",
      "eval",
      "console.log(JSON.stringify(Deno.args))",
      "{files}",
    ], { root, files: ["*.ts"], quiet: true });
    equal(JSON.parse(result.results[0]!.stdout), [
      `${root}/a file.ts`,
      `${root}/b.ts`,
    ]);
    await rejects(
      () => plan(["deno", "check"], { root, files: ["*.ts"] }),
      /standalone/,
    );
  });
});

Deno.test("selection is deterministic, validates names, and never guesses on non-TTY", async () => {
  await temp(async (root) => {
    for (const dir of ["apps/a", "apps/b", "other/a"]) {
      await Deno.mkdir(`${root}/${dir}`, { recursive: true });
    }
    await rejects(
      () =>
        plan(["deno", "--version"], {
          root,
          cwd: ["apps/*"],
          select: "one",
          interactive: false,
        }),
      /Choose a target/,
    );
    equal(
      (await plan(["echo", "{name}"], {
        root,
        cwd: ["apps/*"],
        select: "one",
        target: "b",
      }))[0]!.name,
      "b",
    );
    await rejects(
      () =>
        plan(["echo"], {
          root,
          cwd: ["apps/*", "other/*"],
          select: "one",
          target: "a",
        }),
      /ambiguous/,
    );
    equal(
      (await plan(["echo"], {
        root,
        cwd: ["apps/*", "other/*"],
        select: "one",
        target: "other/a",
      })).length,
      1,
    );
    equal(
      (await plan(["echo"], {
        root,
        cwd: "apps/a",
        select: "one",
        interactive: false,
      })).length,
      1,
    );
    await rejects(() => plan(["echo"], { root, cwd: "missing*" }), /No target/);
    await rejects(
      () =>
        plan(["echo"], {
          root,
          cwd: "apps/*",
          select: "one",
          target: "a",
          all: true,
        }),
      /cannot be combined/,
    );
  });
});

Deno.test("a dry run prints a plan without spawning or writing", async () => {
  await temp(async (root) => {
    const result = await exec([
      "deno",
      "eval",
      'Deno.writeTextFileSync("marker", "bad")',
    ], { root, dryRun: true, quiet: true });
    equal(result.results.length, 0);
    equal(result.planned.length, 1);
    await rejects(() => Deno.stat(`${root}/marker`));
  });
});

Deno.test("real child status survives parsers, including parsers reporting zero errors", async () => {
  const parser = {
    name: "custom",
    matches: () => true,
    parse: () => ({ errors: 0 }),
  };
  const result = await exec(["deno", "eval", "Deno.exit(7)"], {
    parser,
    quiet: true,
    throwOnError: false,
  });
  equal(result.code, 7);
  equal(result.success, false);
  equal(result.results[0]!.diagnostics.errors, 0);
  assert(
    await rejects(() =>
      exec(["deno", "eval", "Deno.exit(9)"], { quiet: true })
    ) instanceof ExecutionError,
  );
});

Deno.test("a failed parser retains child output and exit status", async () => {
  const parser = {
    name: "broken",
    matches: () => true,
    parse: () => {
      throw new Error("broken parser");
    },
  };
  const result = await exec(["deno", "eval", 'console.log("original")'], {
    parser,
    quiet: true,
  });
  equal(result.success, true);
  equal(result.results[0]!.stdout, "original\n");
  assert(result.results[0]!.parserError?.includes("broken parser"));
});

Deno.test("capture is bounded and suppresses partial diagnostic totals", async () => {
  const result = await exec([
    "deno",
    "eval",
    'console.log("x".repeat(300000)); console.error("y".repeat(300000))',
  ], { maxOutputBytes: 1000, quiet: true, parser: "typescript" });
  assert(result.results[0]!.truncated);
  equal(result.results[0]!.stdout.length, 1000);
  equal(result.results[0]!.stderr.length, 1000);
  equal(result.results[0]!.diagnostics, {});
});

Deno.test("pool honors its concurrency bound without serializing all children", async () => {
  let active = 0, maximum = 0;
  const specs = Array.from(
    { length: 5 },
    () => ({
      command: ["deno", "eval", "await new Promise(r => setTimeout(r, 100))"],
    }),
  );
  const result = await batch(specs, {
    parallel: true,
    jobs: 2,
    reporter: (event) => {
      if (event.type === "start") maximum = Math.max(maximum, ++active);
      if (event.type === "finish") active--;
    },
  });
  equal(result.results.length, 5);
  equal(maximum, 2);
  equal(active, 0);
});

Deno.test("fail-fast skips unscheduled children and preserves the failure code", async () => {
  await temp(async (root) => {
    const result = await batch([
      { command: ["deno", "eval", "Deno.exit(4)"] },
      { command: ["deno", "eval", 'Deno.writeTextFileSync("marker", "bad")'] },
    ], { root, failFast: true, quiet: true, throwOnError: false });
    equal(result.code, 4);
    equal(result.results.length, 1);
    equal(result.skipped.length, 1);
    await rejects(() => Deno.stat(`${root}/marker`));
  });
});

Deno.test("missing executable, timeout and cancellation yield distinct results", async () => {
  const missing = await exec(["dv-this-program-does-not-exist"], {
    quiet: true,
    throwOnError: false,
  });
  equal(missing.code, 127);
  const timed = await exec(["deno", "eval", "setInterval(() => {}, 1000)"], {
    quiet: true,
    timeoutMs: 100,
    throwOnError: false,
  });
  equal(timed.code, 124);
  assert(timed.results[0]!.aborted);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    const cancelled = await exec([
      "deno",
      "eval",
      "setInterval(() => {}, 1000)",
    ], { quiet: true, signal: controller.signal, throwOnError: false });
    equal(cancelled.code, 130);
  } finally {
    clearTimeout(timer);
  }
});

Deno.test("sh replay executes the same argv, cwd, and overrides", async () => {
  if (Deno.build.os === "windows") return;
  await temp(async (root) => {
    const [p] = await plan([
      "deno",
      "eval",
      'console.log(JSON.stringify([Deno.cwd(), Deno.env.get("DV_COPY"), ...Deno.args]))',
      "space's",
      "$(false)",
    ], { root, env: { DV_COPY: "quoted'value" } });
    const replay = await new Deno.Command("sh", {
      args: ["-c", formatCommand(p!, "sh")],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const direct = await exec(p!.command, { root, env: p!.env, quiet: true });
    equal(replay.code, 0);
    equal(new TextDecoder().decode(replay.stdout), direct.results[0]!.stdout);
  });
});

Deno.test("raw execution runs directly, normalizes exit 130 to 0, and propagates real failures", async () => {
  const rawExit130 = await exec(["deno", "eval", "Deno.exit(130)"], {
    raw: true,
    throwOnError: false,
  });
  equal(rawExit130.code, 0);
  equal(rawExit130.success, true);

  const rawExit42 = await exec(["deno", "eval", "Deno.exit(42)"], {
    raw: true,
    throwOnError: false,
  });
  equal(rawExit42.code, 42);
  equal(rawExit42.success, false);

  await temp(async (root) => {
    await Deno.mkdir(`${root}/apps/app1`, { recursive: true });
    const selectOneResult = await exec(["deno", "eval", "Deno.exit(130)"], {
      root,
      cwd: "apps/*",
      select: "one",
      target: "app1",
      throwOnError: false,
    });
    equal(selectOneResult.code, 0);
    equal(selectOneResult.success, true);

    const noRawResult = await exec(["deno", "eval", "Deno.exit(130)"], {
      root,
      cwd: "apps/*",
      select: "one",
      raw: false,
      target: "app1",
      quiet: true,
      throwOnError: false,
    });
    equal(noRawResult.code, 130);
    equal(noRawResult.success, false);
  });
});
