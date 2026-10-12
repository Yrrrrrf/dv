/** Generate the npm mirror from maintained Deno source. This never publishes. */
import { build, emptyDir } from "@deno/dnt";
import { filePath } from "../src/paths.ts";
import { metadata, root, synchronizeVersion } from "./version.ts";

await synchronizeVersion();
const pkg = await metadata();
const cwd = filePath(root);
const outDir = filePath(new URL("npm/", root));
await emptyDir(outDir);

await build({
  cwd,
  outDir,
  configFile: filePath(new URL("deno.json", root)),
  frozenLockfile: true,
  entryPoints: [
    { name: ".", path: "./src/mod.ts" },
    { name: "./cli", path: "./src/cli/mod.ts" },
    { kind: "bin", name: "dv", path: "./src/cli/bin.ts" },
  ],
  mappings: { "./src/runtime/deno.ts": "./src/runtime/node.ts" },
  // Every runtime operation is explicit. No global Deno shim is distributed.
  shims: {},
  esModule: true,
  scriptModule: false,
  // Node 22 supports the used language APIs; explicit bin startup avoids
  // import.meta ponyfills that assume process.argv[1] exists in eval/REPL.
  polyfills: false,
  declaration: "inline",
  typeCheck: "both",
  // Existing Deno tests launch Deno children. test:npm checks a clean tarball
  // with native Node fixtures instead of giving that suite misleading parity.
  test: false,
  skipSourceOutput: true,
  compilerOptions: {
    target: "ES2023",
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    useUnknownInCatchVariables: true,
    noUncheckedIndexedAccess: true,
  },
  package: {
    ...pkg,
    types: "./esm/mod.d.ts",
    engines: { node: ">=22.0.0" },
    devDependencies: { "@types/node": "22.20.5" },
    keywords: ["cli", "workflow", "tasks", "deno", "node", "just"],
  },
  postBuild: async () => {
    for (const name of ["README.md", "LICENSE"]) {
      await Deno.copyFile(new URL(name, root), new URL(`npm/${name}`, root));
    }
  },
});
