# open-vide-g2

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/f3tch)

`open-vide-g2` is the browser/webview/glasses client for OpenVide.

Its canonical home is now this monorepo workspace at `apps/g2`.

This repo is the UI layer:

- browser/webview app
- glasses UI
- Even Hub / Even AI oriented settings and flows

The canonical backend is the shared `openvide-daemon` in this monorepo:

- monorepo root: `openvide/`
- canonical daemon: `apps/daemon`

If you are publishing or deploying this client, read the main OpenVide README first:

- https://github.com/open-vide/openvide

## What This Repo Adds

- webview-friendly session, workspace, host, team, and schedule UX
- glasses-specific navigation and compact rendering
- Even AI bridge configuration UI
- direct bridge host management
- browser-side secure persistence for bridge tokens and STT API keys
- automatic bridge session rotation for webview and glasses clients

## Production Architecture

```text
open-vide-g2 webview / glasses UI
  -> HTTPS / WebSocket bridge
  -> openvide-daemon (from the main openvide repo)
  -> Claude / Codex sessions, teams, schedules
```

Do not globally link `open-vide-g2/daemon` as your production daemon. The supported production backend is the daemon from the main OpenVide repo.

## Quick Start

From the monorepo root:

```bash
yarn install
yarn g2:dev
```

Or from this workspace directly:

```bash
cd apps/g2
yarn dev
```

The app expects a reachable `openvide-daemon` bridge host.

## Connect To A Daemon Host

On the machine running the canonical daemon:

```bash
cd apps/daemon
npm install -g .
openvide-daemon health
openvide-daemon bridge enable --port 7842
openvide-daemon bridge token --expire 24h
```

If you are deploying on your own VPS or server, prefer generating the host bundle from the canonical daemon repo instead of hand-writing the setup:

```bash
openvide-daemon deploy setup \
  --proxy caddy \
  --domain openvide.example.com \
  --email you@example.com \
  --daemon-user ubuntu \
  --issue-token
```

For a dry safety check before applying anything:

```bash
openvide-daemon deploy doctor --proxy caddy --domain openvide.example.com
```

If you only want the files without touching the machine:

```bash
openvide-daemon deploy scaffold --proxy caddy --domain openvide.example.com --output ./openvide-deploy
```

Then in `apps/g2`:

1. Open `Hosts`
2. Add the daemon bridge URL
3. Paste the pairing token from `openvide-daemon bridge token`
4. Select that host as active

`open-vide-g2` will exchange that pairing token for a short-lived access token plus a rotating refresh token automatically. The pairing token is not used for every request after that initial bridge session is established.

The expected URL is usually:

- `https://HOST:7842`

Use `http://` only for local development or when you are behind a trusted private tunnel and intentionally disabled TLS.

## Even AI Custom Agent Configuration

The daemon bridge exposes an OpenAI-compatible endpoint:

- `/v1/chat/completions`

Tool-specific endpoints are also available:

- `/v1/chat/completions/claude`
- `/v1/chat/completions/codex`

### Typical Even AI setup

In your Even AI custom agent configuration:

- base URL / endpoint: `https://HOST:7842/v1/chat/completions`
- API key: use the pairing/bootstrap JWT from `openvide-daemon bridge token`

Then in the `open-vide-g2` Settings screen, configure:

- `Even AI tool`
- `Session routing`
- optional pinned session
- default working directory

### Routing modes

- `Latest Session`: reuse the last bridge-created session for that tool when possible
- `Always New`: always create a new daemon session
- `Pinned Session`: always route to one specific daemon session

Notes:

- the bridge decides routing; the request body `model` is not the source of truth here
- if you want to hard-force a tool, use the tool-specific endpoint path

## Security Notes

### Browser-side storage

This repo now encrypts sensitive values at rest in the browser/webview:

- bridge bearer tokens
- STT API keys

Implementation details:

- AES-256-GCM via Web Crypto API
- non-extractable key stored in IndexedDB
- ciphertext persisted in localStorage
- older plaintext values are migrated on next save/load

This protects against casual localStorage inspection. It does not protect against same-origin JavaScript execution.

On macOS, Chromium/WebView hosts may show a one-time Keychain prompt for the app-specific `WebCrypto Master Key`. That prompt is expected. If you deny it, encrypted bridge tokens and STT keys stay on disk but may be unavailable until you reload and allow access again. The client now avoids destructive migration in that state.

### Bridge auth

The daemon bridge uses:

- HTTPS by default
- JWT Bearer auth for HTTP calls
- JWT query parameter for WebSocket auth

The WebSocket query parameter is necessary because browsers cannot set arbitrary headers on native WebSocket connections.

### TLS

The daemon generates a self-signed ECDSA certificate that includes:

- `localhost`
- `127.0.0.1`
- current hostname
- current non-internal IPv4 addresses

Important:

- it is still self-signed
- browsers/webviews must trust that certificate, or you should front the daemon with a reverse proxy that terminates TLS using a trusted certificate
- for public or semi-public deployments, a reverse proxy with a trusted certificate is the recommended setup
- if the daemon bridge certificate was generated before the newer SAN handling, rotate `~/.openvide-daemon/bridge/cert.pem` and `key.pem` once on the daemon host

## Teams

The UI surfaces daemon-owned team orchestration:

- team creation and editing
- team chat
- task board
- plan generation and review

Current source of truth is the daemon, not browser state.

## Schedules

The schedules screen manages daemon-owned cron jobs.

Schedules can target:

- a prompt run
- a team dispatch

Behavior to expect:

- `Run` fires immediately
- enabled schedules also fire on their cron expression
- scheduled runs are tagged and filtered separately from normal sessions

These are OpenVide schedules, not Claude native `/schedule` jobs.

## Current Known Limitations

Before you publish, be aware of these still-current gaps:

- some newly added webview/glasses strings still need full translation coverage
- some glasses mode/model controls are still not fully wired to daemon RPC
- browser deployments are safest behind a trusted TLS terminator rather than raw self-signed bridge exposure

## Development Notes

- `open-vide-g2/daemon` exists in this repo for local development history, but it is not the canonical globally installed daemon
- if you are testing end-to-end behavior, always verify which daemon binary your environment is actually using

Recommended production binary:

```bash
which openvide-daemon
# should resolve to the daemon from ../tools/openvide/apps/daemon
```

## Connecting to the Daemon

### Local Network (same WiFi)

```bash
npm install -g @openvide/daemon
openvide-daemon bridge enable --no-tls
openvide-daemon bridge token
```

Paste the Local URL + token into the app.

### Remote via Tailscale (Recommended)

1. Install Tailscale on your machine and phone
2. Login to the same account, enable HTTPS in tailnet admin
3. Start the daemon:

```bash
openvide-daemon bridge enable
openvide-daemon bridge token
```

Paste the Tailscale URL (`https://your-machine.tailXXXXX.ts.net:7842`) + token into the app. Works from anywhere with trusted HTTPS.

### Remote via Caddy + Domain

```bash
openvide-daemon bridge enable --no-tls
```

Then set up Caddy as reverse proxy with your domain. See the full guide in the [@openvide/daemon README](https://www.npmjs.com/package/@openvide/daemon).

## Build

```bash
yarn build
```

If you change shared `even-toolkit` code, rebuild and restart the dev server so the updated toolkit bundle is picked up.

## Support

If you find this useful, consider supporting the project:

[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://buymeacoffee.com/f3tch)
