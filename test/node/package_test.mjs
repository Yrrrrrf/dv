import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm as remove,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  batch,
  createPipeline,
  discover,
  exec,
  ExecutionError,
  filePath,
  formatCommand,
  matrix,
  plan,
  planMatrix,
  rm,
  VERSION,
} from "@yrrrrrf/dv";
import { main, VERSION as cliVersion } from "@yrrrrrf/dv/cli";

const runFile = promisify(execFile);
const bin = process.env.DV_TEST_BIN;
const code = (source, ...args) => [process.execPath, "-e", source, ...args];
const quiet = { quiet: true };
async function temporary(run) {
  const root = await mkdtemp(join(tmpdir(), "dv-node-"));
  try {
    return await run(root);
  } finally {
    await remove(root, { recursive: true, force: true });
  }
}
async function cli(args, options = {}) {
  try {
    const result = await runFile(process.execPath, [bin, ...args], options);
    return { ...result, code: 0 };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

test("packed root, CLI subpath and bin share the release version", async () => {
  assert.equal(VERSION, process.env.DV_TEST_VERSION);
  assert.equal(cliVersion, VERSION);
  assert.equal(typeof main, "function");
  assert.equal((await cli(["--version"])).stdout.trim(), VERSION);
  assert.equal((await cli(["--help"])).code, 0);
});

test("eval can import both entrypoints without a script filename or Deno", async () => {
  const result = await runFile(process.execPath, [
    "--input-type=module",
    "-e",
    `
    const before=[process.listenerCount('SIGINT'),process.listenerCount('SIGTERM')];
    const lib=await import('@yrrrrrf/dv');
    const cli=await import('@yrrrrrf/dv/cli');
    if(typeof globalThis.Deno!=='undefined')throw new Error('Unexpected Deno runtime');
    if(JSON.stringify(before)!==JSON.stringify([process.listenerCount('SIGINT'),process.listenerCount('SIGTERM')]))throw new Error('Import installed signal listeners');
    console.log(lib.VERSION,cli.VERSION);
  `,
  ], { env: { ...process.env, PATH: "" } });
  assert.equal(result.stdout.trim(), `${VERSION} ${VERSION}`);
  assert.equal(result.stderr, "");
});

test("argv, cwd, env, empty values and shell metacharacters survive", () =>
  temporary(async (root) => {
    const cwd = join(root, "space dir");
    await mkdir(cwd);
    const args = [
      "space value",
      "",
      "quote's",
      'double"quote',
      "a\\b",
      "$(touch forbidden)",
      "`touch forbidden`",
      "*",
      "a;b|c",
      "雪\nnext",
    ];
    const result = await exec(
      code(
        "console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),env:process.env.DV_CASE}))",
        ...args,
      ),
      {
        ...quiet,
        root,
        cwd: "space dir",
        env: { DV_CASE: "space's $value" },
      },
    );
    assert.deepEqual(JSON.parse(result.results[0].stdout), {
      args,
      cwd,
      env: "space's $value",
    });
    await assert.rejects(stat(join(cwd, "forbidden")));
  }));

test("Node plans retain an explicit deno executable without looking it up", async () => {
  assert.equal((await plan(["deno", "test"], quiet))[0].command[0], "deno");
});

test("CLI JSON preserves child output and failure status", async () => {
  const result = await cli([
    "exec",
    "--json",
    "--",
    ...code('console.log("original");process.exit(6)'),
  ]);
  assert.equal(result.code, 6);
  assert.equal(result.stderr, "");
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.code, 6);
  assert.equal(summary.results[0].stdout, "original\n");
});

test("literal argv works with an executable path containing spaces", () =>
  temporary(async (root) => {
    const executable = join(
      root,
      process.platform === "win32"
        ? "node with spaces.exe"
        : "node with spaces",
    );
    // A real executable copy avoids POSIX-only shell wrappers and shebangs.
    const { copyFile, chmod } = await import("node:fs/promises");
    await copyFile(process.execPath, executable);
    await chmod(executable, 0o755);
    const result = await exec([
      executable,
      "-e",
      "console.log(process.argv[1])",
      "space value",
    ], quiet);
    assert.equal(result.results[0].stdout, "space value\n");
  }));

test("glob discovery and file placeholders remain sorted and root-contained", () =>
  temporary(async (root) => {
    await mkdir(join(root, "apps/a"), { recursive: true });
    await mkdir(join(root, "apps/b"), { recursive: true });
    await writeFile(join(root, "a file.ts"), "");
    await writeFile(join(root, "b.ts"), "");
    assert.deepEqual(
      (await discover(["apps/*", "apps/a"], { root })).map((t) => t.relative),
      ["apps/a", "apps/b"],
    );
    const result = await exec(
      code("console.log(JSON.stringify(process.argv.slice(1)))", "{files}"),
      { ...quiet, root, files: ["*.ts"] },
    );
    assert.deepEqual(JSON.parse(result.results[0].stdout), [
      join(root, "a file.ts"),
      join(root, "b.ts"),
    ]);
    await assert.rejects(discover(["../outside"], { root }), /escapes root/);
  }));

test("selection rejects ambiguous names and nonterminal prompting", () =>
  temporary(async (root) => {
    for (const path of ["apps/a", "apps/b", "other/a"]) {
      await mkdir(join(root, path), { recursive: true });
    }
    await assert.rejects(
      plan(code(""), {
        root,
        cwd: ["apps/*"],
        select: "one",
        interactive: false,
      }),
      /Choose a target/,
    );
    await assert.rejects(
      plan(code(""), {
        root,
        cwd: ["apps/*", "other/*"],
        select: "one",
        target: "a",
      }),
      /ambiguous/,
    );
    assert.equal(
      (await plan(code(""), {
        root,
        cwd: ["apps/*"],
        select: "one",
        target: "b",
      }))[0].name,
      "b",
    );
  }));

test("removal preserves root refusal, missing paths and symlink boundaries", () =>
  temporary(async (root) => {
    await mkdir(join(root, "build/nested"), { recursive: true });
    const dry = await rm(["build", "build/nested", "missing"], {
      root,
      quiet: true,
      dryRun: true,
    });
    assert.equal(dry.paths.length, 1);
    await stat(join(root, "build"));
    await assert.rejects(rm(["."], { root, quiet: true }), /project root/);
    await rm(["build", "missing"], { root, quiet: true });
    if (process.platform !== "win32") {
      await temporary(async (outside) => {
        await writeFile(join(outside, "keep"), "keep");
        await symlink(outside, join(root, "link"));
        await assert.rejects(
          rm(["link/keep"], { root, quiet: true }),
          /Symlink/,
        );
        await rm(["link"], { root, quiet: true });
        assert.equal(await readFile(join(outside, "keep"), "utf8"), "keep");
      });
    }
  }));

test("dry-run plans preparation without spawning either phase", () =>
  temporary(async (root) => {
    const result = await exec(
      code('require("fs").writeFileSync("marker","bad")'),
      {
        ...quiet,
        root,
        dryRun: true,
        before: [{
          command: code('require("fs").writeFileSync("prepared","bad")'),
        }],
      },
    );
    assert.equal(result.results.length, 0);
    assert.equal(result.preparation.dryRun, true);
    await assert.rejects(stat(join(root, "marker")));
    await assert.rejects(stat(join(root, "prepared")));
  }));

test("capture retains its head and tail and rejects unavailable gate metrics", async () => {
  const result = await exec(
    code('console.log("x".repeat(12000));console.log("FINAL FAILURE")'),
    {
      ...quiet,
      maxOutputBytes: 200,
      throwOnError: false,
      parser: {
        name: "count",
        matches: () => true,
        parse: () => ({ errors: 0 }),
      },
      gate: { maxErrors: 0 },
    },
  );
  const child = result.results[0];
  assert.equal(child.truncated, true);
  assert.ok(Buffer.byteLength(child.stdout) <= 200);
  assert.match(child.stdout, /FINAL FAILURE/);
  assert.deepEqual(child.diagnostics, {});
  assert.equal(child.code, 0);
  assert.equal(result.code, 1);
});

test("process failure remains authoritative and parser failures retain results", async () => {
  await assert.rejects(
    exec(code("process.exit(7)"), {
      ...quiet,
      parser: {
        name: "zero",
        matches: () => true,
        parse: () => ({ errors: 0 }),
      },
    }),
    (error) => error instanceof ExecutionError && error.summary.code === 7,
  );
  const result = await exec(code('console.log("kept")'), {
    ...quiet,
    parser: {
      name: "broken",
      matches: () => true,
      parse: () => {
        throw new Error("broken parser");
      },
    },
  });
  assert.equal(result.results[0].stdout, "kept\n");
  assert.match(result.results[0].parserError, /broken parser/);
});

test("concurrency is bounded and result order follows declarations", async () => {
  const active = new Set();
  let peak = 0;
  const result = await batch(
    [250, 25, 70, 15].map((delay, i) => ({
      id: String(i),
      command: code(`setTimeout(()=>console.log(${i}),${delay})`),
    })),
    {
      ...quiet,
      parallel: true,
      jobs: 2,
      reporter: (event) => {
        if (event.type === "start") {
          active.add(event.command.id);
          peak = Math.max(peak, active.size);
        }
        if (event.type === "finish") active.delete(event.result.id);
      },
    },
  );
  assert.equal(peak, 2);
  assert.deepEqual(result.results.map((r) => r.stdout.trim()), [
    "0",
    "1",
    "2",
    "3",
  ]);
});

test("fail-fast leaves unscheduled work unexecuted", () =>
  temporary(async (root) => {
    const result = await batch([
      { command: code("process.exit(4)") },
      { command: code('require("fs").writeFileSync("marker","bad")') },
    ], { ...quiet, root, failFast: true, throwOnError: false });
    assert.equal(result.code, 4);
    assert.equal(result.skipped.length, 1);
    await assert.rejects(stat(join(root, "marker")));
  }));

test("missing executable, timeout and cancellation have distinct codes", async () => {
  const missing = await exec(["dv-nonexistent-executable-005"], {
    ...quiet,
    throwOnError: false,
  });
  assert.equal(missing.code, 127);
  const timeout = await exec(code("setInterval(()=>{},1000)"), {
    ...quiet,
    timeoutMs: 100,
    throwOnError: false,
  });
  assert.equal(timeout.code, 124);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    const cancelled = await exec(code("setInterval(()=>{},1000)"), {
      ...quiet,
      signal: controller.signal,
      throwOnError: false,
    });
    assert.equal(cancelled.code, 130);
  } finally {
    clearTimeout(timer);
  }
});

