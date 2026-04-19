import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DAEMON_CAPABILITIES, DAEMON_VERSION } from "../dist/buildInfo.js";
import { routeCommand } from "../dist/ipc.js";

test("health reports daemon identity metadata", async () => {
  const response = await routeCommand({ cmd: "health" });

  assert.equal(response.ok, true);
  assert.equal(response.version, DAEMON_VERSION);
  assert.equal(response.nodeVersion, process.version);
  assert.deepEqual(response.capabilities, DAEMON_CAPABILITIES);
  assert.equal(typeof response.pid, "number");
  assert.equal(typeof response.name, "string");
  assert.equal(typeof response.daemonPath, "string");
  assert.ok(path.isAbsolute(response.daemonPath));
  assert.equal(typeof response.activeSessions, "number");
  assert.equal(typeof response.totalSessions, "number");
  assert.equal(typeof response.tools, "object");
});
