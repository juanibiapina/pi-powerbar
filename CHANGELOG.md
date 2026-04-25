# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2026-04-25

### Changed

- Bumped dependencies to latest: `@marckrenn/pi-sub-core` ^1.5.0, `@marckrenn/pi-sub-shared` ^1.5.0, `@mariozechner/pi-coding-agent` ^0.70.2, `@biomejs/biome` 2.4.13, `@types/node` ^25.6.0, `typescript` ^6.0.3.
- Powerbar core no longer redraws when a `powerbar:update` carries a payload identical to the current segment state, cutting widget churn from chatty producers.

### Fixed

- Subscription producer no longer reacts to `sub-core:update-all`. That event filters provider entries by cache TTL, so the current provider can be missing whenever its `fetchedAt` drifts past the refresh interval (e.g. during anthropic 429s, see [marckrenn/pi-sub#58](https://github.com/marckrenn/pi-sub/issues/58)). The previous code interpreted that as "no usage" and cleared `sub-hourly` / `sub-weekly`, producing the disappear/reappear flicker. `sub-core:update-current` is authoritative for the current provider in every case, including cross-instance cache writes, so we now rely on it exclusively.

## [0.9.0] - 2026-04-22

### Fixed

- Move `@juanibiapina/pi-extension-settings` from devDependencies to dependencies (fixes #11)

## [0.8.0] - 2026-04-06

### Changed

- Updated `@mariozechner/pi-coding-agent` dev dependency to ^0.65.2
- Updated `@juanibiapina/pi-extension-settings` dev dependency to ^0.6.1
- Removed all `session_switch` event handlers (event removed from pi API)

## [0.7.1] - 2026-03-23

### Changed

- Updated `@mariozechner/pi-coding-agent` dev dependency to ^0.62.0
- Updated `@juanibiapina/pi-extension-settings` dependency to ^0.6.0

## [0.7.0] - 2026-03-19

### Added

- Bar style setting: choose between `continuous` (left-to-right fill) and `blocks` (discrete partial-height characters with dim background track), default `blocks`
- `barSegments` hint in update payload: producers can suggest how many discrete blocks to show (e.g. context-usage uses one block per 100k tokens, sub-hourly uses 5, sub-weekly uses 7)

## [0.6.1] - 2026-03-07

### Fixed

- Repository URL in package.json now uses https instead of git+ssh

## [0.6.0] - 2026-02-16

- Updated all dependencies to latest versions
- Fix: subscription producer now matches the current provider's entry in `update-all` events instead of blindly using the first entry

## [0.5.0] - 2026-02-07

- Segment registration: producer extensions now register their segments via `powerbar:register-segment` events, enabling any extension to declare segments for the settings menu
- Left/right segment settings now open an ordered multi-select menu (toggle on/off, reorder with Shift+↑/↓) instead of requiring manual comma-separated input
- Requires `@juanibiapina/pi-extension-settings` >= 0.5.0 for `options` support

## [0.4.0] - 2026-02-07

- Provider producer: shows the current LLM provider name (e.g. anthropic, openai)

## [0.3.1] - 2026-02-07

- Fix: gracefully handle overflow by shrinking the widest segment instead of crashing

## [0.3.0] - 2026-02-07

- Token producer: reset on new session or session switch (hide stale values)
- Token producer: update on every tool result for more frequent feedback

## [0.2.1] - 2026-02-07

- Fix: hide context segment instead of showing 0% on new session

## [0.2.0] - 2026-02-07

- Context usage producer: update on every tool result (not just turn end) for more frequent feedback
- Context usage producer: reset to 0% on new session or session switch

## [0.1.0] - 2026-02-06

- Initial release
- Powerbar core: persistent powerline-style widget with left/right segment layout
- Git branch producer: shows current branch, refreshes after bash commands
- Token producer: cumulative input/output tokens and session cost
- Context usage producer: progress bar with warning/error thresholds
- Model producer: current model name and thinking level
- Subscription producer: hourly/weekly usage from pi-sub-core
- Configurable separator, placement, bar width, and segment ordering via settings
- Use muted color for a subtler appearance consistent with pi-sub
