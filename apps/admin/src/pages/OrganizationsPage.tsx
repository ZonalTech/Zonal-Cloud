import type React from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AdminOrganization, Organization, Quota } from "../types";
import { adminApi } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { SearchSelect } from "../components/SearchSelect";

// Lifecycle bucket derived from an org's status + subscription + activity.
// "suspended" status always wins; otherwise an expired subscription, then a
// dormant (no recent activity) flag, else active.
type OrgLifecycle = "active" | "expired" | "dormant" | "suspended";

// An org is dormant if it hasn't shown activity within this window.
const DORMANT_DAYS = 30;

function classifyOrg(org: Organization, now: number): OrgLifecycle {
  if (org.status === "suspended") return "suspended";
  if (org.subscriptionExpiresAt && new Date(org.subscriptionExpiresAt).getTime() < now) {
    return "expired";
  }
  const last = org.lastActiveAt ? new Date(org.lastActiveAt).getTime() : null;
  const dormantBefore = now - DORMANT_DAYS * 24 * 60 * 60 * 1000;
  if (last === null || last < dormantBefore) return "dormant";
  return "active";
}

const LIFECYCLE_META: Record<OrgLifecycle, { label: string; dot: string }> = {
  active: { label: "Active", dot: "bg-green-500" },
  expired: { label: "Expired subscription", dot: "bg-amber-500" },
  dormant: { label: "Dormant", dot: "bg-brand-400" },
  suspended: { label: "Suspended", dot: "bg-red-500" },
};

