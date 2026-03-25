/**
 * Soroban RPC client wrapper.
 *
 * All Soroban interactions go through this module so the rest of the backend
 * never touches stellar-sdk directly.  Each public function handles its own
 * error mapping so callers receive structured AppErrors.
 *
 * SECURITY: Private keys are never accepted, logged, or stored here.
 *           All transactions returned are unsigned.
 */

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
import { config } from '../config/env';
import { AppError } from '../middleware/errorHandler';

// Convenience aliases
const { Api, assembleTransaction } = SorobanRpc;
type SimResult = SorobanRpc.Api.SimulateTransactionResponse;

// ── Types ─────────────────────────────────────────────────────────────────────

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
  /** Base64-encoded XDR of the assembled, unsigned transaction. */
  unsignedXdr: string;
  minResourceFee: string;
  baseFee: string;
  totalEstimatedFee: string;
  totalEstimatedFeeXlm: string;
  authRequirements: AuthRequirement[];
  /**
   * Memo convention note. NiffyInsure does not use memos for protocol
   * correlation — policy_id is embedded in the contract call arguments.
   * Frontends may set an optional text memo (max 28 bytes) for UI correlation.
   */
  memoConvention: string;
  currentLedger: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function enumVariantToScVal(variant: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
}

function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / BigInt(10_000_000);
  const frac = stroops % BigInt(10_000_000);
  return `${whole}.${frac.toString().padStart(7, '0')}`;
}

function makeServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(config.stellar.rpcUrl, {
    allowHttp: config.stellar.rpcUrl.startsWith('http://'),
  });
}

async function loadAccount(
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
      throw new AppError(
        400,
        'ACCOUNT_NOT_FOUND',
        `Account ${publicKey} does not exist on this network. ` +
          'Fund it with at least 1 XLM (testnet: use Friendbot) before building a transaction.',
      );
    }
    if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('passphrase')) {
      throw new AppError(
        400,
        'WRONG_NETWORK',
        'The configured Soroban RPC is on a different network than expected. ' +
          'Check STELLAR_NETWORK_PASSPHRASE and SOROBAN_RPC_URL.',
      );
    }
    throw new AppError(
      502,
      'RPC_UNAVAILABLE',
      'Could not reach the Soroban RPC endpoint. Please try again shortly.',
      { cause: msg },
    );
  }
}

function mapSimulationError(error: string): AppError {
  if (
    error.includes('WasmVm') ||
    error.includes('non-existent') ||
    error.includes('InvalidAction')
  ) {
    return new AppError(
      503,
      'CONTRACT_NOT_DEPLOYED',
      'The smart contract function is not yet deployed on this network. ' +
        'Testnet contract deployment may be pending.',
    );
  }
  if (error.toLowerCase().includes('balance')) {
    return new AppError(
      400,
      'INSUFFICIENT_BALANCE',
      'The account does not have enough XLM to cover the transaction fee.',
    );
  }
  return new AppError(400, 'SIMULATION_FAILED', error);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Simulate `generate_premium(policy_type, region, age, risk_score) → i128`.
 *
 * Argument ordering mirrors the planned contract signature in
 * contracts/niffyinsure/src/policy.rs (generate_premium entrypoint).
 *
 * Falls back to local TypeScript computation if the contract is not deployed.
 */
export async function simulateGeneratePremium(args: {
  policyType: PolicyTypeEnum;
  region: RegionTierEnum;
  age: number;
  riskScore: number;
  sourceAccount: string;
}): Promise<SimulatePremiumResult> {
  const scArgs = [
    enumVariantToScVal(args.policyType),
    enumVariantToScVal(args.region),
    nativeToScVal(args.age, { type: 'u32' }),
    nativeToScVal(args.riskScore, { type: 'u32' }),
  ];

  const server = makeServer();
  const account = await loadAccount(server, args.sourceAccount);
  const contract = new Contract(config.stellar.contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.stellar.networkPassphrase,
  })
    .addOperation(contract.call('generate_premium', ...scArgs))
    .setTimeout(30)
    .build();

  const simulation: SimResult = await server.simulateTransaction(tx);

  if (Api.isSimulationError(simulation)) {
    // Graceful fallback to local computation
    const localPremium = computePremiumLocal(args);
    return {
      premiumStroops: localPremium.toString(),
      premiumXlm: stroopsToXlm(localPremium),
      minResourceFee: '0',
      source: 'local_fallback',
    };
  }

  const successResult = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
  const retval = successResult.result?.retval;
  let premiumStroops = BigInt(0);
  if (retval) {
    const native = scValToNative(retval);
    premiumStroops = typeof native === 'bigint' ? native : BigInt(String(native));
  }

  return {
    premiumStroops: premiumStroops.toString(),
    premiumXlm: stroopsToXlm(premiumStroops),
    minResourceFee: successResult.minResourceFee ?? '0',
    source: 'simulation',
  };
}

