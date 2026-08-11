import { describe, expect, it } from "vitest";

import { fetchNpmVersions } from "../../scripts/check-manifest-continuity.js";
import { versionOnNpm } from "../../scripts/create-manifest.js";

interface Invocation {
  args: string[];
  executable: string;
}

function recordingExecFile(stdout: string): {
  calls: Invocation[];
  execFile: (executable: string, args: string[]) => string;
} {
  const calls: Invocation[] = [];
  return {
    calls,
    execFile(executable, args) {
      calls.push({ executable, args });
      return stdout;
    },
  };
}

describe("release-script npm invocation", () => {
  it.each([
    {
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
      executable: "C:\\Windows\\System32\\cmd.exe",
      prefix: ["/d", "/s", "/c", "npm.cmd"],
    },
    {
      platform: "linux",
      comSpec: "ignored",
      executable: "npm",
      prefix: [],
    },
  ])(
    "routes manifest continuity through the shared npm contract on $platform",
    ({ platform, comSpec, executable, prefix }) => {
      const recorder = recordingExecFile('["0.6.13","0.6.14"]');

      expect(
        fetchNpmVersions({
          platform,
          comSpec,
          execFile: recorder.execFile,
        }),
      ).toEqual(["0.6.13", "0.6.14"]);
      expect(recorder.calls).toEqual([
        {
          executable,
          args: [...prefix, "view", "@ecochain/trellis", "versions", "--json"],
        },
      ]);
    },
  );

  it.each([
    {
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
      executable: "C:\\Windows\\System32\\cmd.exe",
      prefix: ["/d", "/s", "/c", "npm.cmd"],
    },
    {
      platform: "darwin",
      comSpec: "ignored",
      executable: "npm",
      prefix: [],
    },
  ])(
    "routes published-manifest protection through the shared npm contract on $platform",
    ({ platform, comSpec, executable, prefix }) => {
      const recorder = recordingExecFile("0.6.14\n");

      expect(
        versionOnNpm("0.6.14", {
          platform,
          comSpec,
          execFile: recorder.execFile,
        }),
      ).toBe(true);
      expect(recorder.calls).toEqual([
        {
          executable,
          args: [...prefix, "view", "@ecochain/trellis@0.6.14", "version"],
        },
      ]);
    },
  );

  it("preserves each call site's npm failure policy", () => {
    const notFound = Object.assign(new Error("not found"), {
      stderr: Buffer.from("npm error code E404\nnpm error 404 Not Found\n"),
    });
    const unavailable = Object.assign(new Error("network unavailable"), {
      stderr: Buffer.from("npm error code EAI_AGAIN\n"),
    });
    const throwNotFound = () => {
      throw notFound;
    };
    const throwUnavailable = () => {
      throw unavailable;
    };

    expect(fetchNpmVersions({ execFile: throwNotFound })).toEqual([]);
    expect(() => fetchNpmVersions({ execFile: throwUnavailable })).toThrow(
      unavailable,
    );
    expect(versionOnNpm("0.6.14", { execFile: throwUnavailable })).toBe(false);
  });
});
