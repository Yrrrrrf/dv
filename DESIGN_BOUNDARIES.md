# Architectural Boundaries: Generality vs. Ecosystem Specialization in `dv`

A critical design document examining the architectural tensions in `@yrrrrrf/dv`, the trade-offs of absorbing workspace-specific compatibility layers, known ecosystem friction points, and future patterns for managing complex poly-runner environments without compromising core design principles.

---

## 1. The Core Dilemma: Generic Engine vs. Real-World Friction

`@yrrrrrf/dv` was designed around a strict, Unix-inspired thesis: **Commands, composed.**
- **Zero runtime dependencies**: Pure Deno 2 primitives (`Deno.Command`, `Deno.readDir`, `Deno.kill`).
- **No implicit configuration**: No magic `.dvrc`, implicit project scans, or hidden defaults.
- **Argv preservation**: Raw vector execution (`string[]`), avoiding shell interpretation and quoting bugs.
- **Process status authority**: Process exit codes are immutable; parsers observe, they never synthesize truth.

### The Emerging Tension
When `dv` is deployed into real-world monorepos with bleeding-edge or hybrid toolchains (such as the GWA client combining **Deno 2, Svelte 5 runes, SvelteKit, Vite-Plus-Core, Volar, tsgo, and Vue-tsc**), significant ecosystem friction surfaces. 

In this real deployment, getting tests and typegates to pass required a **180-line compatibility layer (`scripts/compat.ts`)** to:
1. Walk Deno's virtual store (`node_modules/.deno/`) and create missing symlinks (`node_modules/vite -> vite-plus-core`).
2. Force `vue-tsc` to link to `typescript@6` instead of breaking under `typescript@7`.
3. Locate platform-specific `tsgo` native preview binaries and symlink `tsgo.js -> tsgo`.
4. Monkey-patch `@volar/typescript`'s internal `runTsc.js` source code on disk using string regexes to intercept Node CJS `Module.prototype._compile`.

### The Question: Should `dv` Absorb This?
> *"Maybe if I just add the compat layer to dv is like contradictory, but it is also a good way to reduce the overall boilerplate on the final user's repo..."*

This document breaks down why baking such tool-specific fixes directly into `dv` core is an architectural hazard, why leaving it entirely as ad-hoc user boilerplate is painful, and what structural solutions `dv` can introduce to solve this cleanly.

---

## 2. Anatomy of the Seams: Why GWA Needed 180 Lines of Patches

