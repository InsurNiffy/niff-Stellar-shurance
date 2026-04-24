import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { INestApplication } from '@nestjs/common';
import type { Response } from 'express';
import { AppLoggerService } from '../common/logger/app-logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { PolicyResolver } from './policy.resolver';
import { ClaimResolver } from './claim.resolver';
import { GraphqlRateLimitGuard } from './graphql-rate-limit.guard';
import { GraphqlWalletAuthGuard } from './graphql-wallet-auth.guard';
import { GraphqlOperationGuardService } from './graphql-operation-guard.service';
import { createGraphqlSecurityPlugin, formatGraphqlError } from './graphql-apollo.plugins';
import { ClaimsService } from '../claims/claims.service';
import { PolicyReadService } from '../policy/policy-read.service';
import { AuthIdentityService } from '../auth/auth-identity.service';
import { RedisService } from '../cache/redis.service';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { GraphqlRequest } from './graphql.context';

const configValues: Record<string, unknown> = {
  JWT_SECRET: 'graphql-test-secret-with-safe-length-1234567890',
  GRAPHQL_MAX_DEPTH: 6,
  GRAPHQL_MAX_COMPLEXITY: 200,
  GRAPHQL_SLOW_OPERATION_MS: 1_000,
  GRAPHQL_RATE_LIMIT_MAX: 100,
  GRAPHQL_RATE_LIMIT_WINDOW_MS: 60_000,
  GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT: 10,
  GRAPHQL_POLICY_CLAIMS_MAX_LIMIT: 25,
};

const configServiceMock = {
  get: jest.fn((key: string, defaultValue?: unknown) =>
    Object.prototype.hasOwnProperty.call(configValues, key)
      ? configValues[key]
      : defaultValue,
  ),
};

const redisClientMock = {
  incr: jest.fn().mockResolvedValue(1),
  pexpire: jest.fn().mockResolvedValue(1),
};

const redisServiceMock = {
  getClient: jest.fn(() => redisClientMock),
};

const policyReadServiceMock = {
  listPolicies: jest.fn(),
  getPolicyById: jest.fn(),
  getPoliciesByIds: jest.fn(),
};

const claimsServiceMock = {
  listClaims: jest.fn(),
  getClaimById: jest.fn(),
  getClaimsNeedingVote: jest.fn(),
  getClaimsByPolicyIds: jest.fn(),
};

function claimDto(id: number, policyId: string) {
  return {
    metadata: {
      id,
      policyId,
      creatorAddress: 'GWALLET',
      status: 'pending',
      amount: '1000',
      description: 'Storm damage',
      evidenceHash: 'bafyhash',
      createdAtLedger: 10,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    },
    votes: {
      yesVotes: 1,
      noVotes: 0,
      totalVotes: 1,
    },
    quorum: {
      required: 1,
      current: 1,
      percentage: 100,
      reached: true,
    },
    deadline: {
      votingDeadlineLedger: 120,
      votingDeadlineTime: new Date('2026-03-10T00:00:00.000Z'),
      isOpen: true,
      remainingSeconds: 60,
    },
    evidence: {
      hash: 'bafyhash',
      gatewayUrl: 'https://ipfs.io/ipfs/bafyhash',
    },
    consistency: {
      isFinalized: false,
      indexerLag: 0,
      lastIndexedLedger: 100,
      isStale: false,
      tallyReconciled: true,
    },
    userVote: undefined,
    userHasVoted: false,
  };
}

