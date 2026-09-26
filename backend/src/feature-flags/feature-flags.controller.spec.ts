import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { APPEAL_FEATURE_FLAG } from '../claims/claims.constants';

describe('FeatureFlagsController', () => {
  let controller: FeatureFlagsController;
  const isEnabled = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsController],
      providers: [{ provide: FeatureFlagsService, useValue: { isEnabled } }],
    }).compile();

    controller = module.get(FeatureFlagsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns the enabled state of an allowlisted flag', () => {
    isEnabled.mockReturnValue(true);
    expect(controller.getFlag(APPEAL_FEATURE_FLAG)).toEqual({
      key: APPEAL_FEATURE_FLAG,
      enabled: true,
    });
    expect(isEnabled).toHaveBeenCalledWith(APPEAL_FEATURE_FLAG);
  });

  it('reports a disabled allowlisted flag as disabled', () => {
    isEnabled.mockReturnValue(false);
    expect(controller.getFlag(APPEAL_FEATURE_FLAG)).toEqual({
      key: APPEAL_FEATURE_FLAG,
      enabled: false,
    });
  });

  it('404s for a key that is not on the allowlist', () => {
    expect(() => controller.getFlag('not_a_real_flag')).toThrow(NotFoundException);
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
