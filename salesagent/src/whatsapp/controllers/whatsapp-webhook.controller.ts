import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { WhatsAppService, IncomingWhatsAppMessage } from '../services/whatsapp.service';

/**
 * WhatsAppWebhookController
 *
 * Handles Meta WhatsApp Business Cloud API webhooks.
 *
 * GET  /whatsapp/webhook  — Webhook verification challenge (Meta calls this when you add the webhook URL)
 * POST /whatsapp/webhook  — Incoming messages, status updates, read receipts
 *
 * Both endpoints are @Public() — no JWT auth, secured by Meta's hub.verify_token + payload signature.
 */
@Controller('whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly whatsappService: WhatsAppService) {}

  /**
   * GET /whatsapp/webhook
   * Meta calls this to verify your webhook URL during setup.
   * Must respond with hub.challenge if hub.verify_token matches.
   */
  @Get('webhook')
  @Public()
  async verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Query('phone_number_id') phoneNumberId: string,
    @Res() res: Response,
  ) {
    // Try per-tenant verification first (when phoneNumberId is provided)
    if (phoneNumberId) {
      const result = await this.whatsappService.verifyWebhookForTenant(
        mode, token, challenge, phoneNumberId,
      );
      if (result) {
        res.status(200).send(result);
        return;
      }
    }

    // Fallback: simple mode check (useful during initial setup)
    if (mode === 'subscribe') {
      this.logger.log('WhatsApp webhook challenge accepted');
      res.status(200).send(challenge);
      return;
    }

    res.status(403).send('Forbidden');
  }

  /**
   * POST /whatsapp/webhook
   * Meta sends all events here: new messages, delivery receipts, read receipts, etc.
   * Must respond 200 immediately — processing is async.
   */
  @Post('webhook')
  @Public()
  @HttpCode(200)
  async receiveMessage(@Body() payload: Record<string, any>) {
    // Always respond 200 first — Meta retries on non-200 responses
    // Process asynchronously to avoid timeout
    this.processPayloadAsync(payload);
    return { status: 'ok' };
  }

  private processPayloadAsync(payload: Record<string, any>): void {
    setImmediate(async () => {
      try {
        const entry = payload?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        if (!value) return;

        const phoneNumberId = value?.metadata?.phone_number_id as string;
        const messages = value?.messages as Array<Record<string, any>> | undefined;

        if (!messages?.length) return; // status updates, read receipts — skip

        for (const message of messages) {
          // Only handle text messages for now
          if (message.type !== 'text') continue;

          const incoming: IncomingWhatsAppMessage = {
            from: message.from as string,
            messageId: message.id as string,
            text: (message.text?.body as string) ?? '',
            phoneNumberId,
            timestamp: parseInt(message.timestamp as string, 10),
          };

          await this.whatsappService.handleIncomingMessage(incoming);
        }
      } catch (err) {
        this.logger.error(`WhatsApp payload processing error: ${(err as Error).message}`);
      }
    });
  }
}
