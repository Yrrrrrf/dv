import { choose } from "../src/mod.ts";
import { equal, rejects } from "./assert.ts";

async function keyboard(
  chunks: string[],
  run: () => Promise<void>,
): Promise<void> {
  const stdin = {
    read: Deno.stdin.read,
    terminal: Deno.stdin.isTerminal,
    raw: Deno.stdin.setRaw,
  };
  const stderr = {
    write: Deno.stderr.writeSync,
    terminal: Deno.stderr.isTerminal,
  };
  const modes: boolean[] = [];
  Deno.stdin.read = (buffer) => {
    const chunk = chunks.shift();
    if (chunk === undefined) return Promise.resolve(null);
    const bytes = new TextEncoder().encode(chunk);
    buffer.set(bytes);
    return Promise.resolve(bytes.length);
  };
  Deno.stdin.isTerminal = () => true;
  Deno.stderr.isTerminal = () => true;
  Deno.stdin.setRaw = (mode) => {
    modes.push(mode);
  };
  Deno.stderr.writeSync = (bytes) => bytes.length;
  try {
    await run();
    equal(modes, [true, false]);
  } finally {
    Deno.stdin.read = stdin.read;
    Deno.stdin.isTerminal = stdin.terminal;
    Deno.stdin.setRaw = stdin.raw;
    Deno.stderr.writeSync = stderr.write;
    Deno.stderr.isTerminal = stderr.terminal;
  }
}

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
