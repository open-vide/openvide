# Relay Stability and Session Resume Improvements

This document defines a concrete plan to improve reliability of the current app + daemon system, with focus on:

- relay/session stability
- consistent chat visibility when switching between mobile app and remote terminal
- safer resume behavior for Claude/Codex sessions

## Scope

Applies to current architecture:

- app: `apps/app`
- daemon: `apps/daemon`
- native history merge logic: `apps/daemon/src/nativeHistory`

## Current pain points

1. Existing chats are sometimes missing in workspace view even when `codex --resume` or `claude -r` shows them.
2. Streaming can fail or appear stuck after entering an existing session.
3. Session behavior is inconsistent when the same conversation is also active in a terminal on the remote host.
4. Resume metadata and context/progress can become inaccurate.

## Reliability goals

1. Workspace list is the same set a user sees from CLI resume lists (after normalization and dedupe).
2. Entering an existing session always loads prior messages first, then live updates.
3. Reconnect/reopen never loses stream continuity (replay from cursor/offset).
4. One active writer per conversation; additional clients are explicit read-only followers.
5. Failures are observable and debuggable from logs/metrics.

## Phase 1: Canonical Session Identity (must-do first)

Define one canonical identity used by app + daemon:

- `sessionKey = <tool>::<normalizedWorkspace>::<resumeId>`
- `resumeId` must map to real CLI conversation id when available.

Implementation steps:

1. Keep `normalizeWorkspacePath()` as the single normalization path.
2. Ensure all session list and merge code uses the same normalized path before compare.
3. Persist mapping `{ daemonSessionId -> sessionKey -> resumeId }` in daemon state.
4. Reject creation of duplicate daemon records for same `sessionKey` unless explicitly forced.

Expected outcome:

- no ghost duplicates
- stable dedupe across daemon sessions and native history sessions

## Phase 2: Deterministic Workspace Sync Flow

When workspace screen opens:

1. Fetch daemon sessions for workspace.
2. Fetch native history sessions for workspace.
3. Merge by canonical key.
4. Return list with explicit `origin`, `status`, `updatedAt`, `messageCount`, `hasLiveProcess`.

Hard requirements:

1. `pull-to-refresh` runs the same merge pipeline.
2. Screen auto-refreshes on app foreground and after session send completion.
3. Merge is idempotent (same inputs, same output order).
4. Sorting always uses server timestamp (`updatedAt`) and clear tie-breaker (`createdAt`, `id`).

## Phase 3: Attach/Resume Protocol (terminal + app coexistence)

Add explicit attach modes:

1. `read_only_follow`: allowed when session already has an external writer.
2. `writer`: exclusive; requires lock acquisition.

Rules:

1. If session is active in terminal, app enters `read_only_follow` by default and shows banner.
2. Sending a prompt requires writer lease; if not available, app prompts user:
   - create new turn in same conversation via resume id, or
   - stay read-only.
3. Lease has heartbeat + timeout so crashes do not leave stale locks.

## Phase 4: Stream Durability and Replay

Treat stream as durable log, not transient socket text.

Implementation steps:

1. Write all output chunks to append-only per-session log with monotonic `seq`.
2. App stores `lastSeenSeq` per open session.
3. On reconnect, app requests replay from `lastSeenSeq + 1`.
4. Include heartbeat events to detect dead streams quickly.
5. Replay path must be idempotent (dedupe by `seq` on client).

This removes "blank session after reopen" and most reconnect race issues.

## Phase 5: Previous Message Loading

When user opens any existing session:

1. Load transcript snapshot from daemon/native history immediately.
2. Render messages before starting live stream subscription.
3. After snapshot render, subscribe and replay from last message sequence.

Rules:

1. Snapshot loading failure must not block live attach.
2. If parser fails, fallback to raw timeline with stable formatting.

## Phase 6: Environment and Process Safety

For child CLI processes (Claude/Codex):

1. Build a strict allowlist environment for spawned process.
2. Explicitly remove nested-session markers (for example `CLAUDECODE`) unless intentionally needed for same process mode.
3. Preserve only required auth/config vars.
4. Record sanitized launch config in logs (never secrets).

This prevents nested-session launch errors while keeping process behavior deterministic.

## Phase 7: Context/Progress Accuracy

Do not infer context from log byte size.

Steps:

1. Prefer tool-provided usage metadata (tokens/context remaining).
2. If unavailable, show `unknown` instead of fake precision.
3. Keep one adapter-normalized context schema for Claude/Codex.
4. Render confidence label (`exact`, `estimated`, `unknown`) next to context UI.

## Phase 8: Observability and Debuggability

Add structured logs and basic metrics:

1. `session_key`, `resume_id`, `daemon_session_id`, `workspace`, `host_id` on every event.
2. Counters:
   - attach failures
   - replay count
   - missing-in-merge count
   - stream interruption count
3. Per-session event timeline endpoint for support/debug UI.

## Testing Matrix (required before rollout)

1. Open workspace with 100+ historical sessions; verify list parity with CLI resume list.
2. Start session in terminal, attach from app, verify read-only follow.
3. Acquire writer in app while terminal active; verify lock behavior and prompts.
4. Kill network while streaming, reconnect, verify replay has no gaps or duplicates.
5. Restart daemon mid-session; verify recovery state and interrupted marker.
6. Open same session on two app clients; verify one writer + one follower behavior.
7. Validate both Claude and Codex flows.

## Rollout Plan

1. Week 1 (quick wins):
   - canonical key enforcement
   - deterministic workspace merge
   - snapshot-then-stream chat opening
2. Week 2:
   - replay cursor + append-only stream sequencing
   - writer lease + read-only follow mode
3. Week 3:
   - context metadata normalization
   - metrics + debug timeline
4. Week 4:
   - stress testing, bug fixes, release hardening

## Operational Best Practices

1. Run daemon as managed service (`launchd`/`systemd`) with auto-restart.
2. Pin daemon + CLI versions per host and expose compatibility in health endpoint.
3. Keep workspace root explicit and stable (avoid symlink ambiguity where possible).
4. Never rely on in-memory-only state for active sessions; persist state changes eagerly.
5. Keep a manual "reconcile workspace" action for support/debug even with auto-refresh.
6. Use UTC ISO timestamps everywhere and convert only in UI.

## Definition of Done

1. User sees same session set as CLI resume list for selected workspace.
2. Opening an old session always shows prior messages before live updates.
3. Reconnects do not lose stream content.
4. Concurrent app/terminal usage is explicit and safe (writer/follower model).
5. Debug logs can explain any missing-chat report within minutes.
