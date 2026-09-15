export function assert(
  value: unknown,
  message = "Assertion failed",
): asserts value {
  if (!value) throw new Error(message);
}
export function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
export async function rejects(
  action: () => unknown | Promise<unknown>,
  pattern?: RegExp,
): Promise<Error> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error);
    if (pattern) {
      assert(pattern.test(error.message), `Unexpected error: ${error.message}`);
    }
    return error;
  }
  throw new Error("Expected rejection");
}
export async function temp(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dv-test-" });
  try {
    await run(root.replaceAll("\\", "/"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
