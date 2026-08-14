import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  name?: string;
  private?: boolean;
  license?: string;
  keywords?: string[];
  files?: string[];
  publishConfig?: { access?: string };
  packageManager?: string;
  repository?: { type?: string; url?: string };
  homepage?: string;
  bugs?: { url?: string };
  scripts?: Record<string, string>;
  pi?: {
    extensions?: string[];
    skills?: string[];
    themes?: string[];
    image?: string;
  };
};

const HOST_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
] as const;

test("Pi host packages stay peers while local checks keep development copies", () => {
  for (const packageName of HOST_PACKAGES) {
    assert.equal(manifest.peerDependencies?.[packageName], "*");
    assert.ok(manifest.devDependencies?.[packageName]);
    assert.equal(manifest.dependencies?.[packageName], undefined);
  }
});

test("the manifest enforces the documented Node floor", () => {
  assert.equal(manifest.engines?.node, ">=22.19.0");
});

test("pi-intercom stays an explicit opt-in instead of a bundled dependency", () => {
  assert.equal(manifest.dependencies?.["pi-intercom"], undefined);
  assert.equal(manifest.devDependencies?.["pi-intercom"], undefined);
});

test("the public OpenPI package has complete gallery and registry metadata", () => {
  assert.equal(manifest.name, "@tt-a1i/openpi");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, "MIT");
  assert.ok(manifest.keywords?.includes("pi-package"));
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(manifest.packageManager, "bun@1.3.14");
  assert.equal(manifest.devDependencies?.["@biomejs/biome"], "2.5.8");
  assert.equal(manifest.devDependencies?.prettier, undefined);
  assert.equal(
    manifest.scripts?.prepublishOnly,
    "bun run check && bun run check:ddd && bun run test",
  );
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "git+https://github.com/tt-a1i/openpi.git",
  });
  assert.equal(manifest.homepage, "https://github.com/tt-a1i/openpi#readme");
  assert.deepEqual(manifest.bugs, {
    url: "https://github.com/tt-a1i/openpi/issues",
  });
  assert.deepEqual(manifest.pi?.extensions, [
    "./extensions/commit-task-sync/index.ts",
    "./extensions/copy-all/index.ts",
    "./extensions/cron/index.ts",
    "./extensions/file-mutation-display/index.ts",
    "./extensions/file-search/index.ts",
    "./extensions/git-info/index.ts",
    "./extensions/model-info/index.ts",
    "./extensions/multi-signal-sync/index.ts",
    "./extensions/post-edit/index.ts",
    "./extensions/session-liveness/index.ts",
    "./extensions/sessions/index.ts",
    "./extensions/suggestions/index.ts",
    "./extensions/turn-time/index.ts",
    "./extensions/ui-customization/index.ts",
    "./extensions/working-indicator/index.ts",
    "./extensions/setup/index.ts",
    "./extensions/tasks/index.ts",
    "./extensions/goal/index.ts",
    "./extensions/plan-mode/index.ts",
    "./extensions/subagents/index.ts",
    "./extensions/background-terminals/index.ts",
    "./extensions/workflows/index.ts",
    "./extensions/ask-user/index.ts",
    "./extensions/context-pivot/index.ts",
  ]);
  assert.deepEqual(manifest.pi?.skills, ["./skills"]);
  assert.deepEqual(manifest.pi?.themes, ["./themes"]);
  assert.equal(
    manifest.pi?.image,
    "https://raw.githubusercontent.com/tt-a1i/openpi/main/assets/openpi-package.png",
  );
  assert.deepEqual(manifest.files, [
    "extensions",
    "!extensions/**/*.test.ts",
    "!extensions/**/*.spec.ts",
    "!extensions/**/tsconfig.json",
    "!extensions/*/docs",
    "skills",
    "themes",
    "assets",
    "scripts/prepare-effect-tsgo.mjs",
    "README.md",
    "SETUP.md",
    "THIRD_PARTY_NOTICES.md",
  ]);
});