test("raw interruption is successful while crashes and timeouts fail", async () => {
  assert.equal(
    (await exec(code("process.exit(130)"), { ...quiet, raw: true })).code,
    0,
  );
  assert.equal(
    (await exec(code("process.exit(42)"), {
      ...quiet,
      raw: true,
      throwOnError: false,
    })).code,
    42,
  );
  assert.equal(
    (await exec(code("setInterval(()=>{},1000)"), {
      ...quiet,
      raw: true,
      timeoutMs: 100,
      throwOnError: false,
    })).code,
    124,
  );
  await assert.rejects(
    batch([{ command: code("") }, { command: code("") }], {
      ...quiet,
      stdin: "inherit",
      parallel: true,
      jobs: 2,
    }),
    /sequential/,
  );
});

test("timeouts close descendant pipes and terminate ordinary process groups", {
  skip: process.platform === "win32",
  timeout: 6000,
}, async () => {
  const started = performance.now();
  const result = await exec(
    code(
      'require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:["ignore","inherit","inherit"]});setInterval(()=>{},1000)',
    ),
    { ...quiet, timeoutMs: 250, throwOnError: false },
  );
  assert.equal(result.code, 124);
  assert.ok(performance.now() - started < 3000);
});

test("reporter exceptions settle active children before rejection", {
  timeout: 6000,
}, async () => {
  await assert.rejects(
    batch([
      { command: code('console.log("trigger");setInterval(()=>{},1000)') },
      { command: code("setInterval(()=>{},1000)") },
    ], {
      parallel: true,
      jobs: 2,
      reporter: (event) => {
        if (event.type === "output") throw new Error("observer failure");
      },
    }),
    /observer failure/,
  );
});

