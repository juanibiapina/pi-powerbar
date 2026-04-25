/**
 * Powerbar Sub Producer
 *
 * Shows subscription usage from pi-sub-core.
 * Sub-core is loaded by pi as a sibling extension (declared in package.json pi.extensions).
 *
 * We listen only to `sub-core:ready` and `sub-core:update-current`. We intentionally
 * skip `sub-core:update-all`: its entries list filters providers by cache TTL, so the
 * current provider can be missing whenever its `fetchedAt` drifts past the refresh
 * interval (e.g. during anthropic 429s, see https://github.com/marckrenn/pi-sub/issues/58).
 * `update-current` is authoritative for the current provider's usage in every case,
 * including when other pi instances refresh the shared cache (sub-core re-emits
 * `update-current` from its `onCacheUpdate` listener).
 *
 * Segment IDs: "sub-hourly", "sub-weekly"
 */

import type { RateWindow, SubCoreState } from "@marckrenn/pi-sub-shared";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

function emitUsage(pi: ExtensionAPI, state: SubCoreState | undefined): void {
	const usage = state?.usage;
	if (!usage || usage.windows.length === 0) {
		pi.events.emit("powerbar:update", { id: "sub-hourly", text: undefined });
		pi.events.emit("powerbar:update", { id: "sub-weekly", text: undefined });
		return;
	}

	emitWindow(pi, "sub-hourly", usage.windows[0], 5);
	emitWindow(pi, "sub-weekly", usage.windows[1], 7);
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "sub-hourly", label: "Sub Hourly" });
	pi.events.emit("powerbar:register-segment", { id: "sub-weekly", label: "Sub Weekly" });

	pi.events.on("sub-core:ready", (payload: unknown) => {
		emitUsage(pi, (payload as { state?: SubCoreState }).state);
	});

	pi.events.on("sub-core:update-current", (payload: unknown) => {
		emitUsage(pi, (payload as { state?: SubCoreState }).state);
	});
}
