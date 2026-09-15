import {
  exec,
  filePath,
  formatCommand,
  plan,
  recipesFromDump,
} from "../src/mod.ts";
import { assert, equal, temp } from "./assert.ts";

const nu = Deno.env.get("DV_TEST_NU");
const just = Deno.env.get("DV_TEST_JUST");

Deno.test({
  name:
    "Nu replay preserves quotes, backslashes, empty strings and env overrides",
  ignore: !nu,
  async fn() {
    await temp(async (root) => {
      const [p] = await plan([
        "deno",
        "eval",
        'console.log(JSON.stringify([Deno.env.get("DV_COPY"), ...Deno.args]))',
        "a'b",
        'a"b',
        "\\",
        "",
        "$(false)",
      ], { root, env: { DV_COPY: "x'y" } });
      const output = await new Deno.Command(nu!, {
        args: ["-c", formatCommand(p!, "nu")],
        stdout: "piped",
        stderr: "piped",
      }).output();
      equal(new TextDecoder().decode(output.stderr), "");
      equal(output.code, 0);
      equal(JSON.parse(new TextDecoder().decode(output.stdout)), [
        "x'y",
        "a'b",
        'a"b',
        "\\",
        "",
        "$(false)",
      ]);
    });
  },
});

async function copyDirectory(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    if (["build", "coverage"].includes(entry.name)) continue;
    if (entry.isDirectory) {
      await copyDirectory(`${from}/${entry.name}`, `${to}/${entry.name}`);
    } else if (entry.isFile) {
      await Deno.copyFile(`${from}/${entry.name}`, `${to}/${entry.name}`);
    }
  }
}

Deno.test({
  name:
    "Just and TypeScript complete the same cycle and produce identical artifacts",
  ignore: !just || !nu,
  async fn() {
    await temp(async (root) => {
      const packageRoot = filePath(new URL("..", import.meta.url));
      await copyDirectory(`${packageRoot}/src`, `${root}/src`);
      await copyDirectory(`${packageRoot}/example`, `${root}/example`);
      await Deno.copyFile(`${packageRoot}/deno.json`, `${root}/deno.json`);
      const ts = await exec([
        "deno",
        "run",
        "-A",
        "pipeline.ts",
        "cycle",
        "-p",
        "--json",
      ], { root, cwd: "example", quiet: true });
      equal(JSON.parse(ts.results[0]!.stdout).completed, [
        "prune",
        "prepare",
        "test",
        "fmt",
        "lint",
        "types",
        "check",
        "ci",
        "build",
        "cycle",
      ]);
      const alpha = await Deno.readTextFile(
        `${root}/example/build/alpha/mod.ts`,
      );
      const beta = await Deno.readTextFile(`${root}/example/build/beta/mod.ts`);
      const dirname = (s: string) =>
        s.replaceAll("\\", "/").replace(/\/[^/]+$/, "");
      const path = [
        dirname(just!),
        dirname(nu!),
        dirname(Deno.execPath()),
        Deno.env.get("PATH") ?? "",
      ].join(Deno.build.os === "windows" ? ";" : ":");
      await exec([just!, "--justfile", "justfile", "cycle", "-p"], {
        root,
        cwd: "example",
        env: { PATH: path },
        quiet: true,
      });
      equal(
        await Deno.readTextFile(`${root}/example/build/alpha/mod.ts`),
        alpha,
      );
      equal(await Deno.readTextFile(`${root}/example/build/beta/mod.ts`), beta);
      const listing = await exec([
        "deno",
        "run",
        "-A",
        "../src/mod.ts",
        "list",
        "--justfile",
        "justfile",
        "--json",
      ], { root, cwd: "example", env: { PATH: path }, quiet: true });
      const recipes = JSON.parse(listing.results[0]!.stdout) as {
        name: string;
        group: string;
        args: string;
      }[];
      equal(recipes.find((r) => r.name === "build")?.group, "deploy");
      equal(recipes.find((r) => r.name === "run")?.args, "*args");
    });
  },
});

Deno.test("timeouts terminate ordinary POSIX descendants and close inherited pipes", async () => {
  if (Deno.build.os === "windows") return;
  const nested =
    'new Deno.Command(Deno.execPath(), { args: ["eval", "setInterval(() => {}, 1000)"], stdin: "null", stdout: "inherit", stderr: "inherit" }).spawn(); setInterval(() => {}, 1000);';
  const started = performance.now();
  const result = await exec(["deno", "eval", nested], {
    quiet: true,
    timeoutMs: 150,
    throwOnError: false,
  });
  equal(result.code, 124);
  assert(
    performance.now() - started < 3000,
    "Descendant cleanup exceeded its grace period",
  );
});

