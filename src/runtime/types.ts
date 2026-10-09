/** Internal OS operations used by dv; orchestration stays in the shared source. */
export type ProcessSignal = "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGWINCH";
export type Stdio = "inherit" | "piped" | "null";

export interface ProcessOptions {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "inherit" | "null";
  stdout?: Stdio;
  stderr?: Stdio;
  detached?: boolean;
}
export interface ProcessStatus {
  code: number;
  success: boolean;
  signal: string | null;
}
export interface ChildProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  status: Promise<ProcessStatus>;
  kill(signal?: ProcessSignal): void;
}
export interface CommandOutput extends ProcessStatus {
  stdout: Uint8Array;
  stderr: Uint8Array;
}
export interface FileInfo {
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}
export interface TerminalWriter {
  isTerminal(): boolean;
  writeSync(bytes: Uint8Array): number;
}
export interface Runtime {
  readonly os: string;
  readonly args: readonly string[];
  readonly noColor: boolean;
  isMain(meta: { url: string; main?: boolean }): boolean;
  cwd(): string;
  env(name: string): string | undefined;
  exit(code: number): void;
  executable(command: string): string;
  hardwareConcurrency(): number;
  realPath(path: string): Promise<string>;
  lstat(path: string): Promise<FileInfo>;
  readDir(path: string): AsyncIterable<FileInfo & { name: string }>;
  remove(path: string): Promise<void>;
  notFound(error: unknown): boolean;
  stdout: TerminalWriter;
  stderr: TerminalWriter;
  stdin: {
    isTerminal(): boolean;
    setRaw(raw: boolean): void;
    read(buffer: Uint8Array): Promise<number | null>;
  };
  /** Release an adapter-owned pending reader; Deno retains its native read. */
  releaseInput(): boolean;
  consoleSize(): { columns: number; rows: number };
  addSignalListener(signal: ProcessSignal, listener: () => void): void;
  removeSignalListener(signal: ProcessSignal, listener: () => void): void;
  kill(pid: number, signal: ProcessSignal): void;
  spawn(command: string, options: ProcessOptions): Promise<ChildProcess>;
  output(command: string, options: ProcessOptions): Promise<CommandOutput>;
}
