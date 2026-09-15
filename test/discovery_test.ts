import { discover, globRegex, rm } from "../src/mod.ts";
import { assert, equal, rejects, temp } from "./assert.ts";

Deno.test("glob and regex discovery deduplicate overlapping rules", async () => {
  await temp(async (root) => {
    for (const p of ["apps/a/src", "apps/b/src", "apps/c/src"]) {
      await Deno.mkdir(`${root}/${p}`, { recursive: true });
    }
    const matches = await discover(["apps/{a,b}", "apps/a"], { root });
    equal(matches.map((m) => m.relative), ["apps/a", "apps/b"]);
    equal(
      (await discover(["^apps/[ab]$"], { root, mode: "regex" })).map((m) =>
        m.relative
      ),
      ["apps/a", "apps/b"],
    );
    equal(
      (await discover(["apps/*"], { root, exclude: ["apps/b"] })).map((m) =>
        m.relative
      ),
      ["apps/a", "apps/c"],
    );
    assert(globRegex("**/*.ts").test("mod.ts"));
    assert(globRegex("**/*.ts").test("deep/mod.ts"));
    assert(!globRegex("apps/*").test("apps/a/src"));
  });
});

Deno.test("rm plans root-contained matches and removes selected parents only once", async () => {
  await temp(async (root) => {
    await Deno.mkdir(`${root}/apps/a/node_modules/pkg`, { recursive: true });
    await Deno.writeTextFile(`${root}/keep.ts`, "keep");
    const dry = await rm(["**/node_modules", "apps/a/node_modules/pkg"], {
      root,
      mode: "glob",
      dryRun: true,
      quiet: true,
    });
    equal(dry.paths.length, 1);
    equal(dry.removed.length, 0);
    await Deno.stat(`${root}/apps/a/node_modules/pkg`);
    const result = await rm(["**/node_modules", "missing"], {
      root,
      mode: "glob",
      quiet: true,
    });
    equal(result.removed.length, 1);
    equal(await Deno.readTextFile(`${root}/keep.ts`), "keep");
    await rejects(() => rm(["."], { root, quiet: true }), /project root/);
    await rejects(
      () => rm(["../outside"], { root, quiet: true }),
      /escapes root/,
    );
  });
});

Deno.test("rm cannot traverse a symlink but may unlink the link itself", async () => {
  if (Deno.build.os === "windows") return;
  await temp(async (root) => {
    await temp(async (outside) => {
      await Deno.writeTextFile(`${outside}/keep`, "keep");
      await Deno.symlink(outside, `${root}/link`);
      await rejects(() => rm(["link/keep"], { root, quiet: true }), /Symlink/);
      equal((await discover(["**/keep"], { root, kind: "file" })).length, 0);
      await rm(["link"], { root, quiet: true });
      equal(await Deno.readTextFile(`${outside}/keep`), "keep");
    });
  });
});

Deno.test("regex removal and missing literal paths are explicit and safe", async () => {
  await temp(async (root) => {
    await Deno.writeTextFile(`${root}/a.tmp`, "");
    await Deno.writeTextFile(`${root}/a.ts`, "");
    await rm(["^.*\\.tmp$"], { root, mode: "regex", quiet: true });
    await Deno.stat(`${root}/a.ts`);
    equal((await rm(["absent"], { root, quiet: true })).paths.length, 0);
  });
});
