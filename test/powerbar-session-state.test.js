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
						usage: {
							input: 1_500,
							output: 250,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { total: 0.123 },
						},
					},
				},
				{
					type: "message",
					message: {
						role: "toolResult",
						usage: { input: 500, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
					},
				},
				{
					type: "compaction",
					usage: { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } },
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
					usage: { input: 2_000, output: 100, cacheRead: 0, cacheWrite: 0, cost: { total: 0.05 } },
				},
			],
		},
	});

	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑2.0k ↓100 $0.05");
});

async function emitTokensFor(entries) {
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);
	emitted.length = 0;
	await fire("session_start", {}, { sessionManager: { getEntries: () => entries } });
	return lastUpdate(emitted, "tokens")?.text;
}

function assistant(usage) {
	return { type: "message", message: { role: "assistant", usage } };
}

test("accumulates cache totals and reports the latest request hit rate", async () => {
	const text = await emitTokensFor([
		assistant({ input: 1_000, output: 200, cacheRead: 4_000, cacheWrite: 1_000, cost: { total: 0.1 } }),
		assistant({ input: 3_000, output: 200, cacheRead: 20_000, cacheWrite: 2_000, cost: { total: 0.05 } }),
	]);

	// R/W are session totals; CH is only the last assistant request: 20000 / 25000.
	assert.equal(text, "↑4.0k ↓400 R24k W3.0k CH80.0% $0.15");
});

test("counts cache usage from tool results and compactions without changing the hit rate", async () => {
	const text = await emitTokensFor([
		assistant({ input: 3_000, output: 200, cacheRead: 20_000, cacheWrite: 2_000, cost: { total: 0.1 } }),
		{
			type: "message",
			message: {
				role: "toolResult",
				usage: { input: 0, output: 100, cacheRead: 5_000, cacheWrite: 500, cost: { total: 0.03 } },
			},
		},
		{
			type: "compaction",
			usage: { input: 0, output: 100, cacheRead: 1_000, cacheWrite: 500, cost: { total: 0.02 } },
		},
	]);

	assert.equal(text, "↑3.0k ↓400 R26k W3.0k CH80.0% $0.15");
});

test("drops the hit rate when the latest assistant request has no prompt tokens", async () => {
	const text = await emitTokensFor([
		assistant({ input: 3_000, output: 200, cacheRead: 20_000, cacheWrite: 2_000, cost: { total: 0.1 } }),
		assistant({ input: 0, output: 200, cacheRead: 0, cacheWrite: 0, cost: { total: 0.05 } }),
	]);

	assert.equal(text, "↑3.0k ↓400 R20k W2.0k $0.15");
});

test("renders no cache parts for a session without cache usage", async () => {
	const text = await emitTokensFor([
		assistant({ input: 3_000, output: 400, cacheRead: 0, cacheWrite: 0, cost: { total: 0.15 } }),
	]);

	assert.equal(text, "↑3.0k ↓400 $0.15");
});

test("clears a stale provider segment when no model is selected", async () => {
	const { pi, emitted, fire } = createPi();
	createProviderExtension(pi);
	emitted.length = 0;

	await fire("session_start", {}, { model: undefined });

	assert.deepEqual(lastUpdate(emitted, "provider"), { id: "provider", text: undefined });
});
