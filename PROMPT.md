# Powerbar Architecture

## Goal

A pi package containing multiple extensions: one core extension that renders a persistent powerline-style status bar, and producer extensions that emit segment data via a standardized event. The Powerbar owns all rendering; producers only send data. The default pi footer is hidden — the powerbar replaces it.

## Multi-Extension Package

This repository is a single pi package that ships multiple extensions, each in its own subdirectory under `src/`. Pi auto-discovers them from the compiled `dist/` directory via the `*/index.js` convention.

```
package.json  →  "pi": { "extensions": ["./dist", "node_modules/@marckrenn/pi-sub-core/index.ts"] }

dist/
├── powerbar/           ← core renderer (event listener + widget)
├── powerbar-provider/  ← producer: current LLM provider name
├── powerbar-model/     ← producer: current model + thinking level
├── powerbar-context/   ← producer: context window usage bar
├── powerbar-tokens/    ← producer: cumulative token counts + cost
├── powerbar-git/       ← producer: current git branch
└── powerbar-sub/       ← producer: subscription usage (hourly + weekly)

node_modules/@marckrenn/pi-sub-core/  ← loaded by pi as a sibling extension via pi.extensions
```

Each subdirectory is a fully independent extension. Producers have zero imports from the core — the only shared contract is the event name and payload shape.

### Adding a New Producer

1. Create `src/powerbar-<name>/index.ts`
2. Export a default function that receives `ExtensionAPI`
3. Listen to relevant pi events and emit `powerbar:update`
4. Build — the new extension is auto-discovered from `dist/`

### User Filtering

Users can disable specific extensions via pi's package filtering:

```json
{
  "source": "npm:@juanibiapina/pi-powerbar",
  "extensions": ["!dist/powerbar-context/index.js"]
}
```

## Architecture

```
┌────────────────────┐ powerbar:update   ┌─────────────────────┐
│ powerbar-provider  │──────────────────▶│                     │
└────────────────────┘                    │     powerbar        │
┌──────────────────┐   powerbar:update   │    (core ext)       │
│  powerbar-model  │────────────────────▶│                     │
└──────────────────┘                      │                     │
┌──────────────────┐   powerbar:update   │                     │
│ powerbar-context │────────────────────▶│                     │
└──────────────────┘                      │  ┌───────────────┐  │
┌──────────────────┐   powerbar:update   │  │ segment store  │  │
│ powerbar-tokens  │────────────────────▶│  │ { id → data } │  │
└──────────────────┘                      │  └───────┬───────┘  │
┌──────────────────┐   powerbar:update   │          │          │
│  powerbar-git    │────────────────────▶│          ▼          │
└──────────────────┘                      │   ctx.ui.setWidget  │
┌──────────────────┐   powerbar:update   │                     │
│  powerbar-sub    │────────────────────▶│  ┌left──────right┐  │
└──────────────────┘                      │  │ A  B  │    C  │  │
                                          │  └───────────────┘  │
                                          └─────────────────────┘
```

One event name. Multiple producers. One renderer. One widget.

## Event Contract

Any extension (in this package or external) emits this to update a segment:

```typescript
pi.events.emit("powerbar:update", {
  id: "git-branch",        // unique segment key
  text: "main",            // text before the bar (undefined to hide segment)
  suffix: "59%",           // optional text after the bar
  icon: "⎇",               // optional prefix icon
  color: "accent",         // optional theme color name
  bar: 59,                 // optional 0–100 progress bar
});
```

To remove a segment:

```typescript
pi.events.emit("powerbar:update", {
  id: "git-branch",
  text: undefined,          // clears it (only if bar is also absent)
});
```

**Segment layout:** `[icon] [text] [bar] [suffix]`

That's the entire API for producers. They don't import anything from the powerbar extension.

## Configuration

Settings are managed via `@juanibiapina/pi-extension-settings` under the extension name `"powerbar"`.

Settings:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `left` | comma-separated string | `"git-branch,tokens,context-usage"` | Ordered segment IDs for left side |
| `right` | comma-separated string | `"provider,model,sub-hourly,sub-weekly"` | Ordered segment IDs for right side |
| `separator` | string | `" │ "` | Drawn between segments on the same side |
| `placement` | string | `"belowEditor"` | Widget placement |
| `bar-width` | number | `10` | Character width of progress bars |

- Segments not listed in either side are **ignored** (silent drop).
- Users can reorder or move segments between sides via `/settings`.

## Internal Data Model (Core)

```typescript
interface Segment {
  id: string;
  text: string;
  suffix?: string;     // text rendered after the bar
  icon?: string;
  color?: string;      // ThemeColor name
  bar?: number;        // 0–100, renders a progress bar
}

const segments: Map<string, Segment> = new Map();
```

On every `powerbar:update` event:

1. Update (or delete) the entry in the map.
2. Re-render the widget.

## Progress Bar Rendering

Progress bars use full-height Unicode block characters, matching the pi-sub visual style:

- `█` — full block (filled)
- `▉▊▋▌▍▎▏` — partial blocks (7/8 to 1/8)
- ` ` (space) — empty

Example at 22% with width 10: `██▎       `

The filled portion uses the segment's `color` (themed), empty is spaces. Color transitions based on usage level are handled by each producer (e.g., accent → warning → error).

## Rendering Logic (Core)

On render:

