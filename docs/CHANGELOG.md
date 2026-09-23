# Changelog

## 0.0.4

This release follows 0.0.3. Earlier `0.2.0` labels in the README and CLI were
inconsistent with the package version and are corrected here.

### Recipe menus

- Share a source-independent recipe model, grouped listing and interactive
  picker between TypeScript workspaces and the optional Just adapter.
- Expose `Pipeline.recipes()` and `chooseRecipe()`; retain existing `choose()`
  and `formatRecipes()` imports. Add `readInput()` for editable argument input.
- Add group colors, bold names, italic descriptions, ranked fuzzy matching,
  matching-character highlights, result counts, scrolling and terminal resizing.
- Support input editing, quote-aware completion and bracketed paste.
- Add `example/workspace.ts` as a standalone TypeScript entrypoint using the
  existing example task graph. No Just installation or justfile is needed.
- Preserve explicit TypeScript targets and `--all`; optional target completion
  provides a recipe-default choice. Run the same pipeline graph as direct calls.
- Reject disabled interaction and pre-cancelled menus before prompting or
  running.

### Just adapter

- Forward selected recipes through inherited stdin/stdout/stderr, preserving
  native terminal interaction, colors and exit status.
- Pass arguments literally without dv placeholder expansion. Let Just evaluate
  defaults; preserve quoted empty arguments and values containing spaces.
- Show public aliases and namespaced module recipes. Continue hiding private
  recipes and recursive menu entries.
- Keep target completions as suggestions instead of inserting a required target.

### Output and execution

- Preserve SGR colors/styles in human-facing captured logs while removing cursor
  movement, child OSC controls and screen clearing. Keep plain diagnostic
  parsing.
- Use stream-specific color detection and honor explicit color environment
  settings. Request color from captured children when displaying to a color
  terminal.
- Keep raw-mode timeouts at exit 124 rather than treating them as successful
  stops.
- Add unit, execution and native POSIX terminal coverage for the new behavior.

### Compatibility

No runtime dependencies were added. Existing Just recipes, TypeScript task
graphs, execution flags and Deno task commands remain usable. Just remains
optional. Interactive menu argument entry is richer; command execution still
belongs to the original recipe provider. Windows terminal behavior needs native
validation.
