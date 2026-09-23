# v0.0.4 validation

Validated on Linux with Deno 2.9.5, Just 1.58.0 and Nushell 0.115.1.

| Check                                                     | Result                                        |
| --------------------------------------------------------- | --------------------------------------------- |
| `deno task check`                                         | Formatting, lint and type checks passed       |
| `deno check example/workspace.ts`                         | Passed                                        |
| `deno task test` with Just/Nushell integration enabled    | 62 passed, 0 failed, none ignored             |
| `python3 test/pty_menu_test.py` with Deno/Just configured | 4 native terminal tests passed                |
| `deno publish --dry-run`                                  | Passed, including public API slow-type checks |
| CLI version                                               | `0.0.4`                                       |

The terminal tests exercise a standalone TypeScript workspace without a
justfile, default and explicit targets, workflow options, recipe failures,
Ctrl-C, Escape, SIGTERM, terminal-mode restoration, exact Just arguments
(including `{root}`, spaces and empty strings), default arguments, native colors
and TTY attachment. They also pass a keyboard command to an interactive child
after menu selection.

The source archive includes the complete project, updated README, changelog and
tests. Existing Deno task commands and example recipe bodies were preserved. No
runtime dependencies were added. This is a source release; no registry publish
was performed. Native Windows/macOS terminal behavior was not tested here.

## Try the menu

From the extracted project root:

```sh
deno run -A example/workspace.ts menu
```

For an existing workspace built with `createPipeline`, use its normal
entrypoint:

```sh
deno run -A workspace.ts menu
```

The optional Just consumer remains available:

```sh
just --justfile example/justfile menu
```

## Reproduce the additional integration checks

```sh
DV_TEST_JUST=/absolute/path/to/just DV_TEST_NU=/absolute/path/to/nu deno task test
DV_TEST_DENO=/absolute/path/to/deno DV_TEST_JUST=/absolute/path/to/just \
  python3 test/pty_menu_test.py
```
