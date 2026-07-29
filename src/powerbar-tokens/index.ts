/**
 * Powerbar Tokens Producer
 *
 * Shows cumulative token stats and session cost.
 * Segment ID: "tokens"
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function emitTokens(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const entries = ctx.sessionManager.getEntries();

	let totalInput = 0;
	let totalOutput = 0;
	let totalCost = 0;

	for (const entry of entries) {
		let usage: { input: number; output: number; cost: { total: number } } | undefined;
		if (
			entry.type === "message" &&
			(entry.message.role === "assistant" || entry.message.role === "toolResult")
		) {
			usage = entry.message.usage;
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			usage = entry.usage;
		}

		if (usage) {
			totalInput += usage.input;
			totalOutput += usage.output;
			totalCost += usage.cost.total;
		}
	}

	if (totalInput === 0 && totalOutput === 0) {
		resetTokens(pi);
		return;
	}

	const parts: string[] = [];
	parts.push(`↑${formatTokens(totalInput)}`);
	parts.push(`↓${formatTokens(totalOutput)}`);
	if (totalCost > 0) {
		parts.push(`$${totalCost.toFixed(2)}`);
	}

	pi.events.emit("powerbar:update", {
		id: "tokens",
		text: parts.join(" "),
		color: "dim",
	});
}

function resetTokens(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:update", {
		id: "tokens",
		text: undefined,
	});
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "tokens", label: "Tokens" });

	// Restore totals immediately when starting or switching sessions.
	pi.on("session_start", async (_event, ctx) => emitTokens(pi, ctx));

	// Update during agent work and after entries are added by session operations.
	pi.on("tool_result", async (_event, ctx) => emitTokens(pi, ctx));
	pi.on("turn_end", async (_event, ctx) => emitTokens(pi, ctx));
	pi.on("session_compact", async (_event, ctx) => emitTokens(pi, ctx));
	pi.on("session_tree", async (_event, ctx) => emitTokens(pi, ctx));
}
