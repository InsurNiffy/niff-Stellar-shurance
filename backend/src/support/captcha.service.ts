import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    const secret = this.config.get<string>('CAPTCHA_SECRET_KEY');

    // In development/test with no secret configured, skip verification
    if (!secret || secret === 'dev-skip') {
      this.logger.warn('CAPTCHA verification skipped (no secret configured)');
      return true;
    }

    const provider = this.config.get<string>('CAPTCHA_PROVIDER', 'turnstile');

    try {
      const url =
        provider === 'hcaptcha'
          ? 'https://hcaptcha.com/siteverify'
          : 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

      const body: Record<string, string> = { secret, response: token };
      if (remoteIp) body['remoteip'] = remoteIp;

      // Encode as application/x-www-form-urlencoded without relying on URLSearchParams
      const encoded = Object.entries(body)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

      const { data } = await axios.post(url, encoded, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      return data.success === true;
    } catch (err) {
      this.logger.error('CAPTCHA verification error', err);
      return false;
    }
  }
}
