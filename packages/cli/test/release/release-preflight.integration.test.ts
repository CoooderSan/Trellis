import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  npmExecutable,
  npmInvocation,
} from "../../scripts/release-preflight.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../../..");
const sourceScript = path.join(
  repoRoot,
  "packages/cli/scripts/release-preflight.js",
);
const sourceNpmInvocation = path.join(
  repoRoot,
  "packages/cli/scripts/npm-invocation.js",
);

interface PackageIdentity {
  cliName?: string;
  cliVersion?: string;
  coreName?: string;
  coreVersion?: string;
}

interface FakeNpmResponse {
  exitCode: number;
  stderr?: string;
  stdout?: string;
}

interface PreflightFixture {
  binDir: string;
  cliManifest: string;
  coreManifest: string;
  logFile: string;
  root: string;
  script: string;
}

interface PreflightResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

const tempDirs: string[] = [];

function writeJson(file: string, value: Record<string, string>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(identity: PackageIdentity = {}): PreflightFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-release-test-"));
  tempDirs.push(root);
  const script = path.join(root, "packages/cli/scripts/release-preflight.js");
  const cliManifest = path.join(root, "packages/cli/package.json");
  const coreManifest = path.join(root, "packages/core/package.json");
  const binDir = path.join(root, "fake-bin");
  const logFile = path.join(root, "npm-args.jsonl");

  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(sourceScript, script);
  fs.copyFileSync(
    sourceNpmInvocation,
    path.join(path.dirname(script), "npm-invocation.js"),
  );
  writeJson(cliManifest, {
    name: identity.cliName ?? "@ecochain/trellis",
    type: "module",
    version: identity.cliVersion ?? "0.6.14",
  });
  writeJson(coreManifest, {
    name: identity.coreName ?? "@ecochain/trellis-core",
    version: identity.coreVersion ?? "0.6.14",
  });

  fs.writeFileSync(
    path.join(binDir, "fake-npm.cjs"),
    `const fs = require("node:fs");
const responses = JSON.parse(process.env.FAKE_NPM_RESPONSES || "{}");
const args = process.argv.slice(2);
if (process.env.FAKE_NPM_LOG) {
  fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(args) + "\\n");
}
const response = responses[args[1]] || {
  exitCode: 1,
  stderr: "npm error code E404\\nnpm error 404 Not Found\\n",
};
if (response.stdout) process.stdout.write(response.stdout);
if (response.stderr) process.stderr.write(response.stderr);
process.exit(response.exitCode);
`,
  );
  const npmShim = path.join(binDir, "npm");
  fs.writeFileSync(
    npmShim,
    `#!/usr/bin/env node\nrequire(${JSON.stringify(path.join(binDir, "fake-npm.cjs"))});\n`,
  );
  fs.chmodSync(npmShim, 0o755);
  fs.writeFileSync(
    path.join(binDir, "npm.cmd"),
    '@echo off\r\nnode "%~dp0fake-npm.cjs" %*\r\n',
  );

  return { binDir, cliManifest, coreManifest, logFile, root, script };
}