/**
 * Build an unsigned `initiate_policy` transaction with simulation-derived
 * resource footprints.  Returns the base64 XDR for wallet signing.
 *
 * Argument ordering: holder, policy_type, region, coverage, age, risk_score,
 *                    start_ledger, end_ledger
 *
 * Multisig: `authRequirements` lists all addresses that must sign the Soroban
 * auth entries before submission. Display these to the user before the wallet popup.
 *
 * Sequence number: Retrieved live from the RPC. Do not cache — stale sequences
 * cause submission failures.
 */
export async function buildInitiatePolicyTransaction(args: {
  holder: string;
  policyType: PolicyTypeEnum;
  region: RegionTierEnum;
  coverage: bigint;
  age: number;
  riskScore: number;
  asset?: string;
  startLedger?: number;
  durationLedgers?: number;
}): Promise<BuildTransactionResult> {
  const server = makeServer();
  const account = await loadAccount(server, args.holder);

  const ledgerInfo = await server.getLatestLedger();
  const startLedger = args.startLedger ?? ledgerInfo.sequence;
  const endLedger = startLedger + (args.durationLedgers ?? 1_051_200);

  // Resolve asset: use caller-supplied address or fall back to configured default.
  const assetAddress = args.asset ?? process.env.DEFAULT_TOKEN_CONTRACT_ID ?? '';

  const scArgs = [
    new Address(args.holder).toScVal(),
    enumVariantToScVal(args.policyType),
    enumVariantToScVal(args.region),
    nativeToScVal(args.coverage, { type: 'i128' }),
    nativeToScVal(args.age, { type: 'u32' }),
    nativeToScVal(args.riskScore, { type: 'u32' }),
    nativeToScVal(startLedger, { type: 'u32' }),
    nativeToScVal(endLedger, { type: 'u32' }),
    new Address(assetAddress).toScVal(),
  ];

  const contract = new Contract(config.stellar.contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.stellar.networkPassphrase,
  })
    .addOperation(contract.call('initiate_policy', ...scArgs))
    .setTimeout(30)
    .build();

  const simulation: SimResult = await server.simulateTransaction(tx);

  if (Api.isSimulationError(simulation)) {
    const errSim = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
    throw mapSimulationError(errSim.error);
  }

  const successSim = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;

  // Assemble transaction: attach footprints, soroban data, and updated fee
  const assembled = assembleTransaction(tx, successSim);
  const assembledTx = assembled.build();
  const unsignedXdr = assembledTx.toEnvelope().toXDR('base64');

  const baseFee = BigInt(BASE_FEE);
  const resourceFee = BigInt(successSim.minResourceFee ?? '0');
  const totalFee = baseFee + resourceFee;

  // auth entries live in successSim.result.auth (SimulateHostFunctionResult)
  const authRequirements: AuthRequirement[] = [];
  for (const authEntry of successSim.result?.auth ?? []) {
    const credentials = authEntry.credentials();
    const credType = credentials.switch();
    if (
      credType.value ===
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
    totalEstimatedFeeXlm: stroopsToXlm(totalFee),
    authRequirements,
    memoConvention:
      'NiffyInsure does not use memos for protocol correlation. ' +
      'policy_id is derived on-chain from the holder counter. ' +
      'Frontends may set an optional text memo (max 28 bytes) for UI session correlation.',
    currentLedger: ledgerInfo.sequence,
  };
}

// ── Local fallback (mirrors contracts/niffyinsure/src/premium.rs) ─────────────

/**
 * TypeScript mirror of `compute_premium` in premium.rs.
 * Used as a fallback when the Soroban simulation is unavailable.
 * All arithmetic uses BigInt to match Rust i128 integer semantics.
 */
export function computePremiumLocal(args: {
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

  const ageF: bigint =
    args.age < 25 ? BigInt(15) : args.age > 60 ? BigInt(13) : BigInt(10);

  const sum =
    typeFactor[args.policyType] +
    regionFactor[args.region] +
    ageF +
    BigInt(args.riskScore);

  return (BASE * sum) / BigInt(10);
}
