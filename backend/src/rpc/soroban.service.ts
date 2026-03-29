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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service';
import { POLICY_BATCH_GET_MAX } from '../chain/chain.constants';
import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  Address,
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

@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

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
    return this.configService.get<string>(
      'SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
  }

  private get networkPassphrase(): string {
    return this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      'Test SDF Network ; September 2015',
    );
  }

  private get contractId(): string {
    return this.configService.get<string>('CONTRACT_ID', '');
  }

  private makeServer(): SorobanRpc.Server {
    return new SorobanRpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith('http://'),
    });
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
      this.logger.error('RPC load account error', msg);
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
      // ContractError tag 49 = PolicyBatchTooLarge (niffyinsure validate::Error)
      /\b49\b/.test(error)
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
   */
  async simulateGeneratePremium(args: {
    policyType: PolicyTypeEnum;
    region: RegionTierEnum;
    age: number;
    riskScore: number;
    sourceAccount: string;
  }): Promise<SimulatePremiumResult> {
    return this.trackRpc('simulate_generate_premium', () =>
      this._simulateGeneratePremium(args),
    );
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
    const assetAddress = args.asset ?? this.configService.get<string>('DEFAULT_TOKEN_CONTRACT_ID', '');

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
   */
  async submitTransaction(transactionXdr: string): Promise<SorobanRpc.Api.SendTransactionResponse> {
    return this.trackRpc('send_transaction', async () => {
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
        this.logger.error('Transaction submission error', err);
        throw new ServiceUnavailableException({
          code: 'SUBMISSION_FAILED',
          message: 'Failed to submit transaction to the network.',
        });
      }
    });
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
      args.asset ?? this.configService.get<string>('DEFAULT_TOKEN_CONTRACT_ID', '');

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
