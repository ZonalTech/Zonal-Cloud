import { useCallback, useEffect, useState } from "react";
import {
  dnsApi,
  DNS_RECORD_TYPES,
  type DnsZone,
  type DnsRecord,
  type DnsRecordType,
} from "../lib/api";
import { useToast } from "../context/ToastContext";

const inputCls =
  "w-full px-3 py-2 rounded border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400";
const btnPrimary =
  "px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors disabled:opacity-50";
const btnGhost =
  "px-3 py-1.5 rounded border border-brand-200 dark:border-brand-700 text-sm text-brand-700 dark:text-brand-200 hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors disabled:opacity-50";

// Placeholder hint per record type (shown in the value field).
const VALUE_HINT: Record<DnsRecordType, string> = {
  A: "203.0.113.10",
  AAAA: "2001:db8::1",
  CNAME: "target.example.com",
  MX: "10 mail.example.com",
  TXT: "v=spf1 include:_spf.google.com ~all",
  NS: "ns1.other-provider.com",
  SRV: "10 5 443 host.example.com",
  CAA: '0 issue "letsencrypt.org"',
};

/**
 * Managed DNS page. Left: the org's hosted zones (create / delete). Right: the
 * selected zone's records with an add form and per-RRset delete. Platform-managed
 * RRsets (apex NS) are shown read-only. Mirrors the master–detail layout used by
 * the Errors page.
 */
