import type { Diagnostics, OutputParser, ParserInput } from "./types.ts";

/** Remove ANSI CSI/OSC sequences before interpreting tool summaries. */
export function stripAnsi(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(
    // deno-lint-ignore no-control-regex
    /\x1b\[[0-?]*[ -/]*[@-~]/g,
    "",
  );
}
const textOf = (input: ParserInput): string =>
  stripAnsi(input.stdout + "\n" + input.stderr);
const number = (match: RegExpMatchArray | null): number | undefined =>
  match ? Number(match[1]) : undefined;
/** Identify the invoked tool, not unrelated positional arguments or embedded code. */
export function invocation(
  args: readonly string[],
): { tool: string; denoCommand?: string } {
  const executable = args[0] ?? "";
  if (!/(?:^|[/\\])deno(?:\.exe)?$/.test(executable)) {
    return { tool: executable };
  }
  const valued = new Set([
    "--config",
    "-c",
    "--import-map",
    "--lock",
    "--cert",
    "--location",
    "--v8-flags",
    "--seed",
    "--env-file",
    "--inspect",
    "--inspect-brk",
  ]);
  let i = 1;
  const skipFlags = () => {
    while (i < args.length && args[i]!.startsWith("-")) {
      const flag = args[i++]!;
      if (flag === "--") break;
      if (valued.has(flag) && i < args.length) i++;
    }
  };
  skipFlags();
  const denoCommand = args[i++];
  if (denoCommand === "run") {
    skipFlags();
    return { tool: args[i] ?? "", denoCommand };
  }
  return { tool: executable, denoCommand };
}
const tool = (args: readonly string[], pattern: RegExp): boolean =>
  pattern.test(invocation(args).tool);

function typeDiagnostics(input: ParserInput): Diagnostics {
  const text = textOf(input);
  const summary = [...text.matchAll(/(?:Found|found)\s+(\d+)\s+errors?/g)].at(
    -1,
  );
  const occurrences = text.match(/(?:error\s+TS\d+:|TS\d+\s+\[ERROR\])/g);
  return { errors: summary ? Number(summary[1]) : occurrences?.length };
}

function testDiagnostics(input: ParserInput): Diagnostics {
  const line = textOf(input).split(/\r?\n/).map((v) => v.trim())
    .filter((v) => /^(?:Tests\s|(?:ok|FAILED)\s*\|)/.test(v)).at(-1);
  if (!line) return {};
  return {
    passed: number(line.match(/(\d+)\s+passed/)) ?? 0,
    failed: number(line.match(/(\d+)\s+failed/)) ?? 0,
    skipped: number(line.match(/(\d+)\s+(?:skipped|ignored)/)) ?? 0,
  };
}

/** Built-in adapters interpret observed diagnostics, never guessed source/test counts. */
export const builtInParsers: readonly OutputParser[] = [
  {
    name: "svelte-check",
    matches: (args) =>
      tool(args, /(?:^|[/:\\])svelte-check(?:-native)?(?:@[^/]*)?$/),
    parse: (input) => {
      const text = textOf(input);
      const summary = [
        ...text.matchAll(
          /(?:found|Found)\s+(\d+)\s+errors?\s+and\s+(\d+)\s+warnings?/g,
        ),
      ].at(-1);
      return summary
        ? { errors: Number(summary[1]), warnings: Number(summary[2]) }
        : typeDiagnostics(input);
    },
  },
  {
    name: "vitest",
    matches: (args) => tool(args, /(?:^|[/:\\])vitest(?:@[^/]*)?$/),
    parse: testDiagnostics,
  },
  {
    name: "deno-test",
    matches: (args) => invocation(args).denoCommand === "test",
    parse: testDiagnostics,
  },
  {
    name: "typescript",
    matches: (args) =>
      tool(args, /(?:^|[/:\\])(?:vue-tsc|tsc|tsgo)(?:@[^/]*)?$/) ||
      invocation(args).denoCommand === "check",
    parse: typeDiagnostics,
  },
  {
    name: "deno-fmt",
    matches: (args) => invocation(args).denoCommand === "fmt",
    parse: (input) => ({
      files: number(textOf(input).match(/Checked\s+(\d+)\s+files?/)),
    }),
  },
  {
    name: "deno-lint",
    matches: (args) => invocation(args).denoCommand === "lint",
    parse: (input) => ({
      files: number(textOf(input).match(/Checked\s+(\d+)\s+files?/)),
      errors: number(textOf(input).match(/Found\s+(\d+)\s+problems?/)),
    }),
  },
  {
    name: "biome",
    matches: (args) => tool(args, /(?:^|[/:\\])biome(?:@[^/]*)?$/),
    parse: (input) => {
      const text = textOf(input);
      return {
        errors: number(text.match(/Found\s+(\d+)\s+errors?/)),
        warnings: number(text.match(/Found\s+(\d+)\s+warnings?/)),
      };
    },
  },
  {
    name: "fallow",
    matches: (args) => tool(args, /(?:^|[/:\\])fallow(?:@[^/]*)?$/),
    parse: (input) => ({
      score: number(
        textOf(input).match(/(?:health\s+)?score\s*[:=]\s*(\d+(?:\.\d+)?)/i),
      ),
    }),
  },
  {
    name: "vite",
    matches: (args) => tool(args, /(?:^|[/:\\])(?:vite|tsdown)(?:@[^/]*)?$/),
    parse: (input) => ({
      urls: [...new Set(textOf(input).match(/https?:\/\/[^\s<>]+/g) ?? [])],
    }),
  },
];

/** Resolve an explicitly chosen adapter or detect one from argv, without inspecting shell code. */
export function resolveParser(
  command: readonly string[],
  choice?: string | OutputParser,
  custom: readonly OutputParser[] = [],
): OutputParser | undefined {
  if (typeof choice === "object") return choice;
  if (choice === "raw") return undefined;
  const parsers = [...custom, ...builtInParsers];
  if (choice && choice !== "auto") {
    const parser = parsers.find((p) => p.name === choice);
    if (!parser) {
      throw new Error(
        `Unknown parser ${choice}. Available: raw, ${
          parsers.map((p) => p.name).join(", ")
        }`,
      );
    }
    return parser;
  }
  return parsers.find((p) => p.matches(command));
}
