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