export function DnsPage() {
  const { success, error: toastError } = useToast();
  const [zones, setZones] = useState<DnsZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [newZone, setNewZone] = useState("");
  const [creating, setCreating] = useState(false);

  const loadZones = useCallback(() => {
    setLoading(true);
    dnsApi
      .listZones()
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
    loadZones();
  }, [loadZones]);

  const createZone = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newZone.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    try {
      const zone = await dnsApi.createZone(name);
      setNewZone("");
      setZones((z) => [zone, ...z]);
      setSelected(zone.name);
      success(`Zone ${zone.name} created`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to create zone");
    } finally {
      setCreating(false);
    }
  };

  const deleteZone = async (name: string) => {
    if (!confirm(`Delete zone ${name} and all its records? This cannot be undone.`))
      return;
    try {
      await dnsApi.deleteZone(name);
      setZones((z) => z.filter((x) => x.name !== name));
      setSelected((curr) => (curr === name ? null : curr));
      success(`Zone ${name} deleted`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to delete zone");
    }
  };

  const selectedZone = zones.find((z) => z.name === selected) ?? null;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="mb-3 shrink-0">
        <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50">
          DNS
        </h1>
        <p className="text-sm text-brand-500 dark:text-brand-400 mt-1">
          Host your domain's DNS on our nameservers. Point your registrar's NS
          records at the nameservers shown for each zone.
        </p>
      </div>

      {loadError && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-4 py-3 border border-red-200 dark:border-red-800">
          {loadError}
        </p>
      )}

      <div className="flex gap-4 min-h-0 flex-1">
        {/* LEFT: zones */}
        <div className="w-72 shrink-0 flex flex-col min-h-0">
          <form onSubmit={createZone} className="flex gap-2 mb-3">
            <input
              className={inputCls}
              placeholder="example.com"
              value={newZone}
              onChange={(e) => setNewZone(e.target.value)}
            />
            <button className={btnPrimary} disabled={creating || !newZone.trim()}>
              {creating ? "…" : "Add"}
            </button>
          </form>

          {loading ? (
            <div className="flex items-center gap-2 text-brand-500 dark:text-brand-400 text-sm">
              <div className="w-4 h-4 border-2 border-brand-300 dark:border-brand-600 border-t-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
              Loading zones…
            </div>
          ) : zones.length === 0 ? (
            <p className="text-sm text-brand-400 dark:text-brand-500">
              No zones yet. Add a domain above to get started.
            </p>
          ) : (
            <ul className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-y-auto min-h-0 flex-1 divide-y divide-brand-100 dark:divide-brand-800">
              {zones.map((z) => (
                <li key={z.id}>
                  <button
                    onClick={() => setSelected(z.name)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                      selected === z.name
                        ? "bg-brand-50 dark:bg-brand-800 text-brand-900 dark:text-brand-50 font-medium"
                        : "text-brand-700 dark:text-brand-200 hover:bg-brand-50 dark:hover:bg-brand-800/50"
                    }`}
                  >
                    <span className="font-mono">{z.name}</span>
                    {z.status === "suspended" && (
                      <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400">
                        suspended
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* RIGHT: records for the selected zone */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {selectedZone ? (
            <ZoneRecords
              zone={selectedZone}
              onDeleteZone={() => deleteZone(selectedZone.name)}
            />
          ) : (
            <div className="text-center py-16 text-brand-400 dark:text-brand-500 text-sm">
              Select a zone to manage its records.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ZoneRecords({
  zone,
  onDeleteZone,
}: {
  zone: DnsZone;
  onDeleteZone: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Add-record form state.
  const [name, setName] = useState("@");
  const [type, setType] = useState<DnsRecordType>("A");
  const [ttl, setTtl] = useState(3600);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    dnsApi
      .listRecords(zone.name)
      .then(setRecords)
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : "Failed to load records"),
      )
      .finally(() => setLoading(false));
  }, [zone.name]);

  useEffect(() => {
    load();
  }, [load]);

  const addRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const values = value
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 0) return;
    setSaving(true);
    try {
      await dnsApi.upsertRecord(zone.name, {
        name: name.trim() || "@",
        type,
        ttl,
        records: values,
      });
      setValue("");
      success(`${type} record saved`);
      load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to save record");
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async (r: DnsRecord) => {
    if (!confirm(`Delete the ${r.type} record for ${r.name}?`)) return;
    try {
      await dnsApi.deleteRecord(zone.name, { name: r.name, type: r.type });
      success(`${r.type} record deleted`);
      load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to delete record");
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Header: zone name + nameserver delegation hint + delete */}
      <div className="flex items-start justify-between gap-4 mb-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50 font-mono truncate">
            {zone.name}
          </h2>
          <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
            Delegate at your registrar — set these nameservers:{" "}
            <span className="font-mono text-brand-700 dark:text-brand-200">
              {zone.nameservers.join(", ")}
            </span>
          </p>
        </div>
        <button onClick={onDeleteZone} className={`${btnGhost} text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 shrink-0`}>
          Delete zone
        </button>
      </div>

      {/* Add record form */}
      <form
        onSubmit={addRecord}
        className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-3 mb-3 shrink-0 flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-500 dark:text-brand-400">Name</span>
          <input
            className={`${inputCls} w-28`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="@ or www"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-500 dark:text-brand-400">Type</span>
          <select
            className={`${inputCls} w-24`}
            value={type}
            onChange={(e) => setType(e.target.value as DnsRecordType)}
          >
            {DNS_RECORD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-brand-500 dark:text-brand-400">TTL</span>
          <input
            type="number"
            min={60}
            max={604800}
            className={`${inputCls} w-24`}
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs text-brand-500 dark:text-brand-400">
            Value(s) — one per line
          </span>
          <input
            className={inputCls}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={VALUE_HINT[type]}
          />
        </label>
        <button className={btnPrimary} disabled={saving || !value.trim()}>
          {saving ? "Saving…" : "Add record"}
        </button>
      </form>

      {/* Records table */}
      {err && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</p>
      )}
      {loading ? (
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
                <th className="px-3 py-2"></th>
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
                  </td>
                  <td className="px-3 py-2 text-brand-500 dark:text-brand-400">
                    {r.ttl}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-brand-700 dark:text-brand-200 break-all">
                    {r.records.join(" ")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.managed ? (
                      <span className="text-xs text-brand-400 dark:text-brand-500">
                        managed
                      </span>
                    ) : (
                      <button
                        onClick={() => removeRecord(r)}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
