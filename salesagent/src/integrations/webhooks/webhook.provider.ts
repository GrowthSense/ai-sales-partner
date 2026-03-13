import { Injectable, Logger } from '@nestjs/common';
import { IntegrationConfigService } from '../services/integration-config.service';
import { IntegrationType } from '../../common/enums';

export interface WebhookPayload {
  event: string;
  tenantId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 10 * 1024;

/**
 * WebhookProvider
 *
 * Delivers event payloads to tenant-configured webhook endpoints.
 * Used for: lead.captured, lead.qualified, stage.changed, handoff.triggered.
 *
 * Security:
 *  - POST to tenant-configured URL (server-side only)
 *  - Optional HMAC-SHA256 signature in X-SalesAgent-Signature header
 *  - 10s timeout, 10KB response cap
 *  - No retry here — callers should use BullMQ for reliable delivery
 */
@Injectable()
export class WebhookProvider {
  private readonly logger = new Logger(WebhookProvider.name);

  constructor(private readonly configService: IntegrationConfigService) {}

  async deliver(tenantId: string, payload: WebhookPayload): Promise<boolean> {
    const hasWebhook = await this.configService.isConnected(tenantId, IntegrationType.WEBHOOK);
    if (!hasWebhook) return false;

    const { record, credentials } = await this.configService.getConfigAndCredentials(
      tenantId,
      IntegrationType.WEBHOOK,
    );

    const webhookUrl = record.config['url'] as string | undefined;
    if (!webhookUrl) return false;

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-SalesAgent-Event': payload.event,
    };

    // Optional HMAC signature
    if (credentials.signingSecret) {
      const sig = await this.hmacSignature(body, credentials.signingSecret);
      headers['X-SalesAgent-Signature'] = `sha256=${sig}`;
    }

    // Include any custom headers from config (non-secret, stored in config not credentials)
    const customHeaders = record.config['headers'] as Record<string, string> | undefined;
    if (customHeaders) {
      Object.assign(headers, customHeaders);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(
          `Webhook delivery failed: tenantId=${tenantId} event=${payload.event} status=${response.status}`,
        );
        return false;
      }

      this.logger.debug(
        `Webhook delivered: tenantId=${tenantId} event=${payload.event} status=${response.status}`,
      );
      return true;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const message = err instanceof Error && err.name === 'AbortError'
        ? `Webhook timed out after ${WEBHOOK_TIMEOUT_MS}ms`
        : err instanceof Error ? err.message : String(err);
      this.logger.warn(`Webhook delivery error: ${message}`);
      return false;
    }
  }

  private async hmacSignature(body: string, secret: string): Promise<string> {
    const { createHmac } = await import('crypto');
    return createHmac('sha256', secret).update(body).digest('hex');
  }
}
