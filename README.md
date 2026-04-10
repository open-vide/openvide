<p align="center">
  <img src="./logo.png" alt="OpenVide logo" width="120" />
</p>

<h1 align="center">OpenVide</h1>

<p align="center">
  <a href="https://buymeacoffee.com/f3tch"><img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee" alt="Buy Me A Coffee"></a>
</p>

<p align="center">
  Open source remote control for Claude Code, Codex, and team automation over SSH and an optional HTTPS bridge.
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.2.0-blue" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-iOS%20%7C%20Android-black" />
</p>

## Overview

This repository is the canonical OpenVide backend and mobile app:

- `apps/app`: the React Native app
- `apps/daemon`: the globally installed `openvide-daemon`

The daemon is the source of truth for:

- interactive Claude and Codex sessions
- workspace session history
- the optional HTTPS/WebSocket bridge
- Even AI compatible `/v1/chat/completions` routing
- team orchestration
- cron-based schedules

If you are using the `open-vide-g2` webview/glasses client, this repository is still the backend you should run in production.

## What OpenVide Does

- Connects to remote hosts over SSH from the RN app
- Persists AI CLI sessions on the host
- Streams output live and preserves session history
- Exposes an optional HTTPS bridge for browser/webview clients
- Provides an OpenAI-compatible bridge endpoint for Even AI custom agents
- Supports team chat, planning, task orchestration, and automated review
- Supports daemon-owned scheduled jobs that can target a prompt session or a team

## Repo Layout

```text
openvide/
  apps/
    app/              Expo / React Native app
    daemon/           openvide-daemon (canonical shared backend)
    bridge/           legacy bridge package artifacts; bridge now lives in daemon
  docs/
```

## Architecture

### RN app path

```text
RN app
  -> SSH command execution
  -> openvide-daemon CLI
  -> local daemon IPC socket
  -> daemon-managed Claude/Codex process
```

### Browser / webview / glasses path

```text
Browser or webview
  -> HTTPS + WebSocket bridge
  -> openvide-daemon
  -> daemon-managed Claude/Codex process
```

### Even AI path

```text
Even AI custom agent
  -> /v1/chat/completions
  -> openvide-daemon bridge routing
  -> existing or new daemon session
  -> Claude/Codex response wrapped in OpenAI-compatible format
```

## Security Model

### SSH mode

When you use the RN app over SSH, the daemon does not need an exposed network port. The app executes `openvide-daemon` commands over SSH and the daemon communicates locally over its Unix socket.

### Bridge mode

The bridge is optional. When enabled:

- pairing/bootstrap tokens are JWT Bearer tokens signed with a daemon-local HMAC secret
- browser/webview clients can exchange that pairing token for a rotating bridge session:
  - short-lived access token
  - long-lived refresh token
  - refresh token rotates on every renewal
- legacy static bridge tokens still work for compatibility
- bridge tokens can be revoked by JTI
- WebSocket auth uses the same access token in the query string because browsers cannot set custom WS headers

### TLS

Bridge TLS is enabled by default.

- the daemon generates a self-signed ECDSA certificate on first run
- the generated certificate now includes SANs for:
  - `localhost`
  - `127.0.0.1`
  - current hostname
  - current non-internal IPv4 addresses

Important:

- the certificate is still self-signed
- for browsers/webviews on LAN, the client must trust that certificate or you should front the bridge with a reverse proxy that provides a publicly trusted certificate
- `openvide-daemon bridge enable --no-tls` is only appropriate for local development or a private tunnel; do not expose plain HTTP directly on an untrusted network
- if you generated bridge certs before this version, rotate `~/.openvide-daemon/bridge/cert.pem` and `key.pem` once so the new SAN coverage is applied

### Secrets at rest

On the host:

- daemon state is written under `~/.openvide-daemon/`
- the daemon state file is saved with restrictive permissions
- the bridge private key is saved with restrictive permissions
- cached Claude auth fallback is stored with restrictive permissions

This repository does not commit host secrets. User-specific app config, EAS config, Firebase config, and daemon runtime state are gitignored.

## Quick Start

```bash
git clone https://github.com/open-vide/openvide.git
cd openvide
yarn install
```

### Build and install the daemon

```bash
yarn daemon:build
cd apps/daemon
npm install -g .
openvide-daemon health
```

`openvide-daemon health` auto-starts the daemon if needed.

