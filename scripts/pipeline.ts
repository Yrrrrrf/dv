/**
 * Developer and CI workflow pipeline for @yrrrrrf/dv.
 * Implements the 4-phase house harness (dev, check, test, deploy) with dv.
 */
import { createPipeline, filePath } from "../src/mod.ts";

const root = filePath(new URL("../", import.meta.url));

const workspace = createPipeline(
  {
    prune: {
      group: "dev",
      description:
        "Remove generated build, npm distribution, and coverage output",
      run: ({ rm }) => rm(["npm", "dist", "coverage"]),
    },
    version: {
      group: "dev",
      description: "Synchronize literal version into src/version.ts",
      run: ({ exec }) =>
        exec([
          "deno",
          "run",
          "--allow-read",
          "--allow-write=src/version.ts",
          "scripts/version.ts",
        ]),
    },
    prepare: {
      group: "dev",
      description: "Prune generated artifacts, then synchronize the version",
      deps: ["prune", "version"],
    },
    fmt: {
      group: "check",
      description: "Verify source formatting",
      run: ({ exec }) => exec(["deno", "fmt", "."]),
    },
    lint: {
      group: "check",
      description: "Lint source files",
      run: ({ exec }) => exec(["deno", "lint"]),
    },
    types: {
      group: "check",
      description: "Type check all library, CLI, and script entrypoints",
      run: ({ exec }) => exec(["deno", "check", "."]),
    },
    check: {
      group: "check",
      description: "Run all quality gates (version, format, lint, types)",
      deps: ["fmt", "lint", "types"],
    },
    test: {
      group: "test",
      description: "Run the Deno unit and integration test suite",
      run: ({ exec }) => exec(["deno", "test", "-A", "test/"]),
    },
    coverage: {
      group: "test",
      description: "Run test suite and collect coverage into coverage/",
      run: ({ exec }) =>
        exec(["deno", "test", "-A", "--coverage=coverage", "test/"]),
    },
    build: {
      group: "deploy",
      description: "Build the npm ESM distribution using dnt",
      deps: ["check"],
      run: ({ exec }) => exec(["deno", "run", "-A", "scripts/dnt.ts"]),
    },
    ci: {
      group: "ci",
      description:
        "Run quality gates, Deno tests, and verified npm tarball tests",
      deps: ["check", "test"],
    },
    cycle: {
      group: "deploy",
      description:
        "Prepare workspace, run full CI gates, and produce distribution",
      deps: ["prepare", "ci", "build"],
    },
  },
  { root },
);

if (import.meta.main) Deno.exit(await workspace.cli());
export { workspace };
