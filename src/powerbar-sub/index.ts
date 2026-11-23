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
	return `(+${currency === "USD" ? "$" : `${currency} `}${charges.toFixed(2)})`;
}

function emitWindow(
	pi: ExtensionAPI,
	segmentId: string,
	window: RateWindow | undefined,
	barSegments: number,
	observedAt: number,
	options: { amounts: boolean; overage: boolean },
): void {
	if (!window) {
		pi.events.emit("powerbar:update", { id: segmentId, text: undefined });
		return;
	}

	const pct = Math.round(window.usedPercent);
	const label = window.label || "";
	const reset = formatResetAt(window.resetAt, observedAt) ?? window.resetDescription ?? "";

	const amounts = options.amounts ? formatAmounts(window) : undefined;
	const overage = options.overage ? formatOverage(window) : undefined;

	const textParts: string[] = [];
	if (label) textParts.push(label);
	if (amounts && reset) textParts.push(`${amounts} · ${reset}`);
	else if (amounts || reset) textParts.push(amounts ?? reset);

	pi.events.emit("powerbar:update", {
		id: segmentId,
		text: textParts.join(" "),
		suffix: overage ? `${pct}% ${overage}` : `${pct}%`,
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
	const options = { amounts: readFlag("sub-amounts"), overage: readFlag("sub-overage") };
	emitWindow(pi, "sub-hourly", usage.windows[0], 5, observedAt, options);
	emitWindow(pi, "sub-weekly", usage.windows[1], 7, observedAt, options);
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
