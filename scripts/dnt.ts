/** Generate the npm mirror from maintained Deno source. This never publishes. */
import { build, emptyDir } from "@deno/dnt";
import { filePath } from "../src/fs/paths.ts";
import { metadata, root } from "./version.ts";

const pkg = await metadata();
const cwd = filePath(root);
const outDir = filePath(new URL("build/", root));
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
  // Shared built-ins run in both hosts without a Deno namespace shim.
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
    publishConfig: { access: "public" },
    engines: { node: ">=22.0.0" },
    devDependencies: { "@types/node": "22.20.5" },
    keywords: ["cli", "workflow", "tasks", "deno", "node", "just"],
  },
  postBuild: async () => {
    for (const name of ["README.md", "LICENSE", "CHANGELOG.md"]) {
      await Deno.copyFile(new URL(name, root), new URL(`build/${name}`, root));
    }
    await Deno.mkdir(new URL("build/docs/", root), { recursive: true });
    await Deno.copyFile(
      new URL("docs/NPM_BUILD.md", root),
      new URL("build/docs/NPM_BUILD.md", root),
    );
  },
});
