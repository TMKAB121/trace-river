import { execFile } from "node:child_process";

/** Opens the user's default browser at `url`. No dependency — hand-rolled per-platform command. */
export function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", '""', url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  execFile(command, args, (err) => {
    if (err) {
      console.warn(`[traceriver] Couldn't auto-open the browser (${err.message}). Open this URL manually:\n  ${url}`);
    }
  });
}
