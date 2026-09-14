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
	resetAt?: string;
}

interface UsageCoreState {
	provider?: string;
	observedAt?: number;
	usage?: {
		windows: RateWindow[];
	};
}

function getColor(pct: number): string {
	if (pct > 80) return "error";
	if (pct > 60) return "warning";
	return "muted";
}

function formatResetAt(resetAt: string | undefined, observedAt: number): string | undefined {
	if (!resetAt) return undefined;
	const resetTime = Date.parse(resetAt);
	if (!Number.isFinite(resetTime)) return undefined;
	const diffMs = resetTime - observedAt;
	if (diffMs < 0) return "now";

	const diffMins = Math.floor(diffMs / 60_000);
	if (diffMins < 60) return `${diffMins}m`;
	const hours = Math.floor(diffMins / 60);
	const mins = diffMins % 60;
	if (hours < 24) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;
	return remainingHours > 0 ? `${days}d${remainingHours}h` : `${days}d`;
}

function emitWindow(
	pi: ExtensionAPI,
	segmentId: string,
	window: RateWindow | undefined,
	barSegments: number,
	observedAt: number,
): void {
	if (!window) {
		pi.events.emit("powerbar:update", { id: segmentId, text: undefined });
		return;
	}

	const pct = Math.round(window.usedPercent);
	const label = window.label || "";
	const reset = formatResetAt(window.resetAt, observedAt) ?? window.resetDescription ?? "";

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

	const observedAt =
		typeof state.observedAt === "number" && Number.isFinite(state.observedAt) ? state.observedAt : Date.now();
	emitWindow(pi, "sub-hourly", usage.windows[0], 5, observedAt);
	emitWindow(pi, "sub-weekly", usage.windows[1], 7, observedAt);
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
