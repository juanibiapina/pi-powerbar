/**
 * Powerbar Model Producer
 *
 * Shows the current model name and thinking level.
 * Segment ID: "model"
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

function emitModel(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const model = ctx.model;
	if (!model) return;

	const modelId = model.id;
	let text = modelId;

	// Add thinking level if model supports reasoning
	if (model.reasoning) {
		const level = pi.getThinkingLevel();
		text = level === "off" ? `${modelId} · off` : `${modelId} · ${level}`;
	}

	pi.events.emit("powerbar:update", {
		id: "model",
		text,
		color: "dim",
	});
}

export default function createExtension(pi: ExtensionAPI): void {
	pi.events.emit("powerbar:register-segment", { id: "model", label: "Model" });

	pi.on("session_start", async (_event, ctx) => {
		emitModel(pi, ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		emitModel(pi, ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		emitModel(pi, ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		emitModel(pi, ctx);
	});
}
