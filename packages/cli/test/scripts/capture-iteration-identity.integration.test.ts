import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_SOURCE = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts/capture_iteration_identity.py",
);

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function git(repo: string, ...args: string[]): Buffer {
  return execFileSync("git", args, { cwd: repo });
}

describe.skipIf(!hasPython())("capture_iteration_identity.py", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-iteration-identity-"),
    );
    fs.mkdirSync(path.join(repo, ".trellis", "scripts"), { recursive: true });
    fs.copyFileSync(
      SCRIPT_SOURCE,
      path.join(repo, ".trellis", "scripts", "capture_iteration_identity.py"),
    );
    fs.writeFileSync(path.join(repo, "staged.txt"), "staged baseline\n");
    fs.writeFileSync(path.join(repo, "unstaged.txt"), "unstaged baseline\n");

    git(repo, "init", "-q");
    git(repo, "add", ".");
    git(
      repo,
      "-c",
      "user.name=Trellis Test",
      "-c",
      "user.email=trellis@example.test",
      "commit",
      "-qm",
      "fixture",
    );
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("binds labeled digests to staged, unstaged, and untracked content", () => {
    fs.appendFileSync(path.join(repo, "staged.txt"), "staged change\n");
    git(repo, "add", "staged.txt");
    fs.appendFileSync(path.join(repo, "unstaged.txt"), "unstaged change\n");
    fs.writeFileSync(path.join(repo, "untracked.txt"), "untracked content\n");

    const statusBefore = git(repo, "status", "--short").toString("utf-8");
    const result = spawnSync(
      "python3",
      [".trellis/scripts/capture_iteration_identity.py"],
      { cwd: repo, encoding: "utf-8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const identity = JSON.parse(result.stdout) as {
      profile: string;
      identity_status: string;
      repository_root: string;
      head: string;
      staged_diff_sha256: string;
      unstaged_diff_sha256: string;
      untracked: { path: string; sha256: string; kind: string }[];
    };

    expect(identity).toMatchObject({
      profile: "ITERATION",
      identity_status: "PASSED",
      repository_root: fs.realpathSync(repo),
      head: git(repo, "rev-parse", "HEAD").toString("utf-8").trim(),
      staged_diff_sha256: sha256(
        git(
          repo,
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--binary",
          "--full-index",
          "HEAD",
        ),
      ),
      unstaged_diff_sha256: sha256(
        git(
          repo,
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--binary",
          "--full-index",
        ),
      ),
      untracked: [
        {
          path: "untracked.txt",
          sha256: sha256(Buffer.from("untracked content\n")),
          kind: "file",
        },
      ],
    });
    expect(identity.staged_diff_sha256).not.toBe(identity.unstaged_diff_sha256);
    expect(git(repo, "status", "--short").toString("utf-8")).toBe(statusBefore);
  });

  it("fails closed with UNKNOWN outside a Git worktree", () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-iteration-identity-outside-"),
    );
    try {
      const result = spawnSync("python3", [SCRIPT_SOURCE], {
        cwd: outside,
        encoding: "utf-8",
      });
      expect(result.status).not.toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        profile: "ITERATION",
        identity_status: "UNKNOWN",
      });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
