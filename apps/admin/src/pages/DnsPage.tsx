import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type AdminDnsZone, type DnsRecord } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { PageHeader } from "../components/PageHeader";

/**
 * Platform-admin DNS view (cross-tenant). Lists every hosted zone across all
 * organizations; selecting one shows its records read-only. Admins can delete a
 * zone (abuse / cleanup) but do not create zones or edit records — that's the
 * org's own job in the dashboard, gated by their DNS quota. Mirrors the
 * master–detail layout of the Errors page.
 */
export function DnsPage() {
  const { success, error: toastError } = useToast();
  const [zones, setZones] = useState<AdminDnsZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .listDnsZones()
      .then((z) => {
        setZones(z);
        setSelected((curr) => curr ?? (z[0]?.name ?? null));
      })
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : "Failed to load zones"),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const deleteZone = async (name: string) => {
    if (
      !confirm(
        `Delete zone ${name} and all its records from the platform? This affects the owning organization and cannot be undone.`,
      )
    )
      return;
    try {
      await adminApi.deleteDnsZone(name);
      setZones((z) => z.filter((x) => x.name !== name));
      setSelected((curr) => (curr === name ? null : curr));
      success(`Zone ${name} deleted`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to delete zone");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter(
      (z) =>
        z.name.toLowerCase().includes(q) ||
        z.organizationName.toLowerCase().includes(q),
    );
  }, [zones, query]);

  const selectedZone = zones.find((z) => z.name === selected) ?? null;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="DNS"
        actions={
          <span className="text-sm text-brand-500 dark:text-brand-400">
            {zones.length} zone{zones.length === 1 ? "" : "s"} across all orgs
          </span>
        }
      />

      {loadError && (
        <div className="mt-6 px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
        </div>
      ) : zones.length === 0 ? (
        <div className="mt-6 px-4 py-10 text-center text-brand-400 dark:text-brand-500">
          No hosted DNS zones yet.
        </div>
      ) : (
        <div className="mt-6 flex-1 min-h-0 flex gap-4">
          {/* LEFT: all zones */}
          <div className="w-80 shrink-0 flex flex-col min-h-0">
            <input
              className="w-full mb-3 px-3 py-2 rounded border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="Filter by domain or organization…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="overflow-y-auto hide-scrollbar rounded-lg border border-brand-200 dark:border-brand-700 divide-y divide-brand-100 dark:divide-brand-800 bg-white dark:bg-brand-900 min-h-0 flex-1">
              {filtered.map((z) => (
                <li key={z.id}>
                  <button
                    onClick={() => setSelected(z.name)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                      selected === z.name
                        ? "bg-brand-50 dark:bg-brand-800 text-brand-900 dark:text-brand-50"
                        : "text-brand-700 dark:text-brand-200 hover:bg-brand-50 dark:hover:bg-brand-800/50"
                    }`}
                  >
                    <div className="font-mono truncate">
                      {z.name}
                      {z.status !== "active" && (
                        <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400">
                          {z.status}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-brand-400 dark:text-brand-500 truncate">
                      {z.organizationName}
                    </div>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-4 text-sm text-brand-400 dark:text-brand-500">
                  No zones match “{query}”.
                </li>
              )}
            </ul>
          </div>

          {/* RIGHT: selected zone records */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {selectedZone ? (
              <ZoneDetail
                key={selectedZone.name}
                zone={selectedZone}
                onDelete={() => deleteZone(selectedZone.name)}
              />
            ) : (
              <div className="text-center py-16 text-brand-400 dark:text-brand-500 text-sm">
                Select a zone to view its records.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneDetail({
  zone,
  onDelete,
}: {
  zone: AdminDnsZone;
  onDelete: () => void;
}) {
  const { error: toastError } = useToast();
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    adminApi
      .listDnsRecords(zone.name)
      .then(setRecords)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to load records";
        setErr(msg);
        toastError(msg);
      })
      .finally(() => setLoading(false));
  }, [zone.name, toastError]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-start justify-between gap-4 mb-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50 font-mono truncate">
            {zone.name}
          </h2>
          <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
            Owner:{" "}
            <span className="text-brand-700 dark:text-brand-200">
              {zone.organizationName}
            </span>{" "}
            · Nameservers:{" "}
            <span className="font-mono text-brand-700 dark:text-brand-200">
              {zone.nameservers.join(", ")}
            </span>
          </p>
        </div>
        <button
          onClick={onDelete}
          className="shrink-0 px-3 py-1.5 rounded border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
        >
          Delete zone
        </button>
      </div>

      {err ? (
        <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-brand-500 dark:text-brand-400 text-sm">
          <div className="w-4 h-4 border-2 border-brand-300 dark:border-brand-600 border-t-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
          Loading records…
        </div>
      ) : (
        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-y-auto min-h-0 flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-brand-900 text-left text-xs text-brand-500 dark:text-brand-400 border-b border-brand-200 dark:border-brand-700">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">TTL</th>
                <th className="px-3 py-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
              {records.map((r, i) => (
                <tr key={`${r.name}-${r.type}-${i}`}>
                  <td className="px-3 py-2 font-mono text-brand-900 dark:text-brand-50">
                    {r.name}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-block px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-800 text-xs font-medium text-brand-700 dark:text-brand-200">
                      {r.type}
                    </span>
                    {r.managed && (
                      <span className="ml-2 text-xs text-brand-400 dark:text-brand-500">
                        managed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-brand-500 dark:text-brand-400">
                    {r.ttl}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-brand-700 dark:text-brand-200 break-all">
                    {r.records.join(" ")}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-brand-400 dark:text-brand-500"
                  >
                    No records in this zone.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
