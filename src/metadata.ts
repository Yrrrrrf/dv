/** Package metadata is resolved with the module, never from the consumer cwd. */
import metadata from "../deno.json" with { type: "json" };

export const VERSION: string = metadata.version;
