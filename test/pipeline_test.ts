import { createPipeline, recipesFromDump } from "../src/mod.ts";
import { equal, rejects } from "./assert.ts";

Deno.test("pipeline resolves dependencies once, tests first, before build", async () => {
  const calls: string[] = [];
  const leaf = (name: string) => ({
    run: () => {
      calls.push(name);
    },
  });
  const pipeline = createPipeline({
    prune: leaf("prune"),
    prepare: { ...leaf("prepare"), deps: ["prune"] },
    test: leaf("test"),
    types: leaf("types"),
    check: { deps: ["types"] },
    ci: { deps: ["test", "check"] },
    build: { ...leaf("build"), deps: ["ci"] },
    cycle: { deps: ["prepare", "build"] },
    both: { deps: ["cycle", "ci"] },
  }, { quiet: true });
  await pipeline.run("both");
  equal(calls, ["prune", "prepare", "test", "types", "build"]);
});
Deno.test("invalid dependency graphs fail before performing any work", async () => {
  const calls: string[] = [];
  const pipeline = createPipeline({
    a: {
      deps: ["b"],
      run: () => {
        calls.push("a");
      },
    },
    b: { deps: ["a"] },
  });
  await rejects(() => pipeline.run("a"), /cycle/);
  equal(calls, []);
});
Deno.test("a failed child prevents the pipeline's build body", async () => {
  let built = false;
  const pipeline = createPipeline({
    test: { run: ({ exec }) => exec(["deno", "eval", "Deno.exit(5)"]) },
    build: {
      deps: ["test"],
      run: () => {
        built = true;
      },
    },
  }, { quiet: true });
  await rejects(() => pipeline.run("build"), /exit code 5/);
  equal(built, false);
});
Deno.test("Just metadata includes docs/signatures and hides private recipes", () => {
  const recipes = recipesFromDump({
    recipes: {
      run: {
        name: "run",
        parameters: [{ name: "args", kind: "star", default: null }],
        attributes: [{ group: "dev" }, { doc: "Run an app" }],
      },
      _hidden: { private: true },
    },
  });
  equal(
    recipes.map(({ name, group, args, description }) => ({
      name,
      group,
      args,
      description,
    })),
    [{ name: "run", group: "dev", args: "*args", description: "Run an app" }],
  );
});
Deno.test("failed pipeline retains partial results, blocked tasks, and lifecycle events", async () => {
  const events: string[] = [];
  const p = createPipeline({
    first: { run: ({ exec }) => exec(["deno", "eval", "void 0"]) },
    failing: {
      deps: ["first"],
      run: ({ exec }) => exec(["deno", "eval", "Deno.exit(7)"]),
    },
    build: {
      deps: ["failing"],
      run: () => {
        throw new Error("must not run");
      },
    },
  }, { quiet: true });
  const result = await p.run("build", {
    throwOnError: false,
    pipelineReporter: (e) => events.push(e.type),
  });
  equal(result.code, 7);
  equal(result.completed, ["first"]);
  equal(result.tasks.map((t) => t.status), ["completed", "failed", "blocked"]);
  equal(result.tasks[1]?.runs[0]?.results[0]?.code, 7);
  equal(events, [
    "pipeline-start",
    "task-start",
    "task-finish",
    "task-start",
    "task-finish",
    "pipeline-finish",
  ]);
});
