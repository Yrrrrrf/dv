/** Tiny application used by both workflow examples. */
export function greeting(): string {
  return "Hello from beta";
}

if (import.meta.main) {
  Deno.serve(
    { hostname: "127.0.0.1", port: 9412 },
    () => new Response(greeting()),
  );
}
