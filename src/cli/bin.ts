/** Executable-only entrypoint; library entrypoints retain their harmless imports. */
import { main } from "./mod.ts";
import { runtime } from "../runtime/deno.ts";

runtime.exit(await main());
