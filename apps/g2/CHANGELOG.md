# Changelog

## 0.1.7

Released: 2026-04-03

No breaking changes.

### Changed

- aligned the app with `even-toolkit` 1.6.3 for shared bridge-only storage behavior
- host, session, and settings persistence now use the shared toolkit storage helper

### Notes

- there are no daemon or bridge protocol changes in this release

## 0.1.6

Released: 2026-04-02

No breaking changes.

### Changed

- aligned the app version with the rest of the current `0.1.6` release train
- retained the `even-toolkit` 1.6.2 dependency and canonical `open-vide/even-open-vide` release flow

### Notes

- there are no daemon or bridge protocol changes in this release


## 0.1.5

Released: 2026-04-02

No breaking changes.

### Changed

- aligned the app with `even-toolkit` 1.6.2 for the current shared web header/layout fixes
- GitHub releases are now part of the maintained release flow for the canonical `open-vide/even-open-vide` repository

### Notes

- there are no daemon or bridge protocol changes in this release


## 0.1.4

Released: 2026-04-02

No breaking changes.

### Added

- first changelog entry for the G2 client release line
- clearer documentation around the canonical OpenVide repository and daemon architecture

### Changed

- bridge hosts, session labels, and settings now persist through the SDK-backed storage flow
- storage handling was simplified for better reliability in webview and glasses environments
- guide and files flows were refreshed for the current host-aware workspace setup

### Notes

- this repo points to `open-vide/even-open-vide` and should use the canonical daemon from the main OpenVide repository
