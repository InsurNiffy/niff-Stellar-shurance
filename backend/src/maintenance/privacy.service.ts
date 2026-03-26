import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../admin/audit.service';

export type PrivacyRequestType = 'ANONYMIZE' | 'DELETE';

const ANON = {
  email: '[redacted]',
  fullName: '[redacted]',
  phone: '[redacted]',
} as const;

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Open a privacy request ticket and immediately execute the procedure.
   * Returns the created PrivacyRequest record.
   *
   * IMMUTABILITY NOTE: on-chain policy/claim records and IPFS-pinned documents
   * cannot be erased. This procedure only affects mutable off-chain DB rows.
   * Do NOT promise on-chain erasure to users.
   */
  async handleRequest(opts: {
    subjectWalletAddress: string;
    requestType: PrivacyRequestType;
    requestedBy: string; // staff actor
    ipAddress?: string;
    notes?: string;
  }): Promise<{ requestId: string; rowsAffected: number }> {
    const request = await this.prisma.privacyRequest.create({
      data: {
        subjectWalletAddress: opts.subjectWalletAddress,
        requestType: opts.requestType,
        requestedBy: opts.requestedBy,
        notes: opts.notes,
        status: 'IN_PROGRESS',
      },
    });

    let rowsAffected = 0;
    let status: 'COMPLETED' | 'FAILED' = 'COMPLETED';
    let errorMessage: string | undefined;

    try {
      rowsAffected =
        opts.requestType === 'ANONYMIZE'
          ? await this.anonymize(opts.subjectWalletAddress)
          : await this.delete(opts.subjectWalletAddress);
    } catch (err) {
      status = 'FAILED';
      errorMessage = (err as Error).message;
      this.logger.error(`Privacy ${opts.requestType} failed for ${opts.subjectWalletAddress}: ${errorMessage}`);
    }

    await this.prisma.privacyRequest.update({
      where: { id: request.id },
      data: { status, rowsAffected, errorMessage, completedAt: new Date() },
    });

    await this.audit.write({
      actor: opts.requestedBy,
      action: `privacy_${opts.requestType.toLowerCase()}`,
      payload: {
        requestId: request.id,
        subjectWalletAddress: opts.subjectWalletAddress,
        rowsAffected,
        status,
        ...(errorMessage ? { errorMessage } : {}),
      },
      ipAddress: opts.ipAddress,
    });

    if (status === 'FAILED') throw new Error(`Privacy request failed: ${errorMessage}`);
    return { requestId: request.id, rowsAffected };
  }

  /** Replace PII fields with redacted placeholders. Wallet address is retained for audit continuity. */
  private async anonymize(walletAddress: string): Promise<number> {
    // Prisma doesn't expose a User model in this schema (TypeORM entity exists separately).
    // We target the mutable indexed tables that may hold PII.
    const results = await this.prisma.$transaction([
      // Nullify description and imageUrls on claims filed by this address
      this.prisma.claim.updateMany({
        where: { creatorAddress: walletAddress },
        data: { description: '[redacted]', imageUrls: [] },
      }),
    ]);
    return results.reduce((sum, r) => sum + r.count, 0);
  }

  /**
   * Hard-delete mutable off-chain rows for the subject.
   * Votes and raw events are retained for audit integrity.
   * On-chain data is immutable and cannot be deleted.
   */
  private async delete(walletAddress: string): Promise<number> {
    const results = await this.prisma.$transaction([
      this.prisma.claim.deleteMany({
        where: { creatorAddress: walletAddress, isFinalized: false },
      }),
    ]);
    return results.reduce((sum, r) => sum + r.count, 0);
  }

  async getRequest(requestId: string) {
    const req = await this.prisma.privacyRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException(`Privacy request ${requestId} not found`);
    return req;
  }

  async listRequests(page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.privacyRequest.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.privacyRequest.count(),
    ]);
    return { items, total, page, limit };
  }
}
