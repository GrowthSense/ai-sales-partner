import { Injectable, Logger } from '@nestjs/common';
import { IntegrationConfigService } from './integration-config.service';
import { SmtpClient, SendEmailInput } from '../email/smtp/smtp.client';
import { IntegrationType } from '../../common/enums';

/**
 * EmailIntegrationService — facade over the SMTP adapter.
 *
 * Resolves SMTP credentials from tenant integration config and delegates
 * to SmtpClient. Called by SendFollowUp skill and workflow email steps.
 *
 * Skills call via SkillContext.services.invokeIntegration('email', 'send', args).
 */
@Injectable()
export class EmailIntegrationService {
  private readonly logger = new Logger(EmailIntegrationService.name);

  constructor(
    private readonly configService: IntegrationConfigService,
    private readonly smtp: SmtpClient,
  ) {}

  async send(tenantId: string, input: SendEmailInput): Promise<string> {
    const hasSmtp = await this.configService.isConnected(tenantId, IntegrationType.EMAIL_SMTP);

    if (!hasSmtp) {
      this.logger.warn(`No email integration connected for tenant ${tenantId} — email not sent`);
      return 'mock-message-id';
    }

    const { record, credentials } = await this.configService.getConfigAndCredentials(
      tenantId,
      IntegrationType.EMAIL_SMTP,
    );

    const messageId = await this.smtp.send(input, {
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      user: credentials.user,
      password: credentials.password,
      fromName: record.config['fromName'] as string | undefined,
      fromEmail: record.config['fromEmail'] as string | undefined,
    });

    await this.configService.touchLastUsed(tenantId, IntegrationType.EMAIL_SMTP);
    this.logger.debug(`Email sent: tenantId=${tenantId} to=${input.to} messageId=${messageId}`);
    return messageId;
  }
}
