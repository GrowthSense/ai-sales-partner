import { Injectable, Logger } from '@nestjs/common';

const GRAPH_API = 'https://graph.facebook.com/v19.0';

/**
 * WhatsAppClientService — sends messages via WhatsApp Business Cloud API (Meta).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 */
@Injectable()
export class WhatsAppClientService {
  private readonly logger = new Logger(WhatsAppClientService.name);

  /**
   * Send a plain-text message to a WhatsApp number.
   */
  async sendText(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    text: string,
  ): Promise<void> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    };

    const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.error(`WhatsApp send failed ${res.status}: ${err.slice(0, 300)}`);
      throw new Error(`WhatsApp API error ${res.status}`);
    }

    this.logger.debug(`WhatsApp message sent to ${to}`);
  }

  /**
   * Mark a message as read (improves UX — shows double blue tick to visitor).
   */
  async markRead(phoneNumberId: string, accessToken: string, messageId: string): Promise<void> {
    await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    }).catch(() => {}); // Non-critical — don't throw
  }
}
