import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';

export enum WebhookStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export interface RegisteredWebhook {
  id: string;
  url: string;
  eventType: string;
  status: WebhookStatus;
  createdAt: Date;
  verifiedAt?: Date;
  secret: string;
  failedAttempts: number;
}

export interface VerificationChallenge {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class WebhookRegistrationService {
  private readonly logger = new Logger(WebhookRegistrationService.name);
  private readonly webhooks = new Map<string, RegisteredWebhook>();
  private readonly challenges = new Map<string, VerificationChallenge>();
  private readonly challengeTimeoutMs: number;
  private readonly maxVerificationAttempts: number;

  constructor(private readonly config: ConfigService) {
    this.challengeTimeoutMs = this.config.get<number>(
      'WEBHOOK_VERIFICATION_TIMEOUT_MS',
      300_000,
    );
    this.maxVerificationAttempts = this.config.get<number>(
      'WEBHOOK_MAX_VERIFICATION_ATTEMPTS',
      3,
    );
  }

  /**
   * Register a new outbound webhook URL
   * Returns a pending webhook that requires verification
   */
  async registerWebhook(
    url: string,
    eventType: string,
  ): Promise<{ webhook: RegisteredWebhook; verificationUrl: string }> {
    this.validateWebhookUrl(url);

    const existingWebhook = Array.from(this.webhooks.values()).find(
      (w) => w.url === url && w.eventType === eventType,
    );

    if (existingWebhook && existingWebhook.status === WebhookStatus.ACTIVE) {
      throw new ConflictException('Webhook URL is already registered and active for this event type');
    }

    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('hex');
    const challenge = this.generateChallenge();

    const webhook: RegisteredWebhook = {
      id,
      url,
      eventType,
      status: WebhookStatus.PENDING,
      createdAt: new Date(),
      secret,
      failedAttempts: 0,
    };

    this.webhooks.set(id, webhook);
    this.challenges.set(id, challenge);

    // Clean up expired challenges periodically
    setTimeout(() => {
      if (this.challenges.has(id)) {
        this.challenges.delete(id);
        this.logger.debug(`Expired verification challenge for webhook ${id}`);
      }
    }, this.challengeTimeoutMs);

    const verificationUrl = `${this.config.get<string>('API_BASE_URL', 'http://localhost:3000')}/webhooks/verify/${id}`;

    this.logger.log(
      `Registered pending webhook ${id} for ${eventType} at ${url}. Verification required.`,
    );

    return { webhook, verificationUrl };
  }

  /**
   * Send verification challenge to the webhook URL
   */
  async sendVerificationChallenge(webhookId: string): Promise<void> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new BadRequestException(`Webhook ${webhookId} not found`);
    }

    const challenge = this.challenges.get(webhookId);
    if (!challenge) {
      throw new BadRequestException(`Verification challenge has expired for webhook ${webhookId}`);
    }

    try {
      const { default: axios } = await import('axios');
      await axios.post(
        webhook.url,
        {
          type: 'webhook.verification',
          challenge: challenge.token,
          webhookId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': this.createSignature(challenge.token, webhook.secret),
          },
          timeout: 10_000,
        },
      );

      this.logger.log(`Sent verification challenge to ${webhook.url}`);
    } catch (error: unknown) {
      webhook.failedAttempts += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send verification challenge to ${webhook.url}: ${message}. Attempts: ${webhook.failedAttempts}/${this.maxVerificationAttempts}`,
      );

      if (webhook.failedAttempts >= this.maxVerificationAttempts) {
        webhook.status = WebhookStatus.INACTIVE;
        this.logger.error(`Webhook ${webhookId} marked inactive after ${webhook.failedAttempts} failed verification attempts`);
      }

      throw error;
    }
  }

  /**
   * Verify webhook by validating echoed challenge response
   */
  async verifyWebhook(webhookId: string, response: string): Promise<RegisteredWebhook> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new BadRequestException(`Webhook ${webhookId} not found`);
    }

    if (webhook.status === WebhookStatus.ACTIVE) {
      this.logger.warn(`Webhook ${webhookId} is already verified`);
      return webhook;
    }

    const challenge = this.challenges.get(webhookId);
    if (!challenge) {
      throw new BadRequestException(`Verification challenge has expired`);
    }

    if (response !== challenge.token) {
      throw new BadRequestException('Invalid verification response');
    }

    webhook.status = WebhookStatus.ACTIVE;
    webhook.verifiedAt = new Date();
    this.challenges.delete(webhookId);

    this.logger.log(`Webhook ${webhookId} successfully verified and activated`);

    return webhook;
  }

  /**
   * Get a registered webhook
   */
  getWebhook(webhookId: string): RegisteredWebhook | undefined {
    return this.webhooks.get(webhookId);
  }

  /**
   * List all webhooks for an event type
   */
  listWebhooks(eventType: string, statusFilter?: WebhookStatus): RegisteredWebhook[] {
    return Array.from(this.webhooks.values())
      .filter((w) => w.eventType === eventType && (!statusFilter || w.status === statusFilter));
  }

  /**
   * Deactivate a webhook
   */
  deactivateWebhook(webhookId: string): RegisteredWebhook {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new BadRequestException(`Webhook ${webhookId} not found`);
    }

    webhook.status = WebhookStatus.INACTIVE;
    this.logger.log(`Webhook ${webhookId} deactivated`);
    return webhook;
  }

  /**
   * Delete a webhook
   */
  deleteWebhook(webhookId: string): void {
    this.webhooks.delete(webhookId);
    this.challenges.delete(webhookId);
    this.logger.log(`Webhook ${webhookId} deleted`);
  }

  private validateWebhookUrl(url: string): void {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http and https protocols are supported');
      }
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        throw new Error('Localhost URLs are not allowed');
      }
    } catch (error) {
      throw new BadRequestException(`Invalid webhook URL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private generateChallenge(): VerificationChallenge {
    return {
      token: crypto.randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + this.challengeTimeoutMs),
    };
  }

  private createSignature(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }
}
