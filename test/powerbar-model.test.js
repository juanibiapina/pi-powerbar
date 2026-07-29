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

	await fire("session_start", {}, { model: reasoningModel("gpt") });

	assert.equal(emitted[0]?.payload?.text, "gpt · medium");
});

test("clears a stale model segment when no model is selected", async () => {
	const { pi, emitted, fire } = createPi();
	createExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, { model: undefined });

	assert.deepEqual(emitted[0], {
		event: "powerbar:update",
		payload: { id: "model", text: undefined },
	});
});
