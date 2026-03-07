import * as os from "node:os";
import * as path from "node:path";

export function normalizeWorkspacePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "/";

  const home = os.homedir();
  let expanded = trimmed;
  if (expanded === "~") {
    expanded = home;
  } else if (expanded.startsWith("~/")) {
    expanded = path.join(home, expanded.slice(2));
  }

  const resolved = path.resolve(expanded);
  const normalized = resolved.replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

export function parseIsoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function sortByUpdatedDesc<T extends { updatedAt?: string; createdAt?: string }>(items: T[]): T[] {
  return items
    .slice()
    .sort((a, b) => {
      const aTs = a.updatedAt ?? a.createdAt ?? "";
      const bTs = b.updatedAt ?? b.createdAt ?? "";
      return bTs.localeCompare(aTs);
    });
}
