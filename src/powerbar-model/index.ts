/**
 * Powerbar Model Producer
 *
 * Shows the current model name and thinking level. When a virtual model is
 * selected, also shows the physical model and thinking level that produced
 * the latest response, like pi's default footer.
 * Segment ID: "model"
 */

import type { ExtensionAPI, ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";

const VIRTUAL_MODEL_API = "pi-virtual";

type Route = { model: string; thinkingLevel?: string };

function routeOf(message: MessageEndEvent["message"]): Route | undefined {
	if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") {
		return undefined;
	}
	return { model: message.model, thinkingLevel: message.thinkingLevel };
}

function findLatestRoute(ctx: ExtensionContext): Route | undefined {
	const entries = ctx.sessionManager.buildContextEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		const route = entry.type === "message" ? routeOf(entry.message) : undefined;
		if (route) return route;
	}
	return undefined;
}

function emitModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	route: Route | undefined,
	thinkingLevel?: ReturnType<ExtensionAPI["getThinkingLevel"]>,
): void {
	const model = ctx.model;
	if (!model) {
		pi.events.emit("powerbar:update", { id: "model", text: undefined });
		return;
	}

	let text = model.id;

	if (model.reasoning) {
		text = `${text} · ${thinkingLevel ?? pi.getThinkingLevel()}`;
	}

	if (route && model.api === VIRTUAL_MODEL_API) {
		text = `${text} → ${route.model}`;
		if (route.thinkingLevel) text = `${text} · ${route.thinkingLevel}`;
	}

	pi.events.emit("powerbar:update", {
		id: "model",
		text,
		color: "dim",
	});
}

export default function createExtension(pi: ExtensionAPI): void {
	let route: Route | undefined;

	pi.events.emit("powerbar:register-segment", { id: "model", label: "Model" });

	function rescan(ctx: ExtensionContext): void {
		route = findLatestRoute(ctx);
		emitModel(pi, ctx, route);
	}

	pi.on("session_start", async (_event, ctx) => rescan(ctx));
	pi.on("session_tree", async (_event, ctx) => rescan(ctx));
	pi.on("session_compact", async (_event, ctx) => rescan(ctx));

	pi.on("message_end", async (event, ctx) => {
		const latest = routeOf(event.message);
		if (!latest) return;
		route = latest;
		emitModel(pi, ctx, route);
	});

	pi.on("model_select", async (_event, ctx) => {
		emitModel(pi, ctx, route);
	});

	pi.on("thinking_level_select", async (event, ctx) => {
		emitModel(pi, ctx, route, event.level);
	});

	pi.on("turn_start", async (_event, ctx) => {
		emitModel(pi, ctx, route);
	});
}
