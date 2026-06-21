import { FormEvent, useEffect, useState } from "react";
import { adminApi } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import type { InfraSettings } from "../types";

const fieldInputClass =
  "px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";

interface AgentTokenRow {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function AgentTokensSection() {
  const [tokens, setTokens] = useState<AgentTokenRow[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [mcpConfig, setMcpConfig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    adminApi.listAgentTokens().then(({ tokens: t }) => setTokens(t)).catch(() => {});
  }
  useEffect(load, []);

  async function generate() {
    setBusy(true);
    setErr(null);
    setNewToken(null);
    try {
      const res = await adminApi.createAgentToken(name.trim() || "mcp-agent");
      setNewToken(res.token);
      setName("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await adminApi.revokeAgentToken(id);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to revoke");
    }
  }

  async function downloadMcpConfig() {
    setErr(null);
    try {
      const cfg = await adminApi.generateMcpConfig();
      const text = JSON.stringify(cfg, null, 2);
      setMcpConfig(text);
      // Trigger a file download of .mcp.json
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ".mcp.json";
      a.click();
      URL.revokeObjectURL(url);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to generate config");
    }
  }

  return (
    <div>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-6">
        Long-lived, revocable tokens for the MCP agent (no expiry, unlike a login session).
        Shown once at creation.
      </p>

      {err && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
          {err}
        </p>
      )}

      {newToken && (
        <div className="mb-4 p-4 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
          <p className="text-xs font-semibold text-green-800 dark:text-green-300 mb-2">
            New token — copy it now, it will not be shown again.
          </p>
          <code className="block font-mono text-xs bg-white dark:bg-brand-900 border border-green-200 dark:border-green-700 rounded px-3 py-2 text-brand-900 dark:text-brand-100 break-all">
            {newToken}
          </code>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="token name (e.g. mcp-agent)"
          className="flex-1 px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
        />
        <button
          onClick={generate}
          disabled={busy}
          className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
        >
          {busy ? "..." : "Generate token"}
        </button>
        <button
          onClick={downloadMcpConfig}
          className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
          title="Mints a fresh token and downloads a ready-to-use .mcp.json"
        >
          Download MCP config
        </button>
      </div>

      {tokens.length > 0 && (
        <div className="rounded-lg border border-brand-200 dark:border-brand-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700">
                <th className="text-left px-4 py-2 font-medium text-brand-600 dark:text-brand-400">Name</th>
                <th className="text-left px-4 py-2 font-medium text-brand-600 dark:text-brand-400">Last used</th>
                <th className="text-left px-4 py-2 font-medium text-brand-600 dark:text-brand-400"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
              {tokens.map((t) => (
                <tr key={t.id} className="bg-white dark:bg-brand-900">
                  <td className="px-4 py-2 text-brand-800 dark:text-brand-200">{t.name}</td>
                  <td className="px-4 py-2 text-brand-500 dark:text-brand-400">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => revoke(t.id)}
                      className="text-xs px-3 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mcpConfig && (
        <div className="mt-4">
          <p className="text-xs text-brand-500 dark:text-brand-400 mb-1">
            Downloaded .mcp.json (also shown here). Place it where your MCP client reads its config.
          </p>
          <pre className="text-xs bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded p-3 overflow-x-auto hide-scrollbar text-brand-800 dark:text-brand-200">
            {mcpConfig}
          </pre>
        </div>
      )}
    </div>
  );
}

function McpConnectionSection() {
  const [agentApiUrl, setAgentApiUrl] = useState("");
  const [agentToken, setAgentToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    adminApi
      .getSettings()
      .then((s) => {
        setAgentApiUrl(s.agentApiUrl);
        setTokenSet(s.agentTokenSet);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      // Only send the token if the operator typed a new one (keeps the existing one otherwise).
      const payload: { agentApiUrl?: string; agentToken?: string } = { agentApiUrl };
      if (agentToken.trim()) payload.agentToken = agentToken.trim();
      const s = await adminApi.updateSettings(payload);
      setTokenSet(s.agentTokenSet);
      setAgentToken("");
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-6">
        Connection used by the MCP agent to reach the Zonal API. The token is stored encrypted
        and never shown again after saving.
      </p>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="apiUrl" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Base URL
          </label>
          <input
            id="apiUrl"
            type="url"
            value={agentApiUrl}
            onChange={(e) => setAgentApiUrl(e.target.value)}
            placeholder="http://localhost:4000"
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="token" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Agent token{" "}
            <span className="font-normal text-brand-400 dark:text-brand-500">
              {tokenSet ? "(configured — leave blank to keep)" : "(not set)"}
            </span>
          </label>
          <input
            id="token"
            type="password"
            value={agentToken}
            onChange={(e) => setAgentToken(e.target.value)}
            placeholder={tokenSet ? "••••••••••••" : "Paste the agent token"}
            autoComplete="off"
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-3 py-2 border border-green-200 dark:border-green-800">
            {notice}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}

function InfrastructureSection() {
  const [settings, setSettings] = useState<InfraSettings | null>(null);
  const [mariadbAdminHost, setMariadbAdminHost] = useState("");
  const [mariadbAdminPort, setMariadbAdminPort] = useState("");
  const [mariadbAdminUser, setMariadbAdminUser] = useState("");
  const [mariadbAdminPassword, setMariadbAdminPassword] = useState("");
  const [appMariadbHost, setAppMariadbHost] = useState("");
  const [appMariadbPort, setAppMariadbPort] = useState("");
  const [frappeRedisUrl, setFrappeRedisUrl] = useState("");
  const [frappeBaseImage, setFrappeBaseImage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function apply(s: InfraSettings) {
    setSettings(s);
    setMariadbAdminHost(s.mariadbAdminHost);
    setMariadbAdminPort(String(s.mariadbAdminPort));
    setMariadbAdminUser(s.mariadbAdminUser);
    setAppMariadbHost(s.appMariadbHost);
    setAppMariadbPort(String(s.appMariadbPort));
    setFrappeRedisUrl(s.frappeRedisUrl);
    setFrappeBaseImage(s.frappeBaseImage);
  }

  function load() {
    adminApi
      .getInfraSettings()
      .then(apply)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      // Send only changed fields; password only when a new one was typed.
      const payload: Parameters<typeof adminApi.updateInfraSettings>[0] = {};
      if (mariadbAdminHost !== settings.mariadbAdminHost) payload.mariadbAdminHost = mariadbAdminHost;
      if (Number(mariadbAdminPort) !== settings.mariadbAdminPort) payload.mariadbAdminPort = Number(mariadbAdminPort);
      if (mariadbAdminUser !== settings.mariadbAdminUser) payload.mariadbAdminUser = mariadbAdminUser;
      if (mariadbAdminPassword.trim()) payload.mariadbAdminPassword = mariadbAdminPassword.trim();
      if (appMariadbHost !== settings.appMariadbHost) payload.appMariadbHost = appMariadbHost;
      if (Number(appMariadbPort) !== settings.appMariadbPort) payload.appMariadbPort = Number(appMariadbPort);
      if (frappeRedisUrl !== settings.frappeRedisUrl) payload.frappeRedisUrl = frappeRedisUrl;
      if (frappeBaseImage !== settings.frappeBaseImage) payload.frappeBaseImage = frappeBaseImage;
      const s = await adminApi.updateInfraSettings(payload);
      apply(s);
      setMariadbAdminPassword("");
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-6">
        These let Frappe apps provision MariaDB databases and build bench images without editing
        .env. The MariaDB root password is required to create Frappe sites.
      </p>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="infra-admin-host" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            MariaDB admin host
          </label>
          <input
            id="infra-admin-host"
            type="text"
            value={mariadbAdminHost}
            onChange={(e) => setMariadbAdminHost(e.target.value)}
            placeholder="127.0.0.1"
            className={fieldInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="infra-admin-port" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            MariaDB admin port
          </label>
          <input
            id="infra-admin-port"
            type="number"
            value={mariadbAdminPort}
            onChange={(e) => setMariadbAdminPort(e.target.value)}
            placeholder="3306"
            className={fieldInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="infra-admin-user" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            MariaDB admin user
          </label>
          <input
            id="infra-admin-user"
            type="text"
            value={mariadbAdminUser}
            onChange={(e) => setMariadbAdminUser(e.target.value)}
            placeholder="root"
            className={fieldInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="infra-admin-password" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            MariaDB admin password{" "}
            <span className="font-normal text-brand-400 dark:text-brand-500">
              {settings?.mariadbAdminPasswordSet ? "(configured — leave blank to keep)" : "(not set)"}
            </span>
          </label>
          <input
            id="infra-admin-password"
            type="password"
            value={mariadbAdminPassword}
            onChange={(e) => setMariadbAdminPassword(e.target.value)}
            placeholder={settings?.mariadbAdminPasswordSet ? "(configured — leave blank to keep)" : "Not set"}
            autoComplete="off"
            className={fieldInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="infra-app-host" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            App-container MariaDB host
          </label>
          <input
            id="infra-app-host"
            type="text"
            value={appMariadbHost}
            onChange={(e) => setAppMariadbHost(e.target.value)}
            placeholder="host.docker.internal"
            className={fieldInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="infra-app-port" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            App-container MariaDB port
          </label>
          <input
            id="infra-app-port"
            type="number"
            value={appMariadbPort}
            onChange={(e) => setAppMariadbPort(e.target.value)}
            placeholder="3306"
            className={fieldInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="infra-redis" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Frappe Redis URL
          </label>
          <input
            id="infra-redis"
            type="text"
            value={frappeRedisUrl}
            onChange={(e) => setFrappeRedisUrl(e.target.value)}
            placeholder="redis://localhost:6379"
            className={fieldInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="infra-image" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Frappe base image
          </label>
          <input
            id="infra-image"
            type="text"
            value={frappeBaseImage}
            onChange={(e) => setFrappeBaseImage(e.target.value)}
            placeholder="frappe/bench:latest"
            className={fieldInputClass}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-3 py-2 border border-green-200 dark:border-green-800">
            {notice}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}

type SettingsTab = "mcp" | "agent" | "infra";

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("mcp");

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "mcp", label: "MCP" },
    { id: "agent", label: "Agent" },
    { id: "infra", label: "Infrastructure" },
  ];

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="mt-6 border-b border-brand-200 dark:border-brand-700">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-brand-700 dark:border-brand-200 text-brand-800 dark:text-brand-100"
                  : "border-transparent text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6 max-w-xl">
        {tab === "mcp" ? (
          <McpConnectionSection />
        ) : tab === "infra" ? (
          <InfrastructureSection />
        ) : (
          <AgentTokensSection />
        )}
      </div>
    </div>
  );
}
