import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CaptchaService } from './captcha.service';
import { CreateTicketDto } from './dto/create-ticket.dto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly captcha: CaptchaService,
  ) {}

  async submitTicket(dto: CreateTicketDto, remoteIp?: string) {
    const valid = await this.captcha.verify(dto.captchaToken, remoteIp);
    if (!valid) {
      throw new BadRequestException('CAPTCHA verification failed');
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        email: dto.email,
        subject: dto.subject,
        message: dto.message,
        ipHash: remoteIp ? this.hashIp(remoteIp) : null,
      },
    });

    this.logger.log(`Support ticket created: ${ticket.id}`);
    return { id: ticket.id, status: 'received' };
  }

  async trackFaqExpansion(faqId: string) {
    // Privacy-safe: only increment a counter, no user data stored
    await this.prisma.faqStat.upsert({
      where: { faqId },
      update: { expansions: { increment: 1 } },
      create: { faqId, expansions: 1 },
    });
  }

  /** One-way hash so we can detect duplicate IPs without storing raw IPs */
  private hashIp(ip: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(ip + process.env.IP_HASH_SALT ?? 'niff-salt').digest('hex');
  }
}
