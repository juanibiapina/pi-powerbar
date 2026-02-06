/**
 * Powerbar Context Producer
 *
 * Shows context window usage as a progress bar with percentage.
 * Color changes based on usage level: accent → warning → error.
 * Segment ID: "context-usage"
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function getColor(pct: number): string {
	if (pct > 80) return "error";
	if (pct > 60) return "warning";
	return "accent";
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.on("turn_end", async (_event, ctx) => {
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
	});
}
