import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, afterEach } from "node:test";

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "openvide-daemon-test-"));
process.env.HOME = testHome;
const testDaemonDir = path.join(testHome, ".openvide-daemon");

const sm = await import("../dist/sessionManager.js");
const nativeHistory = await import("../dist/nativeHistory/index.js");

afterEach(async () => {
  sm.setCodexAppServerTurnSpawnerForTest();
  await sm.shutdownAll();
});

after(async () => {
  await fs.rm(testHome, { recursive: true, force: true });
});

async function initState() {
  await fs.rm(testDaemonDir, { recursive: true, force: true });
  sm.init();
}

function permissionRequest(requestId = "approval-1") {
  return {
    requestId,
    kind: "command",
    status: "pending",
    title: "Command approval needed",
    description: "Allow test command?",
    command: "echo test",
    reason: "Allow test command?",
    risk: "low",
    createdAt: new Date(0).toISOString(),
    source: "codex_app_server",
    backendMethod: "item/commandExecution/requestApproval",
    options: [
      { id: "approve_once", label: "Approve once", kind: "approve_once" },
      { id: "reject", label: "Reject", kind: "reject" },
      { id: "abort_run", label: "Abort run", kind: "abort_run" },
    ],
  };
}

function installPermissionRunner(request = permissionRequest()) {
  const calls = [];
  const decisions = [];
  let finish;
  let finished = false;

  function finishOnce(result = { exitCode: 0, conversationId: "thread-test" }) {
    assert.equal(typeof finish, "function");
    if (finished) return;
    finished = true;
    finish(result);
  }

  sm.setCodexAppServerTurnSpawnerForTest((
    session,
    prompt,
    turnOpts,
    _onOutputDelta,
    onPermissionRequest,
    onPermissionResolved,
    onFinished,
  ) => {
    calls.push({ session, prompt, turnOpts });
    finish = onFinished;
    onPermissionRequest(request, async (decision) => {
      decisions.push(decision);
      const status = decision === "approve_once"
        ? "approved"
        : decision === "reject"
          ? "rejected"
          : "cancelled";
      onPermissionResolved(request.requestId, status);
    });
    return {
      pid: 12345,
      kill: () => finishOnce({ exitCode: 1 }),
    };
  });

  return {
    calls,
    decisions,
    finish: finishOnce,
  };
}