test("preparation finishes before workers and failed preparation blocks them", () =>
  temporary(async (root) => {
    const result = await exec(
      code('console.log(require("fs").readFileSync("ready","utf8"))'),
      {
        ...quiet,
        root,
        before: [{
          command: code('require("fs").writeFileSync("ready","ready")'),
        }],
      },
    );
    assert.equal(result.results[0].stdout, "ready\n");
    const failed = await exec(
      code('require("fs").writeFileSync("bad","bad")'),
      {
        ...quiet,
        root,
        before: [{ command: code("process.exit(9)") }],
        throwOnError: false,
      },
    );
    assert.equal(failed.code, 9);
    assert.equal(failed.results.length, 0);
    await assert.rejects(stat(join(root, "bad")));
  }));

test("matrix ownership, package cwd and file expansion are preserved", () =>
  temporary(async (root) => {
    for (const name of ["a", "b"]) {
      await mkdir(join(root, "apps", name), { recursive: true });
      await writeFile(join(root, "apps", name, "mod.ts"), "");
    }
    const rule = {
      packages: "apps/*",
      pattern: "apps/*/mod.ts",
      command: code("console.log(process.argv[1])", "{file}"),
      engine: "node",
    };
    assert.equal((await planMatrix([rule, rule], { root })).length, 2);
    assert.equal(
      (await planMatrix([rule, rule], { root, match: "all" })).length,
      4,
    );
    const result = await matrix([rule], { ...quiet, root, target: "b" });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].cwd, join(root, "apps", "b"));
    assert.equal(
      result.results[0].stdout.trim(),
      join(root, "apps", "b", "mod.ts"),
    );
  }));

