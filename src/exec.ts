import { discover } from "./discovery.ts";
import { resolvePath } from "./paths.ts";
import { resolveParser } from "./parsers.ts";
import {
  choose,
  createReporter,
  isInteractive,
  isRawExecution,
} from "./terminal.ts";
import type {
  CommandResult,
  ExecOptions,
  ExecSpec,
  OutputParser,
  PlannedCommand,
  Reporter,
  RunSummary,
  Target,
} from "./types.ts";

/** A failed execution; inspect summary for every child and its original status. */
export class ExecutionError extends Error {
  readonly summary: RunSummary;
  constructor(summary: RunSummary) {
    super(`Execution failed with exit code ${summary.code}`);
    this.name = "ExecutionError";
    this.summary = summary;
  }
}

interface Job {
  plan: PlannedCommand;
  options: ExecOptions;
  parser?: OutputParser;
}
const positive = (value: number | undefined, label: string): void => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new Error(`${label} must be a positive integer`);
  }
};

export async function selectTargets(
  targets: Target[],
  options: ExecOptions,
): Promise<Target[]> {
  if (!targets.length) {
    throw new Error(
      `No target directories matched ${JSON.stringify(options.cwd ?? ["."])}`,
    );
  }
  if (options.filter) {
    targets = targets.filter((t) =>
      t.relative.includes(options.filter!) || t.name.includes(options.filter!)
    );
  }
  if (!targets.length) throw new Error("No targets matched the filter");
  if (!options.select) return targets;
  if (options.target && options.all) {
    throw new Error("An explicit target cannot be combined with --all");
  }
  if (options.target) {
    const exact = targets.find((t) =>
      t.relative === options.target || t.path === options.target
    );
    const matches = exact
      ? [exact]
      : targets.filter((t) => t.name === options.target);
    if (matches.length !== 1) {
      throw new Error(
        `Target ${options.target} is ${
          matches.length ? "ambiguous" : "unknown"
        }. Choices: ${targets.map((t) => t.relative).join(", ")}`,
      );
    }
    return matches;
  }
  if (options.all || options.select === "all" || targets.length === 1) {
    return targets;
  }
  if (options.interactive === false || !isInteractive()) {
    throw new Error(
      `Choose a target explicitly. Choices: ${
        targets.map((t) => t.relative).join(", ")
      }`,
    );
  }
  const selected = await choose(
    "Target",
    targets.map((t) => ({ value: t.relative, label: t.relative })),
  );
  return targets.filter((t) => t.relative === selected);
}

