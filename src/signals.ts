/** Install cancellation handlers for a CLI lifetime; library calls accept caller signals. */
export async function withSignals<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const listener = () => controller.abort();
  const installed: Deno.Signal[] = [];
  for (const signal of ["SIGINT", "SIGTERM"] as Deno.Signal[]) {
    try {
      Deno.addSignalListener(signal, listener);
      installed.push(signal);
    } catch { /* unsupported OS signal */ }
  }
  try {
    return await run(controller.signal);
  } finally {
    for (const signal of installed) Deno.removeSignalListener(signal, listener);
  }
}
