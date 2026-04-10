# @openvide/daemon

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/f3tch)

Background session manager for AI CLI tools (Claude Code, Codex, Gemini) with HTTP bridge, WebSocket streaming, and Tailscale HTTPS support.

## Install

```bash
npm install -g @openvide/daemon
```

Requires Node.js 18+ and at least one AI CLI tool installed.

## Quick Start

```bash
# 1. Start the daemon and enable the bridge
openvide-daemon bridge enable

# 2. Get connection URL and token
openvide-daemon bridge token

# 3. Copy the URL + token into the OpenVide app on your phone
```

The bridge auto-detects your network and prints the best URL to use.

---

## Connection Methods

### Local Network (same WiFi)

No extra setup. The bridge listens on your LAN IP.

```bash
openvide-daemon bridge enable --no-tls
openvide-daemon bridge token
```

Output:
```
Local: http://192.168.1.61:7842
```

In the OpenVide app: paste the Local URL + token.

### Remote via Tailscale (Recommended)

Tailscale creates a private encrypted tunnel between your devices. No domain, no port forwarding, no firewall config.

**One-time setup:**

1. Install Tailscale on your machine: https://tailscale.com/download
2. Install Tailscale on your phone (App Store / Play Store)
3. Login to the same account on both
4. In the Tailscale admin console, enable HTTPS for your tailnet

**Then:**

```bash
openvide-daemon bridge enable
openvide-daemon bridge token
```

Output:
```
Local:     http://192.168.1.61:7842
Tailscale: https://your-machine.tailXXXXX.ts.net:7842
```

The daemon auto-detects Tailscale and uses its Let's Encrypt certificate — trusted HTTPS, works on iOS.

In the OpenVide app: paste the Tailscale URL + token. Works from anywhere.

### Remote via Caddy + Public Domain

For team setups or when you need a public URL.

**On your VPS:**

```bash
# Install daemon
npm install -g @openvide/daemon

# Start bridge without TLS (Caddy handles it)
openvide-daemon bridge enable --no-tls

# Get token
openvide-daemon bridge token
```

**Install Caddy and configure:**

```bash
sudo apt install -y caddy
```

Edit `/etc/caddy/Caddyfile`:

```caddyfile
openvide.example.com {
  reverse_proxy localhost:7842
}
```

```bash
sudo systemctl restart caddy
```

Caddy auto-provisions Let's Encrypt certificates. Connect via `https://openvide.example.com` with the token.

---

## SSH Access

For remote machines without Tailscale, you can set up SSH key-based access:

```bash
# Generate SSH key pair + QR code
openvide-daemon keygen --host your-server.com --username ubuntu
```

This generates an Ed25519 key pair, adds the public key to `~/.ssh/authorized_keys`, and prints a QR code for the OpenVide app to scan.

If Tailscale is running, the QR code automatically uses your Tailscale IP.

---

## CLI Commands

### Bridge

```bash
openvide-daemon bridge enable [--port 7842] [--no-tls]   # Start bridge (TLS on by default)
openvide-daemon bridge disable                            # Stop bridge
openvide-daemon bridge status                             # Show bridge status
openvide-daemon bridge token [--expire 24h]               # Generate auth token
openvide-daemon bridge revoke --jti <id>                  # Revoke a token
```

### Sessions

```bash
openvide-daemon session create --tool <claude|codex|gemini> --cwd <path> [--model <id>]
openvide-daemon session send --id <id> --prompt <text> [--mode <code|chat|plan>]
openvide-daemon session stream --id <id> [--follow] [--offset <line>]
openvide-daemon session cancel --id <id>
openvide-daemon session list
openvide-daemon session get --id <id>
openvide-daemon session history --id <id>
openvide-daemon session remove --id <id>
openvide-daemon session wait-idle --id <id> [--timeout-ms <ms>]
```

### Native Sessions

```bash
openvide-daemon session list-native --cwd <path> [--tool claude|codex|all]
openvide-daemon session list-workspace --cwd <path>
```

### File System

```bash
openvide-daemon fs list --path ~/project
openvide-daemon fs read --path ~/project/main.ts [--offset 0] [--limit 100]
openvide-daemon fs stat --path ~/project
```

### Other

```bash
openvide-daemon health                    # Check daemon status
openvide-daemon version                   # Show version
openvide-daemon stop                      # Stop daemon
openvide-daemon model list --tool codex   # List available models
openvide-daemon keygen [--host <h>] [--username <u>]  # Generate SSH keys + QR
```

---

## TLS Behavior

| Scenario | What happens |
|----------|-------------|
| Tailscale + HTTPS enabled in tailnet | Auto-uses Let's Encrypt cert → trusted HTTPS |
| Tailscale, no HTTPS in tailnet | Self-signed cert (use `--no-tls` for HTTP over WireGuard) |
| No Tailscale | Self-signed cert (LAN only, or use `--no-tls` behind Caddy) |
| `--no-tls` flag | Plain HTTP (use behind Caddy or on LAN) |

---

## Deploy on a VPS

### With Tailscale (simplest)

```bash
# On your VPS
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
npm install -g @openvide/daemon
npm install -g @anthropic-ai/claude-code
export ANTHROPIC_API_KEY=sk-ant-...

openvide-daemon bridge enable
openvide-daemon bridge token
```

### With Caddy (public URL)

```bash
# On your VPS
npm install -g @openvide/daemon
npm install -g @anthropic-ai/claude-code
export ANTHROPIC_API_KEY=sk-ant-...
sudo apt install -y caddy

openvide-daemon bridge enable --no-tls

echo 'openvide.example.com { reverse_proxy localhost:7842 }' | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy

openvide-daemon bridge token
```

### Keep running with systemd

Create `/etc/systemd/system/openvide.service`:

```ini
[Unit]
Description=OpenVide Daemon
After=network.target

[Service]
Type=simple
User=ubuntu
Environment=ANTHROPIC_API_KEY=sk-ant-...
ExecStart=/usr/local/bin/openvide-daemon health
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable openvide && sudo systemctl start openvide
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required for Claude Code |
| `OPENAI_API_KEY` | — | Required for Codex |
| `GOOGLE_API_KEY` | — | Required for Gemini |
| `BRIDGE_PORT` | 7842 | Bridge listen port |

---

## Troubleshooting

**"Invalid API key" in chat:**
Set the API key on the machine running the daemon, not in the app.

**Can't connect from phone:**
```bash
openvide-daemon health          # Is daemon running?
openvide-daemon bridge status   # Is bridge enabled?
openvide-daemon bridge token    # Correct URL + token?
```

**Tailscale HTTPS not working:**
1. Enable HTTPS in Tailscale admin console
2. Run `tailscale cert your-machine.tailXXXXX.ts.net`
3. Restart: `openvide-daemon stop && openvide-daemon bridge enable`

**Daemon won't start:**
```bash
tail -f ~/.openvide-daemon/daemon.log
rm ~/.openvide-daemon/daemon.sock
```

## Support

If you find this useful, consider supporting the project:

[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://buymeacoffee.com/f3tch)

## License

MIT
