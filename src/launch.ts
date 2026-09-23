/** Transparent recipe dispatch: no interpolation, capture, or status normalization. */
export async function launchRecipe(
  argv: readonly string[],
  options: { cwd: string; signal?: AbortSignal },
): Promise<number> {
  if (options.signal?.aborted) return 130;
  const child = new Deno.Command(argv[0]!, {
    args: argv.slice(1),
    cwd: options.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch { /* already exited */ }
    timer ??= setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
    }, 1000);
  };
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  try {
    const status = await child.status;
    return options.signal?.aborted ? 130 : status.code;
  } finally {
    options.signal?.removeEventListener("abort", stop);
    if (timer !== undefined) clearTimeout(timer);
  }
}
