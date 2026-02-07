# Changelog

## Unreleased

- Provider producer: shows the current LLM provider name (e.g. anthropic, openai)

## 0.3.1

- Fix: gracefully handle overflow by shrinking the widest segment instead of crashing

## 0.3.0

- Token producer: reset on new session or session switch (hide stale values)
- Token producer: update on every tool result for more frequent feedback

## 0.2.1

- Fix: hide context segment instead of showing 0% on new session

## 0.2.0

- Context usage producer: update on every tool result (not just turn end) for more frequent feedback
- Context usage producer: reset to 0% on new session or session switch

## 0.1.0

- Initial release
- Powerbar core: persistent powerline-style widget with left/right segment layout
- Git branch producer: shows current branch, refreshes after bash commands
- Token producer: cumulative input/output tokens and session cost
- Context usage producer: progress bar with warning/error thresholds
- Model producer: current model name and thinking level
- Subscription producer: hourly/weekly usage from pi-sub-core
- Configurable separator, placement, bar width, and segment ordering via settings
- Use muted color for a subtler appearance consistent with pi-sub
