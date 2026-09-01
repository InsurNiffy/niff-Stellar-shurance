import {
  createAnonymizationContext,
  anonymizeWallet,
  anonymizeEmail,
  anonymizeName,
  tokenizeId,
  anonymizePolicies,
  anonymizeClaims,
  anonymizeVotes,
  anonymizeHolderProfiles,
  anonymizeSupportTickets,
  anonymizeClaimComments,
} from './anonymization.transform';

describe('AnonymizationTransform', () => {
  describe('createAnonymizationContext', () => {
    it('creates empty maps', () => {
      const ctx = createAnonymizationContext();
      expect(ctx.walletMap.size).toBe(0);
      expect(ctx.emailMap.size).toBe(0);
      expect(ctx.idMap.size).toBe(0);
    });
  });

  describe('anonymizeWallet', () => {
    it('returns consistent output for same input', () => {
      const ctx = createAnonymizationContext();
      const wallet = 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ';

      const anon1 = anonymizeWallet(wallet, ctx);
      const anon2 = anonymizeWallet(wallet, ctx);

      expect(anon1).toBe(anon2);
    });

    it('generates Stellar-like address format (starts with G)', () => {
      const ctx = createAnonymizationContext();
      const wallet = 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ';
      const anon = anonymizeWallet(wallet, ctx);

      expect(anon).toMatch(/^G[A-Z0-9]{55}$/);
    });

    it('maps different wallets to different outputs', () => {
      const ctx = createAnonymizationContext();
      const wallet1 = 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ';
      const wallet2 = 'GBXYZ5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYAAA';

      const anon1 = anonymizeWallet(wallet1, ctx);
      const anon2 = anonymizeWallet(wallet2, ctx);

      expect(anon1).not.toBe(anon2);
    });

    it('stores mapping in context', () => {
      const ctx = createAnonymizationContext();
      const wallet = 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ';

      anonymizeWallet(wallet, ctx);

      expect(ctx.walletMap.has(wallet)).toBe(true);
    });
  });

  describe('anonymizeEmail', () => {
    it('returns consistent output for same input', () => {
      const ctx = createAnonymizationContext();
      const email = 'test@example.com';

      const anon1 = anonymizeEmail(email, ctx);
      const anon2 = anonymizeEmail(email, ctx);

      expect(anon1).toBe(anon2);
    });

    it('generates staging domain email', () => {
      const ctx = createAnonymizationContext();
      const email = 'test@example.com';
      const anon = anonymizeEmail(email, ctx);

      expect(anon).toMatch(/^user_[a-f0-9]{12}@staging\.example\.com$/);
    });

    it('maps different emails to different outputs', () => {
      const ctx = createAnonymizationContext();
      const email1 = 'test1@example.com';
      const email2 = 'test2@example.com';

      const anon1 = anonymizeEmail(email1, ctx);
      const anon2 = anonymizeEmail(email2, ctx);

      expect(anon1).not.toBe(anon2);
    });
  });

  describe('anonymizeName', () => {
    it('generates user name format', () => {
      const ctx = createAnonymizationContext();
      const name = 'John Doe';
      const anon = anonymizeName(name, ctx);

      expect(anon).toMatch(/^User_[a-f0-9]{8}$/);
    });

    it('is deterministic', () => {
      const ctx = createAnonymizationContext();
      const name = 'John Doe';

      const anon1 = anonymizeName(name, ctx);
      const anon2 = anonymizeName(name, ctx);

      expect(anon1).toBe(anon2);
    });
  });

  describe('tokenizeId', () => {
    it('returns consistent output for same input', () => {
      const ctx = createAnonymizationContext();
      const id = 12345;

      const token1 = tokenizeId(id, ctx);
      const token2 = tokenizeId(id, ctx);

      expect(token1).toBe(token2);
    });

    it('generates token format with prefix', () => {
      const ctx = createAnonymizationContext();
      const token = tokenizeId(999, ctx);

      expect(token).toMatch(/^tok_[a-f0-9]{20}$/);
    });

    it('maps different IDs to different tokens', () => {
      const ctx = createAnonymizationContext();

      const token1 = tokenizeId(111, ctx);
      const token2 = tokenizeId(222, ctx);

      expect(token1).not.toBe(token2);
    });

    it('handles string IDs', () => {
      const ctx = createAnonymizationContext();

      const token = tokenizeId('policy-123', ctx);

      expect(token).toMatch(/^tok_[a-f0-9]{20}$/);
    });
  });

  describe('anonymizePolicies', () => {
    it('anonymizes wallet and policy ID', () => {
      const ctx = createAnonymizationContext();
      const policies = [
        {
          id: 'holder1:policy1',
          holderAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          policyType: 'health',
          isActive: true,
        },
      ];

      const anon = anonymizePolicies(policies, ctx);

      expect(anon[0].id).toMatch(/^tok_/);
      expect(anon[0].holderAddress).toMatch(/^G/);
      expect(anon[0].policyType).toBe('health');
    });

    it('preserves non-PII fields', () => {
      const ctx = createAnonymizationContext();
      const policies = [
        {
          id: 'holder1:policy1',
          holderAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          policyType: 'health',
          region: 'US',
          coverageAmount: '100000',
          premium: '500',
          isActive: true,
          createdAt: new Date('2026-01-01'),
        },
      ];

      const anon = anonymizePolicies(policies, ctx);

      expect(anon[0].policyType).toBe('health');
      expect(anon[0].region).toBe('US');
      expect(anon[0].coverageAmount).toBe('100000');
      expect(anon[0].premium).toBe('500');
      expect(anon[0].isActive).toBe(true);
      expect(anon[0].createdAt).toEqual(new Date('2026-01-01'));
    });
  });

  describe('anonymizeClaims', () => {
    it('drops sensitive fields', () => {
      const ctx = createAnonymizationContext();
      const claims = [
        {
          id: 1,
          policyId: 'policy1',
          creatorAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          amount: '1000',
          description: 'Broke my arm in a fall',
          imageUrls: ['https://example.com/image.jpg'],
          txHash: '0x123abc',
          eventIndex: 5,
          status: 'PENDING',
        },
      ];

      const anon = anonymizeClaims(claims, ctx);

      expect(anon[0].description).toBeUndefined();
      expect(anon[0].imageUrls).toBeUndefined();
      expect(anon[0].txHash).toBeUndefined();
      expect(anon[0].eventIndex).toBeUndefined();
    });

    it('tokenizes policyId and anonymizes creator', () => {
      const ctx = createAnonymizationContext();
      const claims = [
        {
          id: 1,
          policyId: 'policy1',
          creatorAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          amount: '1000',
          status: 'APPROVED',
        },
      ];

      const anon = anonymizeClaims(claims, ctx);

      expect(anon[0].policyId).toMatch(/^tok_/);
      expect(anon[0].creatorAddress).toMatch(/^G/);
    });

    it('preserves safe fields', () => {
      const ctx = createAnonymizationContext();
      const now = new Date();
      const claims = [
        {
          id: 1,
          policyId: 'policy1',
          creatorAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          amount: '1000',
          status: 'APPROVED',
          severity: 'HIGH',
          isFinalized: true,
          approveVotes: 3,
          rejectVotes: 1,
          createdAt: now,
        },
      ];

      const anon = anonymizeClaims(claims, ctx);

      expect(anon[0].amount).toBe('1000');
      expect(anon[0].status).toBe('APPROVED');
      expect(anon[0].severity).toBe('HIGH');
      expect(anon[0].isFinalized).toBe(true);
      expect(anon[0].approveVotes).toBe(3);
      expect(anon[0].rejectVotes).toBe(1);
      expect(anon[0].createdAt).toBe(now);
    });
  });

  describe('anonymizeVotes', () => {
    it('removes voterAddress', () => {
      const ctx = createAnonymizationContext();
      const votes = [
        {
          id: 1,
          claimId: 5,
          voterAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          vote: 'APPROVE',
          votingPower: 1,
          txHash: '0x123',
          eventIndex: 2,
        },
      ];

      const anon = anonymizeVotes(votes, ctx);

      expect(anon[0].voterAddress).toBeUndefined();
      expect(anon[0].txHash).toBeUndefined();
      expect(anon[0].eventIndex).toBeUndefined();
    });

    it('preserves voting choice and power', () => {
      const ctx = createAnonymizationContext();
      const votes = [
        {
          id: 1,
          claimId: 5,
          voterAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          vote: 'REJECT',
          votingPower: 5,
        },
      ];

      const anon = anonymizeVotes(votes, ctx);

      expect(anon[0].vote).toBe('REJECT');
      expect(anon[0].votingPower).toBe(5);
    });
  });

  describe('anonymizeHolderProfiles', () => {
    it('anonymizes wallet, email, and display name', () => {
      const ctx = createAnonymizationContext();
      const profiles = [
        {
          walletAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          displayName: 'Alice Smith',
          email: 'alice@example.com',
          locale: 'en',
        },
      ];

      const anon = anonymizeHolderProfiles(profiles, ctx);

      expect(anon[0].walletAddress).toMatch(/^G/);
      expect(anon[0].displayName).toMatch(/^User_/);
      expect(anon[0].email).toMatch(/@staging\.example\.com$/);
    });

    it('preserves locale', () => {
      const ctx = createAnonymizationContext();
      const profiles = [
        {
          walletAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          displayName: 'Alice Smith',
          email: 'alice@example.com',
          locale: 'fr',
        },
      ];

      const anon = anonymizeHolderProfiles(profiles, ctx);

      expect(anon[0].locale).toBe('fr');
    });
  });

  describe('anonymizeSupportTickets', () => {
    it('removes subject, message, assigned_to, ip_hash', () => {
      const ctx = createAnonymizationContext();
      const tickets = [
        {
          id: 'ticket-1',
          email: 'user@example.com',
          subject: 'Problem with my claim',
          message: 'I have a broken leg',
          ipHash: 'hash123',
          assignedTo: 'support@company.com',
          status: 'OPEN',
        },
      ];

      const anon = anonymizeSupportTickets(tickets, ctx);

      expect(anon[0].subject).toBeUndefined();
      expect(anon[0].message).toBeUndefined();
      expect(anon[0].ipHash).toBeUndefined();
      expect(anon[0].assignedTo).toBeUndefined();
    });

    it('anonymizes email and preserves status', () => {
      const ctx = createAnonymizationContext();
      const tickets = [
        {
          id: 'ticket-1',
          email: 'user@example.com',
          status: 'RESOLVED',
        },
      ];

      const anon = anonymizeSupportTickets(tickets, ctx);

      expect(anon[0].email).toMatch(/@staging\.example\.com$/);
      expect(anon[0].status).toBe('RESOLVED');
    });
  });

  describe('anonymizeClaimComments', () => {
    it('removes body and anonymizes author', () => {
      const ctx = createAnonymizationContext();
      const comments = [
        {
          id: 'comment-1',
          claimId: 1,
          authorAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          body: 'This claim is suspicious',
        },
      ];

      const anon = anonymizeClaimComments(comments, ctx);

      expect(anon[0].body).toBeUndefined();
      expect(anon[0].authorAddress).toMatch(/^G/);
    });

    it('tokenizes claimId', () => {
      const ctx = createAnonymizationContext();
      const comments = [
        {
          id: 'comment-1',
          claimId: 5,
          authorAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          body: 'Comment text',
        },
      ];

      const anon = anonymizeClaimComments(comments, ctx);

      expect(anon[0].claimId).toMatch(/^tok_/);
    });
  });

  describe('consistency across context', () => {
    it('maintains same anonymization for repeated fields', () => {
      const ctx = createAnonymizationContext();
      const wallet = 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ';

      const anon1 = anonymizeWallet(wallet, ctx);
      const anon2 = anonymizeWallet(wallet, ctx);

      expect(anon1).toBe(anon2);
    });

    it('preserves referential integrity through tokenization', () => {
      const ctx = createAnonymizationContext();

      const policyToken1 = tokenizeId('policy-1', ctx);
      const policyToken2 = tokenizeId('policy-1', ctx);

      expect(policyToken1).toBe(policyToken2);

      const claims = [
        {
          id: 1,
          policyId: 'policy-1',
          creatorAddress: 'GBVUR5XPGFBFN2XYOJSZ4K6SSWJG3CQFBFPXJNZGYK4KF6HYJQ7XYZZZ',
          status: 'APPROVED',
        },
      ];

      const anonClaims = anonymizeClaims(claims, ctx);

      expect(anonClaims[0].policyId).toBe(policyToken1);
    });
  });
});