For `systemd`, `launchd`, or another service manager, use the foreground mode instead:

```bash
openvide-daemon run
```

### Build the RN app

See the Expo / variant setup below, then:

```bash
cd apps/app
yarn prebuild:clean
yarn ios
```

or use EAS:

```bash
cd apps/app
yarn build:preview
yarn build:prod
yarn update:preview
yarn update:prod
```

## RN App Setup

### 1. Variant configs

```bash
cd apps/app
cp variants/production/config.example.json variants/production/config.json
cp variants/development/config.example.json variants/development/config.json
```

Edit each `config.json` with your bundle IDs and display settings.

### 2. Environment file

```bash
cp apps/app/.env.example apps/app/.env
```

### 3. EAS project link

```bash
cd apps/app
eas init
```

`apps/app/app.json` is intentionally gitignored because it contains your personal Expo project wiring.

### 4. Optional push notifications

Android push requires Firebase config. iOS push requires a paid Apple Developer account and `ENABLE_PUSH_NOTIFICATIONS=1`.

## Bridge Setup

Enable the bridge on the machine running the daemon:

```bash
openvide-daemon bridge enable --port 7842
openvide-daemon bridge status
openvide-daemon bridge token --expire 24h
```

Useful bridge commands:

```bash
openvide-daemon bridge enable [--port 7842] [--no-tls]
openvide-daemon bridge disable
openvide-daemon bridge status
openvide-daemon bridge token [--expire 24h]
openvide-daemon bridge revoke --jti <token-jti>
openvide-daemon bridge qr [--expire 24h] [--host <host>]
openvide-daemon bridge config \
  --bind-host 127.0.0.1 \
  --default-cwd /Users/fabiogalimberti/Desktop/git \
  --even-ai-tool codex \
  --even-ai-mode last
```

`openvide-daemon bridge token` now acts as a pairing/bootstrap token for webview/glasses clients. The browser client exchanges it for rotating access + refresh bridge credentials automatically.

## Self-Host Bootstrap

If you want to run OpenVide on your own VPS or server, the easiest path is now:

1. check the host
2. run the guided setup
3. copy the final token into the clients

### 1. Check the VPS

```bash
openvide-daemon deploy doctor \
  --proxy caddy \
  --domain openvide.example.com
```

This reports:

- whether `systemd` is available
- whether `caddy`/`nginx` is installed
- whether the domain resolves
- where the deployment bundle will be written

### 2. Apply the setup

```bash
openvide-daemon deploy setup \
  --proxy caddy \
  --domain openvide.example.com \
  --email you@example.com \
  --output ./openvide-deploy \
  --daemon-user ubuntu \
  --default-cwd /srv/openvide \
  --even-ai-tool codex \
  --even-ai-mode last \
  --issue-token
```

The setup command:

- generates the deployment bundle
- installs the `systemd` unit
- enables and starts the daemon service
- installs or updates the proxy config
- configures the daemon bridge with secure defaults
- optionally issues a client token

### 3. If you only want the files without touching the machine

Use scaffold mode:

```bash
openvide-daemon deploy scaffold \
  --proxy caddy \
  --domain openvide.example.com \
  --email you@example.com \
  --output ./openvide-deploy \
  --default-cwd /srv/openvide \
  --even-ai-tool codex \
  --even-ai-mode last
```

The scaffold includes:

- a `systemd` unit for `openvide-daemon run`
- a bridge bootstrap script
- a Caddy or nginx reverse-proxy config
- a host-specific `README.md` with install steps

Recommended production topology:

```text
browser / webview / Even AI
  -> trusted HTTPS domain
  -> reverse proxy (Caddy/nginx)
  -> openvide-daemon bridge bound to 127.0.0.1
```

For proxy-backed deployments, the generated bootstrap configures:

```bash
openvide-daemon bridge enable --port 7842 --no-tls
openvide-daemon bridge config --bind-host 127.0.0.1
```

That keeps:

- public TLS at the proxy layer
- the raw daemon bridge on loopback only
- JWT bridge auth still enabled

### Recommended “for dummies” recipe

If you have:

- one Linux VPS
- one domain pointed to that VPS
- ports `80` and `443` reachable

then this is the shortest useful path:

