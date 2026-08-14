/**
 * Session liveness: whether ANY work is still in flight in this session —
 * background subagents or workflows; the main agent's own streaming is
 * tracked separately as mainAgentBusy. The liveness strip (the
 * session-liveness extension) is a static dim notice shown only while
 * children run behind an idle main agent, so a glance at the screen always
 * answers "is the session still running?" even when pi's Working loader has
 * settled (omp keeps its anchored HUD visible the same way). While the main
 * agent streams, the strip stays hidden and its detail is folded into the
 * working message — one activity indicator on screen at a time.
 *
 * Counters are merged here: subagents publishes its running count, workflows
 * publishes its own; the merged state is what consumers subscribe to.
 *
 * Bus safety: this is process-global module state, and in-process subagents
 * bind every package extension again with mode "print" — so writers must be
 * tui/hasUI-gated. session-liveness-drift.test.ts fails closed on any
 * unclassified importer of this module.
 */

export interface SessionLiveness {
  readonly active: boolean;
  /** Compact human summary, e.g. "2 subagent · 1 workflow". */
  readonly detail: string;
  readonly runningSubagents: number;
  readonly runningWorkflows: number;
  /**
   * Whether the MAIN agent is currently running (agent_start → agent_settled).
   * The liveness strip exists for the "main agent idle behind detached
   * children" case; while the main agent streams, pi's own Working loader is
   * already on screen and a second animated strip would duplicate it (the
   * exact multi-working-display bug this gate fixes). Consumers show the
   * strip only when `active && !mainAgentBusy`, and fold `detail` into the
   * working message instead while `mainAgentBusy`.
   */
  readonly mainAgentBusy: boolean;
}

let runningSubagents = 0;
let runningWorkflows = 0;
let mainAgentBusy = false;
let listeners: Array<(state: SessionLiveness) => void> = [];

function merged(): SessionLiveness {
  const parts: string[] = [];
  if (runningSubagents > 0) parts.push(`${runningSubagents} subagent`);
  if (runningWorkflows > 0) parts.push(`${runningWorkflows} workflow`);
  return {
    active: runningSubagents > 0 || runningWorkflows > 0,
    detail: parts.join(" · "),
    runningSubagents,
    runningWorkflows,
    mainAgentBusy,
  };
}

function notify() {
  const state = merged();
  for (const listener of listeners) listener(state);
}

export function getSessionLiveness(): SessionLiveness {
  return merged();
}

export function setRunningSubagents(count: number): void {
  if (count === runningSubagents) return;
  runningSubagents = count;
  notify();
}

export function setRunningWorkflows(count: number): void {
  if (count === runningWorkflows) return;
  runningWorkflows = count;
  notify();
}

export function setMainAgentBusy(busy: boolean): void {
  if (busy === mainAgentBusy) return;
  mainAgentBusy = busy;
  notify();
}

export function subscribeSessionLiveness(
  listener: (state: SessionLiveness) => void,
): () => void {
  listeners.push(listener);
  listener(merged());
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function resetSessionLiveness(): void {
  runningSubagents = 0;
  runningWorkflows = 0;
  mainAgentBusy = false;
  listeners = [];
}
