/**
 * Powerbar Tokens Producer
 *
 * Shows cumulative token stats and session cost.
 * Segment ID: "tokens"
 *
 * Totals are accumulated incrementally: each update only scans entries
 * appended since the previous update. A full recompute from all entries
 * happens on session start, compaction, or when the session is reset,
 * forked, or the leaf moves without a matching append (shrunken entry
 * list, changed root, or moved leaf).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type EntryUsage = {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost: { total: number };
};

type TokenEntry = {
	type: string;
	id?: string;
	message?: { role?: string; usage?: EntryUsage };
	usage?: EntryUsage;
};

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function extractUsage(entry: TokenEntry): { usage: EntryUsage; isAssistant: boolean } | undefined {
	if (entry.type === "message" && (entry.message?.role === "assistant" || entry.message?.role === "toolResult")) {
		const usage = entry.message?.usage;
		if (!usage) return undefined;
		return { usage, isAssistant: entry.message?.role === "assistant" };
	}
	if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
		return { usage: entry.usage, isAssistant: false };
	}
	return undefined;
}

/** Incremental cumulative token state for the current session. */
interface TokenState {
	/** Number of entries whose usage has been folded into the totals. */
	count: number;
	/** id of the first entry when the state (re)started; undefined if entries carry no ids. */
	rootId: string | undefined;
	/** id of entries[count - 1]; undefined if entries carry no ids. */
	lastEntryId: string | undefined;
	/** Last seen leaf entry id (null when the session manager does not report one). */
	leafId: string | null;
	totalInput: number;
	totalOutput: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
	latestCacheHitRate: number | undefined;
}

function applyEntry(state: TokenState, entry: TokenEntry): void {
	const extracted = extractUsage(entry);
	if (!extracted) return;

	const usage = extracted.usage;
	const cacheRead = usage.cacheRead ?? 0;
	const cacheWrite = usage.cacheWrite ?? 0;
	state.totalInput += usage.input;
	state.totalOutput += usage.output;
	state.totalCacheRead += cacheRead;
	state.totalCacheWrite += cacheWrite;
	state.totalCost += usage.cost.total;

	if (extracted.isAssistant) {
		const promptTokens = usage.input + cacheRead + cacheWrite;
		state.latestCacheHitRate = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
	}
}

/**
 * True when `entries` is a pure append of the previously seen entry list,
 * so the delta can be processed instead of a full recompute.
 */
function canIncrement(prev: TokenState, entries: TokenEntry[], leafId: string | null): boolean {
	// Session shrank (reset/fork) or was rewritten.
	if (entries.length < prev.count) return false;
	// The already-processed prefix changed (new root or rewritten entries).
	if (prev.count > 0 && entries[prev.count - 1]?.id !== prev.lastEntryId) return false;
	if (prev.rootId !== undefined && entries.length > 0 && entries[0]?.id !== prev.rootId) return false;
	// Leaf moved without new entries (branch switch).
	if (leafId !== prev.leafId && entries.length === prev.count) return false;
	return true;
}

function emitTotals(pi: ExtensionAPI, state: TokenState): void {
	if (state.totalInput === 0 && state.totalOutput === 0) {
		pi.events.emit("powerbar:update", {
			id: "tokens",
			text: undefined,
		});
		return;
	}

	const parts: string[] = [];
	parts.push(`↑${formatTokens(state.totalInput)}`);
	parts.push(`↓${formatTokens(state.totalOutput)}`);
	if (state.totalCacheRead > 0) {
		parts.push(`R${formatTokens(state.totalCacheRead)}`);
	}
	if (state.totalCacheWrite > 0) {
		parts.push(`W${formatTokens(state.totalCacheWrite)}`);
	}
	if ((state.totalCacheRead > 0 || state.totalCacheWrite > 0) && state.latestCacheHitRate !== undefined) {
		parts.push(`CH${state.latestCacheHitRate.toFixed(1)}%`);
	}
	if (state.totalCost > 0) {
		parts.push(`$${state.totalCost.toFixed(2)}`);
	}

	pi.events.emit("powerbar:update", {
		id: "tokens",
		text: parts.join(" "),
		color: "dim",
	});
}

export default function createExtension(pi: ExtensionAPI): void {
	let state: TokenState | undefined;

	pi.events.emit("powerbar:register-segment", { id: "tokens", label: "Tokens" });

	function emit(ctx: ExtensionContext, force: boolean): void {
		const entries = ctx.sessionManager.getEntries();
		const leafId = ctx.sessionManager.getLeafId?.() ?? null;

		if (state === undefined || force || !canIncrement(state, entries, leafId)) {
			const fresh: TokenState = {
				count: entries.length,
				rootId: entries.length > 0 ? entries[0]?.id : undefined,
				lastEntryId: entries.length > 0 ? entries[entries.length - 1]?.id : undefined,
				leafId,
				totalInput: 0,
				totalOutput: 0,
				totalCacheRead: 0,
				totalCacheWrite: 0,
				totalCost: 0,
				latestCacheHitRate: undefined,
			};
			for (const entry of entries) applyEntry(fresh, entry);
			state = fresh;
		} else {
			const prevCount = state.count;
			const prevLeaf = state.leafId;
			for (let i = prevCount; i < entries.length; i++) applyEntry(state, entries[i]);
			if (entries.length > 0) state.lastEntryId = entries[entries.length - 1]?.id;
			state.count = entries.length;
			state.leafId = leafId;
			// Nothing new and the leaf did not move: totals are unchanged, skip re-emitting.
			if (entries.length === prevCount && leafId === prevLeaf) return;
		}

		emitTotals(pi, state);
	}

	// Restore totals immediately when starting or switching sessions.
	pi.on("session_start", async (_event, ctx) => emit(ctx, true));

	// Update during agent work and after entries are added by session operations.
	pi.on("tool_result", async (_event, ctx) => emit(ctx, false));
	pi.on("turn_end", async (_event, ctx) => emit(ctx, false));
	pi.on("session_compact", async (_event, ctx) => emit(ctx, true));
	pi.on("session_tree", async (_event, ctx) => emit(ctx, false));
}
