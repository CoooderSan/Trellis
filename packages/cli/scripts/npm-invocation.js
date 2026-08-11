/**
 * Build a cross-platform, shell-minimal npm invocation.
 *
 * Windows exposes npm as a `.cmd` shim, which `execFileSync` cannot execute
 * directly. Route that shim through cmd.exe; keep Unix on the direct binary
 * path so arguments are never interpreted by a shell.
 */
export function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function npmInvocation(
  platform = process.platform,
  comSpec = process.env.ComSpec || "cmd.exe",
) {
  const executable = npmExecutable(platform);
  return platform === "win32"
    ? { executable: comSpec, args: ["/d", "/s", "/c", executable] }
    : { executable, args: [] };
}
