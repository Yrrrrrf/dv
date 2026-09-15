import { greeting } from "./mod.ts";

Deno.test("beta greets its visitor", () => {
  if (greeting() !== "Hello from beta") throw new Error("Unexpected greeting");
});
