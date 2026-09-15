import { createReporter } from "../src/mod.ts";
import { assert, equal } from "./assert.ts";
import type { CommandResult, PlannedCommand, RunSummary } from "../src/mod.ts";

function result(id: string): CommandResult {
  return {
    id,
    name: id,
    group: "SDK",
    engine: "deno",
    root: "/root",
    cwd: "/root",
    command: ["deno", "check", "mod.ts"],
    env: {},
    parser: "typescript",
    code: 0,
    success: true,
    durationMs: 10,
    stdout: "",
    stderr: "",
    truncated: false,
    aborted: false,
    diagnostics: {},
  };
}
function summary(
  planned: PlannedCommand[],
  results: CommandResult[],
): RunSummary {
  return {
    planned,
    results,
    success: true,
    code: 0,
    durationMs: 20,
    skipped: [],
    dryRun: false,
  };
}

Deno.test("plain grouped output is ordered and exposes successful warnings without exact paths", () => {
  const saved = Deno.stderr.writeSync;
  let output = "";
  Deno.stderr.writeSync = (bytes) => {
    output += new TextDecoder().decode(bytes);
    return bytes.length;
  };
  try {
    const report = createReporter({ report: "plain" });
    const a = result("alpha"), b = result("beta");
    b.stderr = "Warning: dependency mismatch";
    report({ type: "plan", planned: [a, b], title: "TYPES", dryRun: false });
    report({ type: "finish", result: b });
    report({ type: "finish", result: a });
    report({ type: "summary", summary: summary([a, b], [a, b]) });
    report({ type: "close" });
    assert(output.includes("[SDK]"));
    assert(output.includes("dependency mismatch"));
    assert(output.indexOf("❯❯ deno alpha") < output.indexOf("❯❯ deno beta"));
    assert(!output.includes("exit 0"));
    assert(!output.includes("0 errors"));
    assert(!output.includes("(cd "));
  } finally {
    Deno.stderr.writeSync = saved;
  }
});

Deno.test("live reporter restores cursor and stops timers on close, dry-run uses no animation", () => {
  const saved = {
    write: Deno.stderr.writeSync,
    terminal: Deno.stderr.isTerminal,
    size: Deno.consoleSize,
  };
  let output = "";
  const oldCI = Deno.env.get("CI"), oldTerm = Deno.env.get("TERM");
  Deno.env.delete("CI");
  Deno.env.set("TERM", "xterm");
  Deno.stderr.writeSync = (b) => {
    output += new TextDecoder().decode(b);
    return b.length;
  };
  Deno.stderr.isTerminal = () => true;
  Deno.consoleSize = () => ({ columns: 100, rows: 40 });
  try {
    const report = createReporter();
    const a = result("alpha");
    report({ type: "plan", planned: [a], title: "TEST", dryRun: false });
    report({ type: "start", command: a });
    report({ type: "close" });
    assert(output.includes("\x1b[?25l"));
    assert(output.endsWith("\x1b[?25h"));
    output = "";
    report({ type: "plan", planned: [a], title: "TEST", dryRun: true });
    report({ type: "close" });
    equal(output.includes("\x1b[?25l"), false);
  } finally {
    Deno.stderr.writeSync = saved.write;
    Deno.stderr.isTerminal = saved.terminal;
    Deno.consoleSize = saved.size;
    if (oldCI === undefined) Deno.env.delete("CI");
    else Deno.env.set("CI", oldCI);
    if (oldTerm === undefined) Deno.env.delete("TERM");
    else Deno.env.set("TERM", oldTerm);
  }
});
Deno.test("per-command verbose reporting remains available inside a grouped batch", () => {
  const saved = Deno.stderr.writeSync;
  let output = "";
  Deno.stderr.writeSync = (b) => {
    output += new TextDecoder().decode(b);
    return b.length;
  };
  try {
    const report = createReporter({ report: "plain" });
    const r = result("alpha");
    r.output = { verbose: true };
    r.stdout = "command-specific detail";
    report({ type: "plan", planned: [r], title: "TEST", dryRun: false });
    report({ type: "finish", result: r });
    report({ type: "summary", summary: summary([r], [r]) });
    report({ type: "close" });
    assert(output.includes("command-specific detail"));
  } finally {
    Deno.stderr.writeSync = saved;
  }
});
