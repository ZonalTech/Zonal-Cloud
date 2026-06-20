# CI Agent - Judgment Calls and Notes

Items not explicitly specified in SPEC.md that required a decision.

---

## 1. act secrets file location

SPEC.md says to use a `.secrets` file for act but does not specify its location.
Decision: place `.secrets` in the repository root (not `ci/`), because act's
`--secret-file` flag resolves the path relative to where act is invoked (the repo
root), and because the file contains credentials that should not be nested inside a
tracked subdirectory. The `.secrets.example` template lives in `ci/` and is safe to
commit.

---

## 2. .gitignore entry for .secrets

SPEC.md does not specify where the `.gitignore` entry for `.secrets` should live.
There was no existing root `.gitignore` at the time the CI agent ran. Decision: create
a root `.gitignore` with the single `.secrets` entry so the credential file is
protected from accidental commits. Other agents should append their own ignores to this
file rather than replacing it.

---

## 3. Runner image for act

act supports several runner images: `micro`, `medium` (`catthehacker/ubuntu:act-22.04`),
and `full` (`catthehacker/ubuntu:full-22.04`). The workflow uses `curl` and `python3`
(both present in the standard GitHub runner). The `full` image is chosen as the default
in `.actrc` because it most closely matches the real GitHub Actions environment and
includes both `curl` and `python3`. Developers on slow connections can swap to the
`act-22.04` (medium) image; both provide `curl` and `python3`.

---

## 4. JSON parsing in the workflow

The workflow uses `python3 -m json.tool` and inline `python3 -c` snippets to parse
the deploy API response. This avoids a dependency on `jq`, which is not installed in
all act runner images. `python3` is present in all standard Ubuntu GitHub Actions
runner images. If `jq` is available, the commands can be simplified.

---

## 5. host.docker.internal on Linux

On Linux with Docker Engine (not Docker Desktop), `host.docker.internal` is not
automatically defined inside containers. The `.actrc` includes
`--container-options=--add-host=host.docker.internal:host-gateway` to inject it.
This requires Docker Engine >= 20.10 which supports the `host-gateway` special value.
On older Docker versions, use `--network host` with `ZONAL_API_BASE=http://localhost:4000`.

---

## 6. No build/test steps by default

SPEC.md says the workflow should have an "optional build/test step". Since the backend
and frontend agents own their own build tooling and the CI agent does not know which
app type will be deployed at workflow trigger time, the build/test block is commented
out with clear instructions. Developers uncomment and adapt it for their specific app.

---

## 7. workflow_dispatch input

The workflow supports `workflow_dispatch` with an optional `app_id` input. This is not
required by the spec but allows developers to trigger a deploy manually from the
GitHub Actions UI (or via `act -e`) for a different app ID without changing repo
variables. This is a purely additive convenience.

---

## 8. Deploy body shape

SPEC.md defines `POST /v1/apps/:id/deploy { ref? } -> { deployment }`. The `ref` field
is documented as optional. Decision: send both `ref` (the git SHA) and `branch` (the
full git ref string e.g. `refs/heads/main`) in the body. The backend ignores unknown
fields, and providing both gives the backend more information to log. If the backend
enforces strict body validation, remove `branch` from the payload.
