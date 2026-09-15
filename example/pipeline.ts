/** The same demo graph as ./justfile, using Deno alone. */
import { createPipeline, discover, filePath } from "../src/mod.ts";
// After publication: import { ... } from "jsr:@yrrrrrf/dv";

const root = filePath(new URL(".", import.meta.url));
const apps = ["apps/*"];
const targets = async () =>
  (await discover(apps, { root })).map((t) => t.relative);

const workspace = createPipeline({
  run: {
    group: "dev",
    description: "Select and run an app",
    args: "[target] *args",
    complete: targets,
    run: ({ exec }) =>
      exec(["deno", "run", "--allow-net=127.0.0.1", "mod.ts"], {
        cwd: apps,
        select: "one",
      }),
  },
  prune: {
    group: "dev",
    description: "Remove the demo build and coverage output",
    run: ({ rm }) => rm(["build", "coverage"]),
  },
  prepare: {
    group: "dev",
    description: "Prune, then install dependencies",
    deps: ["prune"],
    run: ({ exec }) => exec(["deno", "install"]),
  },
  test: {
    group: "test",
    description: "Test every app, or one selected target",
    args: "[target] *args",
    complete: targets,
    run: ({ matrix }) =>
      matrix([{
        packages: apps,
        pattern: "apps/*/mod_test.ts",
        engine: "deno test",
        command: ["deno", "test", "{file}"],
      }], { commands: "none" }),
  },
  coverage: {
    group: "test",
    description: "Collect coverage across both apps",
    args: "*args",
    run: ({ exec }) => exec(["deno", "test", "--coverage=coverage", "apps"]),
  },
  fmt: {
    group: "check",
    description: "Verify app formatting",
    run: ({ exec }) => exec(["deno", "fmt", "--check", "apps"]),
  },
  lint: {
    group: "check",
    description: "Lint app sources",
    run: ({ exec }) => exec(["deno", "lint", "apps"]),
  },
  types: {
    group: "check",
    description: "Check all app entrypoints",
    args: "*args",
    run: ({ matrix }) =>
      matrix([{
        packages: apps,
        pattern: "apps/*/mod.ts",
        engine: "deno check",
        cwd: "{root}",
        command: ["deno", "check", "{file}"],
      }], { scope: "declared", commands: "none" }),
  },
  check: {
    group: "check",
    description: "Run the demo quality gates",
    args: "*args",
    deps: ["fmt", "lint", "types"],
  },
  ci: {
    group: "ci",
    description: "Tests first, then checks",
    args: "*args",
    deps: ["test", "check"],
  },
  build: {
    group: "deploy",
    description: "Run CI, then stage app artifacts",
    args: "*args",
    deps: ["ci"],
    run: ({ exec }) =>
      exec([
        "deno",
        "eval",
        'Deno.mkdirSync(Deno.args[0], { recursive: true }); Deno.copyFileSync("mod.ts", Deno.args[0] + "/mod.ts"); console.log("Built " + Deno.args[0]);',
        "{root}/build/{name}",
      ], {
        cwd: apps,
        select: "all",
        engine: "deno",
        label: "Stage {name} artifacts",
      }),
  },
  preview: {
    group: "deploy",
    description: "Build first, then serve the selected artifact",
    args: "[target] *args",
    deps: ["build"],
    complete: targets,
    run: ({ exec }) =>
      exec([
        "deno",
        "run",
        "--allow-net=127.0.0.1",
        "{root}/build/{name}/mod.ts",
      ], { cwd: apps, select: "one" }),
  },
  cycle: {
    group: "deploy",
    description: "Prepare, then perform the gated build",
    args: "*args",
    deps: ["prepare", "build"],
  },
}, { root });

if (import.meta.main) Deno.exit(await workspace.cli());
export { workspace };
