import type { Notification } from "../types";

// Concise display title for a notification. For deployment failures this is the
// failing STEP (e.g. "Cloning repository") — we deliberately keep the full
// error text out of the title/toast and surface it only on the analysis page.
export function notificationTitle(n: Notification): string {
  if (n.type === "deployment_failed") {
    const appName = typeof n.metadata?.appName === "string" ? n.metadata.appName : null;
    // Clear, fixed heading — the cause/step go in the body, not the title.
    return appName ? `Deployment failed: ${appName}` : "Deployment failed";
  }
  if (n.type === "account_impersonated") return "Account accessed by admin";
  return "Notification";
}

// A short, human-readable explanation of WHAT made a deployment fail — derived
// from the raw error reason in metadata. The raw text is build/git output (e.g.
// "Cloning into '/tmp/zonal-build-abc'... fatal: Remote branch master1 not found
// in upstream origin (after 3 attempts)") which is noisy and confusing in the
// bell. We pull out the meaningful cause and phrase it plainly.
export function notificationCause(n: Notification): string {
  if (n.type === "deployment_failed") {
    const reason = typeof n.metadata?.reason === "string" ? n.metadata.reason : "";
    return explainDeployFailure(reason) ?? n.message;
  }
  return n.message;
}

// Map a raw deploy error to a plain-language cause. Returns null when we don't
// recognise the error, so the caller can fall back to the stored message.
function explainDeployFailure(reason: string): string | null {
  if (!reason) return null;
  const text = reason.replace(/\s+/g, " ").trim();

  // Strip a trailing retry count like "(after 3 attempts)" so it doesn't ride
  // along inside the extracted cause; we don't surface it in the one-liner.
  const stripAttempts = (s: string) =>
    s.replace(/\s*\(after \d+ attempts?\)\s*$/i, "").trim();

  // git: missing branch — the most common cause (the screenshot's case).
  const branch = text.match(/Remote branch (\S+) not found in upstream origin/i);
  if (branch) return `Branch "${branch[1]}" doesn't exist in the repository.`;

  // git: bad credentials / private repo without access.
  if (/Authentication failed|could not read Username|Permission denied|access denied/i.test(text))
    return "Couldn't access the repository — check the repo URL and credentials.";

  // git: repo/host unreachable.
  if (/Could not resolve host|repository '.*' not found|Repository not found/i.test(text))
    return "The repository couldn't be found or reached.";

  // build: docker build step failed.
  if (/npm ERR!|build failed|exit code [1-9]|returned a non-zero code/i.test(text))
    return "The build failed — check the deploy log for the failing command.";

  // Fall back to the part after a "fatal:" / "error:" marker if present, else
  // the leading sentence, capped so the bell never shows a wall of text.
  const marker = text.match(/(?:fatal|error):\s*(.+)$/i);
  const core = stripAttempts(marker ? marker[1] : text);
  if (!core) return null;
  return core.length > 140 ? `${core.slice(0, 137)}…` : core;
}

// The deploymentId a deployment_failed notification points at, if any — used to
// link to the error-analysis page.
export function notificationDeploymentId(n: Notification): string | null {
  const id = n.metadata?.deploymentId;
  return typeof id === "string" ? id : null;
}

export function notificationAppId(n: Notification): string | null {
  const id = n.metadata?.appId;
  return typeof id === "string" ? id : null;
}
