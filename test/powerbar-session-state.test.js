import assert from "node:assert/strict";
import test from "node:test";
import createContextExtension from "../src/powerbar-context/index.ts";
import createProviderExtension from "../src/powerbar-provider/index.ts";
import createTokensExtension from "../src/powerbar-tokens/index.ts";

function createPi() {
	const listeners = new Map();
	const emitted = [];
	const pi = {
		events: {
			emit(event, payload) {
				emitted.push({ event, payload });
			},
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

function lastUpdate(emitted, id) {
	return emitted.findLast((entry) => entry.event === "powerbar:update" && entry.payload?.id === id)?.payload;
}

test("restores context usage immediately on session start", async () => {
	const { pi, emitted, fire } = createPi();
	createContextExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, {
		getContextUsage: () => ({ tokens: 25_000, contextWindow: 100_000 }),
	});

	assert.deepEqual(lastUpdate(emitted, "context-usage"), {
		id: "context-usage",
		text: "",
		suffix: "25%",
		bar: 25,
		barSegments: 1,
		color: "muted",
	});
});

test("clears context usage when session usage is unavailable", async () => {
	const { pi, emitted, fire } = createPi();
	createContextExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, { getContextUsage: () => undefined });

	assert.deepEqual(lastUpdate(emitted, "context-usage"), { id: "context-usage", text: undefined });
});

test("refreshes context usage immediately after compaction", async () => {
	const { pi, emitted, fire } = createPi();
	createContextExtension(pi);
	emitted.length = 0;

	await fire("session_compact", {}, { getContextUsage: () => undefined });

	assert.deepEqual(lastUpdate(emitted, "context-usage"), { id: "context-usage", text: undefined });
});

test("restores token totals immediately on session start", async () => {
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, {
		sessionManager: {
			getEntries: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						usage: { input: 1_500, output: 250, cost: { total: 0.123 } },
					},
				},
				{
					type: "message",
					message: {
						role: "toolResult",
						usage: { input: 500, output: 50, cost: { total: 0.01 } },
					},
				},
				{
					type: "compaction",
					usage: { input: 1_000, output: 100, cost: { total: 0.02 } },
				},
			],
		},
	});

	assert.deepEqual(lastUpdate(emitted, "tokens"), {
		id: "tokens",
		text: "↑3.0k ↓400 $0.15",
		color: "dim",
	});
});

test("clears token totals for an empty session", async () => {
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, { sessionManager: { getEntries: () => [] } });

	assert.deepEqual(lastUpdate(emitted, "tokens"), { id: "tokens", text: undefined });
});

test("refreshes token totals immediately after compaction", async () => {
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);
	emitted.length = 0;

	await fire("session_compact", {}, {
		sessionManager: {
			getEntries: () => [
				{
					type: "compaction",
					usage: { input: 2_000, output: 100, cost: { total: 0.05 } },
				},
			],
		},
	});

	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑2.0k ↓100 $0.05");
});

test("clears a stale provider segment when no model is selected", async () => {
	const { pi, emitted, fire } = createPi();
	createProviderExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, { model: undefined });

	assert.deepEqual(lastUpdate(emitted, "provider"), { id: "provider", text: undefined });
});
