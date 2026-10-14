# Changelog

## 0.0.6

- Replace the separate Deno and Node runtime backends and their broad `Runtime`
  interface with one implementation using explicit built-ins and standard Web
  APIs. npm generation no longer maps an alternative runtime module.
- Group execution, filesystem, terminal, CLI, and Just implementation files by
  responsibility. Separate terminal I/O from formatting, prompts, and reporting
  to remove their circular imports. Keep the root library API exports available.
- Resolve the exported version from this package's `deno.json`. Remove the
  generated `src/version.ts` and its synchronization code. The existing
  `scripts/version.ts` pipeline command validates metadata without writing
  source.
- Let dnt generate declaration entrypoint metadata instead of hardcoding its
  emitted path. Keep ESM-only output, inline declarations, and zero runtime
  package dependencies.
- Preserve the existing pipeline file, commands, automatic formatting, and task
  dependency order.

### Migration

- Execute `deno run -A src/cli/bin.ts ...` locally, or
  `deno run -A jsr:@yrrrrrf/dv/bin ...` after publication. The root module and
  `./cli` module now only export APIs. The installed npm command remains `dv`.
- Use `dv rm --paths '["build","coverage"]'`. For patterns, add `--mode glob` or
  `--mode regex`. Positional removal operands and the separate `--glob` /
  `--regex` parser have been removed. Forwarded workflow targets remain separate
  from the JSON removal operands.
- Executables remain as declared in command vectors. dv no longer rewrites
  `deno` into the current Deno installation's executable. Supply its full path
  when a workflow requires that installation specifically.
- Import published APIs through the package's public exports. Internal source
  files have moved into `execution/`, `fs/`, `terminal/`, `cli/`, and `just/`.

### Validation

Run `deno task pipeline cycle` with the existing pipeline. Independently run
`deno run -A scripts/test-npm.ts` for the packed npm consumer and NodeNext
declarations. Set `DV_TEST_PTY=1` to include POSIX prompt lifecycle
verification. These commands build or verify the package; they do not publish
it.
