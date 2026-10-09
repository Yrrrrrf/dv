import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { availableParallelism, constants } from "node:os";
import process from "node:process";
import { Readable } from "node:stream";
import type {
  ChildProcess,
  ProcessOptions,
  ProcessStatus,
  Runtime,
} from "./types.ts";

// Created only while a prompt is reading; importing dv never attaches stdin.
let cancelRead: (() => void) | undefined;
let originalRaw: boolean | undefined;

function readInput(buffer: Uint8Array): Promise<number | null> {
  if (cancelRead) {
    return Promise.reject(
      new Error("Concurrent stdin reads are not supported"),
    );
  }
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const cleanup = () => {
      input.off("readable", read);
      input.off("end", end);
      input.off("error", fail);
      cancelRead = undefined;
    };
    const end = () => {
      cleanup();
      resolve(null);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const read = () => {
      const chunk: Uint8Array | null = input.read();
      if (chunk === null) {
        if (input.readableEnded) end();
        return;
      }
      const count = Math.min(buffer.length, chunk.length);
      buffer.set(chunk.subarray(0, count));
      if (count < chunk.length) input.unshift(chunk.subarray(count));
      cleanup();
      resolve(count);
    };
    cancelRead = end;
    input.on("readable", read);
    input.once("end", end);
    input.once("error", fail);
    read();
  });
}

async function spawnChild(
  command: string,
  options: ProcessOptions,
): Promise<ChildProcess> {
  const stdio = (
    mode: string | undefined,
    fallback: string,
  ): "inherit" | "pipe" | "ignore" => {
    mode ??= fallback;
    return mode === "piped" ? "pipe" : mode === "null" ? "ignore" : "inherit";
  };
  // shell:false keeps the executable and every argv element literal.
  const child = spawn(command, options.args ?? [], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    detached: options.detached,
    shell: false,
    stdio: [
      stdio(options.stdin, "null"),
      stdio(options.stdout, "piped"),
      stdio(options.stderr, "piped"),
    ],
  });
  const status = new Promise<ProcessStatus>((resolve) => {
    child.once("exit", (code, signal) => {
      const result = code ??
        (signal ? 128 + (constants.signals[signal] ?? 0) : 1);
      resolve({ code: result, success: result === 0, signal });
    });
    // A spawn failure is rejected below, before the caller receives this child.
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
    kill: (signal = "SIGTERM") => {
      child.kill(signal);
    },
  };
}

/** Node built-ins only; this is the module selected by the dnt build mapping. */
export const runtime: Runtime = {
  get os() {
    return process.platform === "win32" ? "windows" : process.platform;
  },
  get args() {
    return process.argv.slice(2);
  },
  get noColor() {
    return process.env.NO_COLOR !== undefined;
  },
  // Older Node 22 releases use the explicit bin entrypoint, which needs no
  // import.meta.main polyfill. Imports and eval have no startup side effects.
  isMain: (meta) => meta.main === true,
  cwd: () => process.cwd(),
  env: (name) => process.env[name],
  // Natural exit lets Node finish pending stream writes and adapter cleanup.
  exit: (code) => {
    process.exitCode = code;
  },
  executable: (command) => command,
  hardwareConcurrency: () => availableParallelism(),
  realPath: (path) => realpath(path),
  lstat: async (path) => {
    const info = await lstat(path);
    return {
      isDirectory: info.isDirectory(),
      isFile: info.isFile(),
      isSymlink: info.isSymbolicLink(),
    };
  },
  readDir: async function* (path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      yield {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymlink: entry.isSymbolicLink(),
      };
    }
  },
  remove: (path) => rm(path, { recursive: true }),
  notFound: (error) =>
    error !== null && typeof error === "object" && "code" in error &&
    error.code === "ENOENT",
  stdout: {
    isTerminal: () => process.stdout.isTTY === true,
    writeSync: (bytes) => writeSync(1, bytes),
  },
  stderr: {
    isTerminal: () => process.stderr.isTTY === true,
    writeSync: (bytes) => writeSync(2, bytes),
  },
  stdin: {
    isTerminal: () => process.stdin.isTTY === true,
    setRaw: (raw) => {
      if (raw) {
        originalRaw ??= process.stdin.isRaw ?? false;
        process.stdin.setRawMode(true);
        process.stdin.ref();
      } else {
        process.stdin.setRawMode(originalRaw ?? false);
        originalRaw = undefined;
      }
    },
    read: readInput,
  },
  releaseInput: () => {
    cancelRead?.();
    process.stdin.pause();
    if (process.stdin.isTTY) process.stdin.unref();
    return true;
  },
  consoleSize: () => ({
    columns: process.stderr.columns || 100,
    rows: process.stderr.rows || 24,
  }),
  addSignalListener: (signal, listener) => {
    process.on(signal, listener);
  },
  removeSignalListener: (signal, listener) => {
    process.off(signal, listener);
  },
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
  spawn: spawnChild,
  output: async (command, options) => {
    const child = await spawnChild(command, {
      ...options,
      stdout: "piped",
      stderr: "piped",
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
  },
};