Understanding why the friction exists reveals whether `dv` is the right layer to solve it:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Ecosystem Seams at Play                         │
├──────────────────────────┬─────────────────────────────────────────────┤
│ Tool / Framework         │ Root Cause of Friction                      │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Deno 2 npm store         │ Uses isolated `.deno/pkg@ver/...` layout.   │
│                          │ Tools expecting flat `node_modules/vite`    │
│                          │ fail without explicit symlink resolution.   │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Volar / vue-tsc          │ Designed for Node.js CJS module hooks.      │
│                          │ Monkey-patches `Module.prototype._compile`  │
│                          │ dynamically, which behaves differently in   │
│                          │ Deno's CJS compatibility runtime.           │
├──────────────────────────┼─────────────────────────────────────────────┤
│ svelte-check-native      │ Expects `@typescript/native-preview` or     │
│                          │ a `tsgo` executable in PATH / TSGO_BIN.     │
│                          │ Deno installs npm binaries under mangled    │
│                          │ `.deno` hashes rather than global PATH.     │
├──────────────────────────┼─────────────────────────────────────────────┤
│ Vite-Plus / SvelteKit    │ SvelteKit expects standard `vite`; Vite-    │
│                          │ Plus uses `@voidzero-dev/vite-plus-core`.   │
│                          │ Requires directory-level symlink aliasing.  │
└──────────────────────────┴─────────────────────────────────────────────┘
```

None of these issues stem from command execution, process scheduling, or output capture (the domain of `dv`). They are **package layout and runtime module loader incompatibilities**.

---

## 3. The Traps of Baking Ecosystem Hacks into `dv` Core

If `dv` were to internalize logic like `ensureNodeCompat()`, it would immediately incur severe architectural penalties:

### 1. The Maintenance Treadmill & Upstream Churn
* The Volar monkey-patch in `compat.ts` relies on exact string targets:
  ```ts
  const targetHook = "const proxyApiPath = require.resolve('../node/proxyCreateProgram');";
  ```
* If Volar 2.5 refactors that variable name, or SvelteKit alters how it imports Vite, **`dv` breaks**.
* `dv`'s release cycle would become hostage to patch lifecycles of third-party npm packages it doesn't even use itself.

### 2. Destruction of `dv`'s Core Value Proposition
* `dv` is currently **zero-dependency, agnostic, and universal**. It works equally well for Rust, Go, Python, C++, or Node/Deno/Bun commands.
* Hardcoding SvelteKit or Volar workarounds into `dv` turns a general-purpose orchestrator into a specialized framework wrapper.

### 3. Filesystem & Cache Mutation Hazards
* `compat.ts` writes directly into `node_modules/.deno/`.
* In environments with **read-only mounts, shared global Deno caches (`DENO_DIR`), or locked container environments**, mutating files inside `.deno` causes `EACCES` or breaks checksum verification.

### 4. The Subprocess Environment Boundary Trap
* A child process **cannot mutate its parent's environment variables**.
* If `dv` ran `ensureNodeCompat()` as an internal step, setting `Deno.env.set("TSGO_BIN", ...)` inside the Deno runtime only affects in-process execution. If a child shell or sub-agent is spawned, environment propagation becomes fragile unless `dv` acts as a full environment manager.

---

## 5. The User Pain of Leaving It Unassisted

Conversely, forcing end-user repositories to maintain 180 lines of ad-hoc patching causes real friction:

1. **Boilerplate Duplication**: Every developer setting up a similar stack has to reinvent or copy-paste fragile symlink scripts.
2. **Silent Drift**: When one repository discovers a bugfix for Volar under Deno 2, other repositories using `dv` don't benefit from it.
3. **High Onboarding Barrier**: New contributors cloning the repo must run bespoke pre-flight setup scripts before `deno check` or IDE diagnostics function properly.

---

## 6. How `dv` Can Solve This Cleanly: Future Architectural Patterns

Rather than choosing between "hardcode everything in `dv`" vs. "abandon the user to write 200 lines of fragile bash/TS", `dv` can evolve clean architectural patterns:

### Strategy A: Environment Export Contract for `before` Tasks
Currently, `dv batch` and `dv matrix` support `before: readonly ExecSpec[]` to run sequential preparation. However, `before` commands currently cannot communicate discovered environment variables (like `TSGO_BIN`) to subsequent worker tasks.

**Proposed Enhancement**:
Allow `before` tasks or preparation hooks to emit structured environment exports (e.g., via stdout JSON or a standard dotenv contract):
```json
{
  "before": [{ "command": ["deno", "run", "-A", "scripts/compat.ts"] }],
  "exportEnv": true
}
```
If a `before` command outputs:
```text
::set-env name=TSGO_BIN::/path/to/.deno/.../tsgo
```
`dv` automatically merges these exported variables into the `env` record of all subsequent planned matrix commands. This bridges the subprocess environment boundary without hardcoding any tool knowledge into `dv`.

---

### Strategy B: Standalone Companion Presets (`@yrrrrrf/dv-compat-*`)
Keep the core `dv` repository pure, but offer modular, composable companion packages on JSR:
* **Core**: `jsr:@yrrrrrf/dv` (Universal, zero dependencies, agnostic).
* **Companion**: `jsr:@yrrrrrf/dv-compat-deno-node` or `jsr:@yrrrrrf/dv-preset-gwa`.

In `pipeline.ts` or `justfile`:
```ts
import { matrix } from "jsr:@yrrrrrf/dv";
import { ensureNodeCompat } from "jsr:@yrrrrrf/dv-compat-deno-node";

