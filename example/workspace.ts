/** A standalone TypeScript entrypoint: no Just installation or justfile needed. */
import { workspace } from "./pipeline.ts";

if (import.meta.main) Deno.exit(await workspace.cli());
export { workspace };
