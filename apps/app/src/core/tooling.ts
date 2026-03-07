import type { ToolAction, ToolName } from "./types";

interface ToolSpec {
  label: string;
  npmPackage: string;
  binary: string;
}

const TOOLS: Record<ToolName, ToolSpec> = {
  claude: {
    label: "Claude CLI",
    npmPackage: "@anthropic-ai/claude-code",
    binary: "claude",
  },
  codex: {
    label: "OpenAI Codex CLI",
    npmPackage: "@openai/codex",
    binary: "codex",
  },
  gemini: {
    label: "Gemini CLI",
    npmPackage: "@google/gemini-cli",
    binary: "gemini",
  },
};

function nodePrereqScript(): string {
  return [
    "if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then",
    "  echo 'Node.js + npm already installed';",
    "else",
    "  echo 'Node.js/npm missing. Attempting install via package manager';",
    "  if command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs npm;",
    "  elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y nodejs npm;",
    "  elif command -v yum >/dev/null 2>&1; then sudo yum install -y nodejs npm;",
    "  elif command -v pacman >/dev/null 2>&1; then sudo pacman -Sy --noconfirm nodejs npm;",
    "  elif command -v apk >/dev/null 2>&1; then sudo apk add --no-cache nodejs npm;",
    "  elif command -v zypper >/dev/null 2>&1; then sudo zypper install -y nodejs npm;",
    "  elif command -v brew >/dev/null 2>&1; then brew install node;",
    "  else echo 'ERROR: unsupported package manager for automated node install'; exit 1; fi",
    "fi",
  ].join("\n");
}

function installScript(spec: ToolSpec): string {
  return [
    "set -e",
    "echo 'STEP 1/4: Checking node/npm prerequisites'",
    nodePrereqScript(),
    `echo 'STEP 2/4: Installing ${spec.label}'`,
    `npm install -g ${spec.npmPackage}`,
    `echo 'STEP 3/4: Verifying ${spec.binary}'`,
    `${spec.binary} --version`,
    "echo 'STEP 4/4: Install completed'",
  ].join("\n");
}

function updateScript(spec: ToolSpec): string {
  return [
    "set -e",
    "echo 'STEP 1/3: Checking npm availability'",
    "command -v npm >/dev/null 2>&1",
    `echo 'STEP 2/3: Updating ${spec.label}'`,
    `npm install -g ${spec.npmPackage}@latest`,
    `echo 'STEP 3/3: Verifying ${spec.binary}'`,
    `${spec.binary} --version`,
  ].join("\n");
}

function verifyScript(spec: ToolSpec): string {
  return [
    "set -e",
    "echo 'STEP 1/2: Checking CLI binary'",
    `if ! command -v ${spec.binary} >/dev/null 2>&1; then echo 'ERROR: ${spec.binary} not installed'; exit 1; fi`,
    "echo 'STEP 2/2: Fetching CLI version'",
    `${spec.binary} --version`,
  ].join("\n");
}

function uninstallScript(spec: ToolSpec): string {
  return [
    "set -e",
    `echo 'STEP 1/2: Uninstalling ${spec.label}'`,
    `npm uninstall -g ${spec.npmPackage} || true`,
    "echo 'STEP 2/2: Validating uninstall'",
    `if command -v ${spec.binary} >/dev/null 2>&1; then echo 'WARNING: ${spec.binary} still available'; exit 1; else echo 'Uninstall confirmed'; fi`,
  ].join("\n");
}

export type DaemonAction = "install" | "uninstall";

export function buildDaemonScript(action: DaemonAction): string {
  switch (action) {
    case "install":
      return [
        "set -e",
        "echo 'STEP 1/4: Checking node/npm prerequisites'",
        nodePrereqScript(),
        "echo 'STEP 2/4: Stopping running openvide-daemon'",
        "openvide-daemon stop 2>/dev/null || true",
        "echo 'STEP 3/4: Installing openvide-daemon@latest'",
        "npm install -g @openvide/daemon@latest",
        "echo 'STEP 4/4: Verifying openvide-daemon'",
        "openvide-daemon version",
      ].join("\n");
    case "uninstall":
      return [
        "set -e",
        "echo 'STEP 1/3: Stopping daemon'",
        "openvide-daemon stop 2>/dev/null || true",
        "echo 'STEP 2/3: Uninstalling openvide-daemon'",
        "npm uninstall -g @openvide/daemon || true",
        "echo 'STEP 3/3: Validating uninstall'",
        "if command -v openvide-daemon >/dev/null 2>&1; then echo 'WARNING: openvide-daemon still available'; exit 1; else echo 'Uninstall confirmed'; fi",
      ].join("\n");
    default:
      throw new Error(`Unsupported daemon action ${action}`);
  }
}

export function buildToolScript(tool: ToolName, action: ToolAction): string {
  const spec = TOOLS[tool];

  switch (action) {
    case "install":
      return installScript(spec);
    case "update":
      return updateScript(spec);
    case "verify":
      return verifyScript(spec);
    case "uninstall":
      return uninstallScript(spec);
    default:
      throw new Error(`Unsupported action ${action}`);
  }
}
