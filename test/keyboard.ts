import { Readable } from "node:stream";
import fs from "node:fs";
import process from "node:process";
import { assert, equal } from "./assert.ts";

/** Deterministic native streams and viewport for the shared prompt implementation. */
export async function keyboard(
  chunks: string[],
  run: () => Promise<void>,
  size = { columns: 100, rows: 30 },
): Promise<string> {
  const savedInput = Object.getOwnPropertyDescriptor(process, "stdin")!;
  const input = Readable.from(
    chunks.map((chunk) => new TextEncoder().encode(chunk)),
  );
  const output = process.stderr;
  const outputKeys = ["isTTY", "columns", "rows"] as const;
  const outputs = outputKeys.map((key) =>
    [key, Object.getOwnPropertyDescriptor(output, key)] as const
  );
  const write = fs.writeSync;
  const term = Deno.env.get("TERM");
  const modes: boolean[] = [];
  let text = "";
  const define = (target: object, key: string, value: unknown) =>
    Object.defineProperty(target, key, {
      value,
      writable: true,
      configurable: true,
    });
  Deno.env.set("TERM", "xterm-256color");
  define(process, "stdin", input);
  define(input, "isTTY", true);
  define(input, "setRawMode", (raw: boolean) => {
    modes.push(raw);
    return input;
  });
  for (const key of ["ref", "unref"]) define(input, key, () => input);
  define(output, "isTTY", true);
  define(output, "columns", size.columns);
  define(output, "rows", size.rows);
  fs.writeSync = ((_fd: number, bytes: Uint8Array) => {
    text += new TextDecoder().decode(bytes);
    return bytes.length;
  }) as typeof fs.writeSync;
  try {
    await run();
    assert(modes.length % 2 === 0, "Terminal mode was not restored");
    equal(modes, modes.map((_, i) => i % 2 === 0));
    return text;
  } finally {
    input.destroy();
    Object.defineProperty(process, "stdin", savedInput);
    for (const [key, descriptor] of outputs) {
      if (descriptor) Object.defineProperty(output, key, descriptor);
      else Reflect.deleteProperty(output, key);
    }
    fs.writeSync = write;
    if (term === undefined) Deno.env.delete("TERM");
    else Deno.env.set("TERM", term);
  }
}
