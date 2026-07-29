/**
 * Powerbar Model Producer
 *
 * Shows the current model name and thinking level.
 * Segment ID: "model"
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function emitModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	thinkingLevel?: ReturnType<ExtensionAPI["getThinkingLevel"]>,
): void {
	const model = ctx.model;
	if (!model) {
		pi.events.emit("powerbar:update", { id: "model", text: undefined });
		return;
	}

	const modelId = model.id;
	let text = modelId;

	// Add thinking level if model supports reasoning
	if (model.reasoning) {
		const level = thinkingLevel ?? pi.getThinkingLevel();
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

	pi.on("model_select", async (_event, ctx) => {
		emitModel(pi, ctx);
	});

	pi.on("thinking_level_select", async (event, ctx) => {
		emitModel(pi, ctx, event.level);
	});

	pi.on("turn_start", async (_event, ctx) => {
		emitModel(pi, ctx);
	});
}
