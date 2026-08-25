#!/usr/bin/env bash
#
# Run pi with the powerbar extension loaded from THIS repo checkout instead of
# the version installed globally (npm/Nix/dotfiles).
#
# How it works: pi reads PI_CODING_AGENT_DIR to override its agent config
# directory (where settings.json and settings-extensions.json live). This
# script generates a throwaway agent dir seeded from your real global config,
# swaps the powerbar package entry to this repo root, and launches pi against
# it. Your global ~/.pi/agent config is never touched.
#
# Usage:
#   gh pr checkout <n>       # optional: test a PR branch
#   scripts/test-local.sh    # launch pi with the repo's powerbar
#
# Any extra arguments are passed through to pi.

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
agent="$repo/.local/test-agent"

if ! command -v jq >/dev/null 2>&1; then
	echo "error: jq is required" >&2
	exit 1
fi

if [ ! -f "$src/settings.json" ]; then
	echo "error: no settings.json found at $src" >&2
	exit 1
fi

mkdir -p "$agent"

# Model to default to for testing. Overridable via env. enabledModels (the set
# of usable models) is inherited from your real config below, so any of your
# models are still available at runtime via the model picker.
provider="${PI_TEST_PROVIDER:-anthropic}"
model="${PI_TEST_MODEL:-claude-sonnet-4-6}"
thinking="${PI_TEST_THINKING:-medium}"

# Seed settings from the real config, swapping the powerbar package entry to the
# repo root (matches both "~/.pi/agent/pi-packages/pi-powerbar" and
# "npm:@juanibiapina/pi-powerbar", which both end in "pi-powerbar") and making
# the test model the startup default.
#
# pi picks the startup model from enabledModels[0] (see findInitialModel: the
# first scoped model wins over the saved defaultModel), so the test model is
# PREPENDED to enabledModels, not appended. Your other models stay available in
# the picker. defaultProvider/defaultModel are also set as a fallback.
entry="$provider/$model:$thinking"
jq --arg repo "$repo" --arg provider "$provider" --arg model "$model" --arg thinking "$thinking" --arg entry "$entry" '
	.packages = (.packages | map(if test("pi-powerbar$") then $repo else . end))
	| .defaultProvider = $provider
	| .defaultModel = $model
	| .defaultThinkingLevel = $thinking
	| .enabledModels = ([$entry] + ((.enabledModels // []) - [$entry]))
' "$src/settings.json" >"$agent/settings.json"

# Carry over the segment layout so the tokens segment renders with your real
# left/right configuration. Regenerated every run to track config changes.
if [ -f "$src/settings-extensions.json" ]; then
	cp "$src/settings-extensions.json" "$agent/settings-extensions.json"
fi

# Symlink auth and model catalog from the real config so logged-in providers
# (e.g. your Claude subscription) and model ids resolve. Symlinked, not copied,
# so refreshed OAuth tokens stay in sync with your real config.
for f in auth.json models.json models-store.json; do
	if [ -e "$src/$f" ]; then
		ln -sf "$src/$f" "$agent/$f"
	fi
done

# Share the cache dir so pi-usage reuses the real subscription-usage cache
# (cache-<provider>.json). Without it the test instance starts with an empty
# cache and the sub-hourly/sub-weekly segments stay blank until a fresh fetch.
if [ -d "$src/cache" ]; then
	rm -rf "$agent/cache"
	ln -sfn "$src/cache" "$agent/cache"
fi

# Override the system prompt (pi loads SYSTEM.md from the agent dir). Kept
# minimal and flags this as a throwaway test instance on a live paid
# subscription so the model stays frugal.
cat >"$agent/SYSTEM.md" <<'SYSTEM'
You are a TEST instance of pi, used only to exercise the pi-powerbar extension.
You run against a live, paid model subscription: keep work minimal, avoid
unnecessary model calls, and do not start long or expensive tasks.

You are a coding assistant with read, bash, edit, and write tools.
- Prefer ffgrep/fffind, then rg and fd.
- Read with read; make precise changes with edit; use write only for new or full-file writes.
- Be concise.
SYSTEM

echo "powerbar: loading from $repo (branch: $(git -C "$repo" branch --show-current 2>/dev/null || echo '?'))" >&2
echo "agent dir: $agent" >&2
echo "default model: $provider/$model:$thinking" >&2

exec env PI_CODING_AGENT_DIR="$agent" pi "$@"
