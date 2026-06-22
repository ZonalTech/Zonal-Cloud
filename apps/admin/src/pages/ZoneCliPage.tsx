import { useCallback, useEffect, useState } from "react";
import { adminApi, getMailUrl, type OpsCommand, type OpsResult } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";

/**
 * Zone CLI — trigger platform operations on the VPS from the admin UI, so an
 * operator can upgrade / restart / migrate / back up / deploy mail without
 * SSHing in. Superadmin-only (the API enforces it too).
 *
 * Each command runs the published `zone` CLI in a one-shot helper container on
 * the host; the combined output + exit code stream into the console below.
 * Before any command runs, a modal explains in plain language what it does.
 */
export function ZoneCliPage() {
  const { success, error: toastError } = useToast();
  const [commands, setCommands] = useState<OpsCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<(OpsResult & { key: string }) | null>(null);
  const [pending, setPending] = useState<OpsCommand | null>(null);

  const mailUrl = getMailUrl();

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .listOpsCommands()
      .then((r) => setCommands(r.commands))
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : "Failed to load commands"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Run the confirmed command.
  const execute = async (cmd: OpsCommand) => {
    setPending(null);
    setRunning(cmd.key);
    setResult(null);
    try {
      const res = await adminApi.runOpsCommand(cmd.key);
      setResult({ ...res, key: cmd.key });
      if (res.exitCode === 0) success(`${cmd.label} completed`);
      else toastError(`${cmd.label} exited with code ${res.exitCode}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : `${cmd.label} failed`);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Zone CLI"
        actions={
          <span className="text-sm text-brand-500 dark:text-brand-400">
            Platform operations on the VPS
          </span>
        }
      />

      {loadError && (
        <div className="mt-6 px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </div>
      )}

      {/* Mail service access card */}
      <div className="mt-6 flex items-center justify-between gap-4 px-4 py-3 rounded border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-medium text-brand-800 dark:text-brand-100">
            Mail server (Stalwart)
          </div>
          <div className="text-xs text-brand-500 dark:text-brand-400 truncate">
            {mailUrl
              ? `Admin & webmail at ${mailUrl}`
              : "Not deployed yet — run “deploymail”, then it appears here."}
          </div>
        </div>
        {mailUrl ? (
          <button
            onClick={() => window.open(mailUrl, "_blank", "noopener")}
            className="shrink-0 px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
          >
            Open mail admin
          </button>
        ) : (
          <span className="shrink-0 text-xs text-brand-400 dark:text-brand-500">
            no URL configured
          </span>
        )}
      </div>

      <div className="mt-4 px-4 py-3 rounded border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800/40 text-sm text-brand-700 dark:text-brand-200">
        These run the <span className="font-mono">zone</span> CLI on the host.
        Click a command to see exactly what it does before it runs.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2 shrink-0">
          {commands.map((cmd) => (
            <button
              key={cmd.key}
              onClick={() => setPending(cmd)}
              disabled={running !== null}
              className={`px-4 py-2 rounded text-sm font-semibold font-mono transition-colors disabled:opacity-50 ${
                cmd.mutating
                  ? "bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 hover:bg-brand-800 dark:hover:bg-brand-100"
                  : "border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-200 hover:bg-brand-100 dark:hover:bg-brand-800"
              }`}
            >
              {running === cmd.key ? `${cmd.label}…` : cmd.label}
            </button>
          ))}
        </div>
      )}

      {(running || result) && (
        <div className="mt-4 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 mb-2 shrink-0">
            <span className="text-sm font-medium text-brand-700 dark:text-brand-200">
              Output
            </span>
            {result && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  result.exitCode === 0
                    ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
                    : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
                }`}
              >
                exit {result.exitCode}
              </span>
            )}
            {result && (
              <span className="text-xs font-mono text-brand-400 dark:text-brand-500">
                {result.command}
              </span>
            )}
          </div>
          <pre className="flex-1 min-h-0 overflow-auto rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-950 dark:bg-black text-brand-100 text-xs font-mono p-3 whitespace-pre-wrap break-words">
            {running
              ? "Running… this can take a minute (pulling images, restarting). Output appears when it finishes."
              : result?.output || "(no output)"}
          </pre>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={`Run “${pending.label}”?`}
          message={
            `${pending.description}\n\n` +
            `Command: zone ${pending.key === "migratedb" ? "migrate" : pending.key === "backupdb" ? "backup" : pending.key === "deploymail" ? "up" : pending.label}\n` +
            (pending.mutating
              ? "This changes the running platform."
              : "This is read-only and safe.")
          }
          confirmLabel={`Run ${pending.label}`}
          destructive={pending.mutating}
          onConfirm={() => execute(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
