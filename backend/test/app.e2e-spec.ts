import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { FeatureFlagsGuard } from '../src/feature-flags/feature-flags.guard';
import { OracleHooksController } from '../src/experimental/oracle-hooks.controller';
import { BetaCalculatorsController } from '../src/experimental/beta-calculators.controller';

const FEATURE_FLAGS_JSON_ENV = 'FEATURE_FLAGS_JSON';
const FEATURE_FLAGS_DISABLED_STATUS_ENV = 'FEATURE_FLAGS_DISABLED_STATUS';

describe('Feature Flags (integration)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  const originalFlags = process.env[FEATURE_FLAGS_JSON_ENV];
  const originalDisabledStatus = process.env[FEATURE_FLAGS_DISABLED_STATUS_ENV];

  afterEach(async () => {
    if (app) {
      await app.close();
    }

    if (originalFlags === undefined) {
      delete process.env[FEATURE_FLAGS_JSON_ENV];
    } else {
      process.env[FEATURE_FLAGS_JSON_ENV] = originalFlags;
    }

    if (originalDisabledStatus === undefined) {
      delete process.env[FEATURE_FLAGS_DISABLED_STATUS_ENV];
    } else {
      process.env[FEATURE_FLAGS_DISABLED_STATUS_ENV] = originalDisabledStatus;
    }
  });

  async function createApp(
    flags: Record<string, boolean> | undefined,
    disabledStatusCode?: '403' | '404',
  ) {
    if (flags === undefined) {
      delete process.env[FEATURE_FLAGS_JSON_ENV];
    } else {
      process.env[FEATURE_FLAGS_JSON_ENV] = JSON.stringify(flags);
    }

    if (disabledStatusCode) {
      process.env[FEATURE_FLAGS_DISABLED_STATUS_ENV] = disabledStatusCode;
    } else {
      delete process.env[FEATURE_FLAGS_DISABLED_STATUS_ENV];
    }

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }

  function contextFor(handler: Function, klass: Function, path: string): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => klass,
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: path, ip: '127.0.0.1' }),
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
    } as ExecutionContext;
  }

  it('keeps experimental endpoints unreachable by default (404)', async () => {
    await createApp(undefined);
    const guard = moduleFixture.get(FeatureFlagsGuard);

    expect(() =>
      guard.canActivate(
        contextFor(
          OracleHooksController.prototype.ingest,
          OracleHooksController,
          '/experimental/oracle-hooks/ingest',
        ),
      ),
    ).toThrow(NotFoundException);
  });

  it('supports 403 behavior for disabled features when configured', async () => {
    await createApp({ 'experimental.oracleHooks': false }, '403');
    const guard = moduleFixture.get(FeatureFlagsGuard);

    expect(() =>
      guard.canActivate(
        contextFor(
          OracleHooksController.prototype.ingest,
          OracleHooksController,
          '/experimental/oracle-hooks/ingest',
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows enabled flagged routes to behave normally', async () => {
    await createApp({ 'experimental.betaCalculators': true });
    const guard = moduleFixture.get(FeatureFlagsGuard);
    const betaController = moduleFixture.get(BetaCalculatorsController);

    const allowed = guard.canActivate(
      contextFor(
        BetaCalculatorsController.prototype.premiumPreview,
        BetaCalculatorsController,
        '/experimental/beta-calculators/premium-preview',
      ),
    );

    expect(allowed).toBe(true);
    expect(
      betaController.premiumPreview({ basePremium: 100, riskMultiplier: 1.25 }),
    ).toEqual({ premium: 125 });
  });
});
