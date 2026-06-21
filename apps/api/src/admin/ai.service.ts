import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin client for the Mistral Agents API, used to explain failed deployments.
 * Requires MISTRAL_API_KEY and MISTRAL_AGENT_ID. If either is missing the
 * service reports as not configured so callers can return a graceful message
 * instead of failing.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey?: string;
  private readonly agentId?: string;
  private readonly endpoint: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('MISTRAL_API_KEY') || undefined;
    this.agentId = this.config.get<string>('MISTRAL_AGENT_ID') || undefined;
    this.endpoint =
      this.config.get<string>('MISTRAL_API_URL') ||
      'https://api.mistral.ai/v1/agents/completions';
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.agentId);
  }

  /**
   * Send a build log to the Mistral agent and return a plain-English diagnosis.
   * The log is truncated to keep the request small and avoid leaking huge output.
   */
  async analyzeDeploymentLog(params: {
    appName: string;
    appType: string;
    log: string;
  }): Promise<string> {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message:
          'AI analysis is not configured. Set MISTRAL_API_KEY and MISTRAL_AGENT_ID in the API environment.',
      });
    }

    const log = this.truncate(params.log, 12000);
    const prompt =
      `A deployment failed on the Zonal Cloud platform.\n` +
      `App: ${params.appName} (type: ${params.appType}).\n` +
      `Below is the build/deploy log. Explain in plain English why it failed and give a concrete, ` +
      `actionable fix. Be concise.\n\n--- BUILD LOG ---\n${log}`;

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          agent_id: this.agentId,
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
