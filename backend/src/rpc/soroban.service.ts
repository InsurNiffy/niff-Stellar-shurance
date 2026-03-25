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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  BASE_FEE,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  Address,
} from '@stellar/stellar-sdk';

const { Api, assembleTransaction } = SorobanRpc;

export type PolicyTypeEnum = 'Auto' | 'Health' | 'Property';
export type RegionTierEnum = 'Low' | 'Medium' | 'High';

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

@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);

  constructor(private readonly configService: ConfigService) {}

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

  private static enumVariantToScVal(variant: string): xdr.ScVal {
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
   * Argument ordering: holder, policy_type, region, coverage, age, risk_score,
   *                    start_ledger, end_ledger
   *
   * Multisig: authRequirements lists all addresses that must sign Soroban auth
   * entries before submission. Display these before the wallet popup.
   */
  async buildInitiatePolicyTransaction(args: {
    holder: string;
    policyType: PolicyTypeEnum;
    region: RegionTierEnum;
    coverage: bigint;
    age: number;
    riskScore: number;
    startLedger?: number;
    durationLedgers?: number;
  }): Promise<BuildTransactionResult> {
    const server = this.makeServer();
    const account = await this.loadAccount(server, args.holder);
    const ledgerInfo = await server.getLatestLedger();

    const startLedger = args.startLedger ?? ledgerInfo.sequence;
    const endLedger = startLedger + (args.durationLedgers ?? 1_051_200);

    const scArgs = [
      new Address(args.holder).toScVal(),
      SorobanService.enumVariantToScVal(args.policyType),
      SorobanService.enumVariantToScVal(args.region),
      nativeToScVal(args.coverage, { type: 'i128' }),
      nativeToScVal(args.age, { type: 'u32' }),
      nativeToScVal(args.riskScore, { type: 'u32' }),
      nativeToScVal(startLedger, { type: 'u32' }),
      nativeToScVal(endLedger, { type: 'u32' }),
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