await matrix(RULES, {
  before: [{ fn: ensureNodeCompat }],
});
```
This isolates framework-churn risk to companion packages while keeping the primary orchestrator rock-solid.

---

### Strategy C: Declarative Filesystem Primitives (`dv link`, `dv patch`)
Instead of `dv` knowing *what* packages to patch, `dv` can provide reliable, root-contained primitives for filesystem preparation:

1. **`dv link`**: Safe, cross-platform symlinking that respects root containment and handles Windows directory junctions.
2. **`dv patch`**: Safe, idempotent text replacement for known package seams that logs warnings if upstream files no longer match expected hooks.

This reduces the user's 180 lines of imperatively nested `existsSync` and `Deno.readDirSync` calls to 10 lines of declarative configuration.

---

## 7. Known Fragilities & Sharp Edges in `dv` Today

During the deep-dive analysis and real-world test run on the GWA client, the following nuances and sharp edges were identified:

### 1. Working Directory Nuances (`cwd: "{root}"` vs `{package}`)
* **The behavior**: In `matrix`, omitting `cwd` defaults to `{package}`.
* **The trap**: Commands that look root-relative (like Vitest `--config ./config/vitest.config.ts`) fail with `UNRESOLVED_ENTRY` unless explicitly declared with `cwd: "{root}"`.
* **Recommendation**: Document this prominently. In future versions, `dv` could offer a heuristic or linter warning when a command vector references paths starting with `./config` or `../` while `cwd` is left as `{package}`.

### 2. Invocation & Parser Detection Heuristics
* In [`src/parsers.ts`](file:///home/yrrrrrf/Documents/lab/code/typescript/dv/src/parsers.ts#L17), `invocation()` unwraps:
  ```ts
  deno [flags] run [flags] npm:vue-tsc@3.3.11 -> "vue-tsc"
  ```
* **The trap**: If a user runs a tool through an unusual wrapper (e.g. `pnpm exec`, `sh -c`, or a custom binary like `my-runner`), `dv` cannot guess the tool and falls back to `raw`.
* **Recommendation**: Keep parser selection explicit (`parser: "typescript"`) when wrapping tools in shell scripts or unorthodox launchers.

### 3. Stream Truncation & Diagnostic Blindness
* In [`src/exec.ts`](file:///home/yrrrrrf/Documents/lab/code/typescript/dv/src/exec.ts#L320), output exceeding `maxOutputBytes` (default 2 MiB) truncates by preserving the head and tail, and **disables diagnostic parsers**.
* **The rationale**: If output is truncated, error/warning regex counts are provably incomplete and would report false passes.
* **The consequence**: A build producing 3 MiB of logs with 1 error in the middle will report exit status accurately (`exit 1`), but diagnostic badges will display `exit 1` rather than `(1 errors)`.

### 4. Process Group Signaling Across Environments
* POSIX process detachment (`detached: true`, `Deno.kill(-pid)`) is highly reliable on native Linux and macOS.
* **The trap**: Inside certain container runtimes (e.g., minimal Docker containers without an init process PID 1, or weird subshell nestings), killing negative PIDs can behave differently or require `tini` / `dumb-init`.

---

## 8. Summary Decision Framework: Where Does `dv` Draw the Line?

When considering whether a feature belongs in `dv` core:

```
                  ┌─────────────────────────────────────┐
                  │    Proposed Feature / Workaround    │
                  └──────────────────┬──────────────────┘
                                     │
           Is it specific to a single framework or npm package?
           (e.g. SvelteKit link repairs, Volar CJS patches)
                                     │
                    ┌────────────────┴────────────────┐
                   YES                                NO
                    │                                 │
         ┌─────────────────────┐            Does it generalize across
         │ KEEP OUT OF DV CORE │            arbitrary CLI processes?
         │ Use:                │            (e.g. env export, bounded
         │ - scripts/compat.ts │             capture, process groups)
         │ - Companion package │                      │
         │ - `before` hook     │            ┌─────────┴─────────┐
         └─────────────────────┘           YES                  NO
                                            │                   │
                                   ┌────────────────┐   ┌───────────────┐
                                   │ CANDIDATE FOR  │   │ Belongs in    │
                                   │   DV CORE      │   │ user config   │
                                   └────────────────┘   └───────────────┘
```

By adhering to this boundary, **`@yrrrrrf/dv` remains lean, fast, and permanent**, while giving complex workspaces the exact primitives needed to compose and prepare their workflows cleanly.