async function jobsFor(spec: ExecSpec, defaults: ExecOptions): Promise<Job[]> {
  for (
    const key of [
      "parallel",
      "jobs",
      "dryRun",
      "failFast",
      "throwOnError",
      "before",
    ]
  ) {
    if (key in spec) {
      throw new Error(
        `${key} belongs in batch options, not a command specification`,
      );
    }
  }
  const options = {
    ...defaults,
    ...spec,
    env: { ...defaults.env, ...spec.env },
  };
  positive(options.jobs, "jobs");
  for (const [key, value] of Object.entries(options.gate ?? {})) {
    if (
      !["maxErrors", "maxWarnings", "minScore"].includes(key) ||
      !Number.isFinite(value) || value < 0
    ) throw new Error(`Invalid gate threshold: ${key}`);
  }
  positive(options.timeoutMs, "timeoutMs");
  positive(options.maxOutputBytes, "maxOutputBytes");
  if (
    !spec.command.length ||
    spec.command.some((v) => typeof v !== "string" || v.includes("\0"))
  ) throw new Error("command must be a nonempty vector of NUL-free strings");
  if (!spec.command[0]) throw new Error("Executable cannot be empty");
  for (const [key, value] of Object.entries(options.env)) {
    if (
      !key || /[=\0]/.test(key) || typeof value !== "string" ||
      value.includes("\0")
    ) throw new Error(`Invalid environment override: ${key}`);
  }
  const root = resolvePath(await Deno.realPath(options.root ?? Deno.cwd()));
  const patterns = typeof options.cwd === "string"
    ? [options.cwd]
    : options.cwd ?? ["."];
  const targets = await selectTargets(
    await discover(patterns, {
      root,
      mode: options.mode,
      exclude: options.exclude,
    }),
    options,
  );
  const files = options.files
    ? await discover(options.files, {
      root,
      mode: options.mode,
      kind: "file",
      exclude: options.exclude,
    })
    : [];
  if (options.files && !files.length) {
    throw new Error("No files matched the declared file patterns");
  }
  if (options.files && !spec.command.includes("{files}")) {
    throw new Error(
      "--files requires a standalone {files} argument in the command",
    );
  }
  if (!options.files && spec.command.includes("{files}")) {
    throw new Error("{files} requires file patterns");
  }
  return targets.map((target) => {
    const expand = (value: string): string =>
      value.replace(
        /\{(root|cwd|name)\}/g,
        (_, key: string) =>
          ({ root, cwd: target.path, name: target.name })[key]!,
      );
    const command = spec.command.flatMap((arg) =>
      arg === "{files}" ? files.map((f) => f.path) : [expand(arg)]
    );
    // Use this Deno installation even when the parent was launched by absolute path.
    if (command[0] === "deno") command[0] = Deno.execPath();
    const parser = resolveParser(command, options.parser, options.parsers);
    return {
      options,
      parser,
      plan: {
        id: options.id ? expand(options.id) : target.relative,
        group: options.group
          ? expand(options.group)
          : (target.relative.includes("/")
            ? target.relative.split("/")[0]!.toUpperCase()
            : "WORKSPACE"),
        engine: options.engine ??
          (parser?.name === "typescript"
            ? (spec.command.find((arg) =>
              /(?:^|[/:])(?:tsc|vue-tsc|tsgo)(?:@[^/]*)?$/.test(arg)
            )?.split(/[/:]/).at(-1) ?? "deno")
            : parser?.name ?? spec.command[0]),
        label: options.label ? expand(options.label) : undefined,
        skip: options.skip,
        output: {
          verbose: options.verbose,
          quiet: options.quiet,
          logs: options.logs,
        },
        name: options.targetName ? expand(options.targetName) : target.name,
        root,
        cwd: target.path,
        command,
        env: Object.fromEntries(
          Object.entries(options.env).map(([k, v]) => [k, expand(v)]),
        ),
        parser: parser?.name ?? "raw",
      },
    };
  });
}

/** Resolve commands without spawning anything; selection may require a terminal. */
export async function plan(
  command: readonly string[],
  options: ExecOptions = {},
): Promise<PlannedCommand[]> {
  return (await jobsFor({ command }, options)).map((job) => job.plan);
}

