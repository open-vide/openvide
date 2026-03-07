# Setup and Validation (Direct SSH)

## 1) Mobile setup

1. `cd <repo-root>`
2. Install dependencies (Yarn): `corepack yarn install`
3. Prebuild native project: `corepack yarn prebuild`
4. Install iOS pods (required for SSH): `cd apps/app/ios && env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install && cd ../..`
5. Build/run Dev Client:
   - iOS: `corepack yarn ios`
   - Android: `corepack yarn android`
6. Start Metro: `corepack yarn start`

Expo Go is not enough for this architecture.

## 2) Direct SSH package setup

This repo uses:

- `@dylankenneally/react-native-ssh-sftp`
- Podfile line: `pod 'NMSSH', :git => 'https://github.com/aanah0/NMSSH.git'`

See:

- `docs/direct-ssh-contract.md`

Important iOS note: run SSH tests on a physical device, not simulator.

## 3) Validation checklist

## A) Target management
- [ ] Add one VPS target (SSH reachable).
- [ ] Add one local SSH target.
- [ ] Confirm credentials are accepted for each auth mode used.

## B) Connectivity/readiness
- [ ] Run **Test SSH** on both targets.
- [ ] Run **Readiness** on both targets and validate OS/distro/shell/pkg manager/prereqs.

## C) CLI lifecycle
- [ ] Configure Claude env and run install/verify/update/uninstall.
- [ ] Configure Codex env and run install/verify/update/uninstall.
- [ ] Configure Gemini env and run install/verify/update/uninstall.

## D) Direct streaming + parsing
- [ ] Run ad-hoc command from Run Console.
- [ ] Confirm live incremental output appears in Run Detail.
- [ ] Confirm parsed timeline shows phase/severity/progress.
- [ ] Confirm raw logs remain available and mapped.

## E) Cancel/reconnect
- [ ] Start long-running command and cancel it.
- [ ] Confirm final state is `cancelled` and summary is present.
- [ ] Background app during a run and return; verify app state remains coherent.

## F) Security
- [ ] Verify SSH credentials and tool env secrets are stored in keychain/keystore (`expo-secure-store`).
- [ ] Verify sensitive values are redacted in logs.
