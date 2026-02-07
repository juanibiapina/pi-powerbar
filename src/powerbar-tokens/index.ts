/**
 * Powerbar Tokens Producer
 *
 * Shows cumulative token stats and session cost.
 * Segment ID: "tokens"
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

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
		if (entry.type === "message" && entry.message.role === "assistant") {
			totalInput += entry.message.usage.input;
			totalOutput += entry.message.usage.output;
			totalCost += entry.message.usage.cost.total;
		}
	}

	if (totalInput === 0 && totalOutput === 0) return;

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
	// Reset on new/switched session
	pi.on("session_start", async () => resetTokens(pi));
	pi.on("session_switch", async () => resetTokens(pi));

	// Update frequently during agent work
	pi.on("tool_result", async (_event, ctx) => emitTokens(pi, ctx));
	pi.on("turn_end", async (_event, ctx) => emitTokens(pi, ctx));
}