async function execute(job: Job, report: Reporter): Promise<CommandResult> {
  const start = performance.now();
  const { plan, options, parser } = job;
  const isRaw = isRawExecution(options);
  const base: CommandResult = {
    ...plan,
    code: 0,
    success: false,
    durationMs: 0,
    stdout: "",
    stderr: "",
    truncated: false,
    aborted: false,
    diagnostics: {},
  };
  if (options.signal?.aborted) {
    const code = isRaw ? 0 : 130;
    const result = { ...base, code, aborted: true, success: isRaw };
    report({ type: "finish", result });
    return result;
  }
  report({ type: "start", command: plan });
  let child: Deno.ChildProcess;
  const stdinMode = isRaw ? "inherit" : (options.stdin ?? "null");
  const stdoutMode = isRaw ? "inherit" : "piped";
  const stderrMode = isRaw ? "inherit" : "piped";
  const grouped = Deno.build.os !== "windows" && stdinMode !== "inherit";
  try {
    child = new Deno.Command(plan.command[0]!, {
      args: plan.command.slice(1),
      cwd: plan.cwd,
      env: plan.env,
      stdin: stdinMode,
      stdout: stdoutMode,
      stderr: stderrMode,
      detached: grouped,
    }).spawn();
  } catch (error) {
    const result = {
      ...base,
      code: 127,
      stderr: String(error),
      durationMs: performance.now() - start,
    };
    report({ type: "finish", result });
    return result;
  }
  let aborted = false, timedOut = false;
  let hardKill: ReturnType<typeof setTimeout> | undefined;
  const treeKills: Promise<unknown>[] = [];
  const kill = (signal: Deno.Signal) => {
    if (Deno.build.os === "windows") {
      try {
        const killer = new Deno.Command("taskkill", {
          args: ["/PID", String(child.pid), "/T", "/F"],
          stdin: "null",
          stdout: "null",
          stderr: "null",
        }).spawn();
        treeKills.push(killer.status.then((status) => {
          if (!status.success) {
            try {
              child.kill();
            } catch { /* already exited */ }
          }
        }));
      } catch {
        try {
          child.kill();
        } catch { /* already exited */ }
      }
    } else {
      try {
        if (grouped) Deno.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* already exited */ }
    }
  };
  const stop = () => {
    if (aborted) return;
    aborted = true;
    kill("SIGTERM");
    hardKill = setTimeout(() => kill("SIGKILL"), 1000);
  };
  const timeout = options.timeoutMs
    ? setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs)
    : undefined;
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  const limit = options.maxOutputBytes ?? 2 * 1024 * 1024;
  let truncated = false;
  const read = async (
    stream: ReadableStream<Uint8Array>,
    name: "stdout" | "stderr",
  ): Promise<string> => {
    const decoder = new TextDecoder();
    let captured = new Uint8Array(0);
    let pending = "";
    for await (const chunk of stream) {
      const joined = new Uint8Array(captured.length + chunk.length);
      joined.set(captured);
      joined.set(chunk, captured.length);
      if (joined.length <= limit) captured = joined;
      else {
        truncated = true;
        const head = Math.ceil(limit / 2), tail = limit - head;
        captured = new Uint8Array(limit);
        captured.set(joined.subarray(0, head));
        captured.set(joined.subarray(joined.length - tail), head);
      }
      pending += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        report({
          type: "output",
          command: plan,
          stream: name,
          text: pending.slice(0, end + 1),
        });
        pending = pending.slice(end + 1);
      }
      // A child may emit a huge line or progress without newlines: stream it boundedly.
      if (pending.length > 8192 || pending.includes("\r")) {
        report({ type: "output", command: plan, stream: name, text: pending });
        pending = "";
      }
    }
    pending += decoder.decode();
    if (pending) {
      report({ type: "output", command: plan, stream: name, text: pending });
    }
    return new TextDecoder().decode(captured);
  };
  let stdout = "", stderr = "";
  let status: Deno.CommandStatus;
  let stdoutRead: Promise<string> | undefined;
  let stderrRead: Promise<string> | undefined;
  try {
    if (isRaw) {
      status = await child.status;
    } else {
      stdoutRead = read(child.stdout, "stdout");
      stderrRead = read(child.stderr, "stderr");
      const [s, out, err] = await Promise.all([
        child.status,
        stdoutRead,
        stderrRead,
      ]);
      status = s;
      stdout = out;
      stderr = err;
    }
    let code = timedOut ? 124 : aborted ? 130 : status.code;
    let success = code === 0;
    if (
      isRaw &&
      (aborted || status.code === 130 || status.signal === "SIGINT")
    ) {
      code = 0;
      success = true;
    }
    const result: CommandResult = {
      ...base,
      code,
      success,
      durationMs: performance.now() - start,
      stdout,
      stderr,
      truncated,
      aborted,
      diagnostics: {},
    };
    if (parser && !truncated && !isRaw) {
      try {
        result.diagnostics = parser.parse({ stdout, stderr, code });
      } catch (error) {
        result.parserError = String(error);
      }
    }
    if (options.gate && !isRaw) {
      const reasons: string[] = [];
      for (const [key, value] of Object.entries(options.gate)) {
        const metric = key === "maxErrors"
          ? "errors"
          : key === "maxWarnings"
          ? "warnings"
          : "score";
        const observed = result.diagnostics[metric];
        if (observed === undefined) {
          reasons.push(
            `${metric}: unavailable; cannot evaluate ${key}=${value}`,
          );
        } else if (key === "minScore" ? observed < value : observed > value) {
          reasons.push(`${metric}: ${observed}; required ${key}=${value}`);
        }
      }
      result.gate = { success: reasons.length === 0, reasons };
    }
    report({ type: "finish", result });
    return result;
  } catch (error) {
    stop();
    if (isRaw) {
      await child.status.catch(() => {});
    } else {
      await Promise.allSettled([
        child.status,
        ...(stdoutRead ? [stdoutRead] : []),
        ...(stderrRead ? [stderrRead] : []),
      ]);
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (hardKill !== undefined) clearTimeout(hardKill);
    options.signal?.removeEventListener("abort", stop);
    await Promise.all(treeKills);
  }
}

