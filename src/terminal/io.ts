import fs from "node:fs";
import process from "node:process";

const encoder = new TextEncoder();

/** Write the complete string, including partial native writes. */
export function write(
  text: string,
  stream: "stdout" | "stderr" = "stderr",
): void {
  const bytes = encoder.encode(text);
  const fd = stream === "stdout" ? 1 : 2;
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes.subarray(offset));
    if (count === 0) throw new Error("Terminal write made no progress");
    offset += count;
  }
}

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

/** Reporting and prompts use the same viewport and redirected-stream fallback. */
export function terminalSize(): { columns: number; rows: number } {
  return {
    columns: process.stderr.columns || 100,
    rows: process.stderr.rows || 24,
  };
}
