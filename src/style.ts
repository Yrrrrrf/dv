// deno-lint-ignore-file no-control-regex
/** Terminal presentation shared by listings, prompts and captured output. */
export type OutputStream = "stdout" | "stderr";

export function environment(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Explicit environment choices win; automatic color follows the actual stream. */
export function supportsColor(stream: OutputStream = "stderr"): boolean {
  if (Deno.noColor || environment("NO_COLOR") !== undefined) return false;
  const force = environment("FORCE_COLOR");
  if (force !== undefined) return force !== "0";
  return Deno[stream].isTerminal() && environment("TERM") !== "dumb";
}

export function color(
  text: string,
  code: number | string,
  stream: OutputStream = "stderr",
): string {
  return text && supportsColor(stream) ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/** Retain only SGR styles; discard OSC, cursor operations and other controls. */
export function sanitize(text: string, styles = false): string {
  return text.replace(
    /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][\s\S]*?\x1b\\|[ -/]*[@-~])/g,
    (sequence) => styles && /^\x1b\[[\d;:]*m$/.test(sequence) ? sequence : "",
  )
    // SGR ESC bytes are kept separately from remaining control characters.
    .split(/(\x1b\[[\d;:]*m)/g).map((part) =>
      /^\x1b\[[\d;:]*m$/.test(part)
        ? part
        : part.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    ).join("");
}

export const plain = (text: string): string => sanitize(text);

/** Approximate cells, including combining characters and common wide glyphs. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const c of plain(text)) {
    if (/\p{Mark}|[\u200d\ufe0f]/u.test(c)) continue;
    const n = c.codePointAt(0)!;
    width += n >= 0x1100 && (n <= 0x115f || n >= 0x2e80 && n <= 0xa4cf ||
        n >= 0xac00 && n <= 0xd7a3 || n >= 0xf900 && n <= 0xfaff ||
        n >= 0xfe10 && n <= 0xfe6f || n >= 0xff01 && n <= 0xff60 ||
        n >= 0x1f000)
      ? 2
      : 1;
  }
  return width;
}

/** Clip by terminal cells without cutting escape sequences or leaking styles. */
export function clip(text: string, width: number, styles = false): string {
  text = sanitize(text, styles);
  width = Math.max(0, width);
  const truncated = displayWidth(text) > width;
  const limit = truncated ? Math.max(0, width - 1) : width;
  let result = "", cells = 0, styled = false;
  for (const token of text.match(/\x1b\[[\d;:]*m|[^]/gu) ?? []) {
    if (token.startsWith("\x1b")) {
      result += token;
      styled = true;
      continue;
    }
    const size = displayWidth(token);
    if (cells + size > limit) break;
    result += token;
    cells += size;
  }
  return result + (truncated && width ? "…" : "") + (styled ? "\x1b[0m" : "");
}

/** Preserve an explicit child setting; request color for captured terminal logs. */
export function childEnvironment(
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  if (
    Object.hasOwn(overrides, "NO_COLOR") ||
    Object.hasOwn(overrides, "FORCE_COLOR") ||
    overrides.TERM === "dumb" || environment("NO_COLOR") !== undefined ||
    environment("FORCE_COLOR") !== undefined || !supportsColor()
  ) return { ...overrides };
  return { FORCE_COLOR: "1", ...overrides };
}
