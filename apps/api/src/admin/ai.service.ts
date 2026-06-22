import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../common/encrypt.util';

// Settings keys (shared with admin.service). The MCP/Agent tab in the admin UI
// writes the Base URL + token here; AI analysis reuses them as its Mistral
// credentials, so it's configured from the UI — no API restart / env editing.
const SETTING_AGENT_API_URL = 'agent_api_url';
const SETTING_AGENT_TOKEN = 'agent_token';
const SETTING_AGENT_ID = 'agent_id';

interface AiConfig {
  apiKey?: string;
  agentId?: string;
  endpoint: string;
}

/**
 * Thin client for the Mistral Agents API, used to explain failed deployments.
 *
 * Credentials resolve DB-first, env fallback (the PlatformSettings pattern):
 *   - API key   : Setting `agent_token` (encrypted)   → env MISTRAL_API_KEY
 *   - Agent id  : Setting `agent_id`                   → env MISTRAL_AGENT_ID
 *   - Endpoint  : Setting `agent_api_url` (+/agents/completions) → env MISTRAL_API_URL
 * So configuring the admin Settings → MCP/Agent tab is enough; if nothing is
 * set the service reports "not configured" and callers degrade gracefully.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Read a setting from the DB (decrypting if needed), or null. */
  private async setting(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (!row || !row.value) return null;
    return row.encrypted ? decrypt(row.value) : row.value;
  }

  /** Resolve the active AI config: DB settings first, then env vars. */
  private async resolveConfig(): Promise<AiConfig> {
    const apiKey =
      (await this.setting(SETTING_AGENT_TOKEN)) ||
      this.config.get<string>('MISTRAL_API_KEY') ||
      undefined;
    const agentId =
      (await this.setting(SETTING_AGENT_ID)) ||
      this.config.get<string>('MISTRAL_AGENT_ID') ||
      undefined;

    // Base URL from the MCP/Agent tab (e.g. https://api.mistral.ai/v1) → the
    // agents-completions endpoint. Fall back to a full endpoint env or default.
    const base = (await this.setting(SETTING_AGENT_API_URL)) || '';
    const endpoint = base
      ? `${base.replace(/\/+$/, '')}/agents/completions`
      : this.config.get<string>('MISTRAL_API_URL') ||
        'https://api.mistral.ai/v1/agents/completions';

    return { apiKey, agentId, endpoint };
  }

  /** True when both an API key and an agent id are available (DB or env). */
  async isConfigured(): Promise<boolean> {
    const cfg = await this.resolveConfig();
    return Boolean(cfg.apiKey && cfg.agentId);
  }

  /**
   * Send a build log to the Mistral agent and return a plain-English diagnosis.
   * The log is truncated to keep the request small and avoid leaking huge output.
   */
  async analyzeDeploymentLog(params: {
    appName: string;
    appType: string;
    log: string;
    /** The headline failure reason shown in the UI (often present when the log is empty). */
    errorReason?: string;
  }): Promise<string> {
    const cfg = await this.resolveConfig();
    if (!cfg.apiKey || !cfg.agentId) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message:
          'AI analysis is not configured. Set the Base URL + Agent token (and an Agent ID) ' +
          'in Admin → Settings → MCP/Agent, or set MISTRAL_API_KEY and MISTRAL_AGENT_ID in the API environment.',
      });
    }

    const log = this.truncate(params.log, 12000);
    const reasonBlock = params.errorReason
      ? `\n--- ERROR ---\n${this.truncate(params.errorReason, 2000)}\n`
      : '';
    const prompt =
      `A deployment failed on the Zonal Cloud platform.\n` +
      `App: ${params.appName} (type: ${params.appType}).\n` +
      `Below is the failure reason and the build/deploy log. Explain in plain English why it ` +
      `failed and give a concrete, actionable fix. Be concise. If the log is empty, diagnose ` +
      `from the error reason.\n${reasonBlock}\n--- BUILD LOG ---\n${log}`;

    let res: Response;
    try {
      res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          agent_id: cfg.agentId,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err) {
      this.logger.error(`Mistral request failed: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException({
        code: 'AI_UNREACHABLE',
        message: 'Could not reach the AI service.',
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(`Mistral API ${res.status}: ${detail.slice(0, 300)}`);
      throw new ServiceUnavailableException({
        code: 'AI_ERROR',
        message: `AI service returned ${res.status}.`,
      });
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || 'The AI returned no analysis.';
  }

  private truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    // Keep the tail — the actual error is usually at the end of a build log.
    return `...[truncated ${text.length - max} chars]...\n` + text.slice(text.length - max);
  }
}
