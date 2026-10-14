/** Test the actual tarball from a clean Node consumer outside the source tree. */
import { filePath, resolvePath } from "../src/fs/paths.ts";
import { metadata, root } from "./version.ts";

const node = Deno.env.get("DV_TEST_NODE") ?? "node";
const npm = Deno.env.get("DV_TEST_NPM") ?? "npm";
const pkg = await metadata();
const output = filePath(new URL("build/", root));
const dist = filePath(new URL("dist/", root));
await Deno.mkdir(dist, { recursive: true });
async function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> {
  const status = await new Deno.Command(command, {
    args,
    cwd,
    env,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) throw new Error(`${command} failed (${status.code})`);
}

const packed = await new Deno.Command(npm, {
  args: ["pack", "--json", "--ignore-scripts", "--pack-destination", dist],
  cwd: output,
  stdout: "piped",
  stderr: "inherit",
}).output();
if (!packed.success) throw new Error("npm pack failed");
const [archive] = JSON.parse(new TextDecoder().decode(packed.stdout));
if (!archive?.filename) throw new Error("npm pack returned no archive");
const consumer = await Deno.makeTempDir({ prefix: "dv-npm-consumer-" });
try {
  await Deno.writeTextFile(
    `${consumer}/package.json`,
    JSON.stringify({ private: true, type: "module" }),
  );
  await run(npm, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `${dist}/${archive.filename}`,
  ], consumer);
  const packageRoot = `${consumer}/node_modules/${pkg.name}`;
  const generated = JSON.parse(
    await Deno.readTextFile(`${packageRoot}/package.json`),
  );
  if (Object.keys(generated.dependencies ?? {}).length) {
    throw new Error("Unexpected runtime dependencies");
  }
  if (generated.version !== pkg.version) {
    throw new Error("Packed version differs from deno.json");
  }
  const bin = resolvePath(generated.bin.dv, packageRoot);
  await Deno.copyFile(
    new URL("test/node/package_test.mjs", root),
    `${consumer}/package_test.mjs`,
  );
  const env = { DV_TEST_BIN: bin, DV_TEST_VERSION: pkg.version };
  await run(node, ["--version"], consumer);
  await run(node, ["--test", "package_test.mjs"], consumer, env);

  if (Deno.build.os !== "windows") {
    const resolved = await new Deno.Command(node, {
      args: ["-p", "process.execPath"],
      stdout: "piped",
      stderr: "inherit",
    }).output();
    if (!resolved.success) {
      throw new Error("Cannot resolve the selected Node executable");
    }
    const executable = new TextDecoder().decode(resolved.stdout).trim();
    const directory = executable.slice(0, executable.lastIndexOf("/"));
    await run(`${consumer}/node_modules/.bin/dv`, ["--version"], consumer, {
      PATH: directory + ":" + (Deno.env.get("PATH") ?? ""),
    });
  }

  await run(npm, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-dev",
    "typescript@5.9.3",
    "@types/node@22.20.5",
  ], consumer);
  await Deno.writeTextFile(
    `${consumer}/consumer.mts`,
    `import {createPipeline, exec, VERSION, type ExecOptions, type RunSummary} from ${
      JSON.stringify(pkg.name)
    };\nimport {main} from ${
      JSON.stringify(pkg.name + "/cli")
    };\nconst options: ExecOptions = {quiet:true};\nconst result: RunSummary = await exec(["node","--version"],options);\nconst pipeline = createPipeline({test:{run:({exec})=>exec(["node","--version"])}},options);\nconst status: number = await main(["--version"]);\nconsole.log(VERSION,result.code,pipeline.recipes(),status);\n`,
  );
  await run(node, [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2023",
    "consumer.mts",
  ], consumer);

  if (Deno.env.get("DV_TEST_PTY") === "1") {
    await run(
      Deno.env.get("DV_TEST_PYTHON") ?? "python3",
      [filePath(new URL("test/node/pty_test.py", root))],
      consumer,
      {
        DV_TEST_NODE: node,
        DV_TEST_PACKAGE_ROOT: packageRoot,
        DV_TEST_BIN: bin,
      },
    );
  }
  console.log(`Verified ${pkg.name}@${pkg.version}: ${archive.filename}`);
} finally {
  await Deno.remove(consumer, { recursive: true });
}
