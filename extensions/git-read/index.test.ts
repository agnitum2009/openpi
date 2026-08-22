import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Cause, Effect, Exit } from "effect";
import { expandedResultPreview } from "./index.ts";
import { buildDiffArgs, buildLogArgs, buildShowArgs } from "./src/args.ts";
import { runGit } from "./src/process.ts";

/** Create a small real repository with two commits and a dirty worktree. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-git-read-"));
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "--quiet"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "T"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "first"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "b.txt"), "new\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "second"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  return dir;
}

let repo: string;

before(() => {
  repo = makeRepo();
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("runGit returns stdout for a successful command", async () => {
  const exit = await Effect.runPromiseExit(runGit(buildLogArgs({}), repo));
  assert.ok(Exit.isSuccess(exit));
  if (Exit.isSuccess(exit)) {
    assert.match(exit.value.output.preview, /second/);
    assert.match(exit.value.output.preview, /first/);
    assert.equal(exit.value.exitCode, 0);
  }
});

test("runGit surfaces git failures as GitCommandError with stderr", async () => {
  const exit = await Effect.runPromiseExit(
    runGit(["show", "--no-color", "does-not-exist"], repo),
  );
  assert.ok(Exit.isFailure(exit));
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause) as { message?: string };
    assert.match(
      error.message ?? "",
      /does-not-exist|bad revision|unknown revision|ambiguous argument/i,
    );
  }
});

test("git show output includes commit metadata and patch", async () => {
  const exit = await Effect.runPromiseExit(
    runGit(buildShowArgs({ revision: "HEAD" }), repo),
  );
  assert.ok(Exit.isSuccess(exit));
  if (Exit.isSuccess(exit)) {
    assert.match(exit.value.output.preview, /second/);
    assert.match(exit.value.output.preview, /\+new/);
  }
});

test("git show with path limits the commit patch to that path", async () => {
  const exit = await Effect.runPromiseExit(
    runGit(buildShowArgs({ revision: "HEAD", path: "b.txt" }), repo),
  );
  assert.ok(Exit.isSuccess(exit));
  if (Exit.isSuccess(exit)) {
    assert.match(exit.value.output.preview, /new/);
  }
});

test("git diff never invokes repository-configured textconv commands", async () => {
  const marker = join(repo, "textconv-ran");
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const attributes = join(repo, ".gitattributes");
  try {
    writeFileSync(attributes, "a.txt diff=evil\n");
    git(["config", "diff.evil.textconv", `/usr/bin/touch ${marker}`]);
    const exit = await Effect.runPromiseExit(runGit(buildDiffArgs({}), repo));
    assert.ok(Exit.isSuccess(exit));
    assert.equal(existsSync(marker), false);
  } finally {
    git(["config", "--unset", "diff.evil.textconv"]);
    rmSync(attributes, { force: true });
    rmSync(marker, { force: true });
  }
});

test("runGit applies its own bounded timeout", async () => {
  const exit = await Effect.runPromiseExit(
    runGit(["-c", "alias.hang=!sleep 2", "hang"], repo, 20),
  );
  assert.ok(Exit.isFailure(exit));
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause) as { message?: string };
    assert.match(error.message ?? "", /timed out/i);
  }
});

test("git diff of the dirty worktree shows unstaged changes", async () => {
  const exit = await Effect.runPromiseExit(
    runGit(["diff", "--no-color"], repo),
  );
  assert.ok(Exit.isSuccess(exit));
  if (Exit.isSuccess(exit)) {
    assert.match(exit.value.output.preview, /\+three/);
  }
});

test("outside a repository the command fails with a clear error", async () => {
  const outside = mkdtempSync(join(tmpdir(), "pi-git-none-"));
  try {
    const exit = await Effect.runPromiseExit(runGit(["log"], outside));
    assert.ok(Exit.isFailure(exit));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("expanded git results show a bounded preview and retained output path", () => {
  const rendered = expandedResultPreview(
    {
      content: [
        {
          type: "text",
          text: Array.from(
            { length: 25 },
            (_, index) => `line ${index + 1}`,
          ).join("\n"),
        },
      ],
    },
    "/tmp/pi-git-test/output.txt",
    { fg: (_color, text) => text },
  );
  assert.match(rendered, /line 1/);
  assert.doesNotMatch(rendered, /line 21/);
  assert.match(rendered, /5 more lines/);
  assert.match(rendered, /Full output: \/tmp\/pi-git-test\/output\.txt/);
});
