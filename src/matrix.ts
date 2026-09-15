import { discover, globRegex } from "./discovery.ts";
import { batch, selectTargets } from "./exec.ts";
import { resolvePath } from "./paths.ts";
import type { ExecOptions, ExecSpec, RunSummary } from "./types.ts";

/** Inline package classification; argv remains an argument vector, never a shell string. */
export interface MatrixRule {
  id?: string;
  packages: string | readonly string[];
  pattern: string;
  command: readonly string[];
  cwd?: string;
  group?: string;
  engine?: string;
  label?: string;
  parser?: ExecSpec["parser"];
  env?: Readonly<Record<string, string>>;
  skip?: string;
  gate?: ExecSpec["gate"];
}
/** Rules are declared in TypeScript or passed inline to the CLI. */
export interface MatrixOptions extends ExecOptions {
  match?: "first" | "all";
  scope?: "selected" | "declared";
}

/** Classify packages by matching files/directories and produce ordinary batch specifications. */
export async function planMatrix(
  rules: readonly MatrixRule[],
  options: MatrixOptions = {},
): Promise<ExecSpec[]> {
  if (!rules.length) throw new Error("matrix requires at least one rule");
  if (options.match && !["first", "all"].includes(options.match)) {
    throw new Error("matrix match must be first or all");
  }
  const root = resolvePath(await Deno.realPath(options.root ?? Deno.cwd()));
  const candidates: {
    rule: MatrixRule;
    index: number;
    package: Awaited<ReturnType<typeof discover>>[number];
    matches: Awaited<ReturnType<typeof discover>>;
  }[] = [];
  const claimed = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    if (
      !rule || typeof rule.pattern !== "string" || !rule.pattern ||
      !Array.isArray(rule.command) || !rule.command.length ||
      rule.command.some((v) => typeof v !== "string")
    ) {
      throw new Error(
        `Invalid matrix rule ${index + 1}: pattern and command vector required`,
      );
    }
    const packages = typeof rule.packages === "string"
      ? [rule.packages]
      : rule.packages;
    if (
      !Array.isArray(packages) || !packages.length ||
      packages.some((p) => typeof p !== "string")
    ) throw new Error(`Invalid packages in matrix rule ${index + 1}`);
    const matcher = globRegex(rule.pattern);
    const matches = await discover([rule.pattern], {
      root,
      kind: "any",
      allowMissing: true,
      exclude: options.exclude,
    });
    for (
      const pkg of await discover(packages, { root, exclude: options.exclude })
    ) {
      if (options.match !== "all" && claimed.has(pkg.path)) continue;
      const found = matches.filter((m) =>
        (m.path === pkg.path || m.path.startsWith(pkg.path + "/")) &&
        matcher.test(m.relative)
      );
      if (!found.length) continue;
      claimed.add(pkg.path);
      candidates.push({ rule, index, package: pkg, matches: found });
    }
  }
  const unique = [
    ...new Map(candidates.map((c) => [c.package.path, c.package])).values(),
  ];
  const selected = new Set(
    (await selectTargets(unique, {
      ...options,
      select: options.scope === "declared"
        ? undefined
        : options.select ?? "all",
    })).map((p) => p.path),
  );
  return candidates.filter((c) => selected.has(c.package.path)).map(
    ({ rule, index, package: pkg, matches }) => {
      const expand = (value: string): string =>
        value.replace(
          /\{(root|package|file|name|relative)\}/g,
          (_, key: string) =>
            ({
              root,
              package: pkg.path,
              file: matches[0]!.path,
              name: pkg.name,
              relative: pkg.relative,
            })[key]!,
        );
      return {
        root,
        cwd: expand(rule.cwd ?? "{package}"),
        id: `${pkg.relative}${
          options.match === "all" ? `:${rule.id ?? index + 1}` : ""
        }`,
        label: rule.label ? expand(rule.label) : undefined,
        group: rule.group ?? pkg.relative.split("/")[0]!.toUpperCase(),
        engine: rule.engine,
        // name is represented by label metadata in execution via targetName.
        targetName: pkg.name,
        command: rule.command.flatMap((arg) =>
          arg === "{files}" ? matches.map((m) => m.path) : [expand(arg)]
        ),
        env: Object.fromEntries(
          Object.entries(rule.env ?? {}).map(([k, v]) => [k, expand(v)]),
        ),
        parser: rule.parser,
        skip: rule.skip,
        gate: rule.gate ?? options.gate,
      };
    },
  );
}

/** Execute a heterogeneous suite with the same scheduler and reporter as exec/batch. */
export async function matrix(
  rules: readonly MatrixRule[],
  options: MatrixOptions = {},
): Promise<RunSummary> {
  const specs = await planMatrix(rules, options);
  return await batch(specs, {
    ...options,
    select: undefined,
    target: undefined,
    all: undefined,
    filter: undefined,
    files: undefined,
    mode: "path",
  });
}
