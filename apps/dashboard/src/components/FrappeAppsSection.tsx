import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { appsApi, githubApi, type FrappeApp, type GithubRepo } from "../lib/api";
import { useToast } from "../context/ToastContext";

// Manage the git apps installed on a Frappe app's bench. Frappe core is always
// present (added by the deploy pipeline) and is NOT listed here — these are the
// extra apps (erpnext, hrms, custom apps). Adding/removing takes effect on the
// next deploy, which rebuilds the bench image and migrates the site.
//
// Adding an app is GitHub-aware: when the account is connected, typing searches
// the user's repos and the branch list auto-loads from GitHub. A raw repo URL
// also works (e.g. public frappe/* repos) — its branches are fetched via
// ls-remote. The version (branch) is selected automatically (default branch
// first) and can be changed from the dropdown.
export function FrappeAppsSection({
  appId,
  currentVersion,
  onVersionChanged,
}: {
  appId: string;
  // The app's current frappeVersion (defaults to version-15 if unset).
  currentVersion?: string | null;
  // Called after the version is changed so the parent can refresh the app.
  onVersionChanged?: () => void;
}) {
  const toast = useToast();
  const [apps, setApps] = useState<FrappeApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Frappe framework version (the whole bench is built on one version).
  const initialVersion = currentVersion || "version-15";
  const [version, setVersion] = useState(initialVersion);
  const [versionOptions, setVersionOptions] = useState<
    Array<{ value: string; label: string }>
  >([{ value: initialVersion, label: initialVersion }]);
  const [versionMode, setVersionMode] = useState<"preset" | "custom">("preset");
  const [savingVersion, setSavingVersion] = useState(false);
  useEffect(() => {
    setVersion(currentVersion || "version-15");
  }, [currentVersion]);

  // Load available Frappe versions (version-15+ newest-first, plus nightly).
  useEffect(() => {
    let cancelled = false;
    githubApi
      .listFrappeVersions()
      .then(({ versions }) => {
        if (cancelled || versions.length === 0) return;
        // Make sure the current version is always selectable even if it's older
        // than the offered range.
        const cur = currentVersion || "version-15";
        const opts = versions.some((v) => v.value === cur)
          ? versions
          : [...versions, { value: cur, label: cur }];
        setVersionOptions(opts);
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [currentVersion]);

  async function handleSaveVersion() {
    const v = version.trim();
    if (!v || v === (currentVersion || "version-15")) return;
    setSavingVersion(true);
    try {
      const res = await appsApi.setFrappeVersion(appId, v);
      toast.success(
        res.rebuildRequired
          ? `Frappe version set to ${v}. Migrate (clean rebuild) to apply it.`
          : `Frappe version is already ${v}.`,
      );
      onVersionChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set version");
    } finally {
      setSavingVersion(false);
    }
  }

  // The repo to add: either a picked GitHub repo (fullName known) or a free-text
  // git URL. `gitUrl` is the value actually submitted.
  const [gitUrl, setGitUrl] = useState("");
  const [query, setQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // GitHub connection + repo list (for search).
  const [ghConnected, setGhConnected] = useState(false);
  const [repos, setRepos] = useState<GithubRepo[]>([]);

  // Branches for the chosen repo/URL, with the selected one.
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  function load() {
    appsApi
      .listFrappeApps(appId)
      .then(({ frappeApps }) => setApps(frappeApps))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load Frappe apps"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, [appId]);

  // Discover GitHub connection + preload repos for client-side search.
  useEffect(() => {
    githubApi
      .status()
      .then((s) => {
        setGhConnected(s.connected);
        if (s.connected) {
          githubApi
            .listRepos()
            .then(({ repos: list }) => setRepos(list))
            .catch(() => setRepos([]));
        }
      })
      .catch(() => setGhConnected(false));
  }, []);

  // Repos matching the current query (case-insensitive on full name).
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos.slice(0, 8);
    return repos.filter((r) => r.fullName.toLowerCase().includes(q)).slice(0, 8);
  }, [repos, query]);

  // Load branches for a connected-repo selection.
  function pickRepo(repo: GithubRepo) {
    setSelectedRepo(repo);
    setQuery(repo.fullName);
    setGitUrl(`${repo.htmlUrl}.git`);
    setShowSuggestions(false);
    setBranches([]);
    setBranch("");
    setBranchesError(null);
    setBranchesLoading(true);
    githubApi
      .listBranches(repo.fullName)
      .then(({ branches: list, defaultBranch }) => {
        setBranches(list);
        setBranch(defaultBranch || list[0] || "");
      })
      .catch((err: unknown) =>
        setBranchesError(err instanceof Error ? err.message : "Failed to load branches"),
      )
      .finally(() => setBranchesLoading(false));
  }

  // For a free-text git URL (not a picked repo), auto-fetch branches via
  // ls-remote, debounced. Only runs when no GitHub repo is selected.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (selectedRepo) return; // handled by pickRepo
    const url = query.trim();
    setGitUrl(url);
    if (!/^(https?:\/\/|git@).+/.test(url)) {
      setBranches([]);
      setBranch("");
      setBranchesError(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setBranchesLoading(true);
      setBranchesError(null);
      githubApi
        .listRemoteBranches(url)
        .then(({ branches: list }) => {
          setBranches(list);
          // Prefer version-15 if present (Frappe convention), else the first.
          const preferred =
            list.find((b) => b === "version-15") ?? list[0] ?? "";
          setBranch((prev) => (list.includes(prev) ? prev : preferred));
          if (list.length === 0) setBranchesError("No branches found");
        })
        .catch((err: unknown) => {
          setBranches([]);
          setBranchesError(
            err instanceof Error ? err.message : "Failed to fetch branches",
          );
        })
        .finally(() => setBranchesLoading(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selectedRepo]);

  function resetForm() {
    setGitUrl("");
    setQuery("");
    setSelectedRepo(null);
    setBranches([]);
    setBranch("");
    setBranchesError(null);
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!gitUrl.trim()) {
      toast.error("Choose a repository or paste a git URL");
      return;
    }
    setAdding(true);
    try {
      await appsApi.addFrappeApp(appId, {
        gitUrl: gitUrl.trim(),
        branch: branch.trim() || undefined,
        appName: selectedRepo?.name,
      });
      resetForm();
      toast.success("App added. Deploy to build it onto the bench and install it.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add app");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(frappeAppId: string) {
    setRemovingId(frappeAppId);
    try {
      await appsApi.removeFrappeApp(appId, frappeAppId);
      toast.info("App removed. It is dropped from the bench on the next deploy.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove app");
    } finally {
      setRemovingId(null);
    }
  }

  const fieldClass =
    "px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 mb-3">
        Frappe apps
      </h2>

      {/* Frappe framework version (upgrade/downgrade the whole bench) */}
      <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-800/40 p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Frappe version
          </span>
          <span className="text-xs text-brand-400 dark:text-brand-500">
            current: <code className="font-mono">{currentVersion || "version-15"}</code>
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {versionMode === "preset" ? (
            <select
              value={version}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setVersionMode("custom");
                  setVersion("");
                } else {
                  setVersion(e.target.value);
                }
              }}
              className={`flex-1 ${fieldClass}`}
            >
              {versionOptions.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
              <option value="__custom__">Custom branch/tag…</option>
            </select>
          ) : (
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. version-12 or a tag"
              className={`flex-1 ${fieldClass}`}
            />
          )}
          <button
            type="button"
            onClick={handleSaveVersion}
            disabled={savingVersion || !version.trim() || version.trim() === (currentVersion || "version-15")}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {savingVersion ? "Saving..." : "Set version"}
          </button>
        </div>
      </div>

      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 mb-4">
        {/* Repo search / URL input with suggestions dropdown */}
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedRepo(null);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            // Delay hiding so a click on a suggestion registers first.
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={
              ghConnected
                ? "Search repos or paste https://github.com/frappe/erpnext"
                : "https://github.com/frappe/erpnext"
            }
            className={`w-full ${fieldClass}`}
          />
          {showSuggestions && ghConnected && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-md border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-lg">
              {suggestions.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickRepo(r);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-brand-800 dark:text-brand-100 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
                  >
                    {r.fullName}
                    {r.private ? (
                      <span className="ml-2 text-xs text-brand-400">(private)</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Version (branch) — auto-loaded, selectable */}
        {branches.length > 0 ? (
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className={`sm:w-56 ${fieldClass}`}
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
                {selectedRepo && b === selectedRepo.defaultBranch ? " (default)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={branchesLoading ? "Loading versions…" : "version (default version-15)"}
            className={`sm:w-56 ${fieldClass}`}
          />
        )}

        <button
          type="submit"
          disabled={adding}
          className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
        >
          {adding ? "Adding..." : "Add app"}
        </button>
      </form>

      {branchesError && (
        <p className="text-xs text-red-500 dark:text-red-400 -mt-2 mb-3">{branchesError}</p>
      )}

      {loading && (
        <p className="text-sm text-brand-400 dark:text-brand-500">Loading Frappe apps...</p>
      )}
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {!loading && !error && apps.length === 0 && (
        <p className="text-sm text-brand-400 dark:text-brand-500">
          No extra apps yet — only Frappe core will be installed. Add one above.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {apps.map((a) => (
          <div
            key={a.id}
            className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-4 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-brand-900 dark:text-brand-50 truncate">
                  {a.appName || a.gitUrl}
                </span>
                <span
                  className={[
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                    a.installed
                      ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                      : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300",
                  ].join(" ")}
                >
                  {a.installed ? "installed" : "pending deploy"}
                </span>
              </div>
              <code className="block font-mono text-xs text-brand-500 dark:text-brand-400 break-all mt-0.5">
                {a.gitUrl}
                {a.branch ? ` @ ${a.branch}` : ""}
              </code>
            </div>
            <button
              onClick={() => handleRemove(a.id)}
              disabled={removingId === a.id}
              className="shrink-0 text-xs px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 font-medium hover:bg-brand-100 dark:hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {removingId === a.id ? "Removing..." : "Remove"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