function StatusBadge({ status }: { status: Organization["status"] }) {
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

function PlanBadge({ plan }: { plan: Organization["plan"] }) {
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

const QUOTA_FIELDS: { key: keyof Omit<Quota, "id" | "organizationId">; label: string }[] = [
  { key: "maxApps", label: "Max Apps" },
  { key: "cpu", label: "CPU (cores)" },
  { key: "memory", label: "Memory (MB)" },
  { key: "disk", label: "Disk (MB)" },
  { key: "buildMinutes", label: "Build Minutes" },
  { key: "maxConcurrentDeploys", label: "Max Concurrent Deploys" },
];

function QuotaForm({
  organizationId,
  onSave,
  onCancel,
}: {
  organizationId: string;
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
      await adminApi.setOrganizationQuota(organizationId, partial as Partial<Quota>);
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

// Admins create the organizations that users then register into (by slug).
function CreateOrganizationForm({ onCreated }: { onCreated: (org: Organization) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { organization } = await adminApi.createOrganization({
        name,
        slug: slug.trim() || undefined,
      });
      onCreated(organization);
      setName("");
      setSlug("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-4 py-2 rounded bg-brand-800 dark:bg-brand-200 text-white dark:text-brand-900 font-semibold hover:bg-brand-700 dark:hover:bg-brand-300 transition-colors"
      >
        New Organization
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 p-4 rounded border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800/50"
    >
      <div>
        <label className="block text-xs font-medium text-brand-600 dark:text-brand-400 mb-1">
          Name
        </label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Corp"
          className="px-2 py-1.5 text-sm rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-800 dark:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-brand-600 dark:text-brand-400 mb-1">
          Slug (optional)
        </label>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="acme-corp"
          className="px-2 py-1.5 text-sm rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-800 dark:text-brand-200 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="text-xs px-4 py-1.5 rounded bg-brand-800 dark:bg-brand-200 text-white dark:text-brand-900 hover:bg-brand-700 dark:hover:bg-brand-300 disabled:opacity-50 transition-colors"
      >
        {saving ? "Creating..." : "Create"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null); }}
        className="text-xs px-4 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
      >
        Cancel
      </button>
      {error && (
        <p className="w-full text-xs text-red-700 dark:text-red-400">{error}</p>
      )}
    </form>
  );
}

// A labelled key/value row in the detail pane. Empty numeric values render as
// "0"; other empty values fall back to the supplied placeholder.
function DetailRow({
  label,
  value,
  mono,
  zeroFallback,
}: {
  label: string;
  value?: React.ReactNode;
  mono?: boolean;
  // When true, an empty value renders as "0" instead of a placeholder dash.
  zeroFallback?: boolean;
}) {
  const isEmpty = value === undefined || value === null || value === "";
  return (
    <div className="py-2.5 border-b border-brand-100 dark:border-brand-800 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500">{label}</dt>
      <dd
        className={`mt-1 text-sm text-brand-800 dark:text-brand-200 break-all ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {isEmpty ? (
          zeroFallback ? "0" : <span className="text-brand-400 dark:text-brand-500">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

// Right-hand pane: shows the selected organization's details, or a placeholder.
function OrganizationDetailPane({
  org,
  onClose,
}: {
  org: AdminOrganization | null;
  onClose: () => void;
}) {
  if (!org) {
    return (
      <div className="flex h-full min-h-[20rem] flex-col items-center justify-center px-6 text-center">
        <svg
          className="w-10 h-10 text-brand-300 dark:text-brand-600 mb-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
        <p className="text-sm text-brand-400 dark:text-brand-500">
          Select an organization to see its details
        </p>
      </div>
    );
  }
  const q = org.quota;
  return (
    <div>
      {/* Pinned header: stays put while the detail rows scroll beneath it. */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-white dark:bg-brand-900 px-5 pt-5 pb-4 border-b border-brand-100 dark:border-brand-800">
        <div>
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">{org.name}</h2>
          <div className="mt-1 flex items-center gap-2">
            <PlanBadge plan={org.plan} />
            <StatusBadge status={org.status} />
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="text-brand-400 dark:text-brand-500 hover:text-brand-700 dark:hover:text-brand-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <dl className="px-5 pb-5">
        <DetailRow label="Slug" value={org.slug} mono />
        <DetailRow label="Plan" value={org.plan} />
        <DetailRow label="Status" value={org.status} />
        <DetailRow label="Lifecycle" value={LIFECYCLE_META[classifyOrg(org, Date.now())].label} />
        <DetailRow
          label="Subscription expires"
          value={org.subscriptionExpiresAt ? new Date(org.subscriptionExpiresAt).toLocaleString() : undefined}
        />
        <DetailRow
          label="Last active"
          value={org.lastActiveAt ? new Date(org.lastActiveAt).toLocaleString() : undefined}
        />
        <DetailRow label="Created" value={new Date(org.createdAt).toLocaleString()} />
        <DetailRow label="Users" value={org.counts?.users} zeroFallback />
        <DetailRow label="Projects" value={org.counts?.projects} zeroFallback />
        <DetailRow label="Apps" value={org.counts?.apps} zeroFallback />
        <DetailRow label="Max apps" value={q?.maxApps} zeroFallback />
        <DetailRow label="CPU (cores)" value={q?.cpu} mono zeroFallback />
        <DetailRow label="Memory" value={q?.memory} mono zeroFallback />
        <DetailRow label="Disk" value={q?.disk} mono zeroFallback />
        <DetailRow label="Build minutes" value={q?.buildMinutes} zeroFallback />
        <DetailRow label="Max concurrent deploys" value={q?.maxConcurrentDeploys} zeroFallback />
        <DetailRow label="Org ID" value={org.id} mono />
      </dl>
    </div>
  );
}

// A status row in the summary: coloured dot + label on the left, count right.
function SummaryStat({
  label,
  count,
  dotClass,
}: {
  label: string;
  count: number;
  dotClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-sm text-brand-600 dark:text-brand-300">
        {dotClass && <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />}
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums text-brand-900 dark:text-brand-50">
        {count}
      </span>
    </div>
  );
}

// Right-hand pane shown when no org is selected: a lifecycle rollup of all
// organizations (active / expired subscription / dormant / suspended).
function SummaryPane({ orgs }: { orgs: AdminOrganization[] }) {
  const buckets = useMemo(() => {
    const now = Date.now();
    const b: Record<OrgLifecycle, number> = { active: 0, expired: 0, dormant: 0, suspended: 0 };
    for (const o of orgs) b[classifyOrg(o, now)]++;
    return b;
  }, [orgs]);

  return (
    <div>
      <div className="sticky top-0 z-10 bg-white dark:bg-brand-900 px-5 pt-5 pb-3 border-b border-brand-100 dark:border-brand-800">
        <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">Summary</h2>
        <p className="text-xs text-brand-400 dark:text-brand-500 mt-0.5">
          Organization overview · select one for details
        </p>
      </div>
      <div className="px-5 pb-5">
        <div className="py-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500">
              Organizations
            </h3>
            <span className="text-2xl font-bold tabular-nums text-brand-900 dark:text-brand-50">
              {orgs.length}
            </span>
          </div>
          <div className="mt-2">
            <SummaryStat label={LIFECYCLE_META.active.label} count={buckets.active} dotClass={LIFECYCLE_META.active.dot} />
            <SummaryStat label={LIFECYCLE_META.expired.label} count={buckets.expired} dotClass={LIFECYCLE_META.expired.dot} />
            <SummaryStat label={LIFECYCLE_META.dormant.label} count={buckets.dormant} dotClass={LIFECYCLE_META.dormant.dot} />
            <SummaryStat label={LIFECYCLE_META.suspended.label} count={buckets.suspended} dotClass={LIFECYCLE_META.suspended.dot} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-brand-400 dark:text-brand-500">
            Dormant = no activity in {DORMANT_DAYS} days. Expired = subscription end date in the past.
          </p>
        </div>
      </div>
    </div>
  );
}

export function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingOrganizationId, setEditingOrganizationId] = useState<string | null>(null);
  // Id of the org whose details are shown in the right pane, or null.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Top-bar filters: a specific organization, and/or a lifecycle bucket.
  const [filterOrgId, setFilterOrgId] = useState("");
  const [filterLifecycle, setFilterLifecycle] = useState("");

  useEffect(() => {
    adminApi
      .getOrganizations()
      .then(({ organizations: o }) => setOrganizations(o))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load organizations");
      })
      .finally(() => setLoading(false));
  }, []);

  // Apply the top-bar filters to the card grid. The summary pane always counts
  // the full, unfiltered set.
  const visibleOrgs = useMemo(() => {
    const now = Date.now();
    return organizations.filter((o) => {
      if (filterOrgId && o.id !== filterOrgId) return false;
      if (filterLifecycle && classifyOrg(o, now) !== filterLifecycle) return false;
      return true;
    });
  }, [organizations, filterOrgId, filterLifecycle]);

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
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Organizations"
        actions={
          <>
            <div className="w-56">
              <SearchSelect
                options={organizations.map((o) => ({ value: o.id, label: o.name }))}
                value={filterOrgId}
                onChange={setFilterOrgId}
                placeholder="All organizations"
                allLabel="All organizations"
              />
            </div>
            <select
              value={filterLifecycle}
              onChange={(e) => setFilterLifecycle(e.target.value)}
              className="px-3 py-2 text-sm rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-700 dark:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
            >
              <option value="">All statuses</option>
              <option value="active">{LIFECYCLE_META.active.label}</option>
              <option value="expired">{LIFECYCLE_META.expired.label}</option>
              <option value="dormant">{LIFECYCLE_META.dormant.label}</option>
              <option value="suspended">{LIFECYCLE_META.suspended.label}</option>
            </select>
            <CreateOrganizationForm
              onCreated={(org) => setOrganizations((prev) => [org, ...prev])}
            />
          </>
        }
      />

      {/* flex-1 + min-h-0 fills the remaining height of <main> (a flex column)
          so the page never scrolls; each column scrolls within its own box. */}
      <div className="mt-6 flex flex-col lg:flex-row gap-6 items-stretch flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto hide-scrollbar">
        {visibleOrgs.length === 0 ? (
          <div className="px-4 py-12 text-center text-brand-400 dark:text-brand-500 rounded-lg border border-brand-200 dark:border-brand-700">
            {organizations.length === 0
              ? "No organizations found."
              : "No organizations match the current filters."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleOrgs.map((org) => {
              const selected = selectedId === org.id;
              return (
                <div
                  key={org.id}
                  onClick={() => setSelectedId(org.id)}
                  className={`flex flex-col rounded-lg border p-4 cursor-pointer transition-colors ${
                    selected
                      ? "border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-800/60 ring-1 ring-brand-400 dark:ring-brand-500"
                      : "border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-brand-900 dark:text-brand-50 truncate">
                        {org.name}
                      </h3>
                      <p className="mt-0.5 font-mono text-xs text-brand-500 dark:text-brand-400 truncate">
                        {org.slug}
                      </p>
                    </div>
                    <StatusBadge status={org.status} />
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <PlanBadge plan={org.plan} />
                    <span className="text-xs text-brand-400 dark:text-brand-500 tabular-nums">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "Users", value: org.counts?.users ?? 0 },
                      { label: "Projects", value: org.counts?.projects ?? 0 },
                      { label: "Apps", value: org.counts?.apps ?? 0 },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded border border-brand-100 dark:border-brand-800 py-1.5"
                      >
                        <div className="text-sm font-semibold text-brand-800 dark:text-brand-200 tabular-nums">
                          {stat.value}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-brand-400 dark:text-brand-500">
                          {stat.label}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() =>
                        setEditingOrganizationId((prev) => (prev === org.id ? null : org.id))
                      }
                      className="text-xs px-3 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
                    >
                      {editingOrganizationId === org.id ? "Cancel" : "Edit Quota"}
                    </button>
                    {editingOrganizationId === org.id && (
                      <QuotaForm
                        organizationId={org.id}
                        onSave={() => setEditingOrganizationId(null)}
                        onCancel={() => setEditingOrganizationId(null)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

        {/* Right pane: lifecycle summary until an org is selected, then details.
            Scrolls internally so long content never scrolls the page. */}
        <aside className="w-full lg:w-96 lg:flex-shrink-0 h-full overflow-y-auto hide-scrollbar rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900">
          {selectedId ? (
            <OrganizationDetailPane
              org={organizations.find((o) => o.id === selectedId) ?? null}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <SummaryPane orgs={organizations} />
          )}
        </aside>
      </div>
    </div>
  );
}