async function installFakeCodexAppServer() {
  const binDir = await fs.mkdtemp(path.join(testHome, "fake-codex-bin-"));
  const logPath = path.join(binDir, "calls.jsonl");
  const threadId = "thread-resume-test";
  const originalPath = process.env.PATH;
  const originalCodexBin = process.env.OPENVIDE_CODEX_BIN;
  const originalLog = process.env.OPENVIDE_FAKE_CODEX_LOG;
  const originalThreadId = process.env.OPENVIDE_FAKE_CODEX_THREAD_ID;
  const scriptPath = path.join(binDir, "codex");
  await fs.writeFile(scriptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const logPath = process.env.OPENVIDE_FAKE_CODEX_LOG;
const fixedThreadId = process.env.OPENVIDE_FAKE_CODEX_THREAD_ID || "thread-resume-test";
let nextTurn = 1;
function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}
function record(payload) {
  if (logPath) fs.appendFileSync(logPath, JSON.stringify(payload) + "\\n");
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    write({ id: message.id, result: { userAgent: "fake-codex", codexHome: process.env.HOME, platformFamily: "unix", platformOs: "test" } });
    return;
  }
  if (message.method === "thread/start") {
    record({ method: "thread/start" });
    write({ id: message.id, result: { thread: { id: fixedThreadId } } });
    return;
  }
  if (message.method === "thread/resume") {
    record({ method: "thread/resume", threadId: message.params.threadId });
    write({ id: message.id, result: { thread: { id: message.params.threadId } } });
    return;
  }
  if (message.method === "turn/start") {
    const turnId = "turn-" + nextTurn++;
    record({ method: "turn/start", threadId: message.params.threadId });
    write({ id: message.id, result: { turn: { id: turnId } } });
    setTimeout(() => {
      write({ method: "turn/completed", params: { threadId: message.params.threadId, turn: { id: turnId, status: "completed" } } });
    }, 50);
  }
});
`);
  await fs.chmod(scriptPath, 0o755);
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  process.env.OPENVIDE_CODEX_BIN = scriptPath;
  process.env.OPENVIDE_FAKE_CODEX_LOG = logPath;
  process.env.OPENVIDE_FAKE_CODEX_THREAD_ID = threadId;

  return {
    threadId,
    async calls() {
      const raw = await fs.readFile(logPath, "utf8").catch(() => "");
      return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    },
    restore() {
      process.env.PATH = originalPath;
      if (originalCodexBin == null) delete process.env.OPENVIDE_CODEX_BIN;
      else process.env.OPENVIDE_CODEX_BIN = originalCodexBin;
      if (originalLog == null) delete process.env.OPENVIDE_FAKE_CODEX_LOG;
      else process.env.OPENVIDE_FAKE_CODEX_LOG = originalLog;
      if (originalThreadId == null) delete process.env.OPENVIDE_FAKE_CODEX_THREAD_ID;
      else process.env.OPENVIDE_FAKE_CODEX_THREAD_ID = originalThreadId;
    },
  };
}

test("codex ask sessions use the app-server backend while auto sessions keep cli", async () => {
  await initState();

  const ask = sm.createSession("codex", testHome, undefined, undefined, undefined, "ask");
  const auto = sm.createSession("codex", testHome);

  assert.equal(ask.permissionMode, "ask");
  assert.equal(ask.executionBackend, "codex_app_server");
  assert.equal(auto.permissionMode, "auto");
  assert.equal(auto.executionBackend, "cli");
});

test("codex ask permission requests pause the session and approve_once resumes it", async () => {
  await initState();
  const runner = installPermissionRunner();
  const session = sm.createSession("codex", testHome, undefined, undefined, undefined, "ask");

  const send = sm.sendTurn(session.id, "run a command");

  assert.equal(send.ok, true);
  assert.equal(send.session.status, "awaiting_approval");
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0].turnOpts.permissionMode, "ask");

  const awaiting = sm.getSession(session.id);
  assert.equal(awaiting.status, "awaiting_approval");
  assert.equal(awaiting.pendingPermission.requestId, "approval-1");
  assert.equal(awaiting.pendingPermission.status, "pending");
  assert.equal(awaiting.pendingPermission.command, "echo test");
  assert.equal(awaiting.pendingPermission.options.length, 3);

  const catalogSessions = nativeHistory.mergeDiscoveredSessions({
    daemonSessions: [awaiting],
    nativeSessions: [],
  });
  assert.equal(catalogSessions[0].pendingPermission.requestId, "approval-1");
  assert.equal(catalogSessions[0].pendingPermission.status, "pending");

  const approved = await sm.respondToPermission(session.id, "approval-1", "approve_once");

  assert.equal(approved.ok, true);
  assert.deepEqual(runner.decisions, ["approve_once"]);
  assert.equal(approved.session.status, "running");
  assert.equal(approved.session.pendingPermission.status, "approved");

  runner.finish();
  const finished = sm.getSession(session.id);
  assert.equal(finished.status, "idle");
  assert.equal(finished.conversationId, "thread-test");
  assert.equal(finished.pendingPermission.status, "approved");
});

test("codex ask permission rejection marks the pending request rejected", async () => {
  await initState();
  const runner = installPermissionRunner(permissionRequest("approval-reject"));
  const session = sm.createSession("codex", testHome, undefined, undefined, undefined, "ask");
  sm.sendTurn(session.id, "run a command");

  const rejected = await sm.respondToPermission(session.id, "approval-reject", "reject");

  assert.equal(rejected.ok, true);
  assert.deepEqual(runner.decisions, ["reject"]);
  assert.equal(rejected.session.status, "running");
  assert.equal(rejected.session.pendingPermission.status, "rejected");
  runner.finish();
});

test("codex ask abort_run cancels the session", async () => {
  await initState();
  const runner = installPermissionRunner(permissionRequest("approval-abort"));
  const session = sm.createSession("codex", testHome, undefined, undefined, undefined, "ask");
  sm.sendTurn(session.id, "run a command");

  const aborted = await sm.respondToPermission(session.id, "approval-abort", "abort_run");

  assert.equal(aborted.ok, true);
  assert.deepEqual(runner.decisions, ["abort_run"]);
  assert.equal(aborted.session.status, "cancelled");
  assert.equal(aborted.session.pendingPermission.status, "cancelled");
  runner.finish({ exitCode: 1 });
});

test("codex ask app-server resumes stored thread before follow-up turns", async () => {
  await initState();
  const fakeCodex = await installFakeCodexAppServer();

  try {
    const session = sm.createSession("codex", testHome, undefined, undefined, undefined, "ask");

    const first = sm.sendTurn(session.id, "first turn");
    assert.equal(first.ok, true);
    const firstIdle = await sm.waitForIdle(session.id, 5000);
    assert.equal(firstIdle.ok, true);
    assert.equal(firstIdle.session.status, "idle");
    assert.equal(firstIdle.session.conversationId, fakeCodex.threadId);

    const second = sm.sendTurn(session.id, "second turn");
    assert.equal(second.ok, true);
    const secondIdle = await sm.waitForIdle(session.id, 5000);
    assert.equal(secondIdle.ok, true);
    assert.equal(secondIdle.session.status, "idle");
    assert.equal(secondIdle.session.conversationId, fakeCodex.threadId);

    const calls = await fakeCodex.calls();
    assert.deepEqual(calls.map((call) => call.method), [
      "thread/start",
      "turn/start",
      "thread/resume",
      "turn/start",
    ]);
    assert.equal(calls[2].threadId, fakeCodex.threadId);
    assert.equal(calls[3].threadId, fakeCodex.threadId);
  } finally {
    fakeCodex.restore();
  }
});
