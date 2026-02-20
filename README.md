# Open Vide (Direct SSH)

Open Vide is a UX-first Expo app that manages remote machines over SSH, installs/manages Claude/Codex/Gemini CLIs, and runs commands with live streaming.

HTTP/backend transport has been removed. Streaming is direct from SSH in-app.

## Project layout

- `apps/app`: Expo React Native app (including `ios/` and `android/`)
- `apps/daemon`: `openvide-daemon` workspace
- `docs/direct-ssh-contract.md`: selected SSH library + native integration notes
- `docs/conductor-inspired-plan.md`: Conductor-inspired UX mapping + parity matrix
- `docs/setup-and-validation.md`: setup + validation checklist

## Core capabilities

- SSH target CRUD (password, key, key+passphrase)
- Machine readiness scan
- CLI lifecycle actions for Claude/Codex/Gemini
- Ad-hoc command execution with live output
- Parsed timeline events + raw log fallback
- Cancel/timeout flows
- Local persistence for targets/runs/readiness
- Secure keychain storage for SSH credentials and tool env secrets

## Dev client requirement

This architecture requires a native build (Expo Dev Client), not Expo Go.

The app uses:
- `@dylankenneally/react-native-ssh-sftp` for direct SSH/Shell streaming.
- `expo-secure-store` for keychain/keystore secrets.

Compatibility pinned for this repo:
- `expo`: `^54.0.33`
- `react-native`: `0.81.5`
- `expo-dev-client`: `~6.0.20`

See:
- `docs/direct-ssh-contract.md`

## Run

```bash
corepack yarn install
corepack yarn prebuild
cd apps/app/ios && env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install && cd ../..
corepack yarn ios   # or corepack yarn android
corepack yarn start
```
