import { FormEvent, useEffect, useState } from "react";
import { appsApi, githubApi, type GithubRepo } from "../lib/api";
import { useToast } from "../context/ToastContext";
import type { App, AppSource, AppType } from "../types";

type GitMode = "github" | "url";

interface CreateAppFormProps {
  // Called with the created app so the host (modal) can navigate / close.
  onCreated: (app: App) => void;
  onCancel: () => void;
}

export function CreateAppForm({ onCreated, onCancel }: CreateAppFormProps) {
  const toast = useToast();

  const [name, setName] = useState("");
  const [type, setType] = useState<AppType>("static");
  const [source, setSource] = useState<AppSource>("git");
  const [gitMode, setGitMode] = useState<GitMode>("github");
  const [repoUrl, setRepoUrl] = useState("");
  // Blank until a branch is fetched/selected — we never assume "main".
  const [branch, setBranch] = useState("");
  // Frappe framework version the bench is built on (only for type=frappe).
  const [frappeVersion, setFrappeVersion] = useState("version-15");
  // Available Frappe versions (version-15+ newest-first, plus nightly), fetched
  // from GitHub so new majors appear without a code change.
  const [frappeVersionOptions, setFrappeVersionOptions] = useState<
    Array<{ value: string; label: string }>
  >([{ value: "version-15", label: "version-15" }]);
  const [submitting, setSubmitting] = useState(false);

  // Uploaded source folder (Upload source mode). webkitdirectory yields a
  // FileList of every file in the chosen folder, each with webkitRelativePath.
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);

  // GitHub connection state
  const [ghConnected, setGhConnected] = useState(false);
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [ghLoading, setGhLoading] = useState(true);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Branches fetched from GitHub for the selected repo.
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  // Branches fetched via ls-remote for a pasted Repository URL.
  const [urlBranches, setUrlBranches] = useState<string[]>([]);
  const [urlBranchesLoading, setUrlBranchesLoading] = useState(false);
  const [urlBranchesError, setUrlBranchesError] = useState<string | null>(null);

  // Frappe apps put the selected repo on a Frappe bench (bench get-app), so they
  // must use Git source. Force git and drop any chosen upload when Frappe is
  // selected.
  useEffect(() => {
    if (type === "frappe" && source !== "git") {
      setSource("git");
    }
  }, [type, source]);

  // Load available Frappe versions once the user picks the Frappe type. Default
  // the selection to the first (latest) option.
  useEffect(() => {
    if (type !== "frappe") return;
    let cancelled = false;
    githubApi
      .listFrappeVersions()
      .then(({ versions }) => {
        if (cancelled || versions.length === 0) return;
        setFrappeVersionOptions(versions);
        setFrappeVersion((prev) =>
          versions.some((v) => v.value === prev) ? prev : versions[0].value,
        );
      })
      .catch(() => {
        /* keep the static fallback already in state */
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  // Check GitHub connection status on mount.
  useEffect(() => {
    githubApi
      .status()
      .then((s) => {
        setGhConnected(s.connected);
        setGhLogin(s.login ?? null);
      })
      .catch(() => setGhConnected(false))
      .finally(() => setGhLoading(false));
  }, []);

  // Load repos once connected and on GitHub mode.
  useEffect(() => {
    if (!ghConnected || source !== "git" || gitMode !== "github") return;
    setReposLoading(true);
    setReposError(null);
    githubApi
      .listRepos()
      .then(({ repos: list }) => setRepos(list))
      .catch((err: unknown) =>
        setReposError(err instanceof Error ? err.message : "Failed to load repos"),
      )
      .finally(() => setReposLoading(false));
  }, [ghConnected, source, gitMode]);

  async function handleConnectGithub() {
    setConnecting(true);
    try {
      const { url } = await githubApi.authorize();
      // Full-page redirect to GitHub consent; GitHub redirects back to the API
      // callback, which redirects here with ?github=connected.
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start GitHub connect");
      setConnecting(false);
    }
  }

  async function fetchUrlBranches(url: string) {
    setUrlBranchesLoading(true);
    setUrlBranchesError(null);
    try {
      const { branches: list } = await githubApi.listRemoteBranches(url);
      setUrlBranches(list);
      if (list.length === 0) {
        setUrlBranchesError("No branches found");
        return;
      }
      // Preselect default-ish branch (or keep current if still valid).
      setBranch((prev) => (list.includes(prev) ? prev : list[0]));
    } catch (err) {
      setUrlBranches([]);
      setUrlBranchesError(err instanceof Error ? err.message : "Failed to fetch branches");
    } finally {
      setUrlBranchesLoading(false);
    }
  }

  // Auto-fetch branches shortly after the user finishes typing a repo URL, so
  // they don't have to click anything. Debounced to avoid a request on every
  // keystroke.
  useEffect(() => {
    if (source !== "git" || gitMode !== "url") return;
    const url = repoUrl.trim();
    // Only fire for plausible git URLs (http(s):// or git@…), else wait.
    if (!/^(https?:\/\/|git@).+/.test(url)) return;
    const handle = setTimeout(() => {
      void fetchUrlBranches(url);
    }, 600);
    return () => clearTimeout(handle);
    // fetchUrlBranches is stable enough for this debounce; depend on the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl, source, gitMode]);

  function handleSelectRepo(repo: GithubRepo) {
    setSelectedRepo(repo);
    if (!name) setName(repo.name);
    setBranch(repo.defaultBranch || "main");
  }

  // Fetch the selected repo's branches so the user can pick which one to deploy.
  useEffect(() => {
    if (!selectedRepo || gitMode !== "github") {
      setBranches([]);
      return;
    }
    let cancelled = false;
    setBranchesLoading(true);
    setBranchesError(null);
    githubApi
      .listBranches(selectedRepo.fullName)
      .then(({ branches: list, defaultBranch }) => {
        if (cancelled) return;
        setBranches(list);
        // Preselect the default branch (or keep current if still valid).
        setBranch((prev) => (list.includes(prev) ? prev : defaultBranch || list[0] || "main"));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBranches([]);
        setBranchesError(err instanceof Error ? err.message : "Failed to load branches");
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, gitMode]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const appType = type as
        | "static"
        | "node"
        | "fullstack"
        | "nodered"
        | "frappe";
      if (type === "frappe" && source !== "git") {
        throw new Error(
          "A Frappe app must be deployed from a Git repository (the repo is installed on the bench).",
        );
      }
      let payload: Parameters<typeof appsApi.create>[0];
      if (appType === "nodered") {
        // Node-RED has no source repo — it runs the official image. Source is
        // irrelevant, but the API expects a valid value, so send "git".
        payload = { name, source: "git", type: appType };
      } else if (source === "upload") {
        if (uploadFiles.length === 0) {
          throw new Error("Choose a folder to upload");
        }
        payload = { name, source, type: appType };
      } else if (gitMode === "github") {
        if (!selectedRepo) {
          throw new Error("Select a GitHub repository");
        }
        const repoGit = `${selectedRepo.htmlUrl}.git`;
        const repoBranch = branch || selectedRepo.defaultBranch || "main";
        payload = {
          name,
          source: "git",
          type: appType,
          repoUrl: repoGit,
          branch: repoBranch,
          githubRepoFullName: selectedRepo.fullName,
          // For Frappe, the selected repo IS the first app put on the bench
          // (bench get-app). More can be added later from the app page.
          ...(appType === "frappe"
            ? {
                frappeGitUrl: repoGit,
                frappeBranch: repoBranch,
                frappeVersion: frappeVersion || "version-15",
              }
            : {}),
        };
      } else {
        payload = {
          name,
          source: "git",
          type: appType,
          repoUrl: repoUrl || undefined,
          branch: branch || undefined,
          ...(appType === "frappe"
            ? {
                ...(repoUrl ? { frappeGitUrl: repoUrl, frappeBranch: branch || undefined } : {}),
                frappeVersion: frappeVersion || "version-15",
              }
            : {}),
        };
      }
      const { app, noderedAdminPassword } = await appsApi.create(payload);

      // For uploads, push the chosen folder right after creating the app. The
      // code builds on the first manual Deploy from the app's detail page.
      if (source === "upload" && appType !== "nodered") {
        const { files } = await appsApi.uploadSource(app.id, uploadFiles);
        toast.success(`App "${app.name}" created — ${files} files uploaded. Deploy when ready.`);
      } else if (appType === "nodered" && noderedAdminPassword) {
        // Show the one-time seeded admin password — it is only stored hashed and
        // cannot be recovered. The user can add more accounts from the app page.
        toast.success(
          `Node-RED app "${app.name}" created. Admin login — user: admin, password: ${noderedAdminPassword} (save this; it won't be shown again). Deploy to install.`,
        );
      } else {
        toast.success(`App "${app.name}" created.`);
      }
      onCreated(app);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create app");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors";

  return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium text-brand-700 dark:text-brand-300">
              App name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="my-app"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-brand-700 dark:text-brand-300">Site type</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: "static",
                    label: "Static",
                    desc: "Pre-built files served by nginx. No server, no database.",
                  },
                  {
                    value: "node",
                    label: "Dynamic",
                    desc: "A long-running Node server. No managed database.",
                  },
                  {
                    value: "fullstack",
                    label: "Full stack",
                    desc: "Node server with a managed Postgres database.",
                  },
                  {
                    value: "nodered",
                    label: "Node-RED",
                    desc: "Managed Node-RED instance. No repo — runs the official image with a persistent volume. Set up editor accounts after install.",
                  },
                  {
                    value: "frappe",
                    label: "Frappe app",
                    desc: "Full Frappe bench. Your repo is installed as an app; MariaDB + site auto-provisioned. Add more apps later.",
                  },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={[
                    "flex flex-col gap-1 rounded-lg border p-3 cursor-pointer transition-colors",
                    type === opt.value
                      ? "border-lime-500 dark:border-lime-400 bg-brand-50 dark:bg-brand-800"
                      : "border-brand-200 dark:border-brand-700 hover:border-brand-300 dark:hover:border-brand-600",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="type"
                      value={opt.value}
                      checked={type === opt.value}
                      onChange={() => setType(opt.value)}
                      className="accent-lime-500 dark:accent-lime-400"
                    />
                    <span className="text-sm font-medium text-brand-800 dark:text-brand-100">
                      {opt.label}
                    </span>
                  </div>
                  <span className="text-xs text-brand-500 dark:text-brand-400 leading-snug">
                    {opt.desc}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {type === "nodered" && (
            <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800 p-4">
              <p className="text-sm text-brand-600 dark:text-brand-300">
                Node-RED has no source to configure — it runs the official image. On create, a
                default <span className="font-medium">admin</span> editor account is generated
                and its password shown once. After it installs, manage editor accounts (add more
                users, set read-only access, change passwords) from the app page.
              </p>
            </div>
          )}

          {type === "frappe" && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="frappeVersion"
                className="text-sm font-medium text-brand-700 dark:text-brand-300"
              >
                Frappe version
              </label>
              <select
                id="frappeVersion"
                value={frappeVersion}
                onChange={(e) => setFrappeVersion(e.target.value)}
                className={inputClass}
              >
                {frappeVersionOptions.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type !== "nodered" && (
          <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-brand-700 dark:text-brand-300">Source</span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="source"
                  value="git"
                  checked={source === "git"}
                  onChange={() => setSource("git")}
                  className="accent-lime-500 dark:accent-lime-400"
                />
                <span
                  className={
                    source === "git"
                      ? "text-sm font-medium text-lime-600 dark:text-lime-400"
                      : "text-sm text-brand-700 dark:text-brand-300"
                  }
                >
                  Git repository
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="source"
                  value="upload"
                  checked={source === "upload"}
                  onChange={() => setSource("upload")}
                  className="accent-lime-500 dark:accent-lime-400"
                />
                <span
                  className={
                    source === "upload"
                      ? "text-sm font-medium text-lime-600 dark:text-lime-400"
                      : "text-sm text-brand-700 dark:text-brand-300"
                  }
                >
                  Upload
                </span>
              </label>
            </div>
          </div>

          {source === "git" && (
            <>
              {/* Git mode toggle: connect GitHub vs paste URL */}
              <div className="flex gap-2 p-1 rounded-lg bg-brand-100 dark:bg-brand-800 w-fit">
                <button
                  type="button"
                  onClick={() => setGitMode("github")}
                  className={[
                    "px-3 py-1.5 rounded text-xs font-medium transition-colors",
                    gitMode === "github"
                      ? "bg-white dark:bg-brand-900 text-lime-600 dark:text-lime-400 ring-1 ring-lime-500 dark:ring-lime-400 shadow-sm"
                      : "text-brand-600 dark:text-brand-400",
                  ].join(" ")}
                >
                  Connect GitHub
                </button>
                <button
                  type="button"
                  onClick={() => setGitMode("url")}
                  className={[
                    "px-3 py-1.5 rounded text-xs font-medium transition-colors",
                    gitMode === "url"
                      ? "bg-white dark:bg-brand-900 text-lime-600 dark:text-lime-400 ring-1 ring-lime-500 dark:ring-lime-400 shadow-sm"
                      : "text-brand-600 dark:text-brand-400",
                  ].join(" ")}
                >
                  Repository URL
                </button>
              </div>

              {gitMode === "github" && (
                <div className="flex flex-col gap-3">
                  {ghLoading ? (
                    <p className="text-sm text-brand-400 dark:text-brand-500">
                      Checking GitHub connection...
                    </p>
                  ) : !ghConnected ? (
                    <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800 p-4 flex flex-col items-start gap-3">
                      <p className="text-sm text-brand-600 dark:text-brand-300">
                        Connect your GitHub account to pick a repository and enable
                        push-to-deploy.
                      </p>
                      <button
                        type="button"
                        onClick={handleConnectGithub}
                        disabled={connecting}
                        className="px-4 py-2 rounded bg-brand-800 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-900 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
                      >
                        {connecting ? "Redirecting..." : "Connect GitHub"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-brand-600 dark:text-brand-400">
                          Connected as{" "}
                          <span className="font-semibold text-brand-800 dark:text-brand-200">
                            {ghLogin}
                          </span>
                        </span>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-[7fr_3fr]">
                        <div className="flex flex-col gap-1.5">
                          <label
                            htmlFor="repo"
                            className="text-sm font-medium text-brand-700 dark:text-brand-300"
                          >
                            Repository <span className="text-red-500">*</span>
                          </label>
                          {reposLoading ? (
                            <p className="text-sm text-brand-400 dark:text-brand-500">
                              Loading repositories...
                            </p>
                          ) : reposError ? (
                            <p className="text-sm text-red-600 dark:text-red-400">{reposError}</p>
                          ) : (
                            <select
                              id="repo"
                              value={selectedRepo?.id ?? ""}
                              onChange={(e) => {
                                const repo = repos.find((r) => String(r.id) === e.target.value);
                                if (repo) handleSelectRepo(repo);
                              }}
                              className={inputClass}
                            >
                              <option value="" disabled>
                                Select a repository
                              </option>
                              {repos.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.fullName}
                                  {r.private ? " (private)" : ""}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        {selectedRepo && (
                          <div className="flex flex-col gap-1.5">
                            <label
                              htmlFor="gh-branch"
                              className="text-sm font-medium text-brand-700 dark:text-brand-300"
                            >
                              Branch
                            </label>
                            {branchesLoading ? (
                              <p className="text-sm text-brand-400 dark:text-brand-500">
                                Loading branches...
                              </p>
                            ) : branchesError ? (
                              <p className="text-sm text-red-600 dark:text-red-400">
                                {branchesError}
                              </p>
                            ) : (
                              <select
                                id="gh-branch"
                                value={branch}
                                onChange={(e) => setBranch(e.target.value)}
                                className={inputClass}
                              >
                                {branches.map((b) => (
                                  <option key={b} value={b}>
                                    {b}
                                    {b === selectedRepo.defaultBranch ? " (default)" : ""}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {gitMode === "url" && (
                <div className="grid gap-4 sm:grid-cols-[7fr_3fr]">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="repoUrl"
                      className="text-sm font-medium text-brand-700 dark:text-brand-300"
                    >
                      Repository URL
                    </label>
                    <input
                      id="repoUrl"
                      type="url"
                      value={repoUrl}
                      onChange={(e) => {
                        setRepoUrl(e.target.value);
                        // URL changed — fetched branches no longer apply. Branches
                        // are auto-fetched (debounced) by the effect above.
                        setUrlBranches([]);
                        setUrlBranchesError(null);
                        setBranch("");
                      }}
                      className={inputClass}
                      placeholder="https://github.com/org/repo"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="branch"
                      className="text-sm font-medium text-brand-700 dark:text-brand-300"
                    >
                      Branch
                    </label>
                    {urlBranches.length > 0 ? (
                      <select
                        id="branch"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        className={inputClass}
                      >
                        {urlBranches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="branch"
                        type="text"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        className={inputClass}
                        placeholder={
                          urlBranchesLoading
                            ? "Fetching branches…"
                            : "Enter a repo URL to load branches"
                        }
                      />
                    )}
                    {urlBranchesError && (
                      <p className="text-sm text-red-600 dark:text-red-400">{urlBranchesError}</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {source === "upload" && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="folder"
                className="text-sm font-medium text-brand-700 dark:text-brand-300"
              >
                Code folder <span className="text-red-500">*</span>
              </label>
              <input
                id="folder"
                type="file"
                // Folder picker: all files in the chosen directory are uploaded.
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                multiple
                onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))}
                className="text-sm text-brand-700 dark:text-brand-300 file:mr-3 file:rounded file:border-0 file:bg-brand-700 dark:file:bg-brand-200 file:text-white dark:file:text-brand-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:cursor-pointer hover:file:bg-brand-800 dark:hover:file:bg-brand-100"
              />
              {uploadFiles.length > 0 ? (
                <p className="text-xs text-lime-600 dark:text-lime-400">
                  {uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} selected
                </p>
              ) : (
                <p className="text-xs text-brand-400 dark:text-brand-500">
                  Select the folder containing your app's code. It uploads on create;
                  deploy it from the app page when ready.
                </p>
              )}
            </div>
          )}
          </>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Creating..." : "Create app"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
  );
}
