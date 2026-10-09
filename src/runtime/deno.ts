import type { Runtime } from "./types.ts";

/** Native Deno operations. dnt maps this module to ./node.ts for npm output. */
export const runtime: Runtime = {
  get os() {
    return Deno.build.os;
  },
  get args() {
    return Deno.args;
  },
  get noColor() {
    return Deno.noColor;
  },
  isMain: (meta) => meta.main === true,
  cwd: () => Deno.cwd(),
  env: (name) => Deno.env.get(name),
  exit: (code) => Deno.exit(code),
  executable: (command) => command === "deno" ? Deno.execPath() : command,
  hardwareConcurrency: () => navigator.hardwareConcurrency,
  realPath: (path) => Deno.realPath(path),
  lstat: (path) => Deno.lstat(path),
  readDir: (path) => Deno.readDir(path),
  remove: (path) => Deno.remove(path, { recursive: true }),
  notFound: (error) => error instanceof Deno.errors.NotFound,
  stdout: {
    isTerminal: () => Deno.stdout.isTerminal(),
    writeSync: (bytes) => Deno.stdout.writeSync(bytes),
  },
  stderr: {
    isTerminal: () => Deno.stderr.isTerminal(),
    writeSync: (bytes) => Deno.stderr.writeSync(bytes),
  },
  stdin: {
    isTerminal: () => Deno.stdin.isTerminal(),
    setRaw: (raw) => Deno.stdin.setRaw(raw),
    read: (buffer) => Deno.stdin.read(buffer),
  },
  releaseInput: () => false,
  consoleSize: () => Deno.consoleSize(),
  addSignalListener: (signal, listener) =>
    Deno.addSignalListener(signal, listener),
  removeSignalListener: (signal, listener) =>
    Deno.removeSignalListener(signal, listener),
  kill: (pid, signal) => Deno.kill(pid, signal),
  spawn: (command, options) =>
    Promise.resolve().then(() => new Deno.Command(command, options).spawn()),
  output: (command, options) => new Deno.Command(command, options).output(),
};
