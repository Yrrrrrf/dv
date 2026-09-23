import {
  choose,
  chooseRecipe,
  createPipeline,
  readInput,
  recipesFromDump,
} from "../src/mod.ts";
import { splitArguments } from "../src/cli/args.ts";
import { stripAnsi } from "../src/parsers.ts";
import { assert, equal, rejects } from "./assert.ts";
import { keyboard } from "./keyboard.ts";

Deno.test("recipe menu groups and searches metadata without Just", async () => {
  const output = await keyboard(["deploy\r"], async () => {
    const recipe = await chooseRecipe([
      {
        name: "test",
        group: "test",
        args: "*args",
        description: "Test applications",
      },
      {
        name: "build",
        group: "deploy",
        args: "*args",
        description: "Stage app artifacts",
      },
    ]);
    equal(recipe.name, "build");
  });
  const text = stripAnsi(output);
  assert(text.includes("[test]") && text.includes("[deploy]"));
  assert(text.includes("Stage app artifacts"));
  assert(text.includes("2 available"));
});

Deno.test("recipe selection cannot submit an arbitrary command or an empty match", async () => {
  await keyboard(["unlisted-command\r", "\x15test\r"], async () => {
    equal(await choose("Recipe", [{ value: "test", label: "test" }]), "test");
  });
});

Deno.test("argument editor handles cursor editing, quoted completion and validation", async () => {
  await keyboard(["ac\x1b[Db\r"], async () => {
    equal(await readInput("Argument"), "abc");
  });
  await keyboard(["'apps/one\t\r"], async () => {
    const answer = await readInput("Arguments", {
      suggestions: ["'apps/one space'"],
    });
    equal(splitArguments(answer), ["apps/one space"]);
  });
  await keyboard(["bad\r", "\x15good\r"], async () => {
    equal(
      await readInput("Argument", {
        validate: (value) => value === "good" ? undefined : "Try again",
      }),
      "good",
    );
  });
});

Deno.test("bracketed paste inserts text without submitting its embedded newlines", async () => {
  await keyboard(["\x1b[200~hello\nworld\x1b[201~\r"], async () => {
    equal(await readInput("Arguments"), "hello world");
  });
});

Deno.test("pipeline menu runs the same graph and keeps the unspecified target", async () => {
  const observed: unknown[] = [];
  const p = createPipeline({
    prepare: {
      private: true,
      run: () => {
        observed.push("prepare");
      },
    },
    test: {
      group: "test",
      deps: ["prepare"],
      complete: () => ["alpha", "beta"],
      run: ({ options }) => {
        observed.push(options.target ?? "all");
      },
    },
  }, { quiet: true });
  equal(p.recipes().map((r) => r.name), ["test"]);
  await p.run("test");
  const direct = [...observed];
  observed.length = 0;
  await keyboard(["\r", "\r", "\r"], async () => {
    const result = await p.menu();
    equal(result.completed, ["prepare", "test"]);
  });
  equal(observed, direct);
});

Deno.test("pipeline menu preserves explicit targets, all, options, and child failure", async () => {
  let observed: unknown;
  const p = createPipeline({
    test: {
      complete: () => {
        throw new Error("Completion must not replace explicit selection");
      },
      run: ({ options }) => {
        observed = [options.target, options.all, options.verbose, options.env];
      },
    },
  }, { quiet: true, env: { BASE: "base" } });
  await keyboard(["\r", "-v --env KEY='space value'\r"], async () => {
    await p.menu({ target: "beta" });
  });
  equal(observed, ["beta", undefined, true, {
    BASE: "base",
    KEY: "space value",
  }]);
  await keyboard(["\r", "\r"], async () => {
    await p.menu({ all: true });
  });
  equal(observed, [undefined, true, undefined, { BASE: "base" }]);
  let built = false;
  const failing = createPipeline({
    check: {
      private: true,
      run: ({ exec }) => exec(["deno", "eval", "Deno.exit(7)"]),
    },
    build: {
      deps: ["check"],
      run: () => {
        built = true;
      },
    },
  }, { quiet: true });
  await keyboard(["\r", "\r"], async () => {
    equal((await failing.menu({ throwOnError: false })).code, 7);
  });
  equal(built, false);
});

Deno.test("noninteractive and cancelled pipeline menus execute nothing", async () => {
  let executed = false;
  const p = createPipeline({
    task: {
      run: () => {
        executed = true;
      },
    },
  });
  await rejects(() => p.menu({ interactive: false }), /interactive terminal/);
  await rejects(() => p.menu({ signal: AbortSignal.abort() }), /cancelled/);
  await keyboard(["\x1b"], async () => {
    await rejects(() => p.menu(), /cancelled/);
  });
  equal(executed, false);
});

Deno.test("Just metadata includes public aliases and namespaced module recipes", () => {
  const recipes = recipesFromDump({
    recipes: {
      test: {
        name: "test",
        attributes: [{ group: "test" }],
        parameters: [{ name: "value", kind: "singular", default: "original" }],
      },
      _internal: { name: "_internal", private: true, parameters: [] },
    },
    aliases: {
      quick: { name: "quick", target: "test" },
      public: { name: "public", target: "_internal" },
    },
    modules: {
      nested: {
        recipes: {
          run: { name: "run", namepath: "nested::run", parameters: [] },
        },
      },
    },
  });
  equal(recipes.map((r) => r.name), ["test", "quick", "public", "nested::run"]);
  equal(
    recipes.find((r) => r.name === "quick")?.parameters[0]?.default,
    "original",
  );
});

Deno.test("arrow key decoding accepts a split immediately after Escape", async () => {
  await keyboard(["\x1b", "[", "B", "\r"], async () => {
    equal(
      await choose("Recipe", [{ value: "a", label: "alpha" }, {
        value: "b",
        label: "beta",
      }]),
      "b",
    );
  });
});
