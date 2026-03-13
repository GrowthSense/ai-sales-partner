export interface IEmailAdapter {
  send(message: EmailMessage, config: EmailConfig): Promise<void>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}
