import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { exec, plan, VERSION } from "@yrrrrrf/dv";
import { main } from "@yrrrrrf/dv/cli";

const bin = process.env.DV_TEST_BIN;

test("packed metadata and explicit CLI entrypoints agree", () => {
  assert.equal(VERSION, process.env.DV_TEST_VERSION);
  assert.equal(typeof main, "function");
  const result = spawnSync(process.execPath, [bin, "--version"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), VERSION);
});

test("package import has no input or signal listener side effects", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import assert from "node:assert/strict";
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM"), process.stdin.listenerCount("readable")];
    await import("@yrrrrrf/dv");
    await import("@yrrrrrf/dv/cli");
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM"), process.stdin.listenerCount("readable")], before);
  `,
  ], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("native argv, cwd, env, and child failure survive the packed CLI", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dv-node-"));
  try {
    const values = ["two words", "", "$(literal)", "a;b", "quote'\""];
    const child = spawnSync(process.execPath, [
      bin,
      "exec",
      "--json",
      "--root",
      root,
      "--env",
      "DV_VALUE=space value",
      "--",
      process.execPath,
      "-e",
      "console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),env:process.env.DV_VALUE}));process.exitCode=7",
      ...values,
    ], { encoding: "utf8" });
    assert.equal(child.status, 7, child.stderr);
    const summary = JSON.parse(child.stdout);
    const captured = JSON.parse(summary.results[0].stdout);
    assert.deepEqual(captured.args, values);
    assert.equal(captured.cwd, root);
    assert.equal(captured.env, "space value");
    assert.equal(summary.code, 7);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("planning preserves explicit executables without host rewriting", async () => {
  const [command] = await plan(["deno", "--version"]);
  assert.equal(command.command[0], "deno");
});

test("spawn errors, timeouts, and cancellation remain distinct", async () => {
  const missing = await exec(["dv-no-such-executable-0-0-6"], {
    quiet: true,
    throwOnError: false,
  });
  assert.equal(missing.code, 127);
  const command = [process.execPath, "-e", "setInterval(()=>{},1000)"];
  const timed = await exec(command, {
    quiet: true,
    timeoutMs: 60,
    throwOnError: false,
  });
  assert.equal(timed.code, 124);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60);
  try {
    const cancelled = await exec(command, {
      quiet: true,
      signal: controller.signal,
      throwOnError: false,
    });
    assert.equal(cancelled.code, 130);
  } finally {
    clearTimeout(timer);
  }
});

test("retired removal syntax gives a migration error", () => {
  const result = spawnSync(process.execPath, [bin, "rm", "--glob", "build"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown dv option|--paths/);
});
