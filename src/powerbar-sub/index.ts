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
 * Segment IDs: "sub-hourly", "sub-weekly", "sub-overage"
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFlag } from "../powerbar/settings.js";

interface RateWindow {
	label: string;
	usedPercent: number;
	resetDescription?: string;
	resetAt?: string;
	used?: number;
	limit?: number;
	overage?: { charges: number; currency: string };
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

function formatAmount(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(0);
}

function formatAmounts(window: RateWindow): string | undefined {
	if (window.used === undefined || window.limit === undefined) return undefined;
	return `${formatAmount(window.used)}/${formatAmount(window.limit)}`;
}

function formatOverage(window: RateWindow): string | undefined {
	if (!window.overage || !(window.overage.charges > 0)) return undefined;
	const { charges, currency } = window.overage;
	return `${currency === "USD" ? "$" : `${currency} `}${charges.toFixed(2)} over`;
}

interface WindowOptions {
	amounts: boolean;
	reset: boolean;
	bar: boolean;
}

function emitWindow(
	pi: ExtensionAPI,
	segmentId: string,
	window: RateWindow | undefined,
	barSegments: number,
	observedAt: number,
	options: WindowOptions,
): void {
	if (!window) {
		pi.events.emit("powerbar:update", { id: segmentId, text: undefined });
		return;
	}

	const pct = Math.round(window.usedPercent);
	const label = window.label || "";
	const reset = options.reset ? (formatResetAt(window.resetAt, observedAt) ?? window.resetDescription ?? "") : "";
	const amounts = options.amounts ? formatAmounts(window) : undefined;

	const textParts: string[] = [];
	if (label) textParts.push(label);
	const details = [amounts, reset].filter(Boolean).join(" · ");
	if (details) textParts.push(details);

	pi.events.emit("powerbar:update", {
		id: segmentId,
		text: textParts.join(" "),
		suffix: options.bar ? `${pct}%` : undefined,
		bar: options.bar ? pct : undefined,
		barSegments,
		color: getColor(pct),
	});
}

function emitOverage(pi: ExtensionAPI, windows: RateWindow[]): void {
	const text = windows.map(formatOverage).find(Boolean);
	pi.events.emit("powerbar:update", { id: "sub-overage", text, color: "error" });
}

function clearSegments(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:update", { id: "sub-hourly", text: undefined });
	pi.events.emit("powerbar:update", { id: "sub-weekly", text: undefined });
	pi.events.emit("powerbar:update", { id: "sub-overage", text: undefined });
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
	const options = {
		amounts: readFlag("sub-amounts", false),
		reset: readFlag("sub-reset", true),
		bar: readFlag("sub-bar", true),
	};
	emitWindow(pi, "sub-hourly", usage.windows[0], 5, observedAt, options);
	emitWindow(pi, "sub-weekly", usage.windows[1], 7, observedAt, options);
	emitOverage(pi, usage.windows);
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "sub-hourly", label: "Sub Hourly" });
	pi.events.emit("powerbar:register-segment", { id: "sub-weekly", label: "Sub Weekly" });
	pi.events.emit("powerbar:register-segment", { id: "sub-overage", label: "Sub Overage" });

	pi.events.on("usage-core:ready", (payload: unknown) => {
		emitUsage(pi, (payload as { state?: UsageCoreState }).state);
	});

	pi.events.on("usage-core:update-current", (payload: unknown) => {
		emitUsage(pi, (payload as { state?: UsageCoreState }).state);
	});
}