```bash
npm install -g @openvide/daemon
openvide-daemon deploy doctor --proxy caddy --domain openvide.example.com
openvide-daemon deploy setup --proxy caddy --domain openvide.example.com --email you@example.com --daemon-user ubuntu --issue-token
```

Then use:

- `https://openvide.example.com` as the host in `open-vide-g2`
- the returned token as the bridge token / Even AI API key

## Even AI Custom Agent Integration

The bridge exposes OpenAI-compatible endpoints:

- `POST /v1/chat/completions`
- `POST /v1/chat/completions/claude`
- `POST /v1/chat/completions/codex`
- `POST /v1/chat/completions/gemini`

### Recommended Even AI config

Use:

- endpoint: `https://YOUR_HOST:7842/v1/chat/completions`
- API key / bearer token: output of `openvide-daemon bridge token`

Bridge routing is controlled by daemon config:

- `evenAiTool`: default tool when using the base `/v1/chat/completions`
- `evenAiMode=new`: always create a fresh daemon session
- `evenAiMode=last`: reuse the last bridge-created session for that tool when possible
- `evenAiMode=pinned`: always route to a specific session ID

Notes:

- the request body `model` field is not the routing source of truth here
- path suffix or bridge config decides the tool
- scheduled sessions and team-owned sessions are intentionally filtered out of the normal interactive session lists in browser clients

## Teams

Teams are daemon-owned orchestration objects with:

- a member roster
- persistent member sessions
- team chat
- plan history
- task board

Current intended behavior:

- user messages to `Team` go to the coordinator
- direct messages to a member go only to that member
- plans create structured tasks
- task execution and review can advance automatically
- team member sessions are tagged as `runKind: "team"`

## Schedules

Schedules are OpenVide-owned cron jobs, not Claude native `/schedule` jobs.

Each schedule can target:

- a prompt run
- a team dispatch

Important behavior:

- manual `Run` fires immediately
- cron execution fires on its matching schedule
- prompt schedules create tagged `runKind: "scheduled"` sessions
- team schedules dispatch into team orchestration instead of creating a normal interactive session

## CLI Reference

```bash
openvide-daemon version
openvide-daemon health
openvide-daemon stop

openvide-daemon session create --tool <claude|codex|gemini> --cwd <path>
openvide-daemon session send --id <id> --prompt <prompt>
openvide-daemon session stream --id <id> --follow
openvide-daemon session list
openvide-daemon session list-workspace --cwd <path>
openvide-daemon session history --id <id>
openvide-daemon session remove --id <id>

openvide-daemon bridge enable
openvide-daemon bridge token
openvide-daemon bridge qr
openvide-daemon bridge config ...

openvide-daemon schedule list
openvide-daemon schedule create ...
openvide-daemon schedule update ...
openvide-daemon schedule run --task-id <id>
openvide-daemon schedule delete --id <id>

openvide-daemon team list
openvide-daemon team get --id <id>
openvide-daemon team create ...
openvide-daemon team update ...
openvide-daemon team delete --id <id>
openvide-daemon team task list --team-id <id>
openvide-daemon team task create ...
openvide-daemon team message list --team-id <id>
openvide-daemon team plan latest --team-id <id>
```

## Open Source Safety

Safe to publish:

- source code
- bridge / daemon implementation
- example Expo config
- example variant config

Do not commit:

- `apps/app/app.json`
- `apps/app/google-services.json`
- `apps/app/google-play-service-account.json`
- `apps/app/.env`
- `apps/app/variants/*/config.json`
- anything under `~/.openvide-daemon/`

## Known Gaps To Keep In Mind

These are product-level limitations to remember during rollout:

- Claude native `/schedule` integration is not used; schedules are daemon-owned
- some newer webview/glasses labels still need translation coverage
- some glasses mode/model controls are still visual-only and not fully wired to RPC
- browser clients work best with a trusted bridge certificate or a reverse proxy terminating TLS

## Troubleshooting

### Bridge works locally but browser/webview rejects TLS

That is expected with a self-signed certificate unless:

- you trust the generated certificate on the client, or
- you place the daemon behind a reverse proxy with a trusted certificate

### Claude works in Terminal but fails in daemon

The daemon may be using cached auth fallback when Keychain access is unavailable. Restart the daemon from a local GUI terminal once so it can refresh its cached Claude credential.

### EAS build fails on missing config

You likely have not created your local `variants/*/config.json` or Expo `app.json`.
