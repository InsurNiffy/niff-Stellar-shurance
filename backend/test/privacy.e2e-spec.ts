import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HolderProfile } from '../src/entities/holder-profile.entity';
import { SupportTicket } from '../src/entities/support-ticket.entity';
import {
  PrivacyRequest,
  PrivacyRequestStatus,
} from '../src/entities/privacy-request.entity';
import { PrivacyService } from '../src/privacy/privacy.service';

describe('PrivacyService.anonymize (integration)', () => {
  let app: INestApplication;
  let service: PrivacyService;
  let profileRepo: Repository<HolderProfile>;
  let ticketRepo: Repository<SupportTicket>;
  let requestRepo: Repository<PrivacyRequest>;

  const wallet = '0xabc0000000000000000000000000000000000001';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [HolderProfile, SupportTicket, PrivacyRequest],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([HolderProfile, SupportTicket, PrivacyRequest]),
      ],
      providers: [PrivacyService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    service = moduleRef.get(PrivacyService);
    profileRepo = moduleRef.get(getRepositoryToken(HolderProfile));
    ticketRepo = moduleRef.get(getRepositoryToken(SupportTicket));
    requestRepo = moduleRef.get(getRepositoryToken(PrivacyRequest));
  });

  afterAll(async () => {
    await app.close();
  });

  it('replaces PII and records a COMPLETED PrivacyRequest', async () => {
    await profileRepo.save(
      profileRepo.create({
        walletAddress: wallet,
        email: 'real.user@example.com',
        displayName: 'Real User',
      }),
    );
    await ticketRepo.save(
      ticketRepo.create({
        walletAddress: wallet,
        subject: 'My real subject',
        body: 'My real body with PII',
      }),
    );

    const request = await service.anonymize(wallet);

    const profile = await profileRepo.findOneByOrFail({ walletAddress: wallet });
    expect(profile.email).not.toBe('real.user@example.com');
    expect(profile.displayName).not.toBe('Real User');

    const ticket = await ticketRepo.findOneByOrFail({ walletAddress: wallet });
    expect(ticket.subject).not.toBe('My real subject');
    expect(ticket.body).not.toBe('My real body with PII');

    const stored = await requestRepo.findOneByOrFail({ id: request.id });
    expect(stored.status).toBe(PrivacyRequestStatus.COMPLETED);
    expect(stored.rowsAffected).toBe(2);
    expect(stored.completedAt).toBeInstanceOf(Date);
  });
});
