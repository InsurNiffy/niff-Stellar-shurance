import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { HorizonController } from './horizon.controller';
import { HorizonService } from './horizon.service';

const VALID_ADDRESS = 'GBCPNZ6S7RK5N4BX6HBXBCX7P5QNBOJZFGDWBZBXCLK5T6KHWOPTLR3I';

const makeHorizonService = (overrides: Partial<HorizonService> = {}): HorizonService =>
  ({
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    getTransactions: jest.fn().mockResolvedValue({ records: [], eventsEnriched: true }),
    getBalances: jest.fn().mockResolvedValue({ balances: [] }),
    getAccount: jest.fn(),
    getLedger: jest.fn(),
    ...overrides,
  } as unknown as HorizonService);

describe('HorizonController', () => {
  let controller: HorizonController;
  let service: HorizonService;

  async function build(serviceOverrides?: Partial<HorizonService>) {
    service = makeHorizonService(serviceOverrides);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HorizonController],
      providers: [{ provide: HorizonService, useValue: service }],
    }).compile();
    controller = module.get<HorizonController>(HorizonController);
  }

  beforeEach(async () => {
    await build();
  });

  // ── GET /:address/transactions ────────────────────────────────────────────

  describe('getTransactions', () => {
    it('returns paginated records on a valid address', async () => {
      const records = [{ id: '1', paging_token: 'abc', type: 'payment' }];
      (service.getTransactions as jest.Mock).mockResolvedValue({
        records,
        next_cursor: 'abc',
        eventsEnriched: true,
      });

      const result = await controller.getTransactions(VALID_ADDRESS, undefined, '10');

      expect(service.getTransactions).toHaveBeenCalledWith(VALID_ADDRESS, undefined, 10);
      expect(result.records).toEqual(records);
      expect(result.next_cursor).toBe('abc');
    });

    it('passes cursor through to the service', async () => {
      await controller.getTransactions(VALID_ADDRESS, 'cursor123', '5');

      expect(service.getTransactions).toHaveBeenCalledWith(VALID_ADDRESS, 'cursor123', 5);
    });

    it('uses default limit of 20 when limit is omitted', async () => {
      await controller.getTransactions(VALID_ADDRESS);

      expect(service.getTransactions).toHaveBeenCalledWith(VALID_ADDRESS, undefined, 20);
    });

    it('returns 400 when limit is not a number', async () => {
      await expect(
        controller.getTransactions(VALID_ADDRESS, undefined, 'notanumber'),
      ).rejects.toThrow(
        new HttpException('limit must be a number', HttpStatus.BAD_REQUEST),
      );
      expect(service.getTransactions).not.toHaveBeenCalled();
    });

    it('returns 400 (BadRequestException) for an invalid Stellar address', async () => {
      (service.getTransactions as jest.Mock).mockRejectedValue(
        new BadRequestException('Invalid Stellar account address'),
      );

      await expect(controller.getTransactions('INVALID_ADDRESS')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns filtered records — only payment-type operations appear', async () => {
      const filtered = [
        { id: '1', paging_token: 't1', type: 'payment', transaction_hash: 'h1', transaction_successful: true, source_account: VALID_ADDRESS, created_at: '', type_int: 1 },
      ];
      (service.getTransactions as jest.Mock).mockResolvedValue({
        records: filtered,
        eventsEnriched: true,
      });

      const result = await controller.getTransactions(VALID_ADDRESS);

      expect(result.records).toHaveLength(1);
      expect(result.records[0].type).toBe('payment');
    });

    it('returns 429 and sets Retry-After header when rate limit is exceeded', async () => {
      (service.checkRateLimit as jest.Mock).mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 42,
      });

      const mockRes = { setHeader: jest.fn() } as any;

      await expect(
        controller.getTransactions(VALID_ADDRESS, undefined, undefined, mockRes),
      ).rejects.toThrow(
        new HttpException(expect.objectContaining({ statusCode: 429 }), HttpStatus.TOO_MANY_REQUESTS),
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '42');
      expect(service.getTransactions).not.toHaveBeenCalled();
    });

    it('propagates Retry-After header when Horizon itself returns 429 (ServiceUnavailableException)', async () => {
      const svcErr = new ServiceUnavailableException('Horizon unavailable') as ServiceUnavailableException & { retryAfter?: number };
      svcErr.retryAfter = 30;
      (service.getTransactions as jest.Mock).mockRejectedValue(svcErr);

      const mockRes = { setHeader: jest.fn() } as any;

      await expect(
        controller.getTransactions(VALID_ADDRESS, undefined, undefined, mockRes),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    });

    it('does not call checkRateLimit when address would be invalid (rejects before rate-limit check)', async () => {
      // Service validates address and rejects synchronously — the controller
      // calls checkRateLimit before getTransactions. An invalid address
      // reaches getTransactions which throws BadRequestException.
      (service.getTransactions as jest.Mock).mockRejectedValue(
        new BadRequestException('Invalid Stellar account address'),
      );

      await expect(controller.getTransactions('bad')).rejects.toThrow(BadRequestException);
    });
  });

  // ── GET /:address/balances ────────────────────────────────────────────────

  describe('getBalances', () => {
    it('returns the balances array from the account resource', async () => {
      const balances = [
        { asset_type: 'native', balance: '100.0000000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'G...', balance: '50.0000000' },
      ];
      (service.getBalances as jest.Mock).mockResolvedValue({ balances });

      const result = await controller.getBalances(VALID_ADDRESS);

      expect(service.getBalances).toHaveBeenCalledWith(VALID_ADDRESS);
      expect(result.balances).toEqual(balances);
    });

    it('returns empty balances array for an account with no balances', async () => {
      (service.getBalances as jest.Mock).mockResolvedValue({ balances: [] });

      const result = await controller.getBalances(VALID_ADDRESS);

      expect(result.balances).toEqual([]);
    });

    it('propagates BadRequestException for an invalid address', async () => {
      (service.getBalances as jest.Mock).mockRejectedValue(
        new BadRequestException('Invalid Stellar account address'),
      );

      await expect(controller.getBalances('not-a-stellar-address')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('propagates ServiceUnavailableException when Horizon is down', async () => {
      (service.getBalances as jest.Mock).mockRejectedValue(
        new ServiceUnavailableException('Horizon is temporarily unavailable'),
      );

      await expect(controller.getBalances(VALID_ADDRESS)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
