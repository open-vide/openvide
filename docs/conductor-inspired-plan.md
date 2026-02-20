# Conductor-Inspired Plan (Direct SSH Variant)

This plan uses workflow inspiration only. No branding/assets are copied.

## Observed pattern -> UX value -> V2 implementation

| Observed pattern (Conductor) | Why it improves UX | V2 implementation |
|---|---|---|
| Structured operational timeline | Fast understanding of state | Parsed timeline drives run UI; raw logs are secondary fallback |
| Explicit multi-step progression | Reduces ambiguity | CLI and readiness scripts emit deterministic `STEP x/y` markers |
| Actionable failure context | Faster recovery | Parser extracts `nextActions` from common failure lines |
| Persistent run visibility | Better trust/debugging | Runs persist locally; per-target run history available |
| One place to execute + inspect | Lower cognitive load | Target detail links into tools manager, console, and run detail |

## Parity matrix

## Must implement now
- SSH target CRUD in app.
- Readiness detection per target.
- Claude/Codex/Gemini install/update/verify/uninstall/configure.
- Direct SSH command execution with live stdout/stderr streaming.
- Run cancel/timeout handling.
- Parsed timeline + raw log fallback.

## Nice to have next
- Multi-session tabs per target.
- Automatic rerun with remediation steps.
- Background completion notifications.
- Offline export of run bundles.

## Out of scope
- HTTP backend/API server.
- WebSocket transport.
- Multi-user backend auth model.
- Copying Conductor visual branding.

## Source links used
- [Conductor docs](https://conductor.build/docs)
- [Conductor how it works](https://conductor.build/#how-it-works)
