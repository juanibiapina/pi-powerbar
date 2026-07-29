/**
 * Powerbar Context Producer
 *
 * Shows context window usage as a progress bar with percentage.
 * Color changes based on usage level: accent → warning → error.
 * Segment ID: "context-usage"
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CHUNK_SIZE = 100_000;

function getColor(pct: number): string {
	if (pct > 80) return "error";
	if (pct > 60) return "warning";
	return "muted";
}

function emitContextUsage(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const usage = ctx.getContextUsage();
	if (!usage || usage.tokens == null || usage.contextWindow <= 0) {
		resetContextUsage(pi);
		return;
	}

	const pct = Math.round((usage.tokens / usage.contextWindow) * 100);
	pi.events.emit("powerbar:update", {
		id: "context-usage",
		text: "",
		suffix: `${pct}%`,
		bar: pct,
		barSegments: Math.max(1, Math.ceil(usage.contextWindow / CHUNK_SIZE)),
		color: getColor(pct),
	});
}

function resetContextUsage(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:update", {
		id: "context-usage",
		text: undefined,
	});
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "context-usage", label: "Context Usage" });

	// Restore usage immediately when starting or switching sessions.
	pi.on("session_start", async (_event, ctx) => emitContextUsage(pi, ctx));

	// Update during agent work and after session context changes.
	pi.on("turn_start", async (_event, ctx) => emitContextUsage(pi, ctx));
	pi.on("tool_result", async (_event, ctx) => emitContextUsage(pi, ctx));
	pi.on("turn_end", async (_event, ctx) => emitContextUsage(pi, ctx));
	pi.on("session_compact", async (_event, ctx) => emitContextUsage(pi, ctx));
	pi.on("session_tree", async (_event, ctx) => emitContextUsage(pi, ctx));
}
