/** Tiny application used by both workflow examples. */
export function greeting(): string {
  return "Hello from alpha";
}

if (import.meta.main) {
  Deno.serve(
    { hostname: "127.0.0.1", port: 9411 },
    () => new Response(greeting()),
  );
}