describe('GraphQL integration', () => {
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();

    const metrics = new MetricsService();
    const logger = new AppLoggerService(configServiceMock as unknown as ConfigService);
    const operationGuard = new GraphqlOperationGuardService(
      configServiceMock as unknown as ConfigService,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          path: '/graphql',
          useGlobalPrefix: true,
          context: ({
            req,
            res,
          }: {
            req: GraphqlRequest;
            res: Response;
          }) => ({ req, res }),
          formatError: formatGraphqlError,
          plugins: [
            createGraphqlSecurityPlugin(operationGuard, metrics, logger, 1_000),
          ],
        }),
      ],
      providers: [
        PolicyResolver,
        ClaimResolver,
        GraphqlRateLimitGuard,
        GraphqlWalletAuthGuard,
        AuthIdentityService,
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
        {
          provide: RedisService,
          useValue: redisServiceMock,
        },
        {
          provide: PolicyReadService,
          useValue: policyReadServiceMock,
        },
        {
          provide: ClaimsService,
          useValue: claimsServiceMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('batches policy -> claims lookups instead of devolving into N+1 queries', async () => {
    policyReadServiceMock.listPolicies.mockResolvedValue({
      items: [
        {
          id: 'GHOLDER:1',
          policyId: 1,
          holderAddress: 'GHOLDER',
          policyType: 'CROP',
          region: 'NG-LA',
          coverageAmount: '5000',
          premium: '100',
          isActive: true,
          startLedger: 1,
          endLedger: 100,
          assetContractId: null,
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        {
          id: 'GHOLDER:2',
          policyId: 2,
          holderAddress: 'GHOLDER',
          policyType: 'AUTO',
          region: 'NG-LA',
          coverageAmount: '9000',
          premium: '250',
          isActive: true,
          startLedger: 2,
          endLedger: 200,
          assetContractId: null,
          createdAt: new Date('2026-03-02T00:00:00.000Z'),
          updatedAt: new Date('2026-03-02T00:00:00.000Z'),
        },
      ],
      nextCursor: null,
      total: 2,
    });

    claimsServiceMock.getClaimsByPolicyIds.mockResolvedValue(
      new Map([
        ['GHOLDER:1', [claimDto(101, 'GHOLDER:1')]],
        ['GHOLDER:2', [claimDto(201, 'GHOLDER:2')]],
      ]),
    );

    const response = await request(app.getHttpServer())
      .post('/api/graphql')
      .send({
        query: `
          query {
            policies(first: 2) {
              items {
                id
                claims(first: 2) {
                  id
                  status
                }
              }
            }
          }
        `,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.policies.items).toHaveLength(2);
    expect(response.body.data.policies.items[0].claims[0].id).toBe(101);
    expect(claimsServiceMock.getClaimsByPolicyIds).toHaveBeenCalledTimes(1);
    expect(claimsServiceMock.getClaimsByPolicyIds).toHaveBeenCalledWith(
      ['GHOLDER:1', 'GHOLDER:2'],
      2,
    );
  });

  it('rejects maliciously deep queries deterministically', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/graphql')
      .send({
        query: `
          query {
            policy(id: "GHOLDER:1") {
              claims(first: 1) {
                policy {
                  claims(first: 1) {
                    policy {
                      claims(first: 1) {
                        policy {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors[0].extensions.code).toBe('GRAPHQL_DEPTH_LIMIT');
    expect(policyReadServiceMock.getPolicyById).not.toHaveBeenCalled();
    expect(claimsServiceMock.getClaimsByPolicyIds).not.toHaveBeenCalled();
  });

  it('keeps wallet-only queries inaccessible to staff tokens', async () => {
    const staffToken = jwt.sign(
      {
        sub: 'staff-1',
        email: 'admin@niffyinsure.test',
        role: 'admin',
      },
      String(configValues.JWT_SECRET),
      { expiresIn: '1h' },
    );

    const response = await request(app.getHttpServer())
      .post('/api/graphql')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        query: `
          query {
            claimsNeedingMyVote(first: 1) {
              total
            }
          }
        `,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
  });

  it('masks internal resolver errors without leaking stack traces or resolver paths', async () => {
    policyReadServiceMock.getPolicyById.mockRejectedValue(
      new Error('boom from /src/graphql/policy.resolver.ts'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/graphql')
      .send({
        query: `
          query {
            policy(id: "GHOLDER:1") {
              id
            }
          }
        `,
      });

    expect(response.status).toBe(200);
    expect(response.body.errors[0].message).toBe('Internal server error');
    expect(response.body.errors[0].path).toBeUndefined();
    expect(JSON.stringify(response.body.errors[0])).not.toContain('policy.resolver.ts');
  });
});