test("pipeline dependencies, partial failures and scoped signal listeners survive", async () => {
  const order = [];
  const pipeline = createPipeline({
    prepare: { run: () => order.push("prepare") },
    test: { deps: ["prepare"], run: () => order.push("test") },
    types: { deps: ["prepare"], run: () => order.push("types") },
    ci: { deps: ["test", "types"] },
  }, quiet);
  await pipeline.run("ci");
  assert.deepEqual(order, ["prepare", "test", "types"]);
  const before = [
    process.listenerCount("SIGINT"),
    process.listenerCount("SIGTERM"),
  ];
  await pipeline.cli(["ci"]);
  assert.deepEqual([
    process.listenerCount("SIGINT"),
    process.listenerCount("SIGTERM"),
  ], before);
  const failed = await createPipeline({
    bad: { run: ({ exec }) => exec(code("process.exit(8)")) },
    build: { deps: ["bad"] },
  }, quiet).run("build", { throwOnError: false });
  assert.equal(failed.code, 8);
  assert.equal(failed.tasks[1].status, "blocked");
  await assert.rejects(
    pipeline.menu({ interactive: false }),
    /interactive terminal/,
  );
});

test("native path and file URL conversion preserve spaces and reject encoded separators", () => {
  const path = join(tmpdir(), "space dir", "雪.ts");
  assert.equal(filePath(pathToFileURL(path)), path.replaceAll("\\", "/"));
  assert.throws(() => filePath("file:///tmp/a%2Fb"), /Encoded path separators/);
});

test("copyable sh display replays the same argv and environment", {
  skip: process.platform === "win32",
}, async () => {
  const [command] = await plan(
    code(
      "console.log(JSON.stringify([process.env.DV_COPY,...process.argv.slice(1)]))",
      "space value",
      "",
    ),
    { env: { DV_COPY: "it's $literal" } },
  );
  const original =
    (await exec(command.command, { ...quiet, env: command.env })).results[0]
      .stdout;
  const replay = await runFile("sh", ["-c", formatCommand(command, "sh")]);
  assert.equal(replay.stdout, original);
});
