import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { VERSION } from "../../src/constants/version.js";
import {
  getAllMigrationVersions,
  getMigrationMetadata,
} from "../../src/migrations/index.js";
import { releasePushRefspecs, releaseTag } from "../../scripts/release.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("Ecochain distribution contracts", () => {
  it("keeps public package access and core provenance without forcing a registry", () => {
    for (const relativePath of [
      "packages/cli/package.json",
      "packages/core/package.json",
    ]) {
      const manifest = JSON.parse(read(relativePath)) as {
        publishConfig?: Record<string, unknown>;
      };
      expect(manifest.publishConfig?.access).toBe("public");
      expect(manifest.publishConfig).not.toHaveProperty("registry");
    }

    const coreManifest = JSON.parse(read("packages/core/package.json")) as {
      publishConfig?: Record<string, unknown>;
    };
    expect(coreManifest.publishConfig?.provenance).toBe(true);
  });

  it("lets npm commands use npm's active configuration", () => {
    const registryFlag = ["--", "registry"].join("");
    const retiredProvider = ["ali", "yun"].join("");
    for (const relativePath of [
      "packages/cli/scripts/create-manifest.js",
      "packages/cli/scripts/check-manifest-continuity.js",
      "packages/cli/scripts/npm-invocation.js",
      "packages/cli/scripts/release-preflight.js",
      "packages/cli/src/commands/upgrade.ts",
      "packages/cli/src/commands/update.ts",
      "packages/cli/src/constants/version.ts",
    ]) {
      const content = read(relativePath);
      expect(content).not.toContain(registryFlag);
      expect(content.toLowerCase()).not.toContain(retiredProvider);
    }

    const forcedNpmjsRegistry = ["registry", "npmjs", "org"].join(".");
    expect(read("packages/cli/src/commands/update.ts")).not.toContain(
      forcedNpmjsRegistry,
    );
    expect(read("packages/cli/src/constants/version.ts")).not.toContain(
      forcedNpmjsRegistry,
    );
  });

  it("does not pin tracked OpenCode dependencies to the retired npm mirror", () => {
    const lockfile = read(".opencode/package-lock.json");
    const retiredMirror = ["registry", "npmmirror", "com"].join(".");

    expect(lockfile).not.toContain(retiredMirror);
    expect(lockfile).toContain("https://registry.npmjs.org/");
  });

  it("keeps displayed update guidance on Ecochain identity across the full migration range", () => {
    for (const fromVersion of ["0.1.0", ...getAllMigrationVersions()]) {
      const metadata = getMigrationMetadata(fromVersion, VERSION);
      const displayedGuidance = [
        ...metadata.changelog,
        ...metadata.migrationGuides.flatMap(({ guide, aiInstructions }) => [
          guide,
          aiInstructions ?? "",
        ]),
      ].join("\n");

      expect(displayedGuidance).not.toContain("@mindfoldhq/trellis");
    }
  });

  it("creates and pushes only the exact Ecochain release tag", () => {
    const preflight = read("packages/cli/scripts/release-preflight.js");
    const tag = releaseTag("0.6.14");
    const refspecs = releasePushRefspecs("main", tag);

    expect(tag).toBe("ecochain-v0.6.14");
    expect(refspecs).toEqual([
      "HEAD:main",
      "refs/tags/ecochain-v0.6.14:refs/tags/ecochain-v0.6.14",
    ]);
    expect(refspecs.join(" ")).not.toContain("--tags");
    for (const unrelatedTag of ["v0.6.14", "ecochain-v0.6.13", "local-only"]) {
      expect(refspecs.join(" ")).not.toContain(`refs/tags/${unrelatedTag}`);
    }
    expect(preflight).toContain("/^(?:refs\\/tags\\/)?ecochain-v");
  });

  it("keeps GitHub publishing as guarded manual npmjs recovery", () => {
    const workflow = read(".github/workflows/publish.yml");
    const triggerBlock = workflow.slice(
      workflow.indexOf("on:"),
      workflow.indexOf("concurrency:"),
    );

    expect(triggerBlock).toContain("workflow_dispatch:");
    expect(triggerBlock).not.toMatch(/(^|\n)\s+(push|release|schedule):/);
    expect(workflow).toContain("^ecochain-v[0-9]+");
    expect(workflow).toContain("ref: refs/tags/${{ inputs.tag }}");
    expect(workflow).toContain('= "@ecochain/trellis"');
    expect(workflow).toContain('= "@ecochain/trellis-core"');
    expect(workflow).toContain('registry-url: "https://registry.npmjs.org"');
    expect(workflow).toContain("id-token: write");
    expect(workflow.match(/NPM_CONFIG_PROVENANCE: "true"/g)).toHaveLength(2);
    expect(workflow.toLowerCase()).not.toContain(["ali", "yun"].join(""));
  });
});
