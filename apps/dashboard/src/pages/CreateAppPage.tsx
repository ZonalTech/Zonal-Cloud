import React, { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appsApi } from "../lib/api";
import type { AppSource } from "../types";

export function CreateAppPage() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [source, setSource] = useState<AppSource>("git");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload =
        source === "git"
          ? { name, source, repoUrl: repoUrl || undefined, branch: branch || undefined }
          : { name, source };
      const { app } = await appsApi.create(payload);
      navigate(`/apps/${app.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create app");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50 mb-6">New App</h1>

      <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-6 max-w-lg shadow-sm">
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
              className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors"
              placeholder="my-app"
            />
          </div>

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
                  className="accent-brand-600 dark:accent-brand-300"
                />
                <span className="text-sm text-brand-700 dark:text-brand-300">Git repository</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="source"
                  value="upload"
                  checked={source === "upload"}
                  onChange={() => setSource("upload")}
                  className="accent-brand-600 dark:accent-brand-300"
                />
                <span className="text-sm text-brand-700 dark:text-brand-300">Upload</span>
              </label>
            </div>
          </div>

          {source === "git" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="repoUrl" className="text-sm font-medium text-brand-700 dark:text-brand-300">
                  Repository URL
                </label>
                <input
                  id="repoUrl"
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors"
                  placeholder="https://github.com/org/repo"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="branch" className="text-sm font-medium text-brand-700 dark:text-brand-300">
                  Branch
                </label>
                <input
                  id="branch"
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors"
                  placeholder="main"
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2 border border-red-200 dark:border-red-800">
              {error}
            </p>
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
              onClick={() => navigate("/apps")}
              className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
