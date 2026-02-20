# Relay CLI Proposal

> This document describes a future feature. It is NOT implemented yet.

## Overview

A forked/adapted version of [claude-relay](https://github.com/chadbyte/claude-relay) that runs on your machine/VPS. It:
- Generates QR codes for SSH private keys (scan to add hosts in-app)
- Relays AI session streams over WebSocket (supports Claude, Codex, Gemini)
- Sends WebSocket push notifications when tasks/responses complete
- Syncs missed chat content when the mobile app reconnects
- **Cross-platform**: macOS, Linux, Windows

## Part 1: Relay Server

### Directory structure

```
relay/
  package.json
  tsconfig.json
  src/
    index.ts              # Entry: starts HTTP + WS server
    server.ts             # HTTP server (health, QR endpoints)
    ws-server.ts          # WebSocket: client connections, auth, routing
    session-manager.ts    # Active sessions per project
    cli-bridge.ts         # Generalized CLI bridge (marker-based, like SessionEngine)
    adapters/
      adapter-types.ts    # Shared adapter interface (port of mobile's adapterTypes.ts)
      claude-adapter.ts   # Drives `claude` CLI
      codex-adapter.ts    # Drives `codex` CLI
      gemini-adapter.ts   # Drives `gemini` CLI
    process-executor.ts   # Cross-platform local process execution (child_process.spawn)
    ssh-executor.ts       # Remote SSH execution (ssh2)
    protocol.ts           # WebSocket message types (shared with mobile)
    project.ts            # Multi-project management (slug routing)
    session-store.ts      # JSONL session persistence
    qr-generator.ts       # QR code for SSH keys + host info
    reconnect.ts          # Track client cursors, replay missed messages
    notifications.ts      # WebSocket push notifications
    config.ts             # Server configuration (os.homedir() for cross-platform)
    utils.ts
```

### Cross-platform compatibility

- **No Unix-only APIs**: `path.join()` / `os.homedir()` everywhere
- **Config storage**: `~/.remote-dev-tool-relay/` (macOS/Linux), `%APPDATA%\remote-dev-tool-relay\` (Windows)
- **Process execution**: `child_process.spawn()` with `shell: true` on Windows. `process-executor.ts` normalizes across platforms
- **CLI detection**: `which` npm package (cross-platform)
- **Line endings**: Handle `\n` and `\r\n`
- **No native deps**: Pure-JS only (`ws`, `ssh2`, `qrcode`)
- **Install**: `npm install -g remote-dev-tool-relay`
- **CI**: GitHub Actions matrix (macOS, Ubuntu, Windows)

### Generalized CLI Bridge

Port mobile app's adapter pattern server-side:
- Mirror `CliAdapter` from `src/core/ai/adapterTypes.ts`
- Port adapters from `src/core/ai/adapters/` (claude, codex, gemini)
- Use `ssh2` (Node.js) instead of `@dylankenneally/react-native-ssh-sftp`
- Same marker-based output capture as `SessionEngine.executeTurn()`

### WebSocket protocol

```typescript
// Server -> Client
| { type: "session:event"; sessionId: string; event: CliStreamEvent; seq: number }
| { type: "session:status"; sessionId: string; status: AiSessionStatus }
| { type: "session:turn_complete"; sessionId: string; turn: AiTurn }
| { type: "notification"; sessionId: string; title: string; body: string }
| { type: "reconnect:replay_start"; fromSeq: number; toSeq: number }
| { type: "reconnect:replay_end" }

// Client -> Server
| { type: "session:create"; tool: ToolName; targetId: string; model?: string }
| { type: "session:prompt"; sessionId: string; prompt: string }
| { type: "session:cancel"; sessionId: string }
| { type: "reconnect"; lastSeq: number }
```

Every event has a monotonic `seq` number. On reconnect, client sends `lastSeq`, server replays missed events.

### Reconnect sync

Circular buffer of last 10,000 events per session. Replay on reconnect.

### QR code generation

`GET /api/qr/:targetId` -> PNG QR containing `{ version, label, host, port, username, authMethod, privateKey, relayUrl }`. Optionally AES-256-GCM encrypted.

### Session persistence

JSONL: `~/.remote-dev-tool-relay/sessions/<slug>/<sessionId>.jsonl`

### Dependencies
- `ssh2`, `ws`, `qrcode`, `typescript` (all pure JS)

## Part 2: Mobile App - Relay Integration

### New files
- `src/core/relay/RelaySessionEngine.ts` - Same API as SessionEngine, WebSocket-based
- `src/core/relay/RelayWebSocket.ts` - WebSocket transport with reconnect + AppState awareness
- `src/core/relay/protocol.ts` - Shared WS message types
- `src/screens/QrScannerScreen.tsx` - Camera QR scanner -> adds host

### Modified files
- `src/core/types.ts` - Add `connectionMode?: "ssh" | "relay"`, `relayUrl?: string` to TargetProfile
- `src/state/AppStoreContext.tsx` - Dual engine (SSH vs relay), foreground reconnect
- `src/navigation/types.ts` - QrScanner route
- `src/navigation/MainNavigator.tsx` - Register QrScannerScreen
- `src/screens/AddHostSheet.tsx` - "Scan QR" button
- `src/screens/HostDetailScreen.tsx` - Connection mode toggle
- `src/screens/SettingsScreen.tsx` - Relay settings

## Part 3: Polish
- WebSocket notifications (foreground toast / background local notification)
- Error states (unreachable relay, WS drops, QR scan failure)
- Performance (throttle UI updates, no memory leaks)
