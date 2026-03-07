import type {
  EventSeverity,
  ParsedEvent,
  ProgressMarker,
  RawLogLine,
  RunPhase,
  RunRecord,
  RunStatus,
} from "./types";

const STEP_RE = /^STEP\s+(\d+)\/(\d+):\s*(.+)$/i;
const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const ANSI_C1_CSI_RE = /\u009B[0-?]*[ -/]*[@-~]/g;
const CSI_FALLBACK_RE = /\[(?:\d{1,4}(?:;\d{1,4})*|\?\d{1,4})[A-Za-z]/g;
const CSI_SHORT_RE = /\[(?:m|K|J|H|f|h|l)(?=[\s[]|$)/g;
const CURSOR_FORWARD_ESC_RE = /\u001B\[(\d*)C/g;
const CURSOR_FORWARD_BARE_RE = /\[(\d*)C/g;
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function cursorSpaces(value: string | undefined): string {
  const parsed = Number.parseInt(value ?? "1", 10);
  const width = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 8) : 1;
  return " ".repeat(width);
}

export function sanitizeTerminalText(line: string): string {
  return line
    .replace(/\r/g, "\n")
    .replace(CURSOR_FORWARD_ESC_RE, (_, width: string) => cursorSpaces(width))
    .replace(CURSOR_FORWARD_BARE_RE, (_, width: string) => cursorSpaces(width))
    .replace(ANSI_ESCAPE_RE, "")
    .replace(ANSI_C1_CSI_RE, "")
    .replace(CSI_FALLBACK_RE, "")
    .replace(CSI_SHORT_RE, "")
    .replace(/\\x1b\[[0-9;?]*[A-Za-z]/gi, "")
    .replace(/\[(?:\?[\d;]*|[\d;]{1,12})[A-Za-z]/g, "")
    .replace(/\u001B/g, "")
    .replace(CONTROL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeNarrativeText(line: string): string {
  let value = sanitizeTerminalText(line)
    .replace(/\s+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(Accessing)(workspace)/gi, "$1 $2")
    .replace(/(Quick)(safety)/gi, "$1 $2")
    .replace(/(Security)(guide)/gi, "$1 $2")
    .replace(/(Enter)(to)/gi, "$1 to")
    .replace(/(Esc)(to)/gi, "$1 to")
    .trim();

  value = value
    .replace(/accessing\s*workspace\s*:/gi, "Accessing workspace:")
    .replace(/quick\s*safety\s*check\s*:/gi, "Quick safety check:")
    .replace(
      /is\s*this\s*a\s*project\s*you\s*created\s*or\s*one\s*you\s*trust\?/gi,
      "Is this a project you created or one you trust?",
    )
    .replace(
      /\(\s*like\s*your\s*own\s*code\s*,?\s*a\s*well-?\s*known\s*open\s*source\s*project\s*,?\s*or\s*work\s*from\s*your\s*team\s*\)\.?/gi,
      "(Like your own code, a well-known open source project, or work from your team).",
    )
    .replace(
      /if\s*not\s*,?\s*take\s*a\s*moment\s*to\s*review\s*what'?s\s*in\s*this\s*folder\s*first\.?/gi,
      "If not, take a moment to review what's in this folder first.",
    )
    .replace(
      /claude\s*code'?ll\s*be\s*able\s*to\s*read\s*,?\s*edit\s*,?\s*and\s*execute\s*files\s*here\.?/gi,
      "Claude Code will be able to read, edit, and execute files here.",
    )
    .replace(/security\s*guide/gi, "Security guide")
    .replace(/1\s*[.)]\s*yes\s*,?\s*i\s*trust\s*this\s*folder/gi, "1. Yes, I trust this folder")
    .replace(/2\s*[.)]\s*no\s*,?\s*exit/gi, "2. No, exit")
    .replace(/enter\s*to\s*confirm\s*[·.\- ]*\s*esc\s*to\s*cancel/gi, "Enter to confirm · Esc to cancel");

  return value
    .replace(/\s+([,.:;!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isLowSignalShellNoise(line: string): boolean {
  const value = line.trim();
  if (value.length === 0) {
    return true;
  }
  if (/^SSH connection (starting|established)$/i.test(value)) {
    return true;
  }
  if (/^STEP 0\/1: command dispatched to remote shell$/i.test(value)) {
    return true;
  }
  if (/^last login:/i.test(value)) {
    return true;
  }
  if (/^%(\s|$)/.test(value)) {
    return true;
  }
  if (/^%$|^\$$|^#$/.test(value)) {
    return true;
  }
  if (/^\/bin\/sh -lc\b/.test(value)) {
    return true;
  }
  if (/\/bin\/sh\s*-lc/i.test(value)) {
    return true;
  }
  if (/open-vide/i.test(value)) {
    return true;
  }
  if (/^['"`]+$/.test(value)) {
    return true;
  }
  if (/^quote>\s*/i.test(value)) {
    return true;
  }
  if (/^(?:d?quote|bquote|heredoc|cmdsubst|pipe)>\s*/i.test(value)) {
    return true;
  }
  if (/OV_EXIT_CODE=\$?\?/i.test(value)) {
    return true;
  }
  if (/OV_EXIT_CODE|__OV_EXIT_/i.test(value)) {
    return true;
  }
  if (/\.open-vide\/env\.sh/.test(value)) {
    return true;
  }
  if (/^[%$#]\s*(?:->|›|»)/.test(value)) {
    return true;
  }
  if (/->=.*>$/.test(value)) {
    return true;
  }
  if (/^RC=\$\??/.test(value)) {
    return true;
  }
  if (/__OV_EXIT_/.test(value)) {
    return true;
  }
  if (/^\[\?\d+[hl]$/.test(value)) {
    return true;
  }
  if (/^[%$#]$/.test(value)) {
    return true;
  }
  if (/^[\s=~\-'"`>]+$/.test(value)) {
    return true;
  }
  return false;
}

function inferSeverity(line: string, stream: RawLogLine["stream"]): EventSeverity {
  if (/\b(error|failed|fatal|exception|denied|unauthorized|not found)\b/i.test(line)) {
    return "error";
  }
  if (/\b(trust this folder|enter to confirm|select|choose|continue\?|1\.\s*yes|2\.\s*no)\b/i.test(line)) {
    return "prompt";
  }
  if (/\b(warn|warning|deprecated|retry)\b/i.test(line)) {
    return "warning";
  }
  if (/\b(success|completed|complete|verified|ready|installed)\b/i.test(line)) {
    return "success";
  }
  if (/\b(prompt|enter|input|confirm|passphrase|password|token)\b/i.test(line)) {
    return "prompt";
  }
  if (stream === "stderr") {
    return "warning";
  }
  return "info";
}

function inferPhase(line: string, fallback: RunPhase, severity: EventSeverity): RunPhase {
  if (severity === "error") {
    return "failed";
  }
  if (/\b(connect|ssh|auth|handshake|session)\b/i.test(line)) {
    return "connect";
  }
  if (/\b(precheck|readiness|detect|os=|distro=|packageManager=|checking)\b/i.test(line)) {
    return "precheck";
  }
  if (/\b(install|npm install|apt-get install|brew install|dnf install|yum install|apk add)\b/i.test(line)) {
    return "install";
  }
  if (/\b(config|credential|token|profile|env\.sh|export\s+[A-Z_]+)\b/i.test(line)) {
    return "configure";
  }
  if (/\b(verify|version|--version|which\s+)\b/i.test(line)) {
    return "verify";
  }
  if (/\b(complete|completed|done|finished)\b/i.test(line)) {
    return "complete";
  }
  return fallback;
}

function nextActionsFromLine(line: string): string[] {
  const actions: string[] = [];

  if (/permission denied/i.test(line)) {
    actions.push("Verify SSH user permissions, key permissions, and sudo access.");
  }
  if (/command not found/i.test(line)) {
    actions.push("Install missing prerequisite binaries and retry.");
  }
  if (/unauthorized|forbidden|401|403/i.test(line)) {
    actions.push("Reconfigure API token credentials and validate access scope.");
  }
  if (/timed out|timeout/i.test(line)) {
    actions.push("Increase timeout or inspect host/network latency.");
  }
  if (/network is unreachable|no route to host|econn|enotfound/i.test(line)) {
    actions.push("Check host, SSH port, DNS, and firewall/security group rules.");
  }

  return actions;
}

export interface ParseInput {
  line: string;
  stream: RawLogLine["stream"];
  seq: number;
  timestamp: string;
  rawLineId: number;
  fallbackPhase: RunPhase;
}

export function parseLogLine(input: ParseInput): ParsedEvent {
  const normalizedLine = sanitizeTerminalText(input.line);
  const hidden = isLowSignalShellNoise(normalizedLine);
  const text = normalizedLine.length > 0 ? normalizedLine : "(control sequence)";
  const severity = inferSeverity(text, input.stream);
  const phase = inferPhase(text, input.fallbackPhase, severity);
  const match = text.match(STEP_RE);

  return {
    seq: input.seq,
    timestamp: input.timestamp,
    phase,
    severity,
    message: text,
    rawLineIds: [input.rawLineId],
    metadata: hidden ? { hidden: true } : undefined,
    progress: match
      ? {
        current: Number.parseInt(match[1] ?? "0", 10),
        total: Number.parseInt(match[2] ?? "0", 10),
        label: match[3] ?? "",
      }
      : undefined,
    nextActions: nextActionsFromLine(text),
  };
}

export interface LiveRunStatus {
  headline: string;
  detail: string;
  tone: EventSeverity;
  updatedAt?: string;
  progress?: ProgressMarker;
  quickReplies: string[];
}

function normalizeStatusDetail(message: string): string {
  return normalizeNarrativeText(message);
}

function isGenericStatusMessage(message: string): boolean {
  const value = normalizeStatusDetail(message);
  if (value.length === 0) {
    return true;
  }
  if (/^SSH connection (starting|established)$/i.test(value)) {
    return true;
  }
  if (/^STEP 0\/1: command dispatched to remote shell$/i.test(value)) {
    return true;
  }
  if (/^command on target .* completed successfully \(exit 0\)\.?$/i.test(value)) {
    return true;
  }
  if (/^command on target .* (timed out|failed|was cancelled)/i.test(value)) {
    return true;
  }
  return false;
}

function extractQuickReplies(message: string): string[] {
  const value = normalizeStatusDetail(message).toLowerCase();
  const numericOptions = Array.from(value.matchAll(/\b(\d+)\s*[.)]\s*[a-z]/g))
    .map((match) => match[1] ?? "")
    .filter((option) => option.length > 0);
  if (numericOptions.length > 0) {
    return Array.from(new Set(numericOptions)).slice(0, 5);
  }
  if (value.includes("trust this folder")) {
    return ["1", "2"];
  }
  if (/\byes\/no\b/.test(value)) {
    return ["yes", "no"];
  }
  if (value.includes("enter to confirm")) {
    return value.includes("esc to cancel") ? ["<enter>", "<esc>"] : ["<enter>"];
  }
  if (value.includes("esc to cancel")) {
    return ["<esc>"];
  }
  return [];
}

function summarizePromptDetail(message: string): string {
  const value = normalizeStatusDetail(message);
  const lower = value.toLowerCase();
  if (
    lower.includes("trust this folder") ||
    lower.includes("safety check") ||
    lower.includes("security guide")
  ) {
    return "Claude requests workspace trust confirmation. Choose 1 to trust, 2 to exit, or press Enter.";
  }
  if (lower.includes("password")) {
    return "Remote CLI is waiting for a password input.";
  }
  if (lower.includes("passphrase")) {
    return "Remote CLI is waiting for a key passphrase.";
  }
  return value;
}

export function deriveLiveRunStatus(run: RunRecord): LiveRunStatus {
  const visibleEvents = run.events.filter((event) => event.metadata?.hidden !== true);
  const latestVisible = visibleEvents.length > 0 ? visibleEvents[visibleEvents.length - 1] : undefined;
  const latestPrompt = [...visibleEvents].reverse().find((event) => event.severity === "prompt");
  const latestError = [...visibleEvents].reverse().find((event) => event.severity === "error");
  const latestProgress = [...visibleEvents].reverse().find((event) => event.progress)?.progress;
  const latestUseful = [...visibleEvents]
    .reverse()
    .find((event) => !isGenericStatusMessage(event.message));

  const fallbackDetail = normalizeStatusDetail(run.summary ?? latestVisible?.message ?? "Waiting for output...");

  if (run.status === "connecting") {
    return {
      headline: "Connecting to host...",
      detail: "Opening SSH session and preparing remote shell.",
      tone: "info",
      updatedAt: run.startedAt,
      quickReplies: [],
    };
  }

  if (run.status === "running") {
    if (latestPrompt) {
      const detail = summarizePromptDetail(latestPrompt.message);
      return {
        headline: "Awaiting your input",
        detail: detail.length > 0 ? detail : "The remote CLI asked for confirmation/input.",
        tone: "prompt",
        updatedAt: latestPrompt.timestamp,
        progress: latestProgress,
        quickReplies: extractQuickReplies(`${detail} ${latestPrompt.message}`),
      };
    }

    if (latestError) {
      return {
        headline: "Running with warnings",
        detail: normalizeStatusDetail(latestError.message),
        tone: "warning",
        updatedAt: latestError.timestamp,
        progress: latestProgress,
        quickReplies: [],
      };
    }

    return {
      headline: latestProgress ? `Running step ${latestProgress.current}/${latestProgress.total}` : "Command running",
      detail: latestUseful ? normalizeStatusDetail(latestUseful.message) : fallbackDetail,
      tone: "info",
      updatedAt: latestUseful?.timestamp ?? latestVisible?.timestamp ?? run.startedAt,
      progress: latestProgress,
      quickReplies: [],
    };
  }

  if (run.status === "completed") {
    return {
      headline: "Completed successfully",
      detail: fallbackDetail.length > 0 ? fallbackDetail : "Run completed successfully.",
      tone: "success",
      updatedAt: run.endedAt ?? latestVisible?.timestamp ?? run.startedAt,
      quickReplies: [],
    };
  }

  if (run.status === "cancelled") {
    return {
      headline: "Run cancelled",
      detail: fallbackDetail.length > 0 ? fallbackDetail : "The run was cancelled.",
      tone: "warning",
      updatedAt: run.endedAt ?? latestVisible?.timestamp ?? run.startedAt,
      quickReplies: [],
    };
  }

  if (run.status === "timeout") {
    return {
      headline: "Run timed out",
      detail: fallbackDetail.length > 0 ? fallbackDetail : "The command timed out before completion.",
      tone: "error",
      updatedAt: run.endedAt ?? latestVisible?.timestamp ?? run.startedAt,
      quickReplies: [],
    };
  }

  return {
    headline: "Run failed",
    detail: fallbackDetail.length > 0 ? fallbackDetail : "The command failed.",
    tone: "error",
    updatedAt: run.endedAt ?? latestVisible?.timestamp ?? run.startedAt,
    quickReplies: [],
  };
}

export function resolveStatus(
  exitCode: number | null,
  signal: string | undefined,
  cancelled: boolean,
  timedOut: boolean,
): RunStatus {
  if (timedOut) {
    return "timeout";
  }
  if (cancelled || signal === "SIGINT" || signal === "SIGTERM") {
    return "cancelled";
  }
  return exitCode === 0 ? "completed" : "failed";
}

export function summarizeRun(run: RunRecord): { summary: string; nextActions: string[] } {
  const actionLabel = run.action ? `${run.tool ?? "tool"} ${run.action}` : "command";
  const base = `${actionLabel} on target ${run.targetId}`;

  const extractedActions = Array.from(
    new Set(run.events.flatMap((event) => event.nextActions ?? []).concat(run.nextActions)),
  );

  let summary = "";
  if (run.status === "completed") {
    summary = `${base} completed successfully (exit ${run.exitCode ?? 0}).`;
  } else if (run.status === "cancelled") {
    summary = `${base} was cancelled.`;
  } else if (run.status === "timeout") {
    summary = `${base} timed out after ${run.durationMs ?? 0} ms.`;
  } else {
    const errors = run.events
      .filter((event) => event.severity === "error")
      .slice(-2)
      .map((event) => event.message);
    summary =
      errors.length > 0
        ? `${base} failed: ${errors.join(" | ")}`
        : `${base} failed with exit ${run.exitCode ?? -1}.`;
  }

  return { summary, nextActions: extractedActions };
}
