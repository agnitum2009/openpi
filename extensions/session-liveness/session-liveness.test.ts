import assert from "node:assert/strict";
import test from "node:test";
import {
  getSessionLiveness,
  resetSessionLiveness,
  setMainAgentBusy,
  setRunningSubagents,
  setRunningWorkflows,
  subscribeSessionLiveness,
} from "../shared/session-liveness.ts";

test("liveness merges subagent and workflow counters", () => {
  resetSessionLiveness();
  assert.deepEqual(getSessionLiveness(), {
    active: false,
    detail: "",
    runningSubagents: 0,
    runningWorkflows: 0,
    mainAgentBusy: false,
  });
  setRunningSubagents(2);
  assert.equal(getSessionLiveness().active, true);
  assert.equal(getSessionLiveness().detail, "2 subagent");
  setRunningWorkflows(1);
  assert.equal(getSessionLiveness().detail, "2 subagent · 1 workflow");
  setRunningSubagents(0);
  assert.equal(getSessionLiveness().detail, "1 workflow");
  setRunningWorkflows(0);
  assert.equal(getSessionLiveness().active, false);
});

test("subscribers are notified on change only", () => {
  resetSessionLiveness();
  const seen: string[] = [];
  subscribeSessionLiveness((s) => seen.push(s.detail));
  setRunningSubagents(1);
  setRunningSubagents(1); // no-op, no notification
  setRunningSubagents(0);
  assert.deepEqual(seen, ["", "1 subagent", ""]);
});

test("main-agent busy gate rides the merged state", () => {
  resetSessionLiveness();
  // Busy alone never activates liveness: no children, nothing to report.
  setMainAgentBusy(true);
  assert.deepEqual(getSessionLiveness(), {
    active: false,
    detail: "",
    runningSubagents: 0,
    runningWorkflows: 0,
    mainAgentBusy: true,
  });
  // Children while busy: active, but consumers must fold instead of
  // mounting the strip (strip rule is active && !mainAgentBusy).
  setRunningSubagents(2);
  assert.equal(getSessionLiveness().active, true);
  assert.equal(getSessionLiveness().mainAgentBusy, true);
  // Main agent settles behind running children: strip case.
  setMainAgentBusy(false);
  assert.equal(getSessionLiveness().active, true);
  assert.equal(getSessionLiveness().mainAgentBusy, false);
});

test("busy transitions notify subscribers on change only", () => {
  resetSessionLiveness();
  const seen: boolean[] = [];
  subscribeSessionLiveness((s) => seen.push(s.mainAgentBusy));
  setMainAgentBusy(true);
  setMainAgentBusy(true); // no-op, no notification
  setMainAgentBusy(false);
  assert.deepEqual(seen, [false, true, false]);
});

test("reset clears the busy gate alongside the counters", () => {
  resetSessionLiveness();
  setMainAgentBusy(true);
  setRunningWorkflows(1);
  resetSessionLiveness();
  assert.deepEqual(getSessionLiveness(), {
    active: false,
    detail: "",
    runningSubagents: 0,
    runningWorkflows: 0,
    mainAgentBusy: false,
  });
});