1. Read `left` and `right` arrays from settings.
2. For each side, filter the map to only segments listed in that array, in config order.
3. Skip segments with no text, no suffix, and no bar.
4. For each segment, render: `[icon] [text] [bar] [suffix]`, colored with `color`.
5. Join each side's segments with `separator`.
6. Pad the middle so left is flush-left and right is flush-right within the available width.

```
⎇ main │ ↑3 ↓17 $0.03 │ ▎          2%     claude-opus-4-6 · high │ 5h 1h20m ██▎ 22% │ Week 6d2h ▌ 5%
←────────────── left ──────────────→        ←──────────────────── right ────────────────────────────→
```

## Footer Hiding

The core extension hides the default pi footer on `session_start` and `session_switch` by calling `ctx.ui.setFooter()` with an empty component (returns no lines). This avoids duplicate information since the powerbar already shows model, tokens, context, etc.

## Lifecycle (Core)

```
session_start / session_switch
  → load settings from pi-extension-settings
  → hide default footer
  → render widget (shows segments as they arrive)

powerbar:update (any time)
  → upsert/delete segment in map
  → re-render widget

session_shutdown
  → clear widget
  → clean up
```

## Producer Extensions

### powerbar-git

Shows the current git branch.

- **Segment ID:** `git-branch`
- **Listens to:** `session_start`, `tool_result` (bash)
- **Data source:** Reads `.git/HEAD` directly for speed
- **Icon:** `⎇`

### powerbar-tokens

Shows cumulative input/output token counts and estimated cost.

- **Segment ID:** `tokens`
- **Listens to:** `turn_end`
- **Data source:** Session entries (sums all input/output tokens)
- **Format:** `↑3 ↓17 $0.03`

### powerbar-context

Shows context window usage as a progress bar with percentage.

- **Segment ID:** `context-usage`
- **Listens to:** `turn_end`
- **Data source:** `ctx.getContextUsage()`
- **Color:** accent (< 60%) → warning (60–80%) → error (> 80%)
- **Format:** `▎          2%` (bar + suffix)

### powerbar-provider

Shows the current LLM provider name.

- **Segment ID:** `provider`
- **Listens to:** `session_start`, `session_switch`, `model_select`, `turn_start`
- **Data source:** `ctx.model.provider`
- **Format:** `anthropic`

### powerbar-model

Shows the current model ID and thinking level.

- **Segment ID:** `model`
- **Listens to:** `session_start`, `session_switch`, `model_select`, `turn_start`
- **Data source:** `ctx.getModel()`
- **Format:** `claude-opus-4-6 · high`

### powerbar-sub

Shows subscription rate limit usage from pi-sub-core. Emits two segments for hourly and weekly windows.

- **Segment IDs:** `sub-hourly`, `sub-weekly`
- **Listens to:** `sub-core:ready`, `sub-core:update-current`, `sub-core:update-all`
- **Format:** `5h 1h20m ██▎ 22%` (text: label + reset, bar, suffix: percentage)
- **Color:** accent (< 60%) → warning (60–80%) → error (> 80%)

#### Sub-Core Loading

Sub-core is declared as a sibling extension in `package.json`'s `pi.extensions` array:

```json
"pi": {
  "extensions": [
    "./dist",
    "node_modules/@marckrenn/pi-sub-core/index.ts"
  ]
}
```

Pi loads sub-core directly via jiti (required since sub-core ships as `.ts` only). Sub-core handles its own initialization on `session_start` and emits events that `powerbar-sub` listens to. No dynamic `import()` bootstrapping needed — pi's extension discovery handles everything.

**Important**: Sub-core's `.ts` must be loaded by jiti (pi's extension loader), not by Node's native ESM loader. Dynamic `import()` from compiled `.js` files goes through Node which cannot handle `.ts` under `node_modules`. This is why sub-core must be listed in `pi.extensions` rather than bootstrapped programmatically.

## File Structure

```
src/
├── powerbar/
│   ├── index.ts           # Core extension: event listener + widget + footer hiding
│   ├── settings.ts        # Load settings via pi-extension-settings
│   └── render.ts          # Build the left │ right line with progress bars
├── powerbar-provider/
│   └── index.ts           # Producer: LLM provider name
├── powerbar-model/
│   └── index.ts           # Producer: model name + thinking level
├── powerbar-context/
│   └── index.ts           # Producer: context usage bar
├── powerbar-tokens/
│   └── index.ts           # Producer: cumulative token stats
├── powerbar-git/
│   └── index.ts           # Producer: git branch from .git/HEAD
└── powerbar-sub/
    └── index.ts           # Producer: subscription usage (listens to sub-core events)
```

## Build

```bash
npm run build
# tsc compiles src/ → dist/
```

## Example External Producer

An extension in a different package that wants to show info on the powerbar — zero coupling:

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    pi.events.emit("powerbar:update", {
      id: "my-segment",
      text: "Hello",
      icon: "👋",
      color: "accent",
    });
  });
}
```

## Separation of Concerns

| Concern | Owner |
|---------|-------|
| When/how to render | powerbar (core) |
| Layout (left/right, order) | powerbar settings |
| Styling (colors, separators, bars) | powerbar settings + theme |
| What data to show | Producer extensions (via event) |
| Data format | `powerbar:update` event with `{id, text, suffix?, icon?, color?, bar?}` |

The powerbar doesn't know or care what the segments mean. Producers don't know or care how they're rendered. The only shared contract is the event name and payload shape.
