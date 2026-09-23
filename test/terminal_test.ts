import { choose } from "../src/mod.ts";
import { equal, rejects } from "./assert.ts";

import { keyboard } from "./keyboard.ts";

Deno.test("pasted search plus Tab/Enter selects the filtered item, not stale results", async () => {
  await keyboard(["test\t\r"], async () => {
    equal(
      await choose("Recipe", [{ value: "run", label: "run" }, {
        value: "prepare",
        label: "prepare",
        description: "Prune, then install dependencies",
      }, {
        value: "test",
        label: "test",
      }]),
      "test",
    );
  });
});
Deno.test("split arrow-key sequences work and terminal mode is restored", async () => {
  await keyboard(["\x1b[", "B", "\r"], async () => {
    equal(
      await choose("Target", [{ value: "a", label: "alpha" }, {
        value: "b",
        label: "beta",
      }]),
      "b",
    );
  });
});
Deno.test("Ctrl-C cancels the selector and restores terminal mode", async () => {
  await keyboard(["\x03"], async () => {
    await rejects(
      () => choose("Target", [{ value: "a", label: "alpha" }]),
      /cancelled/,
    );
  });
});
