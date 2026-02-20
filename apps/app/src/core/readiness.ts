import type { DetectedToolsMap, ReadinessReport } from "./types";
import { parseCliDetectionOutput } from "./cliDetection";

export const READINESS_SCRIPT = [
  "set +e",
  "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH",
  "[ -f $HOME/.profile ] && . $HOME/.profile || true",
  "[ -f $HOME/.bash_profile ] && . $HOME/.bash_profile || true",
  "[ -f $HOME/.zprofile ] && . $HOME/.zprofile || true",
  "echo 'STEP 1/3: Detecting host basics'",
  "echo \"os=$(uname -s 2>/dev/null || echo unknown)\"",
  "echo \"arch=$(uname -m 2>/dev/null || echo unknown)\"",
  "if [ -n \"${SHELL:-}\" ]; then echo \"shell=$SHELL\"; else echo \"shell=$(ps -p $$ -o comm= 2>/dev/null | tr -d ' ' || echo unknown)\"; fi",
  "if [ \"$(uname -s 2>/dev/null)\" = \"Darwin\" ]; then echo 'distro=macos'; echo \"distroVersion=$(sw_vers -productVersion 2>/dev/null || echo unknown)\"; elif [ -f /etc/os-release ]; then . /etc/os-release; echo \"distro=${ID:-unknown}\"; echo \"distroVersion=${VERSION_ID:-unknown}\"; else echo 'distro=unknown'; echo 'distroVersion=unknown'; fi",
  "PM=unknown",
  "for manager in apt-get dnf yum pacman zypper apk brew; do if command -v $manager >/dev/null 2>&1; then PM=$manager; break; fi; done",
  "echo \"packageManager=$PM\"",
  "echo 'STEP 2/4: Checking toolchain'",
  "for tool in ssh git curl wget node npm python3; do if command -v $tool >/dev/null 2>&1; then echo \"tool.$tool=1\"; else echo \"tool.$tool=0\"; fi; done",
  "echo 'STEP 3/4: Detecting CLI tools'",
  'for cli in claude codex gemini; do if command -v $cli >/dev/null 2>&1; then echo "cli.$cli.installed=1"; echo "cli.$cli.path=$(command -v $cli)"; VER=$($cli --version 2>/dev/null | head -1); echo "cli.$cli.version=$VER"; else echo "cli.$cli.installed=0"; fi; done',
  "echo 'STEP 4/4: Readiness scan complete'",
].join("\n");

function splitLines(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

export function parseReadinessOutput(targetId: string, stdout: string, stderr: string): ReadinessReport & { detectedTools?: DetectedToolsMap } {
  const map = new Map<string, string>();

  for (const line of splitLines(`${stdout}\n${stderr}`)) {
    if (!line.includes("=")) {
      continue;
    }
    const [key, ...rest] = line.split("=");
    if (!key) {
      continue;
    }
    map.set(key.trim(), rest.join("=").trim());
  }

  const toolchain: Record<string, boolean> = {};
  for (const [key, value] of map.entries()) {
    if (key.startsWith("tool.")) {
      toolchain[key.slice(5)] = value === "1";
    }
  }

  const prerequisites = {
    node: Boolean(toolchain.node),
    npm: Boolean(toolchain.npm),
    curl: Boolean(toolchain.curl),
    git: Boolean(toolchain.git),
  };

  const readiness = prerequisites.node && prerequisites.npm && prerequisites.curl && prerequisites.git
    ? "ready"
    : prerequisites.node || prerequisites.npm || prerequisites.curl || prerequisites.git
      ? "partial"
      : "blocked";

  const notes: string[] = [];
  const hasHostBasics = map.has("os") || map.has("arch") || map.has("packageManager");
  if (!hasHostBasics) {
    notes.push("Readiness parser did not receive host basics from SSH output; retry scan after reconnecting.");
  }
  if (!prerequisites.node || !prerequisites.npm) {
    notes.push("Node.js and npm are required for Claude/Codex/Gemini CLI installation.");
  }
  if (!prerequisites.curl) {
    notes.push("curl is missing; install it for diagnostics/bootstrap workflows.");
  }
  if (!prerequisites.git) {
    notes.push("git is missing; some workflows may fail without it.");
  }

  const detectedTools = parseCliDetectionOutput(`${stdout}\n${stderr}`);

  return {
    targetId,
    scannedAt: new Date().toISOString(),
    os: map.get("os") ?? "unknown",
    arch: map.get("arch") ?? "unknown",
    shell: map.get("shell") ?? "unknown",
    distro: map.get("distro") ?? "unknown",
    distroVersion: map.get("distroVersion") ?? "unknown",
    packageManager: map.get("packageManager") ?? "unknown",
    toolchain,
    prerequisites,
    readiness,
    notes,
    detectedTools,
  };
}
