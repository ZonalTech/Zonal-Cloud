/**
 * Zonal Cloud MCP server (stdio).
 *
 * Exposes tools that let an AI agent inspect and act on deployed apps. It calls
 * the Zonal API using credentials configured by the operator on the admin
 * Settings page and passed here as environment variables:
 *
 *   ZONAL_API_URL    base URL of the Zonal API (e.g. http://localhost:4000)
 *   ZONAL_AGENT_TOKEN  a superadmin/admin JWT used as the Bearer token
 *
 * Run:  ZONAL_API_URL=... ZONAL_AGENT_TOKEN=... node dist/index.js
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = (process.env.ZONAL_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const TOKEN = process.env.ZONAL_AGENT_TOKEN ?? '';

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zonal API ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

function result(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: 'zonal-cloud', version: '0.1.0' });

// ---- Read-only inventory tools ----

server.tool(
  'list_apps',
  'List all deployed apps across the platform (name, subdomain, type, status).',
  {},
  async () => result(await api('/v1/admin/apps')),
);

server.tool(
  'get_app',
  'Get one app and its recent deployments by app id.',
  { appId: z.string().describe('The app id') },
  async ({ appId }) => result(await api(`/v1/apps/${appId}`)),
);

server.tool(
  'list_deployments',
  'List recent deployments for an app (alias of get_app, returns the deployments array).',
  { appId: z.string().describe('The app id') },
  async ({ appId }) => {
    const data = (await api(`/v1/apps/${appId}`)) as { deployments?: unknown };
    return result(data.deployments ?? []);
  },
);

server.tool(
  'get_metrics',
  'Get platform-wide metrics (counts of users, orgs, apps, deployments, queue depth).',
  {},
  async () => result(await api('/v1/admin/metrics')),
);

// ---- Action tools (mutating) ----

server.tool(
  'deploy_app',
  'Trigger a new deployment for an app. Optionally pass a git ref/branch.',
  {
    appId: z.string().describe('The app id'),
    ref: z.string().optional().describe('Optional git ref/branch to deploy'),
  },
  async ({ appId, ref }) =>
    result(
      await api(`/v1/admin/apps/${appId}/deploy`, {
        method: 'POST',
        body: JSON.stringify(ref ? { ref } : {}),
      }),
    ),
);

server.tool(
  'stop_app',
  'Stop a running app (admin scope — works across tenants).',
  { appId: z.string().describe('The app id') },
  async ({ appId }) =>
    result(await api(`/v1/admin/apps/${appId}/stop`, { method: 'POST' })),
);

async function main() {
  if (!TOKEN) {
    // Surface a clear hint on stderr; the server still starts so the client can
    // connect, but API calls will fail until a token is provided.
    process.stderr.write(
      'WARNING: ZONAL_AGENT_TOKEN is not set. Configure it on the admin Settings page and pass it to this server.\n',
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`Zonal MCP server connected (API: ${API_URL})\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