/** Execute multiple command specifications, optionally with bounded process concurrency. */
export async function batch(
  specs: readonly ExecSpec[],
  options: ExecOptions = {},
): Promise<RunSummary> {
  const start = performance.now();
  const jobs: Job[] = [];
  if (!Array.isArray(specs)) {
    throw new Error("batch requires command specifications");
  }
  for (const spec of specs) {
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.command)) {
      throw new Error("Each command specification requires a command vector");
    }
    jobs.push(...await jobsFor(spec, options));
  }
  const labels = new Map<string, number>();
  for (const job of jobs) {
    labels.set(job.plan.id, (labels.get(job.plan.id) ?? 0) + 1);
  }
  for (let i = 0; i < jobs.length; i++) {
    if (labels.get(jobs[i]!.plan.id)! > 1) jobs[i]!.plan.id += `#${i + 1}`;
  }
  positive(options.jobs, "jobs");
  const isRaw = isRawExecution(options);
  const report = options.reporter ?? createReporter(options);
  const slots = options.parallel
    ? options.jobs ?? Math.max(1, Math.min(8, navigator.hardwareConcurrency))
    : 1;
  if (
    (options.stdin === "inherit" || isRaw ||
      jobs.some((job) =>
        job.options.stdin === "inherit" || isRawExecution(job.options)
      )) &&
    slots > 1 && jobs.length > 1
  ) throw new Error("Inherited stdin requires sequential execution");
  let preparation: RunSummary | undefined;
  if (options.before?.length) {
    preparation = await batch(options.before, {
      ...options,
      before: undefined,
      cwd: ".",
      files: undefined,
      mode: "glob",
      all: undefined,
      id: undefined,
      targetName: undefined,
      group: "PREPARE",
      engine: undefined,
      label: undefined,
      title: `${options.title ?? "RUN"} · prepare`,
      reporter: options.reporter,
      parallel: false,
      jobs: undefined,
      failFast: true,
      throwOnError: false,
      target: undefined,
      select: undefined,
      filter: undefined,
      skip: undefined,
      gate: undefined,
    });
  }
  const results: (CommandResult | undefined)[] = new Array(jobs.length);
  const internalAbort = new AbortController();
  for (const job of jobs) {
    const signals = [internalAbort.signal, options.signal, job.options.signal]
      .filter((signal): signal is AbortSignal => signal !== undefined);
    job.options.signal = AbortSignal.any(signals);
  }
  let fatal: unknown;
  let next = 0, failed = false;
  try {
    report({
      type: "plan",
      planned: jobs.map((j) => j.plan),
      title: options.title ?? "RUN",
      dryRun: options.dryRun ?? false,
    });
    if (!options.dryRun && preparation?.success !== false) {
      const worker = async () => {
        while (
          next < jobs.length && !(failed && options.failFast) &&
          !options.signal?.aborted && !internalAbort.signal.aborted
        ) {
          const index = next++;
          const job = jobs[index]!;
          if (job.plan.skip) continue;
          try {
            const result = await execute(
              job,
              job.options.reporter ?? report,
            );
            results[index] = result;
            if (!result.success || result.gate?.success === false) {
              failed = true;
            }
          } catch (error) {
            fatal ??= error;
            internalAbort.abort();
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(slots, jobs.length) }, worker),
      );
      if (fatal !== undefined) throw fatal;
    }
    const completed = results.filter((r): r is CommandResult =>
      r !== undefined
    );
    const code =
      (preparation?.success === false ? preparation.code : undefined) ??
        completed.find((r) => !r.success && !r.aborted)?.code ??
        completed.find((r) => !r.success)?.code ??
        (options.signal?.aborted
          ? (isRaw ? 0 : 130)
          : completed.some((r) => r.gate?.success === false)
          ? 1
          : 0);
    const summary: RunSummary = {
      success: code === 0,
      code,
      durationMs: performance.now() - start,
      results: completed,
      skipped: options.dryRun
        ? []
        : jobs.filter((_, i) => !results[i]).map((j) => j.plan),
      planned: jobs.map((j) => j.plan),
      dryRun: options.dryRun ?? false,
      preparation,
    };
    report({ type: "summary", summary });
    if (!summary.success && options.throwOnError !== false) {
      throw new ExecutionError(summary);
    }
    return summary;
  } finally {
    report({ type: "close" });
  }
}

/** Execute an argv vector over its declared directories using the shared engine. */
export function exec(
  command: readonly string[],
  options: ExecOptions = {},
): Promise<RunSummary> {
  return batch([{ command }], options);
}
