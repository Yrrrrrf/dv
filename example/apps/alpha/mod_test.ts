import { greeting } from "./mod.ts";

Deno.test("alpha greets its visitor", () => {
  if (greeting() !== "Hello from alpha") throw new Error("Unexpected greeting");
});
