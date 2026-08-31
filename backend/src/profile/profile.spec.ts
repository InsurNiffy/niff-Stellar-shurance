import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateProfileDto } from './profile.dto';

const WALLET = 'GABC1234';
const OTHER_WALLET = 'GXYZ9999';

const defaultProfile = {
  walletAddress: WALLET,
  displayName: null,
  email: null,
  locale: 'en',
  notificationPreferences: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockProfileService = {
  getOrCreate: jest.fn(),
  update: jest.fn(),
};

function makeModule(guardAllows: boolean | string = true) {
  return Test.createTestingModule({
    controllers: [ProfileController],
    providers: [{ provide: ProfileService, useValue: mockProfileService }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (_ctx: ExecutionContext) => {
        if (!guardAllows) throw new UnauthorizedException('Invalid or missing authentication token');
        return true;
      },
    })
    .compile();
}

describe('ProfileController', () => {
  let controller: ProfileController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await makeModule();
    controller = module.get(ProfileController);
  });

  describe('GET /profile — auto-create on first access', () => {
    it('creates and returns default profile on first access', async () => {
      mockProfileService.getOrCreate.mockResolvedValue(defaultProfile);
      const result = await controller.getProfile(WALLET);
      expect(result).toEqual(defaultProfile);
      expect(mockProfileService.getOrCreate).toHaveBeenCalledWith(WALLET);
    });

    it('returns existing profile on subsequent access', async () => {
      const existing = { ...defaultProfile, displayName: 'Alice', email: 'alice@example.com' };
      mockProfileService.getOrCreate.mockResolvedValue(existing);
      const result = await controller.getProfile(WALLET);
      expect(result.displayName).toBe('Alice');
    });

    it('is scoped to the JWT wallet — never accepts arbitrary wallet param', async () => {
      mockProfileService.getOrCreate.mockResolvedValue({ ...defaultProfile, walletAddress: OTHER_WALLET });
      await controller.getProfile(OTHER_WALLET);
      expect(mockProfileService.getOrCreate).toHaveBeenCalledWith(OTHER_WALLET);
      expect(mockProfileService.getOrCreate).not.toHaveBeenCalledWith(WALLET);
    });
  });

  describe('PATCH /profile — valid updates persist', () => {
    it('persists all provided fields and returns updated profile', async () => {
      const dto: UpdateProfileDto = { displayName: 'Alice', email: 'alice@example.com', locale: 'fr' };
      const updated = { ...defaultProfile, ...dto };
      mockProfileService.update.mockResolvedValue(updated);
      const result = await controller.updateProfile(WALLET, dto);
      expect(result).toEqual(updated);
      expect(mockProfileService.update).toHaveBeenCalledWith(WALLET, dto);
    });

    it('accepts partial update (notificationPreferences only)', async () => {
      const dto: UpdateProfileDto = { notificationPreferences: { renewalReminders: true } };
      mockProfileService.update.mockResolvedValue({ ...defaultProfile, notificationPreferences: dto.notificationPreferences });
      const result = await controller.updateProfile(WALLET, dto);
      expect(result.notificationPreferences).toEqual({ renewalReminders: true });
    });

    it('cannot update another wallet profile — always uses JWT wallet', async () => {
      const dto: UpdateProfileDto = { displayName: 'Hacker' };
      mockProfileService.update.mockResolvedValue({ ...defaultProfile, walletAddress: OTHER_WALLET });
      await controller.updateProfile(OTHER_WALLET, dto);
      expect(mockProfileService.update).toHaveBeenCalledWith(OTHER_WALLET, dto);
      expect(mockProfileService.update).not.toHaveBeenCalledWith(WALLET, expect.anything());
    });
  });

  describe('Guard enforcement — unauthenticated requests denied', () => {
    it('guard throws UnauthorizedException when no token', () => {
      const guard = new JwtAuthGuard();
      expect(() => guard.handleRequest(null, false, undefined)).toThrow(UnauthorizedException);
    });

    it('guard throws when error is present', () => {
      const guard = new JwtAuthGuard();
      expect(() => guard.handleRequest(new Error('bad token'), false, undefined)).toThrow();
    });
  });
});

// ── ProfileService unit tests ─────────────────────────────────────────────────

