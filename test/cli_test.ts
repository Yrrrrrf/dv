import { filePath, parseArgs } from "../src/mod.ts";
import { equal, rejects } from "./assert.ts";

const entry = filePath(new URL("../src/mod.ts", import.meta.url));
Deno.test("CLI separates its vector flags from untouched child arguments", () => {
  const parsed = parseArgs([
    "alpha",
    "-pv",
    "--cwd",
    "apps/*",
    "sdk/state",
    "--env",
    "KEY=space value",
    "--",
    "tool",
    "--cwd",
    "unmodified",
    "",
  ]);
  equal(parsed.options.cwd, ["apps/*", "sdk/state"]);
  equal(parsed.options.target, "alpha");
  equal(parsed.options.parallel, true);
  equal(parsed.command, ["tool", "--cwd", "unmodified", ""]);
});
Deno.test("CLI parses raw flags correctly", () => {
  equal(parseArgs(["-r", "--", "echo"]).options.raw, true);
  equal(parseArgs(["--raw", "--", "echo"]).options.raw, true);
  equal(parseArgs(["--no-raw", "--", "echo"]).options.raw, false);
  equal(parseArgs(["-rb", "--", "echo"]).options.raw, true);
  equal(parseArgs(["-rb", "--", "echo"]).options.benchmark, true);
});
Deno.test("CLI rejects unknown options and invalid concurrency", async () => {
  await rejects(() => parseArgs(["--bogus"]), /Unknown/);
  await rejects(() => parseArgs(["--jobs", "0"]), /positive/);
  await rejects(() => parseArgs(["--select", "maybe"]), /one or all/);
});
Deno.test("CLI JSON output is machine-readable and preserves a child failure", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      entry,
      "exec",
      "--json",
      "--",
      "deno",
      "eval",
      'console.log("original"); Deno.exit(6)',
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  equal(result.code, 6);
  const json = JSON.parse(new TextDecoder().decode(result.stdout));
  equal(json.results[0].stdout, "original\n");
  equal(json.code, 6);
});
Deno.test("importing the library needs no Just, subprocess, read, or env permission", async () => {
  const source = `import { createPipeline, exec } from ${
    JSON.stringify(new URL("../src/mod.ts", import.meta.url).href)
  }; console.log(typeof createPipeline, typeof exec);`;
  const path = await Deno.makeTempFile({ suffix: ".ts" });
  try {
    await Deno.writeTextFile(path, source);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--deny-run", "--deny-env", "--deny-read", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    equal(new TextDecoder().decode(result.stderr), "");
    equal(result.code, 0);
    equal(new TextDecoder().decode(result.stdout), "function function\n");
  } finally {
    await Deno.remove(path);
  }
});
Deno.test("pipeline CLI emits structured failures and preserves the failed child code", async () => {
  const path = await Deno.makeTempFile({ suffix: ".ts" });
  try {
    await Deno.writeTextFile(
      path,
      `import {createPipeline} from ${
        JSON.stringify(new URL("../src/mod.ts", import.meta.url).href)
      }; Deno.exit(await createPipeline({bad:{run:({exec})=>exec(["deno","eval","Deno.exit(8)"])},build:{deps:["bad"]}}).cli());`,
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", path, "build", "--json"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    equal(output.code, 8);
    equal(new TextDecoder().decode(output.stderr), "");
    const json = JSON.parse(new TextDecoder().decode(output.stdout));
    equal(json.success, false);
    equal(json.tasks[1].status, "blocked");
  } finally {
    await Deno.remove(path);
  }
});
