# npm build

The maintained TypeScript source runs under Deno and uses explicit shared
built-ins for OS operations. dnt 0.44.0 generates the ESM npm package in
`build/`. Generated output is rebuilt rather than edited.

```sh
deno task pipeline cycle
deno run -A scripts/test-npm.ts
# Optional POSIX prompt cancellation/reuse and terminal restoration:
DV_TEST_PTY=1 deno run -A scripts/test-npm.ts
```

The pipeline is unchanged. Its existing version step validates the metadata in
`deno.json`; automatic formatting and the established dependency order remain.
The independent npm verification command packs `build/`, installs the tarball
into a temporary external consumer, tests its real Node entrypoints, and checks
TypeScript resolution with NodeNext. It leaves the tarball in `dist/`.

dnt derives JavaScript and declaration paths from its transformed module graph.
The package's metadata JSON is part of that graph, so generated modules live
under `build/esm/src/` alongside `build/esm/deno.js`. The final `package.json`
owns the generated exports, declaration path, and `dv` binary mapping.

```sh
node build/esm/src/cli/bin.js --version
npm install /absolute/path/to/dist/yrrrrrf-dv-0.0.6.tgz
npx dv --help
```

The distribution advertises ESM and Node 22+. It has no runtime npm dependencies
and no Deno namespace shim. A recipe explicitly invoking an external tool still
requires that tool. Build tools and Node declaration packages are development
dependencies.

The version is derived from dv's own metadata, never the consumer's working
directory or configuration. Registry publication is a separate action.
