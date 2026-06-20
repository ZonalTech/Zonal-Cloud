# CI - Zonal Cloud Deploy Workflow

This directory contains everything needed to test the GitHub Actions deploy workflow
locally using nektos/act and to run the workflow on real GitHub Actions once a VPS
is live.

---

## 1. How the workflow works

The workflow lives at `.github/workflows/deploy.yml` and does:

1. Checks out the repository.
2. (Optional) Runs build and tests — uncomment the Node setup steps in the workflow.
3. Resolves the app ID from the `ZONAL_APP_ID` repo variable or workflow input.
4. Calls `POST /v1/apps/:id/deploy` with `Authorization: Bearer <deploy_token>` and
   a JSON body containing the git SHA and ref.
5. Fails the job if the API returns a non-2xx status.
6. Prints the deployment ID and initial status.

---

## 2. Prerequisites for local testing with act

### 2a. Install act

```bash
# Option A: install script (Linux/macOS)
curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Option B: via GitHub releases (pick the latest)
# https://github.com/nektos/act/releases

# Option C: via Homebrew (macOS/Linux)
brew install act

# Verify
act --version
```

### 2b. Install Docker

act requires Docker. Confirm it is running:

```bash
docker info
```

---

## 3. Create a deploy token in the Zonal dashboard

A deploy token is a long-lived credential tied to a specific app. It is returned only
once in plaintext at creation time.

1. Log in to the Zonal dashboard at `http://localhost:5173`.
2. Open the app you want to deploy.
3. Go to Settings -> Deploy Tokens -> Create token.
   Or use the API directly:

   ```bash
   curl -X POST http://localhost:4000/v1/apps/<APP_ID>/tokens \
     -H "Authorization: Bearer <your_jwt>" \
     -H "Content-Type: application/json" \
     -d '{"name": "github-actions-local"}'
   ```

4. Copy the `token` value from the response — it is shown only once.
5. Note the `APP_ID` (the `id` field of the app).

---

## 4. Store secrets and variables for local act runs

act reads secrets from a `.secrets` file (one `KEY=VALUE` per line).
This file must never be committed.

```bash
# In the repo root, copy the example:
cp ci/.secrets.example .secrets

# Edit .secrets with your values:
ZONAL_TOKEN=<paste_the_deploy_token_here>
ZONAL_APP_ID=<your_app_id>
ZONAL_API_BASE=http://host.docker.internal:4000
```

The `.secrets` file is already listed in `.gitignore` (see below).
Make sure the repo root `.gitignore` (or `ci/.gitignore`) contains:

```
.secrets
```

---

## 5. Run the workflow locally with act

From the repository root:

```bash
act push \
  --secret-file .secrets \
  --var ZONAL_APP_ID=$(grep ZONAL_APP_ID .secrets | cut -d= -f2) \
  --var ZONAL_API_BASE=$(grep ZONAL_API_BASE .secrets | cut -d= -f2) \
  --actrc ci/.actrc
```

act will pull the runner image on first run, then execute the workflow steps inside
Docker, calling your local Zonal API.

---

## 6. host.docker.internal vs --network host

This is the key networking consideration when act runs on the same host as the
Zonal API.

### Option A: host.docker.internal (recommended default)

Set `ZONAL_API_BASE=http://host.docker.internal:4000` in `.secrets`.

`host.docker.internal` resolves to the Docker host from inside a container.
It works automatically on Docker Desktop (macOS/Windows) and on Linux with Docker
Engine >= 20.10 when you pass `--add-host=host.docker.internal:host-gateway`.

act passes this flag automatically when using the `--container-options` flag, or you
can force it:

```bash
act push \
  --secret-file .secrets \
  --var ZONAL_APP_ID=<id> \
  --var ZONAL_API_BASE=http://host.docker.internal:4000 \
  --container-options "--add-host=host.docker.internal:host-gateway" \
  --actrc ci/.actrc
```

The `.actrc` in this directory already includes `--container-options` for Linux.

### Option B: host networking (alternative)

If `host.docker.internal` does not resolve in your environment, use host networking:

```bash
act push \
  --secret-file .secrets \
  --var ZONAL_APP_ID=<id> \
  --var ZONAL_API_BASE=http://localhost:4000 \
  --network host \
  --actrc ci/.actrc
```

With `--network host`, the container shares the host's network namespace and
`localhost:4000` resolves to the host process directly. This is simpler but means
the container has no network isolation, which is acceptable for local dev testing.

Summary:

| Mode                        | ZONAL_API_BASE                          | Extra flag                                        |
|-----------------------------|------------------------------------------|---------------------------------------------------|
| host.docker.internal        | http://host.docker.internal:4000         | --container-options "--add-host=..."  (in .actrc) |
| host networking             | http://localhost:4000                    | --network host                                    |

The workflow file itself does not change between these two modes. Only the value of
`ZONAL_API_BASE` (and optionally `--network host`) differ.

---

## 7. Quick manual check without act

Use `ci/test-deploy.sh` to fire a single deploy call directly with curl:

```bash
export APP_ID=<your_app_id>
export API_BASE=http://localhost:4000
export ZONAL_TOKEN=<your_deploy_token>

bash ci/test-deploy.sh
```

---

## 8. Running on real GitHub Actions (VPS live)

The same `deploy.yml` works unchanged on GitHub Actions. The only things that change
are where the secret and variables are stored and the value of `ZONAL_API_BASE`.

1. In your GitHub repository, go to Settings -> Secrets and variables -> Actions.
2. Add a secret named `ZONAL_TOKEN` with the deploy token value.
3. Add repository variables:
   - `ZONAL_APP_ID` = your app ID
   - `ZONAL_API_BASE` = `https://api.yourdomain.com`
     (the public URL of your Zonal API on the VPS; must be reachable from GitHub's
     runner IPs — no localhost, no host.docker.internal)
4. Push to `main`. The workflow triggers automatically.

No edits to `deploy.yml` are needed. The `host.docker.internal` fallback in the
workflow is only used when `ZONAL_API_BASE` is not set, which does not happen in
production because the variable is always set.

---

## 9. Files in this directory

| File                 | Purpose                                                  |
|----------------------|----------------------------------------------------------|
| README.md            | This file — full setup and usage guide                   |
| .actrc               | Default flags for act (runner image, platform, options)  |
| .secrets.example     | Template for the local .secrets file (safe to commit)    |
| test-deploy.sh       | Curl-based manual deploy check                           |
| NOTES.md             | Judgment calls and decisions not covered by the spec     |
