import { sanitizeTerminalText } from "../shared/terminal-text.ts";

interface AskUserAnswer {
  readonly id: string;
  readonly selected?: string;
  readonly note?: string;
  readonly custom?: string;
  readonly rephrase?: true;
}

function safeSingleLine(value: string) {
  return sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
}

/** Model-facing schema descriptions for structured user questions. */
export const ASK_USER_PARAMETER_DESCRIPTIONS = {
  id: "Stable snake_case identifier used to map the answer",
  header: "Short UI header, ideally 12 characters or fewer",
  optionLabel:
    'Concise user-facing label. Put the recommended option first and suffix its label with "(Recommended)".',
  optionDescription:
    "One short sentence explaining the impact or tradeoff if selected",
  optionPreview:
    "Optional concrete artifact shown while this option is highlighted — a short code snippet, config, or ASCII layout the user can compare against the other options. Lines are shown as written (indentation preserved, no re-wrapping), so keep them narrow. Omit unless seeing the artifact genuinely changes the decision; the description already carries the tradeoff.",
  question: "A single-sentence question shown to the user",
  options:
    "Between 2 and 5 mutually exclusive choices. Never include an Other/custom option; the UI adds one automatically.",
  questions:
    "One to three independent questions (see the tool guidelines for when to batch more than one).",
};

export const ASK_USER_TOOL_DESCRIPTION =
  "Ask the user one to three short, independent multiple-choice questions and wait for explicitly reviewed answers. Each question gets a free-form answer option; submitting it blank requests a clearer or split question. The user may add notes, revise any draft answer from the review screen, or dismiss the request. Prefer one question unless several independent decisions should be answered together.";

export const ASK_USER_PROMPT_SNIPPET =
  "Ask 1-3 structured user questions with draft answers, final review, optional notes, and free-form answers";

export const ASK_USER_PROMPT_GUIDELINES = [
  "Use ask_user only for genuine ambiguity unresolvable from code/docs/conversation that materially changes the result; never to ask whether to continue.",
  "Provide mutually exclusive options, recommendation first (label '(Recommended)'), and each option's impact or tradeoff.",
  "Prefer one question; up to three only when independent and batching avoids round trips.",
  "One question per independent review finding, max three; never ask about findings you are already authorized to fix.",
  "A blank free-form answer means rephrase or split — never treat as consent, rejection, or an empty factual answer.",
];

export function buildAskUserResultMessage(
  outcome:
    | { kind: "no-ui" }
    | { kind: "cancelled" }
    | { kind: "dismissed" }
    | { kind: "answered"; answers: readonly AskUserAnswer[] },
) {
  switch (outcome.kind) {
    case "no-ui":
      return "No interactive UI is available, so the questions could not be shown. Ask the user in plain text instead.";
    case "cancelled":
      return "Cancelled";
    case "dismissed":
      return "User dismissed the questions without answering. Do not assume answers; proceed accordingly or ask differently.";
    case "answered":
      return `User answered:\n${outcome.answers
        .map((answer) => {
          const id = safeSingleLine(answer.id);
          const value = answer.rephrase
            ? "[rephrase or split this question]"
            : safeSingleLine(
                answer.custom ?? answer.selected ?? "(unanswered)",
              );
          const note = answer.note
            ? ` — note: ${safeSingleLine(answer.note)}`
            : "";
          return `- ${id}: ${value}${note}`;
        })
        .join("\n")}`;
  }
}
