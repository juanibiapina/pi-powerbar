# Powerbar Architecture

## Goal

`pi-powerbar` renders one persistent status bar from independent producer extensions. Producers publish segment snapshots through Pi's event bus. The core owns segment storage, layout, and rendering.

The README is the source of truth for installation, segment events, settings, and built-in segment behavior.

## Modules

- `src/powerbar`: core segment store, settings, widget lifecycle, and rendering.
- `src/powerbar-provider`: selected provider producer.
- `src/powerbar-model`: selected model and thinking-level producer.
- `src/powerbar-context`: context-window producer.
- `src/powerbar-tokens`: token and cost producer.
- `src/powerbar-git`: Git branch producer.
- `src/powerbar-sub`: subscription presentation adapter for `pi-usage`.

## Update ownership

Reactive producers use the most precise available source event:

- tokens and context use agent lifecycle events;
- provider and model use selection events;
- Git uses lifecycle and filesystem events;
- subscription usage uses `usage-core:*` results.

Powerbar owns no general refresh clock. Subscription endpoint freshness, same-machine coordination, leases, and retry deadlines belong to `pi-usage`. See the `pi-usage` README for that interface.

## Dependency direction

```text
producer ── powerbar:update ──▶ powerbar core ──▶ widget

pi-usage ── usage-core:update-current ──▶ powerbar-sub
                                           │
                                           └── powerbar:update ──▶ powerbar core
```

Producers do not import the core. `powerbar-sub` does not call subscription endpoints.
