import { FormEvent, useEffect, useState } from "react";
import { appsApi, type CustomDomain } from "../lib/api";
import { useToast } from "../context/ToastContext";

function statusBadge(status: CustomDomain["status"]) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  switch (status) {
    case "verified":
      return `${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`;
    case "failed":
      return `${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`;
    default:
      return `${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`;
  }
}

function DnsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-brand-500 dark:text-brand-400">{label}</span>
      <code className="font-mono text-xs text-brand-800 dark:text-brand-200 break-all text-right">
        {value}
      </code>
    </div>
  );
}

export function DomainsSection({ appId }: { appId: string }) {
  const toast = useToast();
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  function load() {
    appsApi
      .listDomains(appId)
      .then(({ domains: list }) => setDomains(list))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load domains"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [appId]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      await appsApi.addDomain(appId, newDomain.trim());
      setNewDomain("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add domain");
    } finally {
      setAdding(false);
    }
  }

  async function handleVerify(domainId: string) {
    setVerifyingId(domainId);
    try {
      const res = await appsApi.verifyDomain(appId, domainId);
      toast.info(res.message);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleRemove(domainId: string) {
    try {
      await appsApi.removeDomain(appId, domainId);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove domain");
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 mb-3">Custom domains</h2>

      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          type="text"
          required
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="app.yourdomain.com"
          className="flex-1 px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
        />
        <button
          type="submit"
          disabled={adding}
          className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
        >
          {adding ? "Adding..." : "Add domain"}
        </button>
      </form>

      {loading && <p className="text-sm text-brand-400 dark:text-brand-500">Loading domains...</p>}
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {!loading && !error && domains.length === 0 && (
        <p className="text-sm text-brand-400 dark:text-brand-500">No custom domains yet.</p>
      )}

      <div className="flex flex-col gap-3">
        {domains.map((d) => (
          <div
            key={d.id}
            className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-brand-900 dark:text-brand-50">{d.domain}</span>
                <span className={statusBadge(d.status)}>{d.status}</span>
              </div>
              <div className="flex gap-2">
                {d.status !== "verified" && (
                  <button
                    onClick={() => handleVerify(d.id)}
                    disabled={verifyingId === d.id}
                    className="text-xs px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 font-medium hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
                  >
                    {verifyingId === d.id ? "Verifying..." : "Verify"}
                  </button>
                )}
                <button
                  onClick={() => handleRemove(d.id)}
                  className="text-xs px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 font-medium hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>

            {d.status !== "verified" && (
              <div className="mt-3 pt-3 border-t border-brand-100 dark:border-brand-800">
                <p className="text-xs font-medium text-brand-600 dark:text-brand-400 mb-1 uppercase tracking-wide">
                  1. Prove ownership (TXT record)
                </p>
                <DnsRow label="Host" value={d.instructions.txtRecord.host} />
                <DnsRow label="Type" value={d.instructions.txtRecord.type} />
                <DnsRow label="Value" value={d.instructions.txtRecord.value} />

                <p className="text-xs font-medium text-brand-600 dark:text-brand-400 mt-3 mb-1 uppercase tracking-wide">
                  2. Point traffic ({d.instructions.routeRecord.type} record)
                </p>
                <DnsRow label="Host" value={d.instructions.routeRecord.host} />
                <DnsRow label="Type" value={d.instructions.routeRecord.type} />
                <DnsRow label="Value" value={d.instructions.routeRecord.value} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
