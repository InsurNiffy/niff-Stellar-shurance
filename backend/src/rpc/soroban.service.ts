/**
 * SorobanService — NestJS wrapper around the Stellar Soroban RPC.
 *
 * SECURITY: Private keys are never accepted, logged, or stored here.
 *           All transactions returned are unsigned.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';
import { MetricsService } from '../metrics/metrics.service';
import { RequestIdService } from '../common/tracing/request-id.service';
import { getNetworkConfig } from '../config/network.config';
import { CLAIM_BATCH_GET_MAX, POLICY_BATCH_GET_MAX } from '../chain/chain.constants';
import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  Address,
  Keypair,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import {
  claimEvidenceVecToScVal,
  type ClaimEvidenceInput,
} from '../soroban/file-claim-evidence';

const { Api, assembleTransaction } = SorobanRpc;

export type PolicyTypeEnum = 'Auto' | 'Health' | 'Property';
export type RegionTierEnum = 'Low' | 'Medium' | 'High';
export type AgeBandEnum = 'Young' | 'Adult' | 'Senior';
export type CoverageTierEnum = 'Basic' | 'Standard' | 'Premium';

export interface SimulatePremiumResult {
  premiumStroops: string;
  premiumXlm: string;
  minResourceFee: string;
  source: 'simulation' | 'local_fallback';
}

export interface AuthRequirement {
  address: string;
  isContract: boolean;
}

export interface BuildTransactionResult {
  unsignedXdr: string;
  minResourceFee: string;
  baseFee: string;
  totalEstimatedFee: string;
  totalEstimatedFeeXlm: string;
  authRequirements: AuthRequirement[];
  memoConvention: string;
  currentLedger: number;
}

export interface BuildRenewalTransactionResult extends BuildTransactionResult {
  /** Renewal premium in stroops (i128 as string). */
  premiumStroops: string;
  /** Renewal premium in XLM. */
  premiumXlm: string;
  /** Whether the premium was computed on-chain or via local fallback. */
  premiumSource: 'simulation' | 'local_fallback';
}

export interface FinalizeClaimResult {
  txHash: string;
  ledger: number;
  onChainStatus: string;
}

export interface EvidenceLimits {
  minEvidenceCount: number;
  maxEvidenceCount: number;
}

export interface KeeperActionResult {
  txHash: string;
  ledger: number;
}

export interface VotingDuration {
  votingDurationLedgers: number;
}

interface PendingSubmission {
  transactionXdr: string;
  timestamp: number;
}

