import fs from "node:fs";
import process from "node:process";
import { createReporter, exec, formatRecipes } from "../src/mod.ts";
import {
  childEnvironment,
  clip,
  color,
  displayWidth,
  sanitize,
} from "../src/terminal/style.ts";
import { assert, equal } from "./assert.ts";

function colorEnvironment(run: () => void): void {
  const values = new Map(
    ["NO_COLOR", "FORCE_COLOR", "TERM"].map((key) => [key, Deno.env.get(key)]),
  );
  try {
    Deno.env.delete("NO_COLOR");
    Deno.env.set("FORCE_COLOR", "1");
    Deno.env.set("TERM", "xterm");
    run();
  } finally {
    for (const [key, value] of values) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("sanitized terminal logs retain SGR and discard cursor/OSC controls", () => {
  const input = "\x1b[31mred\x1b[0m\x1b[2J\x1b]0;title\x07 done";
  equal(sanitize(input, true), "\x1b[31mred\x1b[0m done");
  equal(sanitize(input), "red done");
  const clipped = clip("\x1b[32m你好abc\x1b[0m", 5, true);
  equal(displayWidth(clipped), 5);
  assert(clipped.endsWith("\x1b[0m"));
});

Deno.test("listing colors use stdout independently and descriptions are italic", () => {
  const out = process.stdout.isTTY, err = process.stderr.isTTY;
  try {
    process.stdout.isTTY = true;
    process.stderr.isTTY = false;
    colorEnvironment(() => {
      Deno.env.delete("FORCE_COLOR");
      const text = formatRecipes([{
        name: "test",
        group: "test",
        args: "",
        description: "Run tests",
      }]);
      assert(text.includes("\x1b[2;3m"));
      assert(text.includes("\x1b[32m"));
      equal(color("stderr", 31), "stderr");
      Deno.env.set("NO_COLOR", "1");
      equal(color("stdout", 31, "stdout"), "stdout");
    });
  } finally {
    process.stdout.isTTY = out;
    process.stderr.isTTY = err;
  }
});

Deno.test("reporter preserves emitted color but never child screen-clearing controls", () => {
  const saved = fs.writeSync;
  let output = "";
  fs.writeSync = ((_fd: number, bytes: Uint8Array) => {
    output += new TextDecoder().decode(bytes);
    return bytes.length;
  }) as typeof fs.writeSync;
  try {
    colorEnvironment(() => {
      const report = createReporter({ report: "stream", verbose: true });
      report({
        type: "output",
        command: {
          id: "child",
          name: "child",
          root: "/",
          cwd: "/",
          command: ["tool"],
          env: {},
          parser: "raw",
        },
        stream: "stdout",
        text: "\x1b[31merror\x1b[0m\x1b[2J\n",
      });
      report({ type: "close" });
    });
    assert(output.includes("\x1b[31merror"));
    assert(!output.includes("\x1b[2J"));
  } finally {
    fs.writeSync = saved;
  }
});

Deno.test("child color environment respects explicit overrides", () => {
  colorEnvironment(() => {
    equal(childEnvironment({ NO_COLOR: "1" }), { NO_COLOR: "1" });
    equal(childEnvironment({ FORCE_COLOR: "0" }), { FORCE_COLOR: "0" });
  });
});

Deno.test("raw timeout remains a failed timeout instead of successful cancellation", async () => {
  const result = await exec(["deno", "eval", "setInterval(() => {}, 1000)"], {
    raw: true,
    timeoutMs: 50,
    throwOnError: false,
  });
  equal(result.code, 124);
  equal(result.success, false);
});
