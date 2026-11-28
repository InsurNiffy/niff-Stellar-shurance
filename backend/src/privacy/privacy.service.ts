import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HolderProfile } from '../entities/holder-profile.entity';
import { SupportTicket } from '../entities/support-ticket.entity';
import { PrivacyRequest, PrivacyRequestStatus } from '../entities/privacy-request.entity';

export const ANONYMIZED_EMAIL = 'anonymized@redacted.invalid';
export const ANONYMIZED_DISPLAY_NAME = 'Anonymized User';
export const ANONYMIZED_TICKET_SUBJECT = '[redacted]';
export const ANONYMIZED_TICKET_BODY = '[redacted]';

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    @InjectRepository(HolderProfile)
    private readonly holderProfileRepo: Repository<HolderProfile>,
    @InjectRepository(SupportTicket)
    private readonly supportTicketRepo: Repository<SupportTicket>,
    @InjectRepository(PrivacyRequest)
    private readonly privacyRequestRepo: Repository<PrivacyRequest>,
  ) {}

  /**
   * Staff-initiated GDPR/CCPA anonymisation of off-chain PII for a wallet.
   * On-chain data, RawEvent rows, and IPFS CIDs are immutable and are NOT erased
   * (see docs/ops/privacy-runbook.md).
   */
  async anonymize(walletAddress: string): Promise<PrivacyRequest> {
    const request = this.privacyRequestRepo.create({
      walletAddress,
      status: PrivacyRequestStatus.PENDING,
      rowsAffected: 0,
    });
    await this.privacyRequestRepo.save(request);

    try {
      let rowsAffected = 0;

      const profileResult = await this.holderProfileRepo.update(
        { walletAddress },
        {
          email: ANONYMIZED_EMAIL,
          displayName: ANONYMIZED_DISPLAY_NAME,
        },
      );
      rowsAffected += profileResult.affected ?? 0;

      const ticketResult = await this.supportTicketRepo.update(
        { walletAddress },
        {
          subject: ANONYMIZED_TICKET_SUBJECT,
          body: ANONYMIZED_TICKET_BODY,
        },
      );
      rowsAffected += ticketResult.affected ?? 0;

      request.status = PrivacyRequestStatus.COMPLETED;
      request.rowsAffected = rowsAffected;
      request.completedAt = new Date();
      await this.privacyRequestRepo.save(request);

      this.logger.log(
        `Privacy anonymisation completed for ${walletAddress}: ${rowsAffected} rows affected`,
      );
      return request;
    } catch (err) {
      request.status = PrivacyRequestStatus.FAILED;
      request.completedAt = new Date();
      await this.privacyRequestRepo.save(request);
      this.logger.error(
        `Privacy anonymisation failed for ${walletAddress}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }

  async findRequest(id: string): Promise<PrivacyRequest> {
    const request = await this.privacyRequestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Privacy request ${id} not found`);
    }
    return request;
  }
}
