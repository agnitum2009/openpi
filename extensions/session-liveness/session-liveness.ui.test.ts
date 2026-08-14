/**
 * UI-wiring adversarial tests for session-liveness.
 *
 * session-liveness.test.ts covers the pure state layer (merging, notify,
 * reset). The bugs this extension actually shipped lived one layer up — in
 * the reconciliation between shared state and the screen — so these tests
 * drive the real extension factory through stub ExtensionAPI/UI contexts:
 *
 * - sync(): strip ↔ working-message fold ↔ restore across the busy gate
 * - working-message ownership released exactly once, never taken when idle
 * - repeated session_start (/resume) must not stack subscriptions
 * - session_shutdown best-effort teardown
 * - the in-process child topology: a print-mode instance of this same
 *   extension (an in-process subagent binds one per child session) must
 *   never write the shared liveness bus — cross-session pollution is the
 *   class of bug the busy-gate guard exists to prevent.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import sessionLiveness from "./index.ts";
import {
  getSessionLiveness,
  resetSessionLiveness,
  setRunningSubagents,
} from "../shared/session-liveness.ts";

interface WidgetCall {
  key: string;
  content: unknown;
}

interface UiCalls {
  widgets: WidgetCall[];
  workingMessages: Array<string | undefined>;
}

/** One extension instance the way a session binds it, with recording UI. */
function makeInstance(mode: "tui" | "print", hasUI: boolean) {
  const calls: UiCalls = { widgets: [], workingMessages: [] };
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx: unknown) => void>
  >();
  const ui = {
    setWidget(key: string, content: unknown) {
      calls.widgets.push({ key, content });
    },
    setWorkingMessage(message?: string) {
      calls.workingMessages.push(message);
    },
  } as unknown as ExtensionUIContext;
  const pi = {
    on(event: string, handler: (event: unknown, ctx: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  } as unknown as ExtensionAPI;
  sessionLiveness(pi);
  const ctx = { mode, hasUI, ui } as unknown as ExtensionContext;
  const emit = (event: string) => {
    for (const handler of handlers.get(event) ?? []) handler(undefined, ctx);
  };
  return { emit, calls };
}

const tuiStub = {
  requestRender() {},
};
const themeStub = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

/** Invoke the most recently mounted strip factory and render at `width`. */
function renderStrip(calls: UiCalls, width = 80): string[] {
  const mounted = [...calls.widgets]
    .reverse()
    .find((call) => typeof call.content === "function");
  assert.ok(mounted, "strip factory was never mounted");
  const factory = mounted.content as (
    tui: typeof tuiStub,
    theme: typeof themeStub,
  ) => { render(width: number): string[] };
  return factory(tuiStub, themeStub).render(width);
}

test("sync walks strip → fold → strip → hidden across the busy gate", () => {
  resetSessionLiveness();
  const parent = makeInstance("tui", true);
  parent.emit("session_start");

  // Idle + children running → static strip mounted, correct detail.
  setRunningSubagents(2);
  assert.deepEqual(renderStrip(parent.calls), ["▶ 会话运行中 · 2 subagent"]);

  // Busy + children → strip unmounted, detail folded into the working message.
  parent.emit("agent_start");
  assert.equal(parent.calls.widgets.at(-1)?.content, undefined);
  assert.deepEqual(parent.calls.workingMessages, ["Working... · 2 subagent"]);
  // Belt and braces: a stale mounted component renders nothing while busy.
  assert.deepEqual(renderStrip(parent.calls), []);

  // Count change while folded updates the fold text, not the strip.
  setRunningSubagents(1);
  assert.deepEqual(parent.calls.workingMessages, [
    "Working... · 2 subagent",
    "Working... · 1 subagent",
  ]);

  // Settle behind running children → strip back, message restored.
  parent.emit("agent_settled");
  assert.equal(typeof parent.calls.widgets.at(-1)?.content, "function");
  assert.deepEqual(parent.calls.workingMessages.at(-1), undefined);
  assert.deepEqual(renderStrip(parent.calls), ["▶ 会话运行中 · 1 subagent"]);

  // Everything settles → strip hidden, ownership already released.
  setRunningSubagents(0);
  assert.equal(parent.calls.widgets.at(-1)?.content, undefined);
  assert.equal(parent.calls.workingMessages.length, 3);
});

test("children settling mid-turn restores the message without remounting the strip", () => {
  resetSessionLiveness();
  const parent = makeInstance("tui", true);
  parent.emit("session_start");
  setRunningSubagents(2);
  parent.emit("agent_start");
  setRunningSubagents(0);

  // Ownership released exactly when the fold stopped applying…
  assert.deepEqual(parent.calls.workingMessages, [
    "Working... · 2 subagent",
    undefined,
  ]);
  // …and the strip never appears while the main agent still streams.
  parent.emit("agent_settled");
  assert.equal(parent.calls.workingMessages.length, 2);
  assert.equal(parent.calls.widgets.length, 2); // install + hide, nothing more
});

test("no children running → a busy cycle never touches widget or message", () => {
  resetSessionLiveness();
  const parent = makeInstance("tui", true);
  parent.emit("session_start");
  parent.emit("agent_start");
  parent.emit("agent_settled");
  // The plain Working loader owns the screen; liveness must stay invisible.
  assert.equal(parent.calls.widgets.length, 0);
  assert.equal(parent.calls.workingMessages.length, 0);
});

test("in-process child instances cannot pollute the shared busy gate", () => {
  resetSessionLiveness();
  const parent = makeInstance("tui", true);
  parent.emit("session_start");
  // Same process ⇒ same module bus: this is the real subagent topology.
  const child = makeInstance("print", false);

  // The child's session lifecycle must neither reset the parent's
  // subscription nor flip the shared busy gate on its own agent loops.
  child.emit("session_start");
  child.emit("agent_start");
  assert.equal(getSessionLiveness().mainAgentBusy, false);
  child.emit("agent_settled");
  assert.equal(getSessionLiveness().mainAgentBusy, false);

  // The parent's subscription survived the child session boundary…
  setRunningSubagents(1);
  assert.equal(parent.calls.widgets.length, 1);
  assert.deepEqual(renderStrip(parent.calls), ["▶ 会话运行中 · 1 subagent"]);

  // …and only the parent's own agent loop drives the gate.
  parent.emit("agent_start");
  assert.equal(getSessionLiveness().mainAgentBusy, true);
  parent.emit("agent_settled");
  assert.equal(getSessionLiveness().mainAgentBusy, false);
});

test("repeated session_start (resume) never stacks subscriptions", () => {
  resetSessionLiveness();
  const parent = makeInstance("tui", true);
  parent.emit("session_start");
  parent.emit("session_start"); // pi re-fires it on every /resume

  setRunningSubagents(1);
  assert.equal(parent.calls.widgets.length, 1); // exactly one install
  setRunningSubagents(0);
  assert.equal(parent.calls.widgets.length, 2); // exactly one hide
});

test("session_shutdown restores the folded message and detaches", () => {
  resetSessionLiveness();
  const parent = makeInstance("tui", true);
  parent.emit("session_start");
  setRunningSubagents(1);
  parent.emit("agent_start"); // fold active, strip hidden
  parent.emit("session_shutdown");

  assert.deepEqual(parent.calls.workingMessages, [
    "Working... · 1 subagent",
    undefined, // best-effort restore of the default working message
  ]);
  // Detached: later state changes produce no further UI calls.
  setRunningSubagents(0);
  assert.equal(parent.calls.widgets.length, 2); // install + hide only
  assert.equal(parent.calls.workingMessages.length, 2);
});
