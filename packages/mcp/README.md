# Zonal Cloud MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Claude,
Mistral, etc.) inspect and act on apps deployed to Zonal Cloud. It calls the
Zonal API using credentials you configure on the admin **Settings** page.

## Tools

Read-only:
- `list_apps` — all apps across the platform (name, subdomain, type, status)
- `get_app` — one app + its recent deployments (by app id)
- `list_deployments` — recent deployments for an app
- `get_metrics` — platform counts (users, orgs, apps, deployments, queue depth)

Actions (mutating):
- `deploy_app` — trigger a new deployment (optional git ref)
- `stop_app` — stop a running app (admin scope, cross-tenant)

## Configuration

The server reads two environment variables (set them from the values on the
admin Settings page):

| Variable | Meaning |
| --- | --- |
| `ZONAL_API_URL` | Base URL of the Zonal API, e.g. `http://localhost:4000` |
| `ZONAL_AGENT_TOKEN` | A superadmin/admin JWT used as the Bearer token |

Two ways to get `ZONAL_AGENT_TOKEN`:

- **Recommended — a permanent agent token.** On the admin Settings page, under *Agent
  tokens*, click **Generate token** (a `ztk_...` value, shown once) or **Download MCP config**
  to get a ready-to-use `.mcp.json` with the token already embedded. These tokens do not
  expire and can be revoked from the same page.
- A superadmin login JWT (`POST /v1/auth/login`) also works, but it expires (~7 days).

## Build & run

```bash
cd packages/mcp
npm install
npm run build
ZONAL_API_URL=http://localhost:4000 ZONAL_AGENT_TOKEN=<jwt> node dist/index.js
```

## Connect from an MCP client

Add to your client's MCP config (example for a Claude-style client):

```json
{
  "mcpServers": {
    "zonal-cloud": {
      "command": "node",
      "args": ["/absolute/path/to/zonal-cloud/packages/mcp/dist/index.js"],
      "env": {
        "ZONAL_API_URL": "http://localhost:4000",
        "ZONAL_AGENT_TOKEN": "<jwt>"
      }
    }
  }
}
```

The agent can then ask things like "list all failed apps" or "redeploy app X",
and the tools call the Zonal API on its behalf.

## Notes

- Action tools change platform state — only give the token to a trusted agent.
- The token is a JWT and expires (default 7 days); regenerate by logging in again.
- Inventory uses admin endpoints (cross-tenant). `get_app`/`deploy_app`/logs use
  the app endpoints scoped to the token's org.