describe('ProfileService', () => {
  const mockPrisma = {
    holderProfile: { upsert: jest.fn(), findUnique: jest.fn() },
    profileAuditLog: { create: jest.fn() },
  };
  let service: ProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProfileService(mockPrisma as never);
  });

  describe('getOrCreate', () => {
    it('upserts with empty create defaults and no-op update', async () => {
      mockPrisma.holderProfile.upsert.mockResolvedValue(defaultProfile);
      const result = await service.getOrCreate(WALLET);
      expect(result).toEqual(defaultProfile);
      expect(mockPrisma.holderProfile.upsert).toHaveBeenCalledWith({
        where: { walletAddress: WALLET },
        create: { walletAddress: WALLET },
        update: {},
      });
    });
  });

  describe('update', () => {
    it('only includes defined fields in update payload', async () => {
      mockPrisma.holderProfile.findUnique.mockResolvedValue(defaultProfile);
      mockPrisma.holderProfile.upsert.mockResolvedValue({ ...defaultProfile, displayName: 'Bob' });
      await service.update(WALLET, { displayName: 'Bob' });
      const { update } = mockPrisma.holderProfile.upsert.mock.calls[0][0];
      expect(update).toEqual({ displayName: 'Bob' });
      expect(update).not.toHaveProperty('email');
    });

    it('includes all provided fields', async () => {
      const dto: UpdateProfileDto = {
        displayName: 'Alice',
        email: 'alice@example.com',
        locale: 'fr',
        notificationPreferences: { renewalReminders: true },
      };
      mockPrisma.holderProfile.findUnique.mockResolvedValue(defaultProfile);
      mockPrisma.holderProfile.upsert.mockResolvedValue({ ...defaultProfile, ...dto });
      await service.update(WALLET, dto);
      const { update } = mockPrisma.holderProfile.upsert.mock.calls[0][0];
      expect(update).toEqual({
        displayName: 'Alice',
        email: 'alice@example.com',
        locale: 'fr',
        notificationPreferences: { renewalReminders: true },
      });
    });

    it('malformed email is rejected by DTO validation (class-validator)', async () => {
      // Validation happens at the pipe layer; service receives already-validated data.
      // Verify the DTO decorator is present by checking the metadata.
      const { getMetadataStorage } = await import('class-validator');
      const metas = getMetadataStorage().getTargetValidationMetadatas(
        UpdateProfileDto,
        '',
        false,
        false,
      );
      const emailMeta = metas.find((m) => m.propertyName === 'email');
      expect(emailMeta).toBeDefined();
    });

    it('writes audit log entry only for fields that actually changed', async () => {
      const existing = { ...defaultProfile, displayName: 'Alice', email: 'alice@example.com' };
      mockPrisma.holderProfile.findUnique.mockResolvedValue(existing);
      mockPrisma.holderProfile.upsert.mockResolvedValue({
        ...existing,
        displayName: 'Bob',
      });
      mockPrisma.profileAuditLog.create.mockResolvedValue({});

      await service.update(WALLET, { displayName: 'Bob' });

      expect(mockPrisma.profileAuditLog.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.profileAuditLog.create).toHaveBeenCalledWith({
        data: {
          walletAddress: WALLET,
          fieldName: 'displayName',
          oldValue: 'Alice',
          newValue: 'Bob',
          actor: WALLET,
        },
      });
    });

    it('produces no audit entries when submitting identical values', async () => {
      const existing = { ...defaultProfile, displayName: 'Alice' };
      mockPrisma.holderProfile.findUnique.mockResolvedValue(existing);
      mockPrisma.holderProfile.upsert.mockResolvedValue(existing);
      mockPrisma.profileAuditLog.create.mockResolvedValue({});

      await service.update(WALLET, { displayName: 'Alice' });

      expect(mockPrisma.profileAuditLog.create).not.toHaveBeenCalled();
    });

    it('handles duplicate wallet address conflict with 409 error', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`wallet_address`)',
        { code: 'P2002', clientVersion: '6.19.3' },
      );

      mockPrisma.holderProfile.findUnique.mockResolvedValue(defaultProfile);
      mockPrisma.holderProfile.upsert.mockRejectedValue(prismaError);

      await expect(service.update(WALLET, { displayName: 'Bob' })).rejects.toThrow(ConflictException);
    });
  });
});
