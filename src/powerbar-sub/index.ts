/**
 * Powerbar Sub Producer
 *
 * Shows subscription usage from pi-sub-core.
 * Sub-core is loaded by pi as a sibling extension (declared in package.json pi.extensions).
 * This producer just listens to sub-core events and emits powerbar segments.
 *
 * Segment IDs: "sub-hourly", "sub-weekly"
 */

import type { RateWindow, SubCoreAllState, SubCoreState, UsageSnapshot } from "@marckrenn/pi-sub-shared";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function getColor(pct: number): string {
	if (pct > 80) return "error";
	if (pct > 60) return "warning";
	return "muted";
}

function emitWindow(pi: ExtensionAPI, segmentId: string, window: RateWindow | undefined): void {
	if (!window) {
		pi.events.emit("powerbar:update", { id: segmentId, text: undefined });
		return;
	}

	const pct = Math.round(window.usedPercent);
	const label = window.label || "";
	const reset = window.resetDescription || "";

	const textParts: string[] = [];
	if (label) textParts.push(label);
	if (reset) textParts.push(reset);

	pi.events.emit("powerbar:update", {
		id: segmentId,
		text: textParts.join(" "),
		suffix: `${pct}%`,
		bar: pct,
		color: getColor(pct),
	});
}

function emitUsage(pi: ExtensionAPI, usage: UsageSnapshot | undefined): void {
	if (!usage || usage.windows.length === 0) {
		pi.events.emit("powerbar:update", { id: "sub-hourly", text: undefined });
		pi.events.emit("powerbar:update", { id: "sub-weekly", text: undefined });
		return;
	}

	emitWindow(pi, "sub-hourly", usage.windows[0]);
	emitWindow(pi, "sub-weekly", usage.windows[1]);
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.on("sub-core:ready", (payload: unknown) => {
		const data = payload as { state?: SubCoreState };
		emitUsage(pi, data.state?.usage);
	});

	pi.events.on("sub-core:update-current", (payload: unknown) => {
		const data = payload as { state?: SubCoreState };
		emitUsage(pi, data.state?.usage);
	});

	pi.events.on("sub-core:update-all", (payload: unknown) => {
		const data = payload as { state?: SubCoreAllState };
		const entry = data.state?.entries?.[0];
		emitUsage(pi, entry?.usage);
	});
}