Deno.test("Just flags remain flags in the displayed signature", () => {
  const [recipe] = recipesFromDump({
    recipes: {
      run: {
        parameters: [{
          name: "verbose",
          kind: "singular",
          long: "verbose",
          short: "v",
          flag: true,
        }],
      },
    },
  });
  equal(recipe?.args, "[--verbose]");
});

Deno.test({
  name:
    "independent Just and TypeScript wiring preserve plans, quoted flags, dry-run and failure gates",
  ignore: !just || !nu,
  async fn() {
    await temp(async (root) => {
      const packageRoot = filePath(new URL("..", import.meta.url));
      await copyDirectory(`${packageRoot}/src`, `${root}/src`);
      await copyDirectory(`${packageRoot}/example`, `${root}/example`);
      await Deno.copyFile(`${packageRoot}/deno.json`, `${root}/deno.json`);
      const dirname = (s: string) =>
        s.replaceAll("\\", "/").replace(/\/[^/]+$/, "");
      const path = [
        dirname(just!),
        dirname(nu!),
        dirname(Deno.execPath()),
        Deno.env.get("PATH") ?? "",
      ].join(Deno.build.os === "windows" ? ";" : ":");
      const invoke = (kind: "ts" | "just", recipe: string, args: string[]) =>
        exec(
          kind === "ts"
            ? ["deno", "run", "-A", "pipeline.ts", recipe, ...args]
            : [just!, "--justfile", "justfile", recipe, ...args],
          {
            root,
            cwd: "example",
            env: { PATH: path },
            quiet: true,
            throwOnError: false,
          },
        );
      const args = [
        "--dry-run",
        "-pb",
        "--env",
        "DV_PARITY=space's value",
        "--json",
      ];
      await Deno.mkdir(`${root}/example/build`, { recursive: true });
      await Deno.writeTextFile(`${root}/example/build/keep`, "keep");
      const ts = await invoke("ts", "cycle", args),
        js = await invoke("just", "cycle", args);
      equal(ts.code, 0);
      equal(js.code, 0);
      equal(ts.results[0]!.stderr, "");
      equal(js.results[0]!.stderr, "");
      equal(await Deno.readTextFile(`${root}/example/build/keep`), "keep");
      const tsResult = JSON.parse(ts.results[0]!.stdout);
      const justResults = js.results[0]!.stdout.trim().split("\n").map((line) =>
        JSON.parse(line)
      );
      const project = (p: Record<string, unknown>) => ({
        id: p.id,
        name: p.name,
        group: p.group,
        engine: p.engine,
        command: p.command,
        cwd: p.cwd,
        env: p.env,
      });
      equal(
        tsResult.tasks.flatMap((
          t: { runs: { planned: Record<string, unknown>[] }[] },
        ) => t.runs.flatMap((r) => r.planned.map(project))),
        justResults.flatMap((r) => (r.planned ?? []).map(project)),
      );
      // A selected build tests/builds one app while the declared type gate checks both.
      for (const kind of ["ts", "just"] as const) {
        const selected = await invoke(kind, "build", [
          "alpha",
          "--dry-run",
          "--json",
        ]);
        equal(selected.code, 0);
        const parsed = selected.results[0]!.stdout.trim().split("\n").map((
          line,
        ) => JSON.parse(line));
        const runs = kind === "ts"
          ? parsed[0].tasks.flatMap((t: { runs: unknown[] }) => t.runs)
          : parsed;
        equal(runs.map((r: { planned: unknown[] }) => r.planned.length), [
          1,
          1,
          1,
          2,
          1,
        ]);
        const quiet = await invoke(kind, "cycle", ["--dry-run", "--quiet"]);
        equal(quiet.code, 0);
        equal(quiet.results[0]!.stdout, "");
        equal(quiet.results[0]!.stderr, "");
      }
      // Both consumers stop before creating artifacts after a real failing test.
      await Deno.remove(`${root}/example/build`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/example/apps/beta/mod_test.ts`,
        'Deno.test("failure", () => { throw new Error("fixture failure"); });\n',
      );
      for (const kind of ["ts", "just"] as const) {
        const failed = await invoke(kind, "build", ["--json"]);
        assert(failed.code !== 0);
        let built = false;
        try {
          await Deno.stat(`${root}/example/build`);
          built = true;
        } catch { /* expected */ }
        equal(built, false);
      }
    });
  },
});
