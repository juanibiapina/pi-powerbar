import assert from "node:assert/strict";
import test from "node:test";
import createExtension from "../src/powerbar-model/index.ts";

function createPi(initialThinkingLevel = "low") {
	const listeners = new Map();
	const emitted = [];
	const pi = {
		events: {
			emit(event, payload) {
				emitted.push({ event, payload });
			},
		},
		getThinkingLevel() {
			return initialThinkingLevel;
		},
		on(event, handler) {
			const handlers = listeners.get(event) ?? [];
			handlers.push(handler);
			listeners.set(event, handlers);
		},
	};

	async function fire(event, payload, ctx) {
		for (const handler of listeners.get(event) ?? []) {
			await handler(payload, ctx);
		}
	}

	return { pi, emitted, fire };
}

function reasoningModel(id = "claude") {
	return { id, provider: "anthropic", reasoning: true };
}

function virtualModel(id = "auto") {
	return { id, provider: "router", api: "pi-virtual", reasoning: true };
}

function response(model, thinkingLevel, stopReason = "stop") {
	return { role: "assistant", provider: "openai", model, thinkingLevel, stopReason };
}

function ctxWith(model, messages = []) {
	const entries = messages.map((message) => ({ type: "message", message }));
	return { model, sessionManager: { buildContextEntries: () => entries } };
}

test("updates model segment immediately when thinking level changes", async () => {
	const { pi, emitted, fire } = createPi("low");
	createExtension(pi);
	emitted.length = 0;

	await fire(
		"thinking_level_select",
		{ level: "high", previousLevel: "low" },
		{ model: reasoningModel(), thinkingLevel: "high" },
	);

	assert.deepEqual(emitted, [
		{
			event: "powerbar:update",
			payload: { id: "model", text: "claude · high", color: "dim" },
		},
	]);
});

test("model segment falls back to current thinking level on session start", async () => {
	const { pi, emitted, fire } = createPi("medium");
	createExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, ctxWith(reasoningModel("gpt")));

	assert.equal(emitted[0]?.payload?.text, "gpt · medium");
});

test("clears a stale model segment when no model is selected", async () => {
	const { pi, emitted, fire } = createPi();
	createExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, ctxWith(undefined));

	assert.deepEqual(emitted[0], {
		event: "powerbar:update",
		payload: { id: "model", text: undefined },
	});
});

test("virtual model shows the model that produced the latest response on session start", async () => {
	const { pi, emitted, fire } = createPi("high");
	createExtension(pi);
	emitted.length = 0;

	await fire(
		"session_start",
		{},
		ctxWith(virtualModel(), [response("gpt-5.6-luna", "medium"), response("gpt-5.6-sol", "low", "error")]),
	);

	assert.equal(emitted[0]?.payload?.text, "auto · high → gpt-5.6-luna · medium");
});

test("virtual model follows each successful response", async () => {
	const { pi, emitted, fire } = createPi("high");
	createExtension(pi);
	const ctx = ctxWith(virtualModel());
	await fire("session_start", {}, ctx);
	assert.equal(emitted.at(-1)?.payload?.text, "auto · high");

	await fire("message_end", { message: response("gpt-5.6-luna", "medium") }, ctx);
	assert.equal(emitted.at(-1)?.payload?.text, "auto · high → gpt-5.6-luna · medium");

	emitted.length = 0;
	await fire("message_end", { message: response("gpt-5.6-sol", "low", "aborted") }, ctx);
	await fire("message_end", { message: { role: "user" } }, ctx);
	assert.deepEqual(emitted, []);

	await fire("turn_start", {}, ctx);
	assert.equal(emitted.at(-1)?.payload?.text, "auto · high → gpt-5.6-luna · medium");
});

test("physical model does not show the responding model", async () => {
	const { pi, emitted, fire } = createPi("high");
	createExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, ctxWith(reasoningModel(), [response("gpt-5.6-luna", "medium")]));

	assert.equal(emitted[0]?.payload?.text, "claude · high");
});
