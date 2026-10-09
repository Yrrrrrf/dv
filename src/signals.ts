import type { ProcessSignal } from "./runtime/types.ts";
import { runtime } from "./runtime/deno.ts";
/** Install cancellation handlers for a CLI lifetime; library calls accept caller signals. */
export async function withSignals<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const listener = () => controller.abort();
  const installed: ProcessSignal[] = [];
  for (const signal of ["SIGINT", "SIGTERM"] as ProcessSignal[]) {
    try {
      runtime.addSignalListener(signal, listener);
      installed.push(signal);
    } catch { /* unsupported OS signal */ }
  }
  try {
    return await run(controller.signal);
  } finally {
    for (const signal of installed) {
      runtime.removeSignalListener(signal, listener);
    }
  }
}
