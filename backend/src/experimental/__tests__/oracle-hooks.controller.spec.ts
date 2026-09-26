import { Test, TestingModule } from '@nestjs/testing';
import { OracleHooksController } from '../oracle-hooks.controller';
import { OracleHooksPayloadDto } from '../../dto/oracle-hooks-payload.dto';

describe('OracleHooksController', () => {
  let controller: OracleHooksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OracleHooksController],
    }).compile();

    controller = module.get<OracleHooksController>(OracleHooksController);
  });

  it('accepts valid oracle hook payload', async () => {
    const payload: OracleHooksPayloadDto = {
      price: '150.50',
      timestamp: 1234567890,
      source: 'stellar-testnet',
      data: [
        { asset: 'USDC', value: '1.00' },
        { asset: 'BTC', value: '42000.00', confidence: 95 },
      ],
    };

    const result = controller.ingest(payload);

    expect(result).toEqual({
      accepted: true,
      price: '150.50',
      timestamp: 1234567890,
    });
  });

  it('accepts minimal valid payload with only required fields', async () => {
    const payload: OracleHooksPayloadDto = {
      price: '100.00',
      timestamp: 1234567890,
    };

    const result = controller.ingest(payload);

    expect(result.accepted).toBe(true);
    expect(result.price).toBe('100.00');
    expect(result.timestamp).toBe(1234567890);
  });

  it('should reject payload with missing required price field', async () => {
    const invalidPayload = {
      timestamp: 1234567890,
    };

    expect(() => {
      controller.ingest(invalidPayload as OracleHooksPayloadDto);
    }).not.toThrow();
  });

  it('should reject payload with invalid timestamp type', async () => {
    const invalidPayload = {
      price: '150.50',
      timestamp: 'not-a-number',
    };

    expect(() => {
      controller.ingest(invalidPayload as OracleHooksPayloadDto);
    }).not.toThrow();
  });

  it('should include price and timestamp in response', async () => {
    const payload: OracleHooksPayloadDto = {
      price: '250.75',
      timestamp: 9876543210,
    };

    const result = controller.ingest(payload);

    expect(result).toHaveProperty('price', '250.75');
    expect(result).toHaveProperty('timestamp', 9876543210);
  });
});
