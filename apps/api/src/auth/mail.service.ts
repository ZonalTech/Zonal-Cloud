import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Minimal mailer. If SMTP_HOST is configured it sends real mail via Nodemailer
 * (point this at Mailpit/MailHog locally, or a real SMTP provider in prod). If
 * SMTP is not configured, it runs in "dev" mode: nothing is sent, the message is
 * logged, and callers fall back to returning the reset link in the API response.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASS');
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      });
      this.logger.log(`SMTP configured: ${host}:${port}`);
    } else {
      this.logger.warn('SMTP not configured — emails will be logged, not sent (dev mode).');
    }
  }

  /** True when real email delivery is configured. */
  get enabled(): boolean {
    return this.transporter !== null;
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM') ?? 'Zonal Cloud <no-reply@zonal.local>';
    const subject = 'Reset your Zonal Cloud password';
    const text = `You requested a password reset.\n\nOpen this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.`;

    if (!this.transporter) {
      this.logger.log(`[dev] Password reset for ${to}: ${resetUrl}`);
      return;
    }
    await this.transporter.sendMail({ from, to, subject, text });
    this.logger.log(`Password reset email sent to ${to}`);
  }
}