function runPreflight(
  fixture: PreflightFixture,
  args: string[],
  responses: Record<string, FakeNpmResponse> = {},
  env: Record<string, string> = {},
): PreflightResult {
  const result = spawnSync(process.execPath, [fixture.script, ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      GITHUB_REF: "",
      GITHUB_REF_NAME: "",
      ...env,
      FAKE_NPM_LOG: fixture.logFile,
      FAKE_NPM_RESPONSES: JSON.stringify(responses),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function npmResponse(version: string, exists: boolean): FakeNpmResponse {
  return exists
    ? { exitCode: 0, stdout: `${JSON.stringify(version)}\n` }
    : {
        exitCode: 1,
        stderr: "npm error code E404\nnpm error 404 Not Found\n",
      };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("release preflight execution contracts", () => {
  it("routes Windows npm.cmd through cmd.exe and uses npm elsewhere", () => {
    expect(npmExecutable("win32")).toBe("npm.cmd");
    expect(npmExecutable("linux")).toBe("npm");
    expect(npmExecutable("darwin")).toBe("npm");
    expect(npmInvocation("win32", "C:\\Windows\\System32\\cmd.exe")).toEqual({
      executable: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd"],
    });
    expect(npmInvocation("linux")).toEqual({ executable: "npm", args: [] });
  });

  it.each([
    {
      coreExists: true,
      cliExists: false,
      expectedCorePublish: false,
      expectedCliPublish: true,
    },
    {
      coreExists: false,
      cliExists: true,
      expectedCorePublish: true,
      expectedCliPublish: false,
    },
  ])(
    "plans a partial rerun independently (core=$coreExists, cli=$cliExists)",
    ({ coreExists, cliExists, expectedCorePublish, expectedCliPublish }) => {
      const fixture = createFixture();
      const responses = {
        "@ecochain/trellis-core@0.6.14": npmResponse("0.6.14", coreExists),
        "@ecochain/trellis@0.6.14": npmResponse("0.6.14", cliExists),
      };

      const first = runPreflight(
        fixture,
        ["publish-plan", "--json"],
        responses,
      );
      const second = runPreflight(
        fixture,
        ["publish-plan", "--json"],
        responses,
      );

      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(JSON.parse(first.stdout)).toEqual({
        version: "0.6.14",
        tag: "latest",
        core: {
          name: "@ecochain/trellis-core",
          publish: expectedCorePublish,
          alreadyOnNpm: coreExists,
        },
        cli: {
          name: "@ecochain/trellis",
          publish: expectedCliPublish,
          alreadyOnNpm: cliExists,
        },
      });
      expect(second.stdout).toBe(first.stdout);
      const npmCalls = fs
        .readFileSync(fixture.logFile, "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(npmCalls).toEqual([
        ["view", "@ecochain/trellis-core@0.6.14", "version", "--json"],
        ["view", "@ecochain/trellis@0.6.14", "version", "--json"],
        ["view", "@ecochain/trellis-core@0.6.14", "version", "--json"],
        ["view", "@ecochain/trellis@0.6.14", "version", "--json"],
      ]);
    },
  );

  it.each([
    ["auth", "npm error code E401\nnpm error Unable to authenticate\n"],
    ["network", "npm error code EAI_AGAIN\nnpm error network unavailable\n"],
  ])("fails closed on non-404 npm %s errors", (_kind, stderr) => {
    const fixture = createFixture();
    const result = runPreflight(fixture, ["publish-plan", "--json"], {
      "@ecochain/trellis-core@0.6.14": { exitCode: 1, stderr },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(stderr.split("\n")[0]);
    expect(result.stdout).toBe("");
  });

  it("writes an idempotent partial publish plan to GITHUB_OUTPUT", () => {
    const fixture = createFixture();
    const githubOutput = path.join(fixture.root, "github-output.txt");
    const result = runPreflight(
      fixture,
      ["publish-plan", "--github"],
      {
        "@ecochain/trellis-core@0.6.14": npmResponse("0.6.14", true),
        "@ecochain/trellis@0.6.14": npmResponse("0.6.14", false),
      },
      { GITHUB_OUTPUT: githubOutput },
    );

    expect(result.status).toBe(0);
    expect(fs.readFileSync(githubOutput, "utf-8")).toBe(
      "version=0.6.14\n" +
        "tag=latest\n" +
        "core_publish=false\n" +
        "cli_publish=true\n" +
        "core_already_on_npm=true\n" +
        "cli_already_on_npm=false\n",
    );
  });

  it("rejects --github without GITHUB_OUTPUT", () => {
    const fixture = createFixture();
    const result = runPreflight(
      fixture,
      ["publish-plan", "--github"],
      {
        "@ecochain/trellis-core@0.6.14": npmResponse("0.6.14", true),
        "@ecochain/trellis@0.6.14": npmResponse("0.6.14", true),
      },
      { GITHUB_OUTPUT: "" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--github requested but GITHUB_OUTPUT is not set",
    );
  });

  it.each([
    [{ cliName: "@mindfoldhq/trellis" }, "@mindfoldhq/trellis"],
    [{ coreName: "@mindfoldhq/trellis-core" }, "@mindfoldhq/trellis-core"],
  ])(
    "rejects package identity mismatch before consulting npm",
    (identity, unexpectedName) => {
      const fixture = createFixture(identity);
      const result = runPreflight(fixture, ["publish-plan", "--json"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Package identity mismatch");
      expect(result.stderr).toContain(unexpectedName);
      expect(fs.existsSync(fixture.logFile)).toBe(false);
    },
  );

  it("rejects package version mismatch before consulting npm", () => {
    const fixture = createFixture({ coreVersion: "0.6.13" });
    const result = runPreflight(fixture, ["publish-plan", "--json"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Version mismatch");
    expect(fs.existsSync(fixture.logFile)).toBe(false);
  });

  it.each([
    ["v0.6.14", "Expected a git tag like ecochain-v0.6.14"],
    [
      "ecochain-v0.6.15",
      "Git tag version (0.6.15) does not match package version (0.6.14)",
    ],
  ])("rejects invalid or mismatched release tag %s", (refName, message) => {
    const fixture = createFixture();
    const result = runPreflight(
      fixture,
      ["check-versions", "--require-tag"],
      {},
      { GITHUB_REF_NAME: refName },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it("accepts the exact Ecochain tag matching both package versions", () => {
    const fixture = createFixture();
    const result = runPreflight(
      fixture,
      ["check-versions", "--require-tag"],
      {},
      { GITHUB_REF_NAME: "ecochain-v0.6.14" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("git tag ecochain-v0.6.14");
  });
});
