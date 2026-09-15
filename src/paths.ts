// Native Deno paths, with slash-separated internal representation on every OS.
const windows = Deno.build.os === "windows";

/** Normalize a native absolute path, or resolve a relative path against base. */
export function resolvePath(path: string, base = Deno.cwd()): string {
  const slash = (p: string) => windows ? p.replaceAll("\\", "/") : p;
  let value = slash(path);
  const parent = slash(base);
  if (windows && /^[a-z]:[^/]/i.test(value)) {
    throw new Error(`Drive-relative paths are ambiguous: ${path}`);
  }
  if (
    windows && value.startsWith("/") && !value.startsWith("//") &&
    /^[a-z]:/i.test(parent)
  ) {
    value = parent.slice(0, 2) + value;
  }
  if (!(value.startsWith("/") || (windows && /^[a-z]:\//i.test(value)))) {
    value = `${parent}/${value}`;
  }
  let prefix = "/";
  if (windows && value.startsWith("//")) {
    const parts = value.slice(2).split("/");
    if (!parts[0] || !parts[1]) throw new Error(`Incomplete UNC path: ${path}`);
    prefix = `//${parts[0]}/${parts[1]}/`;
    value = parts.slice(2).join("/");
  } else if (windows && /^[a-z]:\//i.test(value)) {
    prefix = value.slice(0, 3);
    value = value.slice(3);
  }
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return prefix + parts.join("/");
}

/** True if path is root itself or one of its lexical descendants. */
export function within(root: string, path: string): boolean {
  const norm = (p: string) => windows ? p.toLowerCase() : p;
  root = norm(resolvePath(root));
  path = norm(resolvePath(path));
  return path === root || path.startsWith(root.replace(/\/$/, "") + "/");
}

/** Project-relative identifier for a contained path. */
export function relativePath(root: string, path: string): string {
  root = resolvePath(root);
  path = resolvePath(path);
  if (!within(root, path)) {
    throw new Error(`Path escapes root ${root}: ${path}`);
  }
  return (windows ? path.toLowerCase() === root.toLowerCase() : path === root)
    ? "."
    : path.slice(root.replace(/\/$/, "").length + 1);
}

/** Last path component, including paths containing spaces. */
export function basename(path: string): string {
  return (windows ? path.replaceAll("\\", "/") : path).replace(/\/$/, "").split(
    "/",
  ).at(-1) ??
    path;
}

/** Reject symlink ancestors; optionally allow the final symlink for unlinking. */
export async function containedPath(
  root: string,
  path: string,
  allowLeafLink = false,
): Promise<void> {
  const relative = relativePath(root, path);
  const parts = relative === "." ? [] : relative.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = resolvePath(parts[i]!, current);
    const stat = await Deno.lstat(current);
    if (stat.isSymlink && !(allowLeafLink && i === parts.length - 1)) {
      throw new Error(`Symlink traversal is not allowed: ${current}`);
    }
  }
}

/** Convert a file URL to a native path without treating percent escapes as separators. */
export function filePath(url: string | URL): string {
  const value = new URL(url);
  if (value.protocol !== "file:") throw new Error(`Expected file URL: ${url}`);
  if (/%2f/i.test(value.pathname) || (windows && /%5c/i.test(value.pathname))) {
    throw new Error("Encoded path separators are not allowed");
  }
  if (!windows && value.hostname && value.hostname !== "localhost") {
    throw new Error("Remote file URL hosts are unsupported on this OS");
  }
  let path = decodeURIComponent(value.pathname);
  if (windows && /^\/[a-z]:/i.test(path)) path = path.slice(1);
  if (value.hostname) path = `//${value.hostname}${path}`;
  return resolvePath(path);
}
