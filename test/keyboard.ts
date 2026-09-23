import { assert, equal } from "./assert.ts";

/** Deterministic keyboard and viewport; native PTY coverage lives beside this. */
export async function keyboard(
  chunks: string[],
  run: () => Promise<void>,
  size = { columns: 100, rows: 30 },
): Promise<string> {
  const saved = {
    read: Deno.stdin.read,
    terminal: Deno.stdin.isTerminal,
    raw: Deno.stdin.setRaw,
    write: Deno.stderr.writeSync,
    outputTerminal: Deno.stderr.isTerminal,
    size: Deno.consoleSize,
  };
  const term = Deno.env.get("TERM");
  const modes: boolean[] = [];
  let output = "";
  Deno.env.set("TERM", "xterm-256color");
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
  Deno.consoleSize = () => size;
  Deno.stderr.writeSync = (bytes) => {
    output += new TextDecoder().decode(bytes);
    return bytes.length;
  };
  try {
    await run();
    assert(modes.length % 2 === 0, "Terminal mode was not restored");
    equal(modes, modes.map((_, i) => i % 2 === 0));
    return output;
  } finally {
    Deno.stdin.read = saved.read;
    Deno.stdin.isTerminal = saved.terminal;
    Deno.stdin.setRaw = saved.raw;
    Deno.stderr.writeSync = saved.write;
    Deno.stderr.isTerminal = saved.outputTerminal;
    Deno.consoleSize = saved.size;
    if (term === undefined) Deno.env.delete("TERM");
    else Deno.env.set("TERM", term);
  }
}
