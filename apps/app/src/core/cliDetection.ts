import type { DetectedToolsMap, ToolName } from "./types";

const TOOL_BINARIES: Record<ToolName, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

export const CLI_DETECTION_SCRIPT = [
  // Disable PTY echo so markers aren't duplicated/garbled in output (critical for macOS zsh)
  "stty -echo 2>/dev/null",
  "set +e",
  // Add common tool paths — no need to source profiles since the interactive shell already loaded them
  "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH",
  '[ -d "$HOME/.nvm/versions/node" ] && for d in $HOME/.nvm/versions/node/*/bin; do export PATH="$d:$PATH"; done',
  "echo '___OV_DETECT_START___'",
  // Daemon detection first — fast, must not be blocked by slow tool checks
  "echo '___DAEMON_VER_START___'",
  "openvide-daemon version 2>/dev/null || echo '{\"ok\":false}'",
  "echo '___DAEMON_VER_END___'",
  // CLI tool detection — only use `which` (fast); skip --version to avoid slow commands blocking detection
  ...Object.entries(TOOL_BINARIES).map(
    ([name, binary]) =>
      `which ${binary} 2>/dev/null && echo '___${name.toUpperCase()}_FOUND___' || echo '___${name.toUpperCase()}_NOTFOUND___'`,
  ),
  "echo '___OV_DETECT_END___'",
  // Re-enable echo for subsequent interactive commands
  "stty echo 2>/dev/null",
].join("\n");

function stripAnsi(text: string): string {
  return text
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, "")
    .replace(/\[(?:\d{1,4}(?:;\d{1,4})*|\?\d{1,4})[A-Za-z]/g, "")
    .replace(/\[(?:\?[\d;]*)?[\d;]*[ABCDHIJKfhlmnsu]/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function parseCliDetectionOutput(stdout: string): DetectedToolsMap {
  const cleaned = stripAnsi(stdout);

  // Use lastIndexOf to skip echoed markers from PTY and find the actual output markers
  const startIdx = cleaned.lastIndexOf("___OV_DETECT_START___");
  const endIdx = cleaned.lastIndexOf("___OV_DETECT_END___");
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    console.warn("[OV:cliDetect] markers not found in output");
    return {};
  }

  const block = cleaned.slice(startIdx, endIdx);

  const tools: DetectedToolsMap = {};

  for (const name of Object.keys(TOOL_BINARIES) as ToolName[]) {
    const upper = name.toUpperCase();
    const foundMarker = `___${upper}_FOUND___`;
    // Use lastIndexOf to find the actual output marker (skip echoed ones)
    const found = block.lastIndexOf(foundMarker) >= 0 &&
      block.lastIndexOf(`___${upper}_NOTFOUND___`) < block.lastIndexOf(foundMarker);

    let path: string | undefined;

    if (found) {
      // Extract path: the line before the LAST ___FOUND___ marker (output of `which`)
      const foundIdx = block.lastIndexOf(foundMarker);
      if (foundIdx > 0) {
        const preceding = block.slice(0, foundIdx).trimEnd();
        const lastNewline = preceding.lastIndexOf("\n");
        const whichLine = preceding.slice(lastNewline + 1).trim();
        if (whichLine.startsWith("/")) {
          path = whichLine;
        }
      }
    }

    tools[name] = {
      installed: found,
      path: found ? path : undefined,
    };
  }

  return tools;
}

export function parseDaemonFromDetectionOutput(stdout: string): { installed: boolean; version?: string } {
  const cleaned = stripAnsi(stdout);

  // The daemon markers should appear early in the output (before tool checks).
  // First try within the OV_DETECT block, then fall back to full output search.
  let searchBlock = cleaned;

  const startIdx = cleaned.lastIndexOf("___OV_DETECT_START___");
  const endIdx = cleaned.lastIndexOf("___OV_DETECT_END___");
  if (startIdx >= 0 && endIdx > startIdx) {
    searchBlock = cleaned.slice(startIdx, endIdx);
  }

  // Find daemon version JSON between markers
  const verStart = "___DAEMON_VER_START___";
  const verEnd = "___DAEMON_VER_END___";
  const vsIdx = searchBlock.lastIndexOf(verStart);
  const veIdx = searchBlock.lastIndexOf(verEnd);

  // If markers not in the detect block, search the full output
  // (in case script timed out before ___OV_DETECT_END___ was emitted)
  if (vsIdx < 0 || veIdx <= vsIdx) {
    const fullVsIdx = cleaned.lastIndexOf(verStart);
    const fullVeIdx = cleaned.lastIndexOf(verEnd);
    if (fullVsIdx < 0 || fullVeIdx <= fullVsIdx) {
      console.warn("[OV:cliDetect] daemon: version markers not found anywhere in output");
      return { installed: false };
    }
    searchBlock = cleaned;
    return parseDaemonBlock(cleaned.slice(fullVsIdx + verStart.length, fullVeIdx));
  }

  return parseDaemonBlock(searchBlock.slice(vsIdx + verStart.length, veIdx));
}

function parseDaemonBlock(verBlock: string): { installed: boolean; version?: string } {
  const trimmed = verBlock.trim();

  // Parse the JSON output from `openvide-daemon version`
  for (const line of trimmed.split("\n")) {
    const clean = line.trim();
    if (!clean.startsWith("{")) continue;
    try {
      const obj = JSON.parse(clean) as Record<string, unknown>;
      if (obj["ok"] === true) {
        const version = typeof obj["version"] === "string" ? obj["version"] : undefined;
        console.log("[OV:cliDetect] daemon: installed=true version=" + (version ?? "unknown"));
        return { installed: true, version };
      }
    } catch {
      continue;
    }
  }

  console.log("[OV:cliDetect] daemon: not installed (no valid JSON response)");
  return { installed: false };
}
