import { Fragment, FormEvent, useEffect, useState } from "react";
import type { Org, Quota } from "../types";
import { adminApi } from "../lib/api";

function StatusBadge({ status }: { status: Org["status"] }) {
  const base = "inline-block px-2 py-0.5 rounded text-xs font-medium";
  if (status === "active") {
    return (
      <span className={`${base} bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400`}>
        active
      </span>
    );
  }
  return (
    <span className={`${base} bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400`}>
      suspended
    </span>
  );
}

function PlanBadge({ plan }: { plan: Org["plan"] }) {
  const base = "inline-block px-2 py-0.5 rounded text-xs font-medium";
  if (plan === "pro") {
    return (
      <span className={`${base} bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400`}>
        pro
      </span>
    );
  }
  return (
    <span className={`${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`}>
      free
    </span>
  );
}

const QUOTA_FIELDS: { key: keyof Omit<Quota, "id" | "orgId">; label: string }[] = [
  { key: "maxApps", label: "Max Apps" },
  { key: "cpu", label: "CPU (cores)" },
  { key: "memory", label: "Memory (MB)" },
  { key: "disk", label: "Disk (MB)" },
  { key: "buildMinutes", label: "Build Minutes" },
  { key: "maxConcurrentDeploys", label: "Max Concurrent Deploys" },
];

function QuotaForm({
  orgId,
  onSave,
  onCancel,
}: {
  orgId: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Per the API contract, cpu/memory/disk are strings (e.g. "1", "512m", "2g")
    // while buildMinutes/maxConcurrentDeploys are numbers. Send each field with
    // the correct type so backend validation does not reject the request.
    const numericFields = new Set(["buildMinutes", "maxConcurrentDeploys"]);
    const partial: Record<string, string | number> = {};
    for (const { key } of QUOTA_FIELDS) {
      const v = values[key];
      if (v !== undefined && v !== "") {
        partial[key] = numericFields.has(key) ? Number(v) : v;
      }
    }
    setSaving(true);
    try {
      await adminApi.setOrgQuota(orgId, partial as Partial<Quota>);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save quota");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-4 rounded border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800/50">
      <p className="text-xs font-medium text-brand-600 dark:text-brand-400 mb-3 uppercase tracking-wide">
        Edit Quota
      </p>
      {error && (
        <div className="mb-3 px-3 py-2 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {QUOTA_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-brand-600 dark:text-brand-400 mb-1">
              {label}
            </label>
            <input
              type={key === "buildMinutes" || key === "maxConcurrentDeploys" ? "number" : "text"}
              min={0}
              value={values[key] ?? ""}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [key]: e.target.value }))
              }
              className="w-full px-2 py-1.5 text-sm rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-800 dark:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              placeholder="unchanged"
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="text-xs px-4 py-1.5 rounded bg-brand-800 dark:bg-brand-200 text-white dark:text-brand-900 hover:bg-brand-700 dark:hover:bg-brand-300 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-4 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function OrgsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .getOrgs()
      .then(({ orgs: o }) => setOrgs(o))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load orgs");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-800 dark:text-brand-100 mb-6">
        Orgs
      </h1>

      <div className="overflow-x-auto rounded-lg border border-brand-200 dark:border-brand-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700">
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Name</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Slug</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Status</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Created</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {orgs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  No orgs found.
                </td>
              </tr>
            )}
            {orgs.map((org) => (
              <Fragment key={org.id}>
                <tr
                  className="bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors"
                >
                  <td className="px-4 py-3 text-brand-800 dark:text-brand-200 font-medium">
                    {org.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-brand-500 dark:text-brand-400">
                    {org.slug}
                  </td>
                  <td className="px-4 py-3">
                    <PlanBadge plan={org.plan} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={org.status} />
                  </td>
                  <td className="px-4 py-3 text-brand-500 dark:text-brand-400 tabular-nums">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        setEditingOrgId((prev) => (prev === org.id ? null : org.id))
                      }
                      className="text-xs px-3 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
                    >
                      {editingOrgId === org.id ? "Cancel" : "Edit Quota"}
                    </button>
                  </td>
                </tr>
                {editingOrgId === org.id && (
                  <tr key={`${org.id}-quota`} className="bg-white dark:bg-brand-900">
                    <td colSpan={6} className="px-4 pb-4">
                      <QuotaForm
                        orgId={org.id}
                        onSave={() => setEditingOrgId(null)}
                        onCancel={() => setEditingOrgId(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
