/** Directory selection policy when no explicit target is supplied. */
export type Selection = "one" | "all";
/** Matching mode. Regexes operate on project-relative, slash-separated paths. */
export type MatchMode = "path" | "glob" | "regex";
/** Reproducible command, after discovery and template expansion. */
export interface PlannedCommand {
  id: string;
  name: string;
  root: string;
  cwd: string;
  command: string[];
  env: Record<string, string>;
  parser: string;
  group?: string;
  engine?: string;
  label?: string;
  skip?: string;
  output?: { verbose?: boolean; quiet?: boolean; logs?: "group" | "stream" };
}
/** Counts are absent when the output does not contain trustworthy evidence. */
export interface Diagnostics {
  files?: number;
  errors?: number;
  warnings?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  score?: number;
  urls?: string[];
}
/** Parser input; process status remains authoritative. */
export interface ParserInput {
  stdout: string;
  stderr: string;
  code: number;
}
/** Optional user-supplied parser. Custom matches take precedence over built-ins. */
export interface OutputParser {
  name: string;
  matches(command: readonly string[]): boolean;
  parse(input: ParserInput): Diagnostics;
}
/** Completed child, including bounded original output and exact invocation. */
export interface CommandResult extends PlannedCommand {
  code: number;
  success: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  aborted: boolean;
  diagnostics: Diagnostics;
  parserError?: string;
  gate?: GateResult;
}
/** All selected children, in declaration order, including unscheduled work. */
export interface RunSummary {
  success: boolean;
  code: number;
  durationMs: number;
  results: CommandResult[];
  skipped: PlannedCommand[];
  planned: PlannedCommand[];
  dryRun: boolean;
  preparation?: RunSummary;
}
/** Structured reporting shared by CLI and TypeScript consumers. */
export type RunEvent =
  | { type: "plan"; planned: PlannedCommand[]; title: string; dryRun: boolean }
  | { type: "close" }
  | { type: "start"; command: PlannedCommand }
  | {
    type: "output";
    command: PlannedCommand;
    stream: "stdout" | "stderr";
    text: string;
  }
  | { type: "finish"; result: CommandResult }
  | { type: "summary"; summary: RunSummary };
/** Synchronous observer; never called before execution planning has completed. */
export type Reporter = (event: RunEvent) => void;
/** Execution and reporting controls; no project configuration file is read. */
export interface GatePolicy {
  maxErrors?: number;
  maxWarnings?: number;
  minScore?: number;
}
/** A quality gate never overwrites the original process exit code. */
export interface GateResult {
  success: boolean;
  reasons: string[];
}
/** Shared execution and presentation options for the API and CLI. */
export interface ExecOptions {
  targetName?: string;
  title?: string;
  group?: string;
  engine?: string;
  label?: string;
  id?: string;
  skip?: string;
  filter?: string;
  report?: "auto" | "plain" | "stream";
  commands?: "concise" | "full" | "none";
  logs?: "group" | "stream";
  gate?: GatePolicy;
  before?: readonly ExecSpec[];

  root?: string;
  cwd?: string | readonly string[];
  mode?: MatchMode;
  exclude?: readonly string[];
  select?: Selection;
  target?: string;
  all?: boolean;
  parallel?: boolean;
  jobs?: number;
  verbose?: boolean;
  benchmark?: boolean;
  quiet?: boolean;
  dryRun?: boolean;
  failFast?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Readonly<Record<string, string>>;
  files?: readonly string[];
  parser?: string | OutputParser;
  parsers?: readonly OutputParser[];
  reporter?: Reporter;
  throwOnError?: boolean;
  maxOutputBytes?: number;
  stdin?: "null" | "inherit";
  interactive?: boolean;
  shell?: "sh" | "nu" | "powershell";
}
/** A command vector plus its own discovery and execution options. */
export interface ExecSpec extends
  Omit<
    ExecOptions,
    "parallel" | "jobs" | "dryRun" | "failFast" | "throwOnError" | "before"
  > {
  command: readonly string[];
}
/** A discovered path. Names are conveniences; relative paths are stable IDs. */
export interface Target {
  path: string;
  relative: string;
  name: string;
}
/** Explicit filesystem discovery parameters. */
export interface DiscoverOptions {
  root?: string;
  mode?: MatchMode;
  kind?: "directory" | "file" | "any";
  exclude?: readonly string[];
  includeIgnored?: boolean;
  pruneMatches?: boolean;
  allowMissing?: boolean;
}
