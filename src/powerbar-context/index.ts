/**
 * Powerbar Context Producer
 *
 * Shows context window usage as a progress bar with percentage.
 * Color changes based on usage level: accent → warning → error.
 * Segment ID: "context-usage"
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

function getColor(pct: number): string {
	if (pct > 80) return "error";
	if (pct > 60) return "warning";
	return "muted";
}

function emitContextUsage(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const usage = ctx.getContextUsage();
	if (usage) {
		const pct = Math.round((usage.tokens / usage.contextWindow) * 100);
		pi.events.emit("powerbar:update", {
			id: "context-usage",
			text: "",
			suffix: `${pct}%`,
			bar: pct,
			color: getColor(pct),
		});
	}
}

function resetContextUsage(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:update", {
		id: "context-usage",
		text: undefined,
	});
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "context-usage", label: "Context Usage" });

	// Reset on new/switched session
	pi.on("session_start", async () => resetContextUsage(pi));
	pi.on("session_switch", async () => resetContextUsage(pi));

	// Update frequently during agent work
	pi.on("turn_start", async (_event, ctx) => emitContextUsage(pi, ctx));
	pi.on("tool_result", async (_event, ctx) => emitContextUsage(pi, ctx));
	pi.on("turn_end", async (_event, ctx) => emitContextUsage(pi, ctx));
}
