import type { ExecOptions, ExecSpec } from "../types.ts";

/** Parsed execution options; command is empty when parsing pipeline arguments. */
export interface ParsedArguments {
  options: ExecOptions;
  command: string[];
  json: boolean;
  help: boolean;
  rules?: import("../matrix.ts").MatrixRule[];
  specs?: ExecSpec[];
  paths?: string[];
  match?: "first" | "all";
  scope?: "selected" | "declared";
}

/** Parse dv flags before --, retaining the child argv exactly as supplied. */
export function parseArgs(input: readonly string[]): ParsedArguments {
  const separator = input.indexOf("--");
  const command = separator < 0 ? [] : input.slice(separator + 1);
  const args = [...(separator < 0 ? input : input.slice(0, separator))];
  const options: ExecOptions = {};
  let json = false, help = false;
  const extra: Pick<
    ParsedArguments,
    "rules" | "specs" | "paths" | "match" | "scope"
  > = {};
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]!;
    if (/^-[Apvbr]+$/.test(arg) && arg.length > 2) {
      args.splice(i, 1, ...arg.slice(1).split("").map((v) => "-" + v));
      arg = args[i]!;
    }
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const inline = equals > 0 ? arg.slice(equals + 1) : undefined;
    if (equals > 0) arg = arg.slice(0, equals);
    const value = (): string => {
      const v = inline ?? args[++i];
      if (v === undefined || (inline === undefined && v.startsWith("--"))) {
        throw new Error(`${arg} requires a value`);
      }
      return v;
    };
    const vector = (): string[] => {
      const values = inline === undefined ? [] : [inline];
      while (i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
        values.push(args[++i]!);
      }
      if (!values.length) throw new Error(`${arg} requires one or more values`);
      return values;
    };
    const integer = (): number => {
      const text = value();
      const n = Number(text);
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < 1) {
        throw new Error(`${arg} requires a positive integer`);
      }
      return n;
    };
    const jsonArray = (): unknown[] => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value());
      } catch {
        throw new Error(`${arg} requires a JSON array`);
      }
      if (!Array.isArray(parsed)) {
        throw new Error(`${arg} requires a JSON array`);
      }
      return parsed;
    };
    if (arg === "--rules") {
      extra.rules = jsonArray() as ParsedArguments["rules"];
    } else if (arg === "--specs") extra.specs = jsonArray() as ExecSpec[];
    else if (arg === "--paths") {
      const paths = jsonArray();
      if (paths.some((p) => typeof p !== "string")) {
        throw new Error("--paths requires strings");
      }
      extra.paths = paths as string[];
    } else if (arg === "--before") options.before = jsonArray() as ExecSpec[];
    else if (arg === "--scope") {
      const v = value();
      if (v !== "selected" && v !== "declared") {
        throw new Error("--scope must be selected or declared");
      }
      extra.scope = v;
    } else if (arg === "--match") {
      const v = value();
      if (v !== "first" && v !== "all") {
        throw new Error("--match must be first or all");
      }
      extra.match = v;
    } else if (arg === "--title") options.title = value();
    else if (arg === "--group") options.group = value();
    else if (arg === "--engine") options.engine = value();
    else if (arg === "--label") options.label = value();
    else if (arg === "--name") options.targetName = value();
    else if (arg === "--filter" || arg === "-f") options.filter = value();
    else if (arg === "--skip") options.skip = value();
    else if (arg === "--report") {
      const v = value();
      if (!["auto", "plain", "stream"].includes(v)) {
        throw new Error("--report must be auto, plain or stream");
      }
      options.report = v as ExecOptions["report"];
    } else if (arg === "--commands") {
      const v = value();
      if (!["concise", "full", "none"].includes(v)) {
        throw new Error("--commands must be concise, full or none");
      }
      options.commands = v as ExecOptions["commands"];
    } else if (arg === "--logs") {
      const v = value();
      if (v !== "group" && v !== "stream") {
        throw new Error("--logs must be group or stream");
      }
      options.logs = v;
    } else if (
      ["--max-errors", "--max-warnings", "--min-score"].includes(arg)
    ) {
      const n = Number(value());
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${arg} requires a nonnegative number`);
      }
      const key = arg === "--max-errors"
        ? "maxErrors"
        : arg === "--max-warnings"
        ? "maxWarnings"
        : "minScore";
      options.gate = { ...options.gate, [key]: n };
    } else if (arg === "--cwd") {
      options.cwd = [
        ...(typeof options.cwd === "string"
          ? [options.cwd]
          : options.cwd ?? []),
        ...vector(),
      ];
    } else if (arg === "--files") {
      options.files = [...options.files ?? [], ...vector()];
    } else if (arg === "--exclude") {
      options.exclude = [...options.exclude ?? [], ...vector()];
    } else if (arg === "--root") options.root = value();
    else if (arg === "--select") {
      const v = value();
      if (v !== "one" && v !== "all") {
        throw new Error("--select must be one or all");
      }
      options.select = v;
    } else if (arg === "--target") {
      if (options.target) throw new Error("Supply one target");
      options.target = value();
    } else if (arg === "--mode") {
      const v = value();
      if (!["path", "glob", "regex"].includes(v)) {
        throw new Error("--mode must be path, glob, or regex");
      }
      options.mode = v as ExecOptions["mode"];
    } else if (arg === "--env") {
      const v = value(), at = v.indexOf("=");
      if (at < 1) throw new Error("--env requires NAME=value");
      options.env = { ...options.env, [v.slice(0, at)]: v.slice(at + 1) };
    } else if (arg === "--parser") options.parser = value();
    else if (arg === "--jobs" || arg === "-j") {
      options.jobs = integer();
      options.parallel = true;
    } else if (arg === "--timeout") options.timeoutMs = integer();
    else if (arg === "--max-output") options.maxOutputBytes = integer();
    else if (arg === "--shell") {
      const v = value();
      if (!["sh", "nu", "powershell"].includes(v)) {
        throw new Error("--shell must be sh, nu, or powershell");
      }
      options.shell = v as ExecOptions["shell"];
    } else if (arg === "--stdin") {
      const v = value();
      if (v !== "null" && v !== "inherit") {
        throw new Error("--stdin must be null or inherit");
      }
      options.stdin = v;
    } else if (arg === "-A" || arg === "--all") options.all = true;
    else if (arg === "-p" || arg === "--parallel") options.parallel = true;
    else if (arg === "-v" || arg === "--verbose") options.verbose = true;
    else if (arg === "-b" || arg === "--benchmark") options.benchmark = true;
    else if (arg === "-r" || arg === "--raw") options.raw = true;
    else if (arg === "--no-raw") options.raw = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--fail-fast") options.failFast = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--no-interactive") options.interactive = false;
    else if (arg === "--json") {
      json = true;
      options.quiet = true;
      options.interactive = false;
    } else if (arg === "--help" || arg === "-h") help = true;
    else if (arg.startsWith("-")) {
      throw new Error(
        `Unknown dv option: ${arg}. Child arguments belong after --.`,
      );
    } else {
      if (options.target !== undefined) {
        throw new Error(`Unexpected argument: ${arg}`);
      }
      options.target = arg;
    }
    if (
      inline !== undefined &&
      [
        "--all",
        "--parallel",
        "--verbose",
        "--benchmark",
        "--dry-run",
        "--quiet",
        "--fail-fast",
        "--json",
        "--help",
        "--no-interactive",
        "--raw",
        "--no-raw",
      ].includes(arg)
    ) throw new Error(`${arg} does not take a value`);
  }
  return { options, command, json, help, ...extra };
}

/** Shell-like tokenization for manually entered menu arguments, with no evaluation. */
export function splitArguments(text: string): string[] {
  const args: string[] = [];
  let current = "", quote = "", started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\" && quote !== "'" && /[\s'"\\]/.test(text[i + 1] ?? "")) {
      current += text[++i];
      started = true;
    } else if (quote) {
      if (c === quote) quote = "";
      else current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
    } else {
      current += c;
      started = true;
    }
  }
  if (quote) throw new Error("Unclosed argument quote");
  if (started) args.push(current);
  return args;
}
