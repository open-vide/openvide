# CLAUDE.md

## Project
React Native mobile app (Expo SDK 52, React 18.3, RN 0.76) managing AI CLI tools
(Claude Code, OpenAI Codex, Google Gemini CLI) on remote machines over SSH.

## How It Works: App ↔ Daemon Relay

The app does not talk to CLI tools directly. A lightweight **daemon** (`openvide-daemon`)
runs persistently on each remote machine, acting as a relay between the mobile app and
the AI CLI tools. This decouples the app from the SSH connection — sessions survive
network drops, app backgrounding, and reconnections.

### Data Flow
```
Mobile App → SSH exec → openvide-daemon CLI → Unix socket IPC → Daemon process
                                                                   ↓
                                                             spawns CLI tool
                                                          (claude / codex / gemini)
                                                                   ↓
                                                          stdout/stderr captured
                                                          line-by-line → output.jsonl
                                                                   ↓
App ← SSH stdout ← openvide-daemon session stream --follow ← tails output.jsonl
```

### Daemon (service/)
- **Zero-dependency** Node.js process, installed globally via `npm install -g openvide-daemon`.
- Self-daemonizes: the CLI auto-starts the daemon on first use (`ensureDaemon()`).
- Lives at `~/.openvide-daemon/` on the remote machine:
  - `daemon.pid` — PID file, touched every 30s as heartbeat (stale after 60s).
  - `daemon.sock` — Unix domain socket for newline-delimited JSON IPC.
  - `daemon.log` — daemon stdout/stderr.
  - `state.json` — all session records (atomic writes via rename).
  - `sessions/<id>/output.jsonl` — captured CLI output per session.
- **No HTTP server or open ports.** All app→daemon communication is via CLI commands
  executed over SSH. The daemon listens only on a local Unix socket.

### IPC Commands
| Command | Description |
|---------|-------------|
| `session.create` | Create session record + output dir |
| `session.send` | Spawn CLI tool process, begin capturing output |
| `session.stream --follow` | Tail output.jsonl via fs.watch (bypasses IPC, reads file directly) |
| `session.cancel` | SIGINT → 3s grace → SIGTERM |
| `session.get/list/remove` | CRUD on session records |
| `health` | PID, session counts |
| `stop` | Graceful shutdown (SIGTERM children → SIGKILL after 5s) |

### Output Format (output.jsonl)
Each line is one of three types:
- `{ t: "o", ts, line }` — stdout line from CLI tool (raw JSON)
- `{ t: "e", ts, line }` — stderr line
- `{ t: "m", ts, event, ... }` — meta: `turn_start`, `turn_end` (with exitCode), `error`

### App-Side Transport (DaemonTransport.ts)
Runs `openvide-daemon <cmd>` over SSH via `NativeSshClient.runCommand()`.
Tracks `daemonOutputOffset` per session so incremental reads never miss or
duplicate output. For streaming, runs `session stream --follow` over SSH and
parses each JSONL line through the tool-specific adapter.

### Session Lifecycle
1. **Install**: App runs `npm install -g openvide-daemon` over SSH (HostDetailScreen).
2. **Detect**: App runs `openvide-daemon version` during CLI detection (cliDetection.ts).
3. **Create**: `DaemonTransport.createSession()` → daemon creates record + output dir.
4. **Turn**: `DaemonTransport.sendTurn()` → daemon spawns CLI tool, captures output.
5. **Stream**: `DaemonTransport.streamOutput()` → tails output.jsonl over SSH, feeds
   lines to adapter → `CliStreamEvent[]` → `SessionEngine.processEvent()` → UI.
6. **Multi-turn**: `conversationId` extracted from CLI output (Claude: `session_id`,
   Codex: `thread_id`). Passed as `--resume` / `exec resume` on subsequent turns.
   Gemini injects history into prompt via `<previous_conversation>` tags.
7. **Reconnect**: `importDaemonSessions()` lists daemon sessions, imports any
   untracked ones with their current `outputLines` offset.

### Command Building (commandBuilder.ts)
- **Claude**: `claude -p '<prompt>' --output-format stream-json --verbose [--resume <id>]`
- **Codex**: `codex exec '<prompt>' --json --full-auto` (or `codex exec resume '<id>' '<prompt>'`)
- **Gemini**: `gemini -p '<prompt>' --output-format json -y`

### Environment (processRunner.ts)
Spawned CLI processes get an augmented PATH (`~/.local/bin`, `~/.cargo/bin`,
`~/.bun/bin`, `/opt/homebrew/bin`, etc.) and `CLAUDECODE` is removed from env
to prevent Claude Code from refusing to start inside the daemon's process tree.