@Injectable()
export class SorobanService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SorobanService.name);
  private circuitBreaker!: CircuitBreaker;
  private pendingSubmissions: PendingSubmission[] = [];
  private readonly cbThreshold: number;
  private readonly cbResetMs: number;
  private quoteCache = new Map<string, { result: unknown; timestamp: number }>();
  private readonly quoteCacheTtlMs = 60_000;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly metricsService?: MetricsService,
    @Optional() private readonly requestIdService?: RequestIdService,
  ) {
    this.cbThreshold = this.configService.get<number>('SOROBAN_RPC_CIRCUIT_BREAKER_THRESHOLD', 5);
    this.cbResetMs = this.configService.get<number>('SOROBAN_RPC_CIRCUIT_BREAKER_RESET_MS', 60_000);
  }

  onModuleInit(): void {
    this.initCircuitBreaker();
  }

  onModuleDestroy(): void {
    this.circuitBreaker?.shutdown();
  }

  private initCircuitBreaker(): void {
    this.circuitBreaker = new CircuitBreaker(
      async (fn: () => Promise<unknown>) => fn(),
      {
        timeout: 30_000,
        maxFailures: this.cbThreshold,
        resetTimeout: this.cbResetMs,
        name: 'SorobanRpcCircuitBreaker',
      },
    );

    this.circuitBreaker.on('open', () => {
      this.logger.warn('Soroban RPC circuit breaker opened');
    });

    this.circuitBreaker.on('halfOpen', () => {
      this.logger.debug('Soroban RPC circuit breaker transitioning to half-open');
    });

    this.circuitBreaker.on('close', () => {
      this.logger.debug('Soroban RPC circuit breaker closed');
    });
  }

  isRpcHealthy(): boolean {
    return !this.circuitBreaker?.opened;
  }

  getPendingSubmissions(): PendingSubmission[] {
    return [...this.pendingSubmissions];
  }

  /**
   * Wraps an RPC call with timing + metric recording.
   * rpcMethod must be one of a fixed set to keep cardinality bounded.
   */
  private async trackRpc<T>(
    rpcMethod: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.metricsService?.recordRpcCall({
        rpcMethod,
        status: 'success',
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err: unknown) {
      const errorType =
        err instanceof BadRequestException
          ? 'client_error'
          : err instanceof ServiceUnavailableException
            ? 'unavailable'
            : 'unknown';
      this.metricsService?.recordRpcCall({
        rpcMethod,
        status: 'error',
        durationMs: Date.now() - start,
        errorType,
      });
      throw err;
    }
  }

  private get rpcUrl(): string {
    return getNetworkConfig().rpcUrl;
  }

  private get networkPassphrase(): string {
    return getNetworkConfig().networkPassphrase;
  }

  private get contractId(): string {
    return getNetworkConfig().contractIds.niffyinsure;
  }

  private makeServer(): SorobanRpc.Server {
    const options: { allowHttp: boolean; headers?: Record<string, string> } = {
      allowHttp: this.rpcUrl.startsWith('http://'),
    };

    const requestId = this.requestIdService?.getRequestId();
    if (requestId) {
      options.headers = { 'x-request-id': requestId };
    }

    return new SorobanRpc.Server(this.rpcUrl, options as SorobanRpc.Server.Options);
  }

  static enumVariantToScVal(variant: string): xdr.ScVal {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
  }

  static stroopsToXlm(stroops: bigint): string {
    const whole = stroops / BigInt(10_000_000);
    const frac = stroops % BigInt(10_000_000);
    return `${whole}.${frac.toString().padStart(7, '0')}`;
  }

  private async loadAccount(
    server: SorobanRpc.Server,
    publicKey: string,
  ): Promise<Account> {
    try {
      return await server.getAccount(publicKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('404') ||
        msg.toLowerCase().includes('not found') ||
        msg.toLowerCase().includes('does not exist')
      ) {
        throw new BadRequestException({
          code: 'ACCOUNT_NOT_FOUND',
          message:
            `Account ${publicKey} does not exist on this network. ` +
            'Fund it with at least 1 XLM (testnet: use Friendbot).',
        });
      }
      if (
        msg.toLowerCase().includes('network') ||
        msg.toLowerCase().includes('passphrase')
      ) {
        throw new BadRequestException({
          code: 'WRONG_NETWORK',
          message:
            'The configured Soroban RPC is on a different network than expected. ' +
            'Check STELLAR_NETWORK_PASSPHRASE and SOROBAN_RPC_URL.',
        });
      }
      const requestId = this.requestIdService?.getRequestId();
      this.logger.error('RPC load account error', { msg, requestId });
      throw new ServiceUnavailableException({
        code: 'RPC_UNAVAILABLE',
        message: 'Could not reach the Soroban RPC endpoint. Try again shortly.',
      });
    }
  }

  /** Soroban `PolicyLookupKey` map encoding for `get_policies_batch`. */
  static encodePolicyLookupKey(holder: string, policyId: number): xdr.ScVal {
    return xdr.scvSortedMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('holder'),
        val: new Address(holder).toScVal(),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('policy_id'),
        val: nativeToScVal(policyId, { type: 'u32' }),
      }),
    ]);
  }

  private isPolicyBatchTooLargeSimulation(error: string): boolean {
    const e = error.toLowerCase();
    return (
      e.includes('policybatch') ||
      e.includes('policy_batch') ||
      // ContractError tag 50 = PolicyBatchTooLarge
      /\b50\b/.test(error)
    );
  }

  private isClaimBatchTooLargeSimulation(error: string): boolean {
    const e = error.toLowerCase();
    return (
      e.includes('claimbatch') ||
      e.includes('claim_batch') ||
      // ContractError tag 60 = ClaimBatchTooLarge
      /\b60\b/.test(error)
    );
  }

  private mapSimulationError(error: string): never {
    if (
      error.includes('WasmVm') ||
      error.includes('non-existent') ||
      error.includes('InvalidAction')
    ) {
      throw new ServiceUnavailableException({
        code: 'CONTRACT_NOT_DEPLOYED',
        message:
          'The smart contract function is not yet deployed on this network.',
      });
    }
    if (error.toLowerCase().includes('balance')) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'The account does not have enough XLM to cover fees.',
      });
    }
    throw new BadRequestException({ code: 'SIMULATION_FAILED', message: error });
  }

  /**
   * Simulate generate_premium(policy_type, region, age, risk_score) → i128.
   * Falls back to local computation if contract is not deployed.
   * Returns cached responses when circuit breaker is open.
   */
  async simulateGeneratePremium(args: {
    policyType: PolicyTypeEnum;
    region: RegionTierEnum;
    age: number;
    riskScore: number;
    sourceAccount: string;
  }): Promise<SimulatePremiumResult> {
    const cacheKey = JSON.stringify(args);
    const cached = this.quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.quoteCacheTtlMs) {
      this.logger.debug('Returning cached quote response');
      return cached.result as SimulatePremiumResult;
    }

    const simulateFn = async () => {
      const result = await this._simulateGeneratePremium(args);
      this.quoteCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    };

    try {
      return await this.trackRpc('simulate_generate_premium', async () =>
        (await this.circuitBreaker.fire(simulateFn)) as SimulatePremiumResult,
      );
    } catch (err) {
      if (this.circuitBreaker.opened && cached) {
        this.logger.debug('Soroban RPC circuit is open, returning stale cached quote');
        return cached.result as SimulatePremiumResult;
      }
      throw err;
    }
  }

  private async _simulateGeneratePremium(args: {
    policyType: PolicyTypeEnum;
    region: RegionTierEnum;
    age: number;
    riskScore: number;
    sourceAccount: string;
  }): Promise<SimulatePremiumResult> {
    const scArgs = [
      SorobanService.enumVariantToScVal(args.policyType),
      SorobanService.enumVariantToScVal(args.region),
      nativeToScVal(args.age, { type: 'u32' }),
      nativeToScVal(args.riskScore, { type: 'u32' }),
    ];

    const server = this.makeServer();
    const account = await this.loadAccount(server, args.sourceAccount);
    const contract = new Contract(this.contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('generate_premium', ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simulation)) {
      const local = SorobanService.computePremiumLocal(args);
      return {
        premiumStroops: local.toString(),
        premiumXlm: SorobanService.stroopsToXlm(local),
        minResourceFee: '0',
        source: 'local_fallback',
      };
    }

    const success = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const retval = success.result?.retval;
    let premiumStroops = BigInt(0);
    if (retval) {
      const native = scValToNative(retval);
      premiumStroops =
        typeof native === 'bigint' ? native : BigInt(String(native));
    }

    return {
      premiumStroops: premiumStroops.toString(),
      premiumXlm: SorobanService.stroopsToXlm(premiumStroops),
      minResourceFee: success.minResourceFee ?? '0',
      source: 'simulation',
    };
  }

  /**
   * Build unsigned initiate_policy transaction with simulation-derived footprints.
   * Argument ordering matches `contracts/niffyinsure/src/lib.rs` initiate_policy:
   * holder, policy_type, region, age_band, coverage_tier, safety_score,
   * base_amount, asset, beneficiary (optional payout address), deductible (optional i128).
   */
  async buildInitiatePolicyTransaction(args: {
    holder: string;
    policyType: PolicyTypeEnum;
    region: RegionTierEnum;
    ageBand: AgeBandEnum;
    coverageType: CoverageTierEnum;
    safetyScore: number;
    baseAmount: bigint;
    asset?: string;
    beneficiary?: string;
    deductible?: bigint | null;
  }): Promise<BuildTransactionResult> {
    return this.trackRpc('build_initiate_policy', () =>
      this._buildInitiatePolicyTransaction(args),
    );
  }

  private async _buildInitiatePolicyTransaction(args: {
    holder: string;
    policyType: PolicyTypeEnum;
    region: RegionTierEnum;
    ageBand: AgeBandEnum;
    coverageType: CoverageTierEnum;
    safetyScore: number;
    baseAmount: bigint;
    asset?: string;
    beneficiary?: string;
    deductible?: bigint | null;
  }): Promise<BuildTransactionResult> {
    const server = this.makeServer();
    const account = await this.loadAccount(server, args.holder);
    const ledgerInfo = await server.getLatestLedger();

    // Resolve asset: use caller-supplied address or fall back to the configured default token.
    const assetAddress = args.asset ?? getNetworkConfig().contractIds.defaultToken;

    const beneficiaryScv =
      args.beneficiary == null || args.beneficiary === ''
        ? nativeToScVal(null)
        : nativeToScVal(new Address(args.beneficiary), {
            type: 'option',
            innerType: 'address',
          } as { type: string; innerType: string });

    const deductibleScv =
      args.deductible == null || args.deductible === undefined
        ? nativeToScVal(null)
        : nativeToScVal(args.deductible, {
            type: 'option',
            innerType: 'i128',
          } as { type: string; innerType: string });

    const scArgs = [
      new Address(args.holder).toScVal(),
      SorobanService.enumVariantToScVal(args.policyType),
      SorobanService.enumVariantToScVal(args.region),
      SorobanService.enumVariantToScVal(args.ageBand),
      SorobanService.enumVariantToScVal(args.coverageType),
      nativeToScVal(args.safetyScore, { type: 'u32' }),
      nativeToScVal(args.baseAmount, { type: 'i128' }),
      new Address(assetAddress).toScVal(),
      beneficiaryScv,
      deductibleScv,
    ];

    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('initiate_policy', ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      this.mapSimulationError(err.error);
    }

    const successSim =
      simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const assembled = assembleTransaction(tx, successSim);
    const unsignedXdr = assembled.build().toEnvelope().toXDR('base64');

    const baseFee = BigInt(BASE_FEE);
    const resourceFee = BigInt(successSim.minResourceFee ?? '0');
    const totalFee = baseFee + resourceFee;

    const authRequirements: AuthRequirement[] = [];
    for (const authEntry of successSim.result?.auth ?? []) {
      const credentials = authEntry.credentials();
      if (
        credentials.switch().value ===
        xdr.SorobanCredentialsType.sorobanCredentialsAddress().value
      ) {
        const addrObj = credentials.address().address();
        const stellarAddr = Address.fromScAddress(addrObj);
        const isContract =
          addrObj.switch().value ===
          xdr.ScAddressType.scAddressTypeContract().value;
        authRequirements.push({ address: stellarAddr.toString(), isContract });
      }
    }

    if (!authRequirements.some((r) => r.address === args.holder)) {
      authRequirements.unshift({ address: args.holder, isContract: false });
    }

    return {
      unsignedXdr,
      minResourceFee: successSim.minResourceFee ?? '0',
      baseFee: BASE_FEE.toString(),
      totalEstimatedFee: totalFee.toString(),
      totalEstimatedFeeXlm: SorobanService.stroopsToXlm(totalFee),
      authRequirements,
      memoConvention:
        'NiffyInsure does not use memos for protocol correlation. ' +
        'policy_id is derived on-chain from the holder counter. ' +
        'Frontends may set an optional text memo (≤28 bytes) for UI session correlation.',
      currentLedger: ledgerInfo.sequence,
    };
  }

  /**
   * Build unsigned file_claim transaction.
   * Signature: file_claim(holder, policy_id, amount, details, evidence)
   * Each evidence item: URL + 32-byte SHA-256 hex (from IPFS proxy / client).
   */
  async buildFileClaimTransaction(args: {
    holder: string;
    policyId: number;
    amount: bigint;
    details: string;
    evidence: ClaimEvidenceInput[];
  }): Promise<BuildTransactionResult> {
    return this.trackRpc('build_file_claim', () =>
      this._buildFileClaimTransaction(args),
    );
  }

  private async _buildFileClaimTransaction(args: {
    holder: string;
    policyId: number;
    amount: bigint;
    details: string;
    evidence: ClaimEvidenceInput[];
  }): Promise<BuildTransactionResult> {
    const server = this.makeServer();
    const account = await this.loadAccount(server, args.holder);
    const ledgerInfo = await server.getLatestLedger();

    const scArgs = [
      new Address(args.holder).toScVal(),
      nativeToScVal(args.policyId, { type: 'u32' }),
      nativeToScVal(args.amount, { type: 'i128' }),
      nativeToScVal(args.details, { type: 'string' }),
      claimEvidenceVecToScVal(args.evidence),
    ];

    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('file_claim', ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      this.mapSimulationError(err.error);
    }

    const successSim =
      simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const assembled = assembleTransaction(tx, successSim);
    const unsignedXdr = assembled.build().toEnvelope().toXDR('base64');

    const baseFee = BigInt(BASE_FEE);
    const resourceFee = BigInt(successSim.minResourceFee ?? '0');
    const totalFee = baseFee + resourceFee;

    const authRequirements: AuthRequirement[] = [];
    for (const authEntry of successSim.result?.auth ?? []) {
      const credentials = authEntry.credentials();
      if (
        credentials.switch().value ===
        xdr.SorobanCredentialsType.sorobanCredentialsAddress().value
      ) {
        const addrObj = credentials.address().address();
        const stellarAddr = Address.fromScAddress(addrObj);
        const isContract =
          addrObj.switch().value ===
          xdr.ScAddressType.scAddressTypeContract().value;
        authRequirements.push({ address: stellarAddr.toString(), isContract });
      }
    }

    if (!authRequirements.some((r) => r.address === args.holder)) {
      authRequirements.unshift({ address: args.holder, isContract: false });
    }

    return {
      unsignedXdr,
      minResourceFee: successSim.minResourceFee ?? '0',
      baseFee: BASE_FEE.toString(),
      totalEstimatedFee: totalFee.toString(),
      totalEstimatedFeeXlm: SorobanService.stroopsToXlm(totalFee),
      authRequirements,
      memoConvention:
        'NiffyInsure does not use memos for protocol correlation. ' +
        'Claim details are embedded in the contract call.',
      currentLedger: ledgerInfo.sequence,
    };
  }

  /**
   * Submit a signed transaction to the Soroban RPC.
   * Expects base64-encoded XDR (envelope).
   * When circuit is open, queue the transaction for retry instead of failing immediately.
   */
  async submitTransaction(transactionXdr: string): Promise<SorobanRpc.Api.SendTransactionResponse> {
    const submitFn = async () => {
      const server = this.makeServer();
      const tx = TransactionBuilder.fromXDR(transactionXdr, this.networkPassphrase);
      try {
        const response = await server.sendTransaction(tx);
        if (response.status === 'ERROR') {
          throw new BadRequestException({
            code: 'TRANSACTION_REJECTED',
            message: 'The transaction was rejected by the network.',
            details: response.errorResult,
          });
        }
        return response;
      } catch (err) {
        const requestId = this.requestIdService?.getRequestId();
        this.logger.error('Transaction submission error', { err, requestId });
        throw new ServiceUnavailableException({
          code: 'SUBMISSION_FAILED',
          message: 'Failed to submit transaction to the network.',
        });
      }
    };

    try {
      return await this.trackRpc('send_transaction', async () =>
        (await this.circuitBreaker.fire(submitFn)) as SorobanRpc.Api.SendTransactionResponse,
      );
    } catch (err) {
      if (this.circuitBreaker.opened) {
        this.logger.debug('Soroban RPC circuit is open, queuing transaction for retry');
        this.pendingSubmissions.push({
          transactionXdr,
          timestamp: Date.now(),
        });
        return {
          status: 'PENDING',
          hash: '',
          errorResult: 'Transaction queued for retry when RPC recovers',
        } as unknown as SorobanRpc.Api.SendTransactionResponse;
      }
      throw err;
    }
  }

  async processPendingSubmissions(): Promise<void> {
    if (this.pendingSubmissions.length === 0 || this.circuitBreaker.opened) {
      return;
    }

    const submissions = [...this.pendingSubmissions];
    this.pendingSubmissions = [];

    for (const submission of submissions) {
      try {
        await this.submitTransaction(submission.transactionXdr);
        this.logger.debug('Processed pending transaction submission');
      } catch (err) {
        this.logger.error('Failed to process pending submission, requeuing', err);
        this.pendingSubmissions.push(submission);
      }
    }
  }

  /**
   * Fetch events for the configured contract ID within a ledger range.
   */
  async getEvents(startLedger: number, limit = 50): Promise<SorobanRpc.Api.GetEventsResponse> {
    return this.trackRpc('get_events', async () => {
      const server = this.makeServer();
      return server.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [this.contractId],
        },
      ],
      limit,
      });
    });
  }

  /**
   * Fetch the latest ledger sequence from the network.
   */
  async getLatestLedger(): Promise<number> {
    return this.trackRpc('get_latest_ledger', async () => {
      const server = this.makeServer();
      const info = await server.getLatestLedger();
      return info.sequence;
    });
  }

  async tryEmitClaimStatusOverrideEvent(args: {
    sourceAccount?: string;
    claimId: number;
    oldStatus: string;
    newStatus: string;
    reason: string;
    actor: string;
  }): Promise<void> {
    await this.trackRpc('emit_claim_override_event', async () => {
      const sourceAccount =
        args.sourceAccount ??
        this.configService.get<string>('SOROBAN_ADMIN_PUBLIC_KEY') ??
        this.configService.get<string>('ADMIN_PUBLIC_KEY');
      if (!sourceAccount) {
        throw new BadRequestException({
          code: 'ADMIN_SOURCE_ACCOUNT_REQUIRED',
          message: 'No admin source account configured for Soroban override event emission.',
        });
      }

      const server = this.makeServer();
      const account = await this.loadAccount(server, sourceAccount);
      const contract = new Contract(this.contractId);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'admin_emit_claim_status_override',
            nativeToScVal(args.claimId, { type: 'u64' }),
            nativeToScVal(args.oldStatus, { type: 'string' }),
            nativeToScVal(args.newStatus, { type: 'string' }),
            nativeToScVal(args.reason, { type: 'string' }),
            nativeToScVal(args.actor, { type: 'string' }),
          ),
        )
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (Api.isSimulationError(simulation)) {
        const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
        throw new BadRequestException({ code: 'OVERRIDE_EVENT_SIMULATION_FAILED', message: err.error });
      }
    });
  }

  /**
   * Simulate `get_policies_batch(Vec<PolicyLookupKey>)` → `Vec<Option<Policy>>`.
   * One RPC round-trip for dashboard bulk loads; order matches `keys`.
   */
  async simulateGetPoliciesBatch(args: {
    keys: { holder: string; policy_id: number }[];
    sourceAccount?: string;
  }): Promise<(Record<string, unknown> | null)[]> {
    return this.trackRpc('simulate_get_policies_batch', () =>
      this._simulateGetPoliciesBatch(args),
    );
  }

  private async _simulateGetPoliciesBatch(args: {
    keys: { holder: string; policy_id: number }[];
    sourceAccount?: string;
  }): Promise<(Record<string, unknown> | null)[]> {
    if (!this.contractId) {
      throw new BadRequestException({
        code: 'CONTRACT_NOT_INITIALIZED',
        message:
          'CONTRACT_ID is not configured on the server; cannot simulate get_policies_batch.',
      });
    }
    if (args.keys.length > POLICY_BATCH_GET_MAX) {
      throw new BadRequestException({
        code: 'POLICY_BATCH_TOO_LARGE',
        message: `At most ${POLICY_BATCH_GET_MAX} (holder, policy_id) pairs per batch (on-chain POLICY_BATCH_GET_MAX).`,
      });
    }
    if (args.keys.length === 0) {
      return [];
    }

    const source = args.sourceAccount ?? args.keys[0].holder;
    const server = this.makeServer();
    const account = await this.loadAccount(server, source);
    const contract = new Contract(this.contractId);
    const keysScVal = xdr.ScVal.scvVec(
      args.keys.map((k) =>
        SorobanService.encodePolicyLookupKey(k.holder, k.policy_id),
      ),
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_policies_batch', keysScVal))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      if (this.isPolicyBatchTooLargeSimulation(err.error)) {
        throw new BadRequestException({
          code: 'POLICY_BATCH_TOO_LARGE',
          message: `At most ${POLICY_BATCH_GET_MAX} (holder, policy_id) pairs per batch (on-chain POLICY_BATCH_GET_MAX).`,
        });
      }
      this.mapSimulationError(err.error);
    }

    const success =
      simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const retval = success.result?.retval;
    if (!retval) {
      return [];
    }

    const native = scValToNative(retval) as unknown;
    if (!Array.isArray(native)) {
      throw new BadRequestException({
        code: 'SIMULATION_DECODE_FAILED',
        message: 'get_policies_batch: unexpected return shape from simulation.',
      });
    }

    return native.map((entry: unknown) => {
      if (entry === null || entry === undefined) {
        return null;
      }
      if (typeof entry === 'object' && entry !== null) {
        return entry as Record<string, unknown>;
      }
      return null;
    });
  }

  /**
   * Simulate `get_claims_batch(Vec<u64>)` -> `Vec<Option<Claim>>`.
   * One RPC round-trip for claims-board bulk dashboard loads; order matches `ids`.
   */
  async simulateGetClaimsBatch(args: {
    ids: number[];
    sourceAccount?: string;
  }): Promise<(Record<string, unknown> | null)[]> {
    return this.trackRpc('simulate_get_claims_batch', () =>
      this._simulateGetClaimsBatch(args),
    );
  }

  private async _simulateGetClaimsBatch(args: {
    ids: number[];
    sourceAccount?: string;
  }): Promise<(Record<string, unknown> | null)[]> {
    if (!this.contractId) {
      throw new BadRequestException({
        code: 'CONTRACT_NOT_INITIALIZED',
        message:
          'CONTRACT_ID is not configured on the server; cannot simulate get_claims_batch.',
      });
    }
    if (args.ids.length > CLAIM_BATCH_GET_MAX) {
      throw new BadRequestException({
        code: 'CLAIM_BATCH_TOO_LARGE',
        message: `At most ${CLAIM_BATCH_GET_MAX} claim IDs per batch (on-chain CLAIM_BATCH_GET_MAX).`,
      });
    }
    if (args.ids.length === 0) {
      return [];
    }
    if (!args.sourceAccount) {
      throw new BadRequestException({
        code: 'SOURCE_ACCOUNT_REQUIRED',
        message: 'source_account is required when simulating a non-empty claim batch.',
      });
    }

    const server = this.makeServer();
    const account = await this.loadAccount(server, args.sourceAccount);
    const contract = new Contract(this.contractId);
    const idsScVal = xdr.ScVal.scvVec(
      args.ids.map((id) => nativeToScVal(id, { type: 'u64' })),
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_claims_batch', idsScVal))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      if (this.isClaimBatchTooLargeSimulation(err.error)) {
        throw new BadRequestException({
          code: 'CLAIM_BATCH_TOO_LARGE',
          message: `At most ${CLAIM_BATCH_GET_MAX} claim IDs per batch (on-chain CLAIM_BATCH_GET_MAX).`,
        });
      }
      this.mapSimulationError(err.error);
    }

    const success =
      simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const retval = success.result?.retval;
    if (!retval) {
      return [];
    }

    const native = scValToNative(retval) as unknown;
    if (!Array.isArray(native)) {
      throw new BadRequestException({
        code: 'SIMULATION_DECODE_FAILED',
        message: 'get_claims_batch: unexpected return shape from simulation.',
      });
    }

    return native.map((entry: unknown) => {
      if (entry === null || entry === undefined) {
        return null;
      }
      if (typeof entry === 'object' && entry !== null) {
        return entry as Record<string, unknown>;
      }
      return null;
    });
  }

  /**
   * Build unsigned renew_policy transaction with simulation-derived footprints.
   *
   * Contract signature (planned):
   *   renew_policy(holder, policy_id, policy_type, region, age, risk_score,
   *                new_start_ledger, new_end_ledger, asset)
   *
   * The premium is recalculated deterministically using the same on-chain formula
   * as initiate_policy. The caller must supply age and risk_score matching the
   * original policy to prevent premium manipulation.
   *
   * REPLAY PROTECTION:
   *   - new_start_ledger = previous endLedger + 1 (enforced by caller, validated on-chain).
   *   - The contract rejects duplicate renewals for the same policy term.
   *   - Sequence number is fetched live from RPC — never cached.
   *
   * PAYMENT:
   *   The contract collects the renewal premium via token_client.transfer() using
   *   the same SEP-41 asset as the original policy. The asset address is passed
   *   explicitly and validated against the contract's allowlist on-chain.
   */
  async buildRenewPolicyTransaction(args: {
    holder: string;
    policyId: number;
    policyType: PolicyTypeEnum;
    region: RegionTierEnum;
    age: number;
    riskScore: number;
    asset?: string;
    newStartLedger: number;
    newEndLedger: number;
  }): Promise<BuildRenewalTransactionResult> {
    const server = this.makeServer();
    const account = await this.loadAccount(server, args.holder);
    const ledgerInfo = await server.getLatestLedger();

    const assetAddress =
      args.asset ?? getNetworkConfig().contractIds.defaultToken;

    // Simulate premium first to include it in the response for UI display.
    const premiumResult = await this.simulateGeneratePremium({
      policyType: args.policyType,
      region: args.region,
      age: args.age,
      riskScore: args.riskScore,
      sourceAccount: args.holder,
    });

    const scArgs = [
      new Address(args.holder).toScVal(),
      nativeToScVal(args.policyId, { type: 'u32' }),
      SorobanService.enumVariantToScVal(args.policyType),
      SorobanService.enumVariantToScVal(args.region),
      nativeToScVal(args.age, { type: 'u32' }),
      nativeToScVal(args.riskScore, { type: 'u32' }),
      nativeToScVal(args.newStartLedger, { type: 'u32' }),
      nativeToScVal(args.newEndLedger, { type: 'u32' }),
      new Address(assetAddress).toScVal(),
    ];

    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('renew_policy', ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      this.mapSimulationError(err.error);
    }

    const successSim = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const assembled = assembleTransaction(tx, successSim);
    const unsignedXdr = assembled.build().toEnvelope().toXDR('base64');

    const baseFee = BigInt(BASE_FEE);
    const resourceFee = BigInt(successSim.minResourceFee ?? '0');
    const totalFee = baseFee + resourceFee;

    const authRequirements: AuthRequirement[] = [];
    for (const authEntry of successSim.result?.auth ?? []) {
      const credentials = authEntry.credentials();
      if (
        credentials.switch().value ===
        xdr.SorobanCredentialsType.sorobanCredentialsAddress().value
      ) {
        const addrObj = credentials.address().address();
        const stellarAddr = Address.fromScAddress(addrObj);
        const isContract =
          addrObj.switch().value ===
          xdr.ScAddressType.scAddressTypeContract().value;
        authRequirements.push({ address: stellarAddr.toString(), isContract });
      }
    }

    if (!authRequirements.some((r) => r.address === args.holder)) {
      authRequirements.unshift({ address: args.holder, isContract: false });
    }

    return {
      unsignedXdr,
      minResourceFee: successSim.minResourceFee ?? '0',
      baseFee: BASE_FEE.toString(),
      totalEstimatedFee: totalFee.toString(),
      totalEstimatedFeeXlm: SorobanService.stroopsToXlm(totalFee),
      authRequirements,
      memoConvention:
        'NiffyInsure does not use memos for protocol correlation. ' +
        'policy_id is embedded in the renew_policy contract call arguments. ' +
        'Frontends may set an optional text memo (≤28 bytes) for UI session correlation.',
      currentLedger: ledgerInfo.sequence,
      premiumStroops: premiumResult.premiumStroops,
      premiumXlm: premiumResult.premiumXlm,
      premiumSource: premiumResult.source,
    };
  }

  /**
   * Simulate `get_treasury_balance()` → i128 (contract-held default token balance).
   * Used by scheduled solvency checks; throws on simulation/RPC failure (no silent fallback).
   */
  async simulateGetTreasuryBalance(args: {
    sourceAccount: string;
  }): Promise<{ balanceStroops: string; minResourceFee: string }> {
    return this.trackRpc('simulate_get_treasury_balance', () =>
      this._simulateGetTreasuryBalance(args),
    );
  }

  private async _simulateGetTreasuryBalance(args: {
    sourceAccount: string;
  }): Promise<{ balanceStroops: string; minResourceFee: string }> {
    const cid = this.contractId;
    if (!cid) {
      throw new BadRequestException({
        code: 'CONTRACT_NOT_CONFIGURED',
        message: 'CONTRACT_ID is not set.',
      });
    }

    const server = this.makeServer();
    const account = await this.loadAccount(server, args.sourceAccount);
    const contract = new Contract(cid);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_treasury_balance'))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      const errMsg =
        typeof simulation.error === 'string'
          ? simulation.error
          : JSON.stringify(simulation.error ?? {});
      this.mapSimulationError(errMsg);
    }

    const success = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const retval = success.result?.retval;
    let balance = BigInt(0);
    if (retval) {
      const native = scValToNative(retval);
      balance =
        typeof native === 'bigint' ? native : BigInt(String(native));
    }

    return {
      balanceStroops: balance.toString(),
      minResourceFee: success.minResourceFee ?? '0',
    };
  }

  /**
   * Keeper: invoke on-chain `finalize_claim` for an expired claim.
   * Requires CLAIM_KEEPER_SECRET_KEY and a funded source account.
   */
  async finalizeClaim(claimId: number): Promise<FinalizeClaimResult> {
    return this.trackRpc('finalize_claim', () => this._finalizeClaim(claimId));
  }

  private async _finalizeClaim(claimId: number): Promise<FinalizeClaimResult> {
    if (!this.contractId) {
      throw new BadRequestException({
        code: 'CONTRACT_NOT_INITIALIZED',
        message: 'CONTRACT_ID is not configured; cannot finalize claims.',
      });
    }

    const source =
      this.configService.get<string>('CLAIM_KEEPER_SOURCE_ACCOUNT') ||
      this.configService.get<string>('SOLVENCY_SIMULATION_SOURCE_ACCOUNT');
    const secret = this.configService.get<string>('CLAIM_KEEPER_SECRET_KEY');

    if (!source || !secret) {
      throw new ServiceUnavailableException({
        code: 'KEEPER_NOT_CONFIGURED',
        message:
          'Claim keeper is not configured (CLAIM_KEEPER_SOURCE_ACCOUNT / CLAIM_KEEPER_SECRET_KEY).',
      });
    }

    const server = this.makeServer();
    const account = await this.loadAccount(server, source);
    const contract = new Contract(this.contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call('finalize_claim', nativeToScVal(claimId, { type: 'u64' })),
      )
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      this.mapSimulationError(err.error);
    }

    const successSim = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const assembled = assembleTransaction(tx, successSim).build();
    const keypair = Keypair.fromSecret(secret);
    assembled.sign(keypair);

    const sendResponse = await server.sendTransaction(assembled);
    if (sendResponse.status === 'ERROR') {
      throw new BadRequestException({
        code: 'FINALIZE_CLAIM_REJECTED',
        message: 'finalize_claim transaction was rejected by the network.',
        details: sendResponse.errorResult,
      });
    }

    const txHash = sendResponse.hash;
    let ledger = 0;
    let onChainStatus = 'Unknown';

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const txResponse = await server.getTransaction(txHash);
      if (txResponse.status === 'SUCCESS') {
        ledger = txResponse.ledger;
        const retval = txResponse.returnValue;
        if (retval) {
          const native = scValToNative(retval);
          onChainStatus =
            typeof native === 'object' && native !== null && 'tag' in (native as object)
              ? String((native as { tag?: string }).tag)
              : String(native);
        }
        break;
      }
      if (txResponse.status === 'FAILED') {
        throw new BadRequestException({
          code: 'FINALIZE_CLAIM_FAILED',
          message: 'finalize_claim transaction failed on-chain.',
        });
      }
    }

    if (!ledger) {
      throw new ServiceUnavailableException({
        code: 'FINALIZE_CLAIM_TIMEOUT',
        message: `Timed out waiting for finalize_claim confirmation (hash=${txHash}).`,
      });
    }

    return { txHash, ledger, onChainStatus };
  }

  // ── #928 Voting Duration ───────────────────────────────────────────────────

  async simulateGetVotingDuration({ sourceAccount }: { sourceAccount: string }): Promise<VotingDuration> {
    return this.trackRpc('simulateGetVotingDuration', async () => {
      const server = this.makeServer();
      const account = await this.loadAccount(server, sourceAccount);
      const contract = new Contract(this.contractId);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_voting_duration_ledgers'))
        .setTimeout(30)
        .build();
      const result = await server.simulateTransaction(tx);
      if (Api.isSimulationError(result)) {
        throw new BadRequestException({ code: 'SIMULATION_FAILED', message: result.error });
      }
      const raw = result.result?.retval;
      if (!raw) throw new BadRequestException({ code: 'SIMULATION_EMPTY', message: 'Empty simulation result' });
      const ledgers = Number(scValToNative(raw));
      return { votingDurationLedgers: ledgers };
    });
  }

  // ── #929 Evidence limits ─────────────────────────────────────────────────

  async simulateGetEvidenceLimits({ sourceAccount }: { sourceAccount: string }): Promise<EvidenceLimits> {
    return this.trackRpc('simulateGetEvidenceLimits', async () => {
      const minEvidenceCount = await this.simulateReadU32(sourceAccount, 'get_min_evidence_count');
      const maxEvidenceCount = await this.simulateReadU32(sourceAccount, 'get_max_evidence_count');
      return { minEvidenceCount, maxEvidenceCount };
    });
  }

  private async simulateReadU32(sourceAccount: string, method: string): Promise<number> {
    const server = this.makeServer();
    const account = await this.loadAccount(server, sourceAccount);
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method))
      .setTimeout(30)
      .build();
    const result = await server.simulateTransaction(tx);
    if (Api.isSimulationError(result)) {
      throw new BadRequestException({ code: 'SIMULATION_FAILED', message: result.error });
    }
    const raw = result.result?.retval;
    if (!raw) throw new BadRequestException({ code: 'SIMULATION_EMPTY', message: 'Empty simulation result' });
    return Number(scValToNative(raw));
  }

  async invokeAdminSetEvidenceLimits({ min, max }: { min: number; max: number }): Promise<KeeperActionResult> {
    return this.trackRpc('invokeAdminSetEvidenceLimits', async () => {
      const contract = new Contract(this.contractId);
      await this.submitKeeperTx(
        contract.call('admin_set_min_evidence_count', nativeToScVal(min, { type: 'u32' })),
        'admin_set_min_evidence_count',
      );
      return this.submitKeeperTx(
        contract.call('admin_set_max_evidence_count', nativeToScVal(max, { type: 'u32' })),
        'admin_set_max_evidence_count',
      );
    });
  }

  private async submitKeeperTx(
    operation: xdr.Operation,
    label: string,
  ): Promise<KeeperActionResult> {
    const keeperPublic = this.configService.get<string>('CLAIM_KEEPER_SOURCE_ACCOUNT');
    const keeperSecret = this.configService.get<string>('CLAIM_KEEPER_SECRET_KEY');
    if (!keeperPublic || !keeperSecret) {
      throw new BadRequestException({ code: 'KEEPER_NOT_CONFIGURED', message: `Keeper account not configured (${label})` });
    }
    const keypair = Keypair.fromSecret(keeperSecret);
    const server = this.makeServer();
    const account = await this.loadAccount(server, keeperPublic);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();
    const simResult = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simResult)) {
      throw new BadRequestException({ code: 'SIMULATION_FAILED', message: simResult.error });
    }
    const assembled = assembleTransaction(tx, simResult).build();
    assembled.sign(keypair);
    const send = await server.sendTransaction(assembled);
    if (send.status === 'ERROR') {
      throw new BadRequestException({ code: 'TX_SEND_FAILED', message: JSON.stringify(send.errorResult) });
    }
    const deadline = Date.now() + 30_000;
    let poll = await server.getTransaction(send.hash);
    while (poll.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 2_000));
      poll = await server.getTransaction(send.hash);
    }
    if (poll.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new BadRequestException({ code: 'TX_FAILED', message: `${label} transaction status: ${poll.status}` });
    }
    return { txHash: send.hash, ledger: (poll as SorobanRpc.Api.GetSuccessfulTransactionResponse).ledger };
  }

  async invokeAdminSetVotingDuration({ ledgers }: { ledgers: number }): Promise<KeeperActionResult> {
    return this.trackRpc('invokeAdminSetVotingDuration', async () => {
      const contract = new Contract(this.contractId);
      const operation = contract.call(
        'admin_set_vote_duration_ledgers',
        nativeToScVal(ledgers, { type: 'u32' }),
      );
      return this.submitKeeperTx(operation, 'admin_set_vote_duration_ledgers');
    });
  }

  /**
   * Build unsigned batch_register_voter transaction.
   * Signature: batch_register_voter(admin, voters: Vec<Address>)
   */
  async buildBatchRegisterVotersTransaction(args: {
    admin: string;
    voters: string[];
  }): Promise<BuildTransactionResult> {
    return this.trackRpc('build_batch_register_voters', () =>
      this._buildBatchRegisterVotersTransaction(args),
    );
  }

  private async _buildBatchRegisterVotersTransaction(args: {
    admin: string;
    voters: string[];
  }): Promise<BuildTransactionResult> {
    const server = this.makeServer();
    const account = await this.loadAccount(server, args.admin);
    const ledgerInfo = await server.getLatestLedger();

    const voterScVals = args.voters.map(v => new Address(v).toScVal());
    const scArgs = [
      new Address(args.admin).toScVal(),
      nativeToScVal(voterScVals, { type: 'vec' }),
    ];

    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('batch_register_voter', ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      this.mapSimulationError(err.error);
    }

    const successSim = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const assembled = assembleTransaction(tx, successSim);
    const unsignedXdr = assembled.build().toEnvelope().toXDR('base64');

    const baseFee = BigInt(BASE_FEE);
    const resourceFee = BigInt(successSim.minResourceFee ?? '0');
    const totalFee = baseFee + resourceFee;

    const authRequirements: AuthRequirement[] = [];
    for (const authEntry of successSim.result?.auth ?? []) {
      const credentials = authEntry.credentials();
      if (credentials.switch().value === xdr.SorobanCredentialsType.sorobanCredentialsAddress().value) {
        const addrObj = credentials.address().address();
        const stellarAddr = Address.fromScAddress(addrObj);
        const isContract = addrObj.switch().value === xdr.ScAddressType.scAddressTypeContract().value;
        authRequirements.push({ address: stellarAddr.toString(), isContract });
      }
    }

    return {
      unsignedXdr,
      minResourceFee: successSim.minResourceFee ?? '0',
      baseFee: BASE_FEE.toString(),
      totalEstimatedFee: totalFee.toString(),
      totalEstimatedFeeXlm: SorobanService.stroopsToXlm(totalFee),
      authRequirements,
      memoConvention: 'Batch voter registration – no memos used for protocol correlation.',
      currentLedger: ledgerInfo.sequence,
    };
  }

  /**
   * Build unsigned remove_voter transaction.
   * Signature: remove_voter(admin, voter: Address)
   */
  async buildRemoveVoterTransaction(args: {
    admin: string;
    voter: string;
  }): Promise<BuildTransactionResult> {
    return this.trackRpc('build_remove_voter', () =>
      this._buildRemoveVoterTransaction(args),
    );
  }

  private async _buildRemoveVoterTransaction(args: {
    admin: string;
    voter: string;
  }): Promise<BuildTransactionResult> {
    const server = this.makeServer();
    const account = await this.loadAccount(server, args.admin);
    const ledgerInfo = await server.getLatestLedger();

    const scArgs = [
      new Address(args.admin).toScVal(),
      new Address(args.voter).toScVal(),
    ];

    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('remove_voter', ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      this.mapSimulationError(err.error);
    }

    const successSim = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const assembled = assembleTransaction(tx, successSim);
    const unsignedXdr = assembled.build().toEnvelope().toXDR('base64');

    const baseFee = BigInt(BASE_FEE);
    const resourceFee = BigInt(successSim.minResourceFee ?? '0');
    const totalFee = baseFee + resourceFee;

    const authRequirements: AuthRequirement[] = [];
    for (const authEntry of successSim.result?.auth ?? []) {
      const credentials = authEntry.credentials();
      if (credentials.switch().value === xdr.SorobanCredentialsType.sorobanCredentialsAddress().value) {
        const addrObj = credentials.address().address();
        const stellarAddr = Address.fromScAddress(addrObj);
        const isContract = addrObj.switch().value === xdr.ScAddressType.scAddressTypeContract().value;
        authRequirements.push({ address: stellarAddr.toString(), isContract });
      }
    }

    return {
      unsignedXdr,
      minResourceFee: successSim.minResourceFee ?? '0',
      baseFee: BASE_FEE.toString(),
      totalEstimatedFee: totalFee.toString(),
      totalEstimatedFeeXlm: SorobanService.stroopsToXlm(totalFee),
      authRequirements,
      memoConvention: 'Voter removal – no memos used for protocol correlation.',
      currentLedger: ledgerInfo.sequence,
    };
  }

  /**
   * Build unsigned admin_set_quorum_bps transaction.
   * Signature: admin_set_quorum_bps(admin, bps: u32)
   */
  async buildSetQuorumBpsTransaction(args: {
    admin: string;
    bps: number;
  }): Promise<BuildTransactionResult> {
    return this.trackRpc('build_set_quorum_bps', () =>
      this._buildSetQuorumBpsTransaction(args),
    );
  }

  private async _buildSetQuorumBpsTransaction(args: {
    admin: string;
    bps: number;
  }): Promise<BuildTransactionResult> {
    const server = this.makeServer();
    const account = await this.loadAccount(server, args.admin);
    const ledgerInfo = await server.getLatestLedger();

    const scArgs = [
      new Address(args.admin).toScVal(),
      nativeToScVal(args.bps, { type: 'u32' }),
    ];

    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('admin_set_quorum_bps', ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      this.mapSimulationError(err.error);
    }

    const successSim = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const assembled = assembleTransaction(tx, successSim);
    const unsignedXdr = assembled.build().toEnvelope().toXDR('base64');

    const baseFee = BigInt(BASE_FEE);
    const resourceFee = BigInt(successSim.minResourceFee ?? '0');
    const totalFee = baseFee + resourceFee;

    const authRequirements: AuthRequirement[] = [];
    for (const authEntry of successSim.result?.auth ?? []) {
      const credentials = authEntry.credentials();
      if (credentials.switch().value === xdr.SorobanCredentialsType.sorobanCredentialsAddress().value) {
        const addrObj = credentials.address().address();
        const stellarAddr = Address.fromScAddress(addrObj);
        const isContract = addrObj.switch().value === xdr.ScAddressType.scAddressTypeContract().value;
        authRequirements.push({ address: stellarAddr.toString(), isContract });
      }
    }

    return {
      unsignedXdr,
      minResourceFee: successSim.minResourceFee ?? '0',
      baseFee: BASE_FEE.toString(),
      totalEstimatedFee: totalFee.toString(),
      totalEstimatedFeeXlm: SorobanService.stroopsToXlm(totalFee),
      authRequirements,
      memoConvention: 'Quorum update – no memos used for protocol correlation.',
      currentLedger: ledgerInfo.sequence,
    };
  }

  /**
   * Simulate `get_quorum_bps()` read-only entrypoint to retrieve current quorum basis points.
   */
  async simulateGetQuorumBps(): Promise<number> {
    return this.trackRpc('simulate_get_quorum_bps', () => this._simulateGetQuorumBps());
  }

  private async _simulateGetQuorumBps(): Promise<number> {
    if (!this.contractId) {
      const defaultBps = this.configService.get<number>('DEFAULT_QUORUM_BPS', 5000);
      return defaultBps;
    }

    const server = this.makeServer();
    const source = this.configService.get<string>('SOLVENCY_SIMULATION_SOURCE_ACCOUNT')
      ?? this.configService.get<string>('SOROBAN_ADMIN_PUBLIC_KEY');
    if (!source) {
      return this.configService.get<number>('DEFAULT_QUORUM_BPS', 5000);
    }

    const account = await this.loadAccount(server, source);
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_quorum_bps'))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (Api.isSimulationError(simulation)) {
      return this.configService.get<number>('DEFAULT_QUORUM_BPS', 5000);
    }

    const success = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const retval = success.result?.retval;
    if (retval) {
      const native = scValToNative(retval);
      return typeof native === 'number' ? native : Number(native);
    }
    return this.configService.get<number>('DEFAULT_QUORUM_BPS', 5000);
  }

  /**
   * TypeScript mirror of compute_premium in contracts/niffyinsure/src/premium.rs.
   * Uses BigInt to match Rust i128 integer arithmetic exactly.
   */
  static computePremiumLocal(args: {
    policyType: PolicyTypeEnum;
    region: RegionTierEnum;
    age: number;
    riskScore: number;
  }): bigint {
    const BASE = BigInt(10_000_000);
    const typeFactor: Record<PolicyTypeEnum, bigint> = {
      Auto: BigInt(15),
      Health: BigInt(20),
      Property: BigInt(10),
    };
    const regionFactor: Record<RegionTierEnum, bigint> = {
      Low: BigInt(8),
      Medium: BigInt(10),
      High: BigInt(14),
    };
    const ageF =
      args.age < 25 ? BigInt(15) : args.age > 60 ? BigInt(13) : BigInt(10);
    const sum =
      typeFactor[args.policyType] +
      regionFactor[args.region] +
      ageF +
      BigInt(args.riskScore);
    return (BASE * sum) / BigInt(10);
  }
}
