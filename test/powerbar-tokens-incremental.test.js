import assert from "node:assert/strict";
import test from "node:test";
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

function entry(id, usage) {
	return { id, type: "message", message: { role: "assistant", usage } };
}

test("only processes entries appended since the last update", async () => {
	const entries = [
		entry("e1", { input: 100, output: 10, cost: { total: 0.01 } }),
		entry("e2", { input: 200, output: 20, cost: { total: 0.02 } }),
	];
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);

	await fire("session_start", {}, { sessionManager: { getEntries: () => entries, getLeafId: () => "e2" } });
	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑300 ↓30 $0.03");

	// A tool result appends one entry; already-counted entries are not re-read.
	entries.push(entry("e3", { input: 50, output: 5, cost: { total: 0.03 } }));
	await fire("tool_result", {}, { sessionManager: { getEntries: () => entries, getLeafId: () => "e3" } });
	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑350 ↓35 $0.06");
});

test("does not re-read entries already counted on an idle turn", async () => {
	const e1 = entry("e1", { input: 100, output: 10, cost: { total: 0.01 } });
	const e2 = entry("e2", { input: 200, output: 20, cost: { total: 0.02 } });
	const entries = [e1, e2];
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);

	await fire("session_start", {}, { sessionManager: { getEntries: () => entries, getLeafId: () => "e2" } });
	const updateCount = emitted.length;

	// A full rescan would pick up this mutation; the incremental path must not.
	e1.message.usage.output = 999;
	await fire("turn_end", {}, { sessionManager: { getEntries: () => entries, getLeafId: () => "e2" } });

	assert.equal(emitted.length, updateCount, "no new entries -> no re-emit");
	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑300 ↓30 $0.03");
});

test("recomputes fully when the entry list shrinks", async () => {
	const big = [
		entry("a", { input: 100, output: 10, cost: { total: 0.01 } }),
		entry("b", { input: 200, output: 20, cost: { total: 0.02 } }),
		entry("c", { input: 300, output: 30, cost: { total: 0.03 } }),
	];
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);

	await fire("session_start", {}, { sessionManager: { getEntries: () => big, getLeafId: () => "c" } });
	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑600 ↓60 $0.06");

	// A shorter entry list with the same root entry id (e.g. a reset session).
	const shrunken = [entry("a", { input: 100, output: 10, cost: { total: 0.01 } })];
	await fire("tool_result", {}, { sessionManager: { getEntries: () => shrunken, getLeafId: () => "a" } });
	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑100 ↓10 $0.01");
});

test("recomputes fully when the leaf moves without new entries", async () => {
	const entries = [
		entry("e1", { input: 100, output: 10, cost: { total: 0.01 } }),
		entry("e2", { input: 200, output: 20, cost: { total: 0.02 } }),
	];
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);

	await fire("session_start", {}, { sessionManager: { getEntries: () => entries, getLeafId: () => "e2" } });
	const updateCount = emitted.length;

	// Branch switch: same entries, leaf moved back. Totals are unchanged but the
	// state must be recomputed (observable: a re-emit happens, unlike the idle case).
	await fire("session_tree", {}, { sessionManager: { getEntries: () => entries, getLeafId: () => "e1" } });
	assert.equal(emitted.length, updateCount + 1, "leaf moved -> full recompute re-emits");
	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑300 ↓30 $0.03");
});

test("keeps the cache hit rate from the latest assistant request across appends", async () => {
	const entries = [
		entry("e1", { input: 100, output: 10, cacheRead: 900, cacheWrite: 100, cost: { total: 0.01 } }),
	];
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);

	await fire("session_start", {}, { sessionManager: { getEntries: () => entries, getLeafId: () => "e1" } });
	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑100 ↓10 R900 W100 CH81.8% $0.01");

	// A tool result without cache stats must not change the hit rate.
	entries.push({
		id: "e2",
		type: "message",
		message: { role: "toolResult", usage: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } } },
	});
	await fire("tool_result", {}, { sessionManager: { getEntries: () => entries, getLeafId: () => "e2" } });
	assert.equal(lastUpdate(emitted, "tokens")?.text, "↑150 ↓15 R900 W100 CH81.8% $0.03");
});