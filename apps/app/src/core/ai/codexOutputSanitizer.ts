const CHUNK_WRAPPED_OUTPUT_RE =
  /^Chunk ID:[^\n]*\nWall time:[^\n]*\nProcess exited with code\s+(-?\d+)\n(?:Original token count:[^\n]*\n)?Output:\n([\s\S]*)$/;

const EXIT_WRAPPED_OUTPUT_RE =
  /^Exit code:\s*(-?\d+)\nWall time:[^\n]*\nOutput:\n([\s\S]*)$/;

function unwrapStructuredOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return raw;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.output === "string") {
      return parsed.output;
    }
    if (typeof parsed.stdout === "string") {
      return parsed.stdout;
    }
  } catch {
    // Keep raw text when it's not valid JSON
  }
  return raw;
}

export function sanitizeCodexToolOutput(raw: string): string {
  if (!raw) return "";
  const normalized = unwrapStructuredOutput(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.trim();

  const structuredLines = trimmed.split("\n");
  const hasStructuredHeader = structuredLines.length >= 4
    && (/^Chunk ID:/i.test(structuredLines[0] ?? "") || /^Exit code:/i.test(structuredLines[0] ?? ""))
    && /^Wall time:/i.test(structuredLines[1] ?? "");

  if (hasStructuredHeader) {
    let lineIndex = 2;
    let exitCode: number | undefined;

    const statusLine = structuredLines[lineIndex] ?? "";
    const runningMatch = /^Process running with session ID\b/i.exec(statusLine);
    const exitedMatch = /^Process exited with code\s+(-?\d+)/i.exec(statusLine);
    const exitHeaderMatch = /^Exit code:\s*(-?\d+)/i.exec(structuredLines[0] ?? "");

    if (exitedMatch?.[1]) {
      exitCode = Number.parseInt(exitedMatch[1], 10);
      lineIndex += 1;
    } else if (runningMatch) {
      lineIndex += 1;
    }

    if (/^Original token count:/i.test(structuredLines[lineIndex] ?? "")) {
      lineIndex += 1;
    }

    if (/^Output:/i.test(structuredLines[lineIndex] ?? "")) {
      const body = structuredLines.slice(lineIndex + 1).join("\n").trim();
      if (body.length > 0) {
        return body;
      }
      if (Number.isFinite(exitCode) && exitCode !== 0) {
        return `Command exited with code ${exitCode}`;
      }
      const headerExitCode = exitHeaderMatch?.[1] ? Number.parseInt(exitHeaderMatch[1], 10) : undefined;
      if (Number.isFinite(headerExitCode) && headerExitCode !== 0) {
        return `Command exited with code ${headerExitCode}`;
      }
      return "";
    }
  }

  const wrappedMatch = CHUNK_WRAPPED_OUTPUT_RE.exec(trimmed) ?? EXIT_WRAPPED_OUTPUT_RE.exec(trimmed);
  if (!wrappedMatch) {
    return trimmed;
  }

  const exitCodeRaw = wrappedMatch[1];
  const body = (wrappedMatch[2] ?? "").trim();
  if (body.length > 0) {
    return body;
  }

  const exitCode = exitCodeRaw ? Number.parseInt(exitCodeRaw, 10) : 0;
  if (Number.isFinite(exitCode) && exitCode !== 0) {
    return `Command exited with code ${exitCode}`;
  }
  return "";
}
