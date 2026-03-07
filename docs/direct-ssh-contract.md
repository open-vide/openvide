# Direct SSH Implementation (No HTTP)

Open Vide runs SSH directly in the mobile app.

There is no backend and no HTTP/WebSocket streaming layer.

## Selected library

- Library: `@dylankenneally/react-native-ssh-sftp`
- Why chosen:
1. Supports password auth and private key auth.
2. Supports interactive shell streaming (`startShell` + `on('Shell')`).
3. Works in React Native native builds and autolinks cleanly.
4. Is the most practical maintained option for this feature set.

## Rejected alternatives

1. `react-native-ssh`: stale and effectively unmaintained.
2. `@ridenui/react-native-riden-ssh`: lower adoption and less proven for long-running shell streaming UX.

## Integration in this repo

- SSH adapter: `apps/app/src/core/ssh/nativeSsh.ts`
- Runtime:
1. Connect with password or key.
2. Open shell.
3. Write command with an exit marker.
4. Stream shell chunks into parser and raw log store.
5. Detect exit marker and finalize metadata.
6. Support cancel by closing shell/disconnecting.

## iOS requirements

The package requires NMSSH from a fork. Podfile includes:

```ruby
pod 'NMSSH', :git => 'https://github.com/aanah0/NMSSH.git'
```

Install pods with UTF-8 env:

```bash
cd apps/app/ios
env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
```

Note: iOS simulator is not supported by this SSH package; use a physical iOS device for SSH execution testing.
