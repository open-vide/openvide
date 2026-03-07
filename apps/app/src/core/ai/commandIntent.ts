export interface CommandIntent {
  kind: "read" | "search" | "list" | "generic";
  command: string;
  filePath?: string;
  pattern?: string;
  path?: string;
}

function unquoteShellValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function unwrapShellCommand(command: string): string {
  let current = command.trim();
  for (let i = 0; i < 2; i += 1) {
    const match = /^(?:(?:\/usr\/bin\/env)\s+)?(?:(?:\/bin\/)?(?:zsh|bash|sh))\s+-lc\s+([\s\S]+)$/i.exec(current);
    if (!match?.[1]) {
      break;
    }
    current = unquoteShellValue(match[1]);
  }
  return current.trim();
}

function shellTokenToPath(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const value = unquoteShellValue(token).trim();
  if (!value || value.startsWith("-")) return undefined;
  return value;
}

function matchReadPath(command: string): string | undefined {
  const patterns = [
    /\bnl\s+-ba\s+((?:'[^']*'|"[^"]*"|[^\s|;]+))/i,
    /\bsed\s+-n\s+(?:'[^']*'|"[^"]*"|[^\s]+)\s+((?:'[^']*'|"[^"]*"|[^\s|;]+))/i,
    /\bcat\s+((?:'[^']*'|"[^"]*"|[^\s|;]+))/i,
    /\bhead(?:\s+-n\s+\d+)?\s+((?:'[^']*'|"[^"]*"|[^\s|;]+))/i,
    /\btail(?:\s+-n\s+\d+)?\s+((?:'[^']*'|"[^"]*"|[^\s|;]+))/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(command);
    const filePath = shellTokenToPath(match?.[1]);
    if (filePath) {
      return filePath;
    }
  }
  return undefined;
}

function matchSearch(command: string): { pattern?: string; path?: string } | undefined {
  const patterns = [
    /\brg\b(?![^|;]*--files)(?:\s+-[^\s]+|\s+--[^\s]+)*\s+((?:'[^']*'|"[^"]*"|[^\s|;]+))(?:\s+((?:'[^']*'|"[^"]*"|[^\s|;]+)))?/i,
    /\bgrep\b(?:\s+-[^\s]+|\s+--[^\s]+)*\s+((?:'[^']*'|"[^"]*"|[^\s|;]+))(?:\s+((?:'[^']*'|"[^"]*"|[^\s|;]+)))?/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(command);
    if (!match?.[1]) continue;
    return {
      pattern: unquoteShellValue(match[1]),
      path: shellTokenToPath(match[2]),
    };
  }
  return undefined;
}

function matchList(command: string): { path?: string } | undefined {
  const rgFiles = /\brg\b[^|;]*\s--files(?:\s+((?:'[^']*'|"[^"]*"|[^\s|;]+)))?/i.exec(command);
  if (rgFiles) {
    return { path: shellTokenToPath(rgFiles[1]) };
  }

  const findMatch = /\bfind\s+((?:'[^']*'|"[^"]*"|[^\s|;]+))/i.exec(command);
  if (findMatch?.[1]) {
    return { path: shellTokenToPath(findMatch[1]) };
  }

  const lsMatch = /\bls\b(?:\s+-[^\s]+|\s+--[^\s]+)*(?:\s+((?:'[^']*'|"[^"]*"|[^\s|;]+)))?/i.exec(command);
  if (lsMatch) {
    return { path: shellTokenToPath(lsMatch[1]) };
  }

  return undefined;
}

export function describeCommandIntent(rawCommand: string): CommandIntent {
  const command = unwrapShellCommand(rawCommand);
  const filePath = matchReadPath(command);
  if (filePath) {
    return { kind: "read", command, filePath };
  }
  const search = matchSearch(command);
  if (search?.pattern) {
    return {
      kind: "search",
      command,
      pattern: search.pattern,
      path: search.path,
    };
  }
  const list = matchList(command);
  if (list) {
    return {
      kind: "list",
      command,
      path: list.path,
    };
  }
  return { kind: "generic", command };
}

export function getCommandIntentKey(intent: CommandIntent): string | undefined {
  if (intent.kind === "read" && intent.filePath) {
    return `read:${intent.filePath}`;
  }
  if (intent.kind === "search" && intent.pattern) {
    return `search:${intent.pattern}:${intent.path ?? ""}`;
  }
  if (intent.kind === "list") {
    return `list:${intent.path ?? ""}`;
  }
  return undefined;
}
