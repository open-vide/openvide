export interface DiffLine {
  type: "add" | "remove" | "context" | "hunk_header";
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  oldFile: string;
  newFile: string;
  hunks: DiffHunk[];
}

/**
 * Splits raw `git diff` output into per-file chunks.
 * Each chunk includes the full diff text for that file (diff --git header through last hunk).
 */
export function splitMultiFileDiff(raw: string): Array<{ filePath: string; diff: string }> {
  const results: Array<{ filePath: string; diff: string }> = [];
  const parts = raw.split(/^(?=diff --git )/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.startsWith("diff --git ")) continue;

    // Extract file path from "+++ b/..." line
    const plusMatch = /^\+\+\+ b\/(.+)$/m.exec(trimmed);
    if (!plusMatch?.[1]) continue;

    results.push({ filePath: plusMatch[1], diff: trimmed });
  }

  return results;
}

export function parseDiff(text: string): ParsedDiff[] {
  try {
    const results: ParsedDiff[] = [];
    const lines = text.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;

      // Look for file headers
      if (line.startsWith("--- ")) {
        const oldFile = line.slice(4).replace(/^[ab]\//, "");
        i++;
        const nextLine = lines[i];
        if (nextLine && nextLine.startsWith("+++ ")) {
          const newFile = nextLine.slice(4).replace(/^[ab]\//, "");
          i++;

          const hunks: DiffHunk[] = [];

          while (i < lines.length) {
            const hunkLine = lines[i];
            if (!hunkLine || hunkLine.startsWith("--- ")) break;

            if (hunkLine.startsWith("@@ ")) {
              const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/.exec(hunkLine);
              if (!match) {
                i++;
                continue;
              }

              const oldStart = parseInt(match[1]!, 10);
              const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
              const newStart = parseInt(match[3]!, 10);
              const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;
              const header = hunkLine;
              i++;

              const hunkLines: DiffLine[] = [
                { type: "hunk_header", text: header },
              ];

              let oldLine = oldStart;
              let newLine = newStart;

              while (i < lines.length) {
                const contentLine = lines[i];
                if (contentLine === undefined) break;
                if (contentLine.startsWith("@@ ") || contentLine.startsWith("--- ")) break;

                if (contentLine.startsWith("+")) {
                  hunkLines.push({
                    type: "add",
                    text: contentLine.slice(1),
                    newLineNum: newLine,
                  });
                  newLine++;
                } else if (contentLine.startsWith("-")) {
                  hunkLines.push({
                    type: "remove",
                    text: contentLine.slice(1),
                    oldLineNum: oldLine,
                  });
                  oldLine++;
                } else if (contentLine.startsWith(" ")) {
                  hunkLines.push({
                    type: "context",
                    text: contentLine.slice(1),
                    oldLineNum: oldLine,
                    newLineNum: newLine,
                  });
                  oldLine++;
                  newLine++;
                } else if (contentLine === "\\ No newline at end of file") {
                  i++;
                  continue;
                } else {
                  // Treat as context with no prefix
                  hunkLines.push({
                    type: "context",
                    text: contentLine,
                    oldLineNum: oldLine,
                    newLineNum: newLine,
                  });
                  oldLine++;
                  newLine++;
                }
                i++;
              }

              hunks.push({ header, oldStart, oldCount, newStart, newCount, lines: hunkLines });
            } else {
              i++;
            }
          }

          results.push({ oldFile, newFile, hunks });
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return results;
  } catch {
    return [];
  }
}
