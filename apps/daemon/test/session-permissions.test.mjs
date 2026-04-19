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
