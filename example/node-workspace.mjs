/** Standalone Node-only consumer of the generated package. Build npm/ first. */
import { createPipeline, filePath } from "../npm/esm/mod.js";
// After npm publication: import { createPipeline, filePath } from "@yrrrrrf/dv";

const workspace = createPipeline({
  test: {
    group: "test",
    description: "Execute a native Node check",
    run: ({ exec }) =>
      exec([
        process.execPath,
        "-e",
        'require("node:assert/strict").equal(2+2,4);console.log("Node check passed")',
      ]),
  },
  check: {
    group: "check",
    description: "Check workspace syntax",
    run: ({ exec }) =>
      exec([process.execPath, "--check", "node-workspace.mjs"]),
  },
  ci: {
    group: "ci",
    description: "Tests followed by syntax checking",
    deps: ["test", "check"],
  },
}, { root: filePath(new URL(".", import.meta.url)) });

process.exitCode = await workspace.cli();
