import process from "node:process";

// Input listeners exist only during an active prompt read.
let cancelRead: (() => void) | undefined;
let originalRaw: boolean | undefined;

export function readBytes(buffer: Uint8Array): Promise<number | null> {
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

export function setRaw(raw: boolean): void {
  const input = process.stdin;
  if (raw) {
    originalRaw ??= input.isRaw ?? false;
    input.setRawMode(true);
    input.ref();
  } else {
    input.setRawMode(originalRaw ?? false);
    originalRaw = undefined;
  }
}

export function releaseInput(): void {
  cancelRead?.();
  process.stdin.pause();
  if (process.stdin.isTTY) process.stdin.unref();
}
