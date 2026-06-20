import React, {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { appsApi } from "../lib/api";
import type { App, Deployment, DeploymentStatus, AppStatus } from "../types";

// ---- Status badges ----

function appStatusBadge(status: AppStatus) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  switch (status) {
    case "live":
      return `${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`;
    case "stopped":
    case "idle":
      return `${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`;
    case "failed":
      return `${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`;
    case "building":
      return `${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`;
    default:
      return `${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`;
  }
}

function deployStatusBadge(status: DeploymentStatus) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  switch (status) {
    case "queued":
      return `${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`;
    case "building":
      return `${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`;
    case "live":
      return `${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`;
    case "failed":
      return `${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`;
  }
}

// ---- Token section ----

interface TokenEntry {
  id: string;
  name: string;
  lastUsedAt?: string;
}

function TokensSection({ appId }: { appId: string }) {
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Newly created plaintext token — shown once
  const [plaintextToken, setPlaintextToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    appsApi
      .listTokens(appId)
      .then(({ tokens: list }) => setTokens(list))
      .catch((err: unknown) =>
        setTokenError(err instanceof Error ? err.message : "Failed to load tokens")
      )
      .finally(() => setLoadingTokens(false));
  }, [appId]);

  async function handleCreateToken(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await appsApi.createToken(appId, newTokenName);
      setPlaintextToken(res.token);
      // Refresh token list
      const { tokens: updated } = await appsApi.listTokens(appId);
      setTokens(updated);
      setNewTokenName("");
      setShowCreateForm(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  function handleCopy() {
    if (!plaintextToken) return;
    navigator.clipboard.writeText(plaintextToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Deploy Tokens</h2>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-xs font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
          >
            Create Token
          </button>
        )}
      </div>

      {plaintextToken && (
        <div className="mb-4 p-4 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
          <p className="text-xs font-semibold text-green-800 dark:text-green-300 mb-2">
            Token created. Copy it now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-white dark:bg-brand-900 border border-green-200 dark:border-green-700 rounded px-3 py-2 text-brand-900 dark:text-brand-100 break-all">
              {plaintextToken}
            </code>
            <button
              onClick={handleCopy}
              className="flex-shrink-0 px-3 py-2 rounded border border-green-400 dark:border-green-600 text-green-700 dark:text-green-300 text-xs font-medium hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setPlaintextToken(null)}
            className="mt-2 text-xs text-green-600 dark:text-green-400 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {showCreateForm && (
        <form
          onSubmit={handleCreateToken}
          className="mb-4 p-4 rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tokenName" className="text-xs font-medium text-brand-700 dark:text-brand-300">
              Token name
            </label>
            <input
              id="tokenName"
              type="text"
              required
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              placeholder="ci-deploy"
            />
          </div>
          {createError && (
            <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-xs font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreateForm(false); setCreateError(null); }}
              className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loadingTokens && (
        <p className="text-sm text-brand-400 dark:text-brand-500">Loading tokens...</p>
      )}

      {tokenError && (
        <p className="text-sm text-red-500 dark:text-red-400">{tokenError}</p>
      )}

      {!loadingTokens && !tokenError && tokens.length === 0 && (
        <p className="text-sm text-brand-400 dark:text-brand-500">No deploy tokens yet.</p>
      )}

      {!loadingTokens && !tokenError && tokens.length > 0 && (
        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-200 dark:border-brand-700">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Last used</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t, idx) => (
                <tr
                  key={t.id}
                  className={idx < tokens.length - 1 ? "border-b border-brand-100 dark:border-brand-800" : ""}
                >
                  <td className="px-4 py-2.5 font-medium text-brand-800 dark:text-brand-200">{t.name}</td>
                  <td className="px-4 py-2.5 text-brand-500 dark:text-brand-400 text-xs">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- Log viewer ----

function LogViewer({ appId }: { appId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }
    setLines([]);
    setConnected(false);

    const es = appsApi.getLogs(appId);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      setLines((prev) => [...prev, e.data as string]);
    };

    es.onerror = () => {
      setConnected(false);
    };
  }, [appId]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
    };
  }, [connect]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  function handleClear() {
    setLines([]);
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Logs</h2>
          <span className={[
            "w-2 h-2 rounded-full",
            connected ? "bg-green-400" : "bg-brand-400",
          ].join(" ")} title={connected ? "Connected" : "Disconnected"} />
          <span className="text-xs text-brand-400 dark:text-brand-500">
            {connected ? "Connected" : "Connecting..."}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClear}
            className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={connect}
            className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
          >
            Reconnect
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-brand-950 border border-brand-800 overflow-hidden">
        <div className="h-72 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
          {lines.length === 0 ? (
            <span className="text-brand-500">
              {connected ? "Waiting for log output..." : "Connecting..."}
            </span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="text-green-300 whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </section>
  );
}

// ---- Main page ----

export function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const appId = id ?? "";

  const [app, setApp] = useState<App | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deploying, setDeploying] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchApp = useCallback(() => {
    return appsApi
      .get(appId)
      .then(({ app: fetchedApp, deployments: fetchedDeps }) => {
        setApp(fetchedApp);
        setDeployments(fetchedDeps);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load app")
      )
      .finally(() => setLoading(false));
  }, [appId]);

  useEffect(() => {
    void fetchApp();
  }, [fetchApp]);

  async function handleDeploy() {
    setActionError(null);
    setDeploying(true);
    try {
      await appsApi.deploy(appId);
      await fetchApp();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }

  async function handleStop() {
    setActionError(null);
    setStopping(true);
    try {
      await appsApi.stop(appId);
      await fetchApp();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setStopping(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-brand-500 dark:text-brand-400 text-sm">
        <div className="w-4 h-4 border-2 border-brand-300 dark:border-brand-600 border-t-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
        Loading...
      </div>
    );
  }

  if (error || !app) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-4 py-3 border border-red-200 dark:border-red-800">
        {error ?? "App not found"}
      </p>
    );
  }

  return (
    <div>
      {/* App info */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50">{app.name}</h1>
            <span className={appStatusBadge(app.status)}>{app.status}</span>
          </div>
          <p className="text-sm text-brand-500 dark:text-brand-400 font-mono">{app.subdomain}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleDeploy}
            disabled={deploying || stopping}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deploying ? "Deploying..." : "Deploy"}
          </button>
          <button
            onClick={handleStop}
            disabled={deploying || stopping}
            className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {stopping ? "Stopping..." : "Stop"}
          </button>
        </div>
      </div>

      {actionError && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-4 py-3 border border-red-200 dark:border-red-800">
          {actionError}
        </p>
      )}

      {/* App detail fields */}
      <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-5 grid grid-cols-2 gap-x-8 gap-y-3 max-w-2xl">
        {[
          ["Type", app.type],
          ["Source", app.source],
          ["Repository", app.repoUrl ?? "—"],
          ["Branch", app.branch ?? "—"],
          ["Build command", app.buildCmd ?? "—"],
          ["Output dir", app.outputDir ?? "—"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider mb-0.5">
              {label}
            </dt>
            <dd className="text-sm text-brand-800 dark:text-brand-200 font-mono break-all">
              {value}
            </dd>
          </div>
        ))}
      </div>

      {/* Deployments */}
      <section className="mt-8">
        <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 mb-3">Deployments</h2>

        {deployments.length === 0 ? (
          <p className="text-sm text-brand-400 dark:text-brand-500">No deployments yet.</p>
        ) : (
          <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-200 dark:border-brand-700">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Ref</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d, idx) => (
                  <tr
                    key={d.id}
                    className={idx < deployments.length - 1 ? "border-b border-brand-100 dark:border-brand-800" : ""}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-brand-600 dark:text-brand-400">
                      {d.id.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-brand-600 dark:text-brand-400">
                      {d.ref ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={deployStatusBadge(d.status)}>{d.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-brand-500 dark:text-brand-400">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Logs */}
      <LogViewer appId={appId} />

      {/* Deploy tokens */}
      <TokensSection appId={appId} />
    </div>
  );
}