## Architecture (App)
- **Styling**: NativeWind 4.1 (Tailwind CSS) — all UI uses className with cn() utility
  from src/lib/utils.ts (clsx + tailwind-merge). Colors defined in tailwind.config.js.
  Programmatic colors via src/constants/colors.ts for Navigation API / prop values.
- **State**: React Context (AppStoreContext.tsx) + useAppStore(). Persisted via
  AsyncStorage (non-sensitive) + expo-secure-store (SSH credentials).
  Schema versioned (PersistedState.version) with migration in storage.ts.
- **SSH**: NativeSshClient wraps @dylankenneally/react-native-ssh-sftp. Persistent
  shell per target, marker-based command completion detection.
- **AI Sessions**: SessionEngine manages multi-turn conversations. Adapters translate
  CLI JSON → unified CliStreamEvent protocol. Per-session parse context (no global state).
- **Navigation**: React Navigation v7, bottom tabs (Sessions/Hosts/Settings), modal stack.
- **Error Handling**: ErrorBoundary wraps NavigationContainer in App.tsx.

## Conventions
- Styling: Always use className with Tailwind utilities. Use cn() for conditional classes.
  Never use StyleSheet.create. Use colors from tailwind.config.js theme.
- IDs: newId(prefix) → prefix_<random> (core/id.ts)
- Logging: [OV:module] prefix format
- SSH: Commands wrapped with begin/end markers for output capture
- Adapters: Streaming (Claude, Codex) parse line-by-line with context param;
  batch (Gemini) parse complete blob. All adapters use typeof guards for null safety.
- Components: Performance-critical components wrapped in React.memo
  (AiMessageBubble, SessionCard, HostCard, AiContentBlockView)
- Prompt Templates: Built-in prompts in core/builtInPrompts.ts, user templates persisted.
  Merged at render time in AppStoreContext. PromptLibraryScreen for CRUD.
- Markdown: AI text blocks rendered via react-native-markdown-display with dark theme.

## Design Guidelines
- **Press feedback**: All Pressable buttons must include `active:opacity-80`.
- **Icon buttons**: Use fixed-size circles, never padding-based sizing.
  - Modal dismiss (X): `w-10 h-10 rounded-full bg-muted items-center justify-center active:opacity-80`
  - Header actions (+, etc.): `w-9 h-9 rounded-full bg-muted items-center justify-center active:opacity-80`
- **Selector buttons** (e.g., auth method): `flex-1` for equal-width distribution,
  `px-4 py-4 items-center` for tappable height, `border-2 border-accent` for selected state.
- **Primary action buttons**: `bg-accent rounded-full py-4 items-center` full-width pill.
- **Text inputs**: `bg-muted rounded-2xl p-3.5 text-foreground text-[16px]`.
- **Section labels**: `text-foreground text-[15px] font-bold mt-1`.
- **Subdued/dismiss buttons**: `bg-muted` background (not accent). Accent color reserved
  for primary actions and selected states.

## File Map
service/              — openvide-daemon (relay process, runs on remote machines)
  src/
    cli.ts            — CLI subcommand router (entry point)
    daemon.ts         — Lifecycle: PID file, heartbeat, self-daemonize, shutdown
    ipc.ts            — Unix socket IPC server + client
    sessionManager.ts — Session CRUD, turn orchestration, process tracking
    processRunner.ts  — Spawns CLI tools, captures stdout/stderr → output.jsonl
    commandBuilder.ts — Builds tool-specific shell commands (claude/codex/gemini)
    outputStore.ts    — JSONL append, read-from-offset, tail-with-follow
    stateStore.ts     — JSON state persistence (atomic write via rename)
    types.ts          — SessionRecord, OutputLine, IpcRequest/Response
    utils.ts          — newId, escapeShellArg, daemonDir (~/.openvide-daemon), logging
src/
  components/         — 20 reusable components (NativeWind styled)
    ErrorBoundary.tsx — Class component error boundary
  constants/          — colors.ts (programmatic color access)
  core/               — Business logic, types, adapters, SSH, engines
  core/ai/            — SessionEngine, DaemonTransport, 3 CLI adapter implementations
  core/builtInPrompts.ts — Default prompt templates
  lib/                — utils.ts (cn function)
  navigation/         — React Navigation setup
  screens/            — 10 screen components (NativeWind styled)
    PromptLibraryScreen.tsx — Template CRUD with SectionList
  state/              — Context provider, storage (versioned), secure store
  theme.ts            — @standards/ui-core theme definition

## Build & Run
yarn start       # Expo dev server
yarn ios         # iOS simulator
yarn android     # Android emulator
yarn check       # TypeScript (tsc --noEmit)

# Daemon (run on the remote machine or locally for dev)
cd service && npm run build        # Compile TS → dist/
cd service && npm install -g .     # Install globally as `openvide-daemon`
openvide-daemon health             # Auto-starts daemon, returns status
