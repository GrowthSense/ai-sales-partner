import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;   // true for port 465
  user: string;
  password: string;
  fromName?: string;
  fromEmail?: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  fromName?: string;
  fromEmail?: string;
}

/**
 * SmtpClient — Nodemailer SMTP adapter.
 *
 * A new transporter is created per send call with the provided config.
 * This avoids caching transporter instances per tenant (simplicity over
 * connection pooling — acceptable for low-to-medium email volumes).
 *
 * For high-volume use, replace with SendGrid/SES SDK per tenant.
 */
@Injectable()
export class SmtpClient {
  private readonly logger = new Logger(SmtpClient.name);

  async send(input: SendEmailInput, config: SmtpConfig): Promise<string> {
    const transporter = this.createTransporter(config);

    const from = input.fromName || config.fromName
      ? `"${input.fromName ?? config.fromName}" <${input.fromEmail ?? config.fromEmail ?? config.user}>`
      : input.fromEmail ?? config.fromEmail ?? config.user;

    const mailOptions: SendMailOptions = {
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    };

    const info = await transporter.sendMail(mailOptions);
    this.logger.debug(`Email sent: messageId=${info.messageId} to=${input.to}`);
    return String(info.messageId);
  }

  async verify(config: SmtpConfig): Promise<boolean> {
    const transporter = this.createTransporter(config);
    try {
      await transporter.verify();
      return true;
    } catch (err) {
      this.logger.warn(`SMTP verify failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  private createTransporter(config: SmtpConfig): Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  }
}
