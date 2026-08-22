/** Model-facing text for the read-only git tools. */

export const GIT_SHOW_TOOL_DESCRIPTION =
  "Show a git commit (message, author, and patch), optionally limited to one repository path. Read-only.";

export const GIT_SHOW_PROMPT_SNIPPET =
  "Inspect a specific git commit with git_show.";

export const GIT_SHOW_PROMPT_GUIDELINES = [
  "Use git_show to review what a single commit changed instead of reading the whole file tree and guessing.",
  "Use git_diff to compare revisions or the worktree, and git_log to find commits first.",
];

export const GIT_SHOW_PARAMETER_DESCRIPTIONS = {
  revision:
    "Commit to show: a sha (>=4 hex chars), branch or tag name, or HEAD with ~ / ^ modifiers, e.g. HEAD, HEAD~2, main.",
  path: "Optional relative path inside the repository. Limits the commit patch to this path; it does not read the file blob.",
};

export const GIT_DIFF_TOOL_DESCRIPTION =
  "Show a git diff: between two revisions, a revision and the worktree, or staged changes. Read-only.";

export const GIT_DIFF_PROMPT_SNIPPET =
  "Compare git revisions or working-tree changes with git_diff.";

export const GIT_DIFF_PROMPT_GUIDELINES = [
  "Use git_diff (not git_show) when reviewing changes between refs or uncommitted work.",
  "Set stat to true first for a broad overview, then drill into specific paths.",
  "To review a pull request, diff its branch against the base, e.g. from: 'main', to: 'feature-branch'.",
];

export const GIT_DIFF_PARAMETER_DESCRIPTIONS = {
  from: "Base revision. With to, compares from...to from their merge base (PR-style). Omit both revisions to diff the worktree against the index.",
  to: "Compared revision. Requires from and uses the merge-base range from...to. Give from alone to diff that revision against the worktree.",
  staged:
    "Compare the index (staged changes) against HEAD instead of the worktree.",
  stat: "Show a diffstat (files and line counts) instead of the full patch.",
  path: "Only diff this relative path inside the repository.",
};

export const GIT_LOG_TOOL_DESCRIPTION =
  "List commit history with sha, author, date, and first line. Filter by revision or file. Read-only.";

export const GIT_LOG_PROMPT_SNIPPET = "Browse git history with git_log.";

export const GIT_LOG_PROMPT_GUIDELINES = [
  "Use git_log with a file to find who last touched a piece of code before changing it.",
  "Keep oneline true unless the full commit message of every entry is needed.",
];

export const GIT_LOG_PARAMETER_DESCRIPTIONS = {
  revision: "History starting from this revision. Defaults to HEAD.",
  file: "Only commits touching this relative path.",
  limit: "Maximum commits to list (1-1000). Defaults to 100.",
  oneline: "One line per commit (default true); false adds full messages.",
};
