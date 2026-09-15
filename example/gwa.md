# Applying dv to the GWA client

The runnable demo intentionally uses only Deno. This guide maps the supplied GWA
compatibility blueprint onto the same primitives; it is not a copy of the GWA
workspace or a verified implementation of its package patches.

## Keep the boundary explicit

| dv                                                       | GWA consumer                                              |
| -------------------------------------------------------- | --------------------------------------------------------- |
| Discovery, argv planning, bounded scheduling             | Actual SDK/app roots and tool invocations                 |
| Grouped suite reporting and parsed observations          | Tool versions and framework configurations                |
| Sequential `before` specifications and task dependencies | Vite/SvelteKit link repair and Volar patch implementation |
| Explicit child `env`                                     | Discovery and selection of `TSGO_BIN`                     |
| Child and quality-policy outcomes                        | Decisions about acceptable warnings/health scores         |

Do not move `ensureNodeCompat()` into dv. Invoke the workspace's own preparation
before each relevant independent gate, not exclusively from `cycle`. In a Just
consumer, Nushell may implement preparation inline and then call dv, or invoke
an existing workspace helper. No `pipeline.ts` is required. A TypeScript
consumer can call the same existing workspace function from its task callback.

For preparation expressed as commands, both have `before` / `--before`. It runs
sequentially once per batch before the main workers. Repeat preparation after
pruning or installing; dv does not cache readiness. Keep mutation serialized so
parallel checkers never race a symlink or package patch operation.

Environment values discovered in a child process do not change the parent's
environment. Pass the resulting values explicitly into subsequent commands. For
example, a Nushell declaration can include `env: {TSGO_BIN: $tsgo_bin}` in each
specification; TypeScript can pass `env: { TSGO_BIN: tsgoBin }` to a batch.
Neither value should be guessed or baked into dv.

## One TYPES suite, different engines

In the workflow declaration, order specific rules before generic rules:

1. SDK packages with Svelte rune source use Svelte Check/native.
2. Remaining SDK packages with a module entrypoint use `deno check`.
3. SvelteKit apps use Svelte Check/native.
4. Vue apps use `vue-tsc`.
5. React apps use `tsc`.

Declare `packages`, `pattern`, `command`, and `engine` for each. Use
`cwd: "{root}"` when the command needs workspace configs; the row still uses its
package identity. Use `scope: "declared"` / `--scope declared` when all packages
must pass types even if a single app was selected for tests or build.

Use `match: "first"` for framework dispatch. Use `match: "all"` when several
independent rules should run on one package. An explicit `group: "SDK"` or
`group: "APPS"` controls presentation without changing filesystem layout.

The matrix mechanism does not infer readiness from a successful parser result. A
tool failing to start keeps its failure code even when there are no reported
source errors. Compatibility-preparation failures block the matrix workers and
remain inspectable as preparation failures. Intentional exclusions can carry a
`skip` reason.

## Wire the complete graph independently

Both consumer declarations should express prepare, test, check, and build in
that order. Keep direct `test` / `types` / `build` calls correctly prepared.
Test failures block checks/build as appropriate to the declared graph.
Formatting policy belongs to GWA; the demo uses `--check` so the gate does not
modify code after tests.

Tests for a real migration should compare normalized plans and real results from
both entrypoints, including selected-app behavior, full type scope, dry-run,
compatibility failures, environment handoff, and successful artifacts. Do not
compare wall-clock timing, process completion order, or terminal color
sequences.

The supplied narrative and transcript disagree about the SDK core test runner:
the transcript uses Deno tests while the narrative describes all tests as
Vitest. Use the actual workspace commands as the source of truth. Likewise,
version ranges/channel tags in the blueprint are not exact pins. This project
does not change those workspace choices.
