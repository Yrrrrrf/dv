import { spawn, type SpawnOptions } from "node:child_process";
import { constants } from "node:os";
import process from "node:process";
import { Readable } from "node:stream";

/** A process lifetime includes spawn errors and the eventual exit status. */
export async function spawnProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
) {
  const child = spawn(command, args, {
    ...options,
    env: { ...process.env, ...options.env },
    shell: false,
  });
  const status = new Promise<ProcessStatus>((resolve) => {
    child.once("exit", (code, signal) => {
      const result = code ??
        (signal ? 128 + (constants.signals[signal] ?? 0) : 1);
      resolve({ code: result, success: result === 0, signal });
    });
    child.once(
      "error",
      () => resolve({ code: 127, success: false, signal: null }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => {
      child.off("error", reject);
      resolve();
    });
    child.once("error", reject);
  });
  let stdout: ReadableStream<Uint8Array> | undefined;
  let stderr: ReadableStream<Uint8Array> | undefined;
  return {
    pid: child.pid!,
    status,
    get stdout() {
      if (!child.stdout) throw new Error("stdout is not piped");
      return stdout ??= Readable.toWeb(child.stdout) as ReadableStream<
        Uint8Array
      >;
    },
    get stderr() {
      if (!child.stderr) throw new Error("stderr is not piped");
      return stderr ??= Readable.toWeb(child.stderr) as ReadableStream<
        Uint8Array
      >;
    },
    kill: (signal: ProcessSignal = "SIGTERM") => {
      child.kill(signal);
    },
  };
}

/** Collect a finite metadata command, consuming both pipes concurrently. */
export async function commandOutput(command: string, args: readonly string[]) {
  const child = await spawnProcess(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [status, stdout, stderr] = await Promise.all([
    child.status,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
  ]);
  return {
    ...status,
    stdout: new Uint8Array(stdout),
    stderr: new Uint8Array(stderr),
  };
}

export type ProcessSignal = "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGWINCH";
export interface ProcessStatus {
  code: number;
  success: boolean;
  signal: string | null;
}
export type ChildProcess = Awaited<ReturnType<typeof spawnProcess>>;
