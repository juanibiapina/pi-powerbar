/**
 * Powerbar Provider Producer
 *
 * Shows the current LLM provider name.
 * Segment ID: "provider"
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

function emitProvider(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const model = ctx.model;
	if (!model) return;

	pi.events.emit("powerbar:update", {
		id: "provider",
		text: model.provider,
		color: "dim",
	});
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "provider", label: "Provider" });

	pi.on("session_start", async (_event, ctx) => {
		emitProvider(pi, ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		emitProvider(pi, ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		emitProvider(pi, ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		emitProvider(pi, ctx);
	});
}
