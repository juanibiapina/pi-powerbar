# pi-powerbar

A [pi](https://github.com/badlogic/pi) extension that renders a persistent powerline-style status bar with left-aligned and right-aligned segments.

Any other pi extension can update segments by emitting a single `powerbar:update` event — no imports or dependencies required.

## Install

```bash
pi install npm:@juanibiapina/pi-powerbar
```

## Usage

The powerbar renders a widget with two sides, like tmux:

```
│ ⎇ main │ 42% used          model: sonnet │ 12k tokens │
  ← left →                    ←── right ──→
```

### Producing segments

Any extension can update a segment:

```typescript
pi.events.emit("powerbar:update", {
  id: "git-branch",
  text: "main",
  icon: "⎇",
  color: "accent",
});
```

To remove a segment:

```typescript
pi.events.emit("powerbar:update", {
  id: "git-branch",
  text: undefined,
});
```

### Configuration

Settings are stored in `~/.pi/agent/pi-powerbar-settings.json`:

```json
{
  "left": ["git-branch", "sub-usage"],
  "right": ["model", "tokens"],
  "separator": " │ ",
  "placement": "belowEditor"
}
```

- **left** / **right** — Ordered list of segment IDs controlling placement and order.
- **separator** — String drawn between segments on the same side.
- **placement** — Where the widget renders (`"belowEditor"`).

Segments not listed in either side are ignored.

## Development

```bash
npm install
npm run check    # lint + typecheck
npm run build    # compile to dist/
npm run dev      # watch mode
```

## License

MIT
