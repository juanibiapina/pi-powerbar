/**
 * Powerbar Sub Producer
 *
 * Shows subscription usage from pi-usage.
 * pi-usage is loaded by pi as a sibling extension (declared in package.json pi.extensions).
 *
 * We listen to `usage-core:ready` and `usage-core:update-current`.
 * The state includes a `provider` field — when absent (e.g. Bedrock model),
 * we clear the segments.
 *
 * Segment IDs: "sub-hourly", "sub-weekly"
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface RateWindow {
	label: string;
	usedPercent: number;
	resetDescription?: string;
}

interface UsageCoreState {
	provider?: string;
	usage?: {
		windows: RateWindow[];
	};
}

function getColor(pct: number): string {
	if (pct > 80) return "error";
	if (pct > 60) return "warning";
	return "muted";
}

function emitWindow(pi: ExtensionAPI, segmentId: string, window: RateWindow | undefined, barSegments: number): void {
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
		barSegments,
		color: getColor(pct),
	});
}

function clearSegments(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:update", { id: "sub-hourly", text: undefined });
	pi.events.emit("powerbar:update", { id: "sub-weekly", text: undefined });
}

function emitUsage(pi: ExtensionAPI, state: UsageCoreState | undefined): void {
	if (!state?.provider) {
		clearSegments(pi);
		return;
	}

	const usage = state.usage;
	if (!usage || usage.windows.length === 0) {
		clearSegments(pi);
		return;
	}

	emitWindow(pi, "sub-hourly", usage.windows[0], 5);
	emitWindow(pi, "sub-weekly", usage.windows[1], 7);
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "sub-hourly", label: "Sub Hourly" });
	pi.events.emit("powerbar:register-segment", { id: "sub-weekly", label: "Sub Weekly" });

	pi.events.on("usage-core:ready", (payload: unknown) => {
		emitUsage(pi, (payload as { state?: UsageCoreState }).state);
	});

	pi.events.on("usage-core:update-current", (payload: unknown) => {
		emitUsage(pi, (payload as { state?: UsageCoreState }).state);
	});
}
