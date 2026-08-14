/**
 * session-liveness: a screen-level "still running" notice.
 *
 * pi's built-in Working loader only shows while the MAIN agent streams; when
 * it settles behind detached subagents or workflows the screen goes still and
 * nothing says the session is alive. This extension covers exactly that gap,
 * following omp's one-activity-indicator discipline:
 *
 * - Main agent BUSY + children running → no extra strip (the Working loader
 *   is already the screen's single activity indicator); the child summary is
 *   folded into the working message instead ("Working... · 2 subagent").
 * - Main agent IDLE + children running → a static dim strip above the editor
 *   ("▶ 会话运行中 · 2 subagent"). Deliberately NOT animated and deliberately
 *   NOT the loader's gradient bar: duplicating the loader's visual was the
 *   multi-working-display bug (two identical gradient bars on screen).
 * - Everything settled → strip hidden, working message restored.
 *
 * DDD: pure state in shared/session-liveness.ts; this file is the UI wiring.
 */

import type {
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  resetSessionLiveness,
  setMainAgentBusy,
  subscribeSessionLiveness,
  type SessionLiveness,
} from "../shared/session-liveness.ts";

const WIDGET_KEY = "session-liveness";

export default function sessionLiveness(pi: ExtensionAPI) {
  let last: SessionLiveness = {
    active: false,
    detail: "",
    runningSubagents: 0,
    runningWorkflows: 0,
    mainAgentBusy: false,
  };
  let installed = false;
  /** True only while OUR fold owns the working message, so restoring never
   *  clobbers a message some other extension set. */
  let workingMessageOwned = false;
  let repaint: (() => void) | undefined;
  let unsubLiveness: (() => void) | undefined;

  const hide = (ui: ExtensionUIContext) => {
    if (!installed) return;
    repaint = undefined;
    ui.setWidget(WIDGET_KEY, undefined);
    installed = false;
  };

  const install = (ui: ExtensionUIContext) => {
    if (installed) {
      // Already mounted; the detail text may have changed (2 → 1 subagent).
      repaint?.();
      return;
    }
    installed = true;
    ui.setWidget(WIDGET_KEY, (tui, theme) => {
      // State-change one-shot repaint: direct requestRender, matching the
      // subagents/workflows widgets. The requestWidgetRepaint choke point
      // exists for timer-driven repaint loops, which this static strip
      // (no animation timer) no longer has.
      repaint = () => tui.requestRender();
      return {
        render(width: number) {
          const state = last;
          // Belt and braces: mounted state must match visibility rules.
          if (!state.active || state.mainAgentBusy) return [];
          const detail = state.detail ? ` · ${state.detail}` : "";
          const line = `${theme.fg("accent", theme.bold("▶"))} ${theme.fg("dim", `会话运行中${detail}`)}`;
          return [line.slice(0, width)];
        },
        invalidate() {},
      };
    });
  };

  /** Reconcile strip visibility and the working-message fold with `last`. */
  const sync = (ui: ExtensionUIContext) => {
    const state = last;
    if (state.active && !state.mainAgentBusy) install(ui);
    else hide(ui);

    if (state.active && state.mainAgentBusy && state.detail) {
      ui.setWorkingMessage(`Working... · ${state.detail}`);
      workingMessageOwned = true;
    } else if (workingMessageOwned) {
      ui.setWorkingMessage();
      workingMessageOwned = false;
    }
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    // pi re-fires session_start on every /resume: without an explicit
    // unsubscribe each start would stack another listener (and its captured
    // old ctx) onto the shared bus — N resumes ⇒ N duplicate install/hide
    // callbacks per liveness change (adversarial finding). Reset the bus at
    // the session boundary, then subscribe exactly once for this session.
    unsubLiveness?.();
    resetSessionLiveness();
    installed = false;
    workingMessageOwned = false;
    unsubLiveness = subscribeSessionLiveness((state) => {
      last = state;
      sync(ctx.ui);
    });
  });

  // The busy gate: agent_start → agent_settled brackets "main agent running".
  // These write shared state; the subscriber above turns the change into UI.
  // The mode/hasUI guard is load-bearing: in-process subagents bind this same
  // extension with mode "print", and without the guard every child agent loop
  // would flip the shared busy flag — suppressing the parent's strip exactly
  // when children run (its core case) and flickering it on/off per child turn.
  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    setMainAgentBusy(true);
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    setMainAgentBusy(false);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    unsubLiveness?.();
    unsubLiveness = undefined;
    try {
      if (workingMessageOwned) ctx.ui.setWorkingMessage();
      hide(ctx.ui);
    } catch {
      // UI may already be disposed; best-effort teardown.
    }
    workingMessageOwned = false;
  });
}
