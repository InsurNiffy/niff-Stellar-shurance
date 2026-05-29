/**
 * TxService — transaction assembly, simulation, XDR validation, and submission.
 *
 * SECURITY RULES (enforced here):
 *  - Private keys / seed phrases are NEVER accepted, stored, or logged.
 *  - Signed XDR is validated structurally but never logged in full.
 *  - Only the transaction hash and source account are written to logs.
 *  - Idempotency results are cached in Redis; cache keys are keyed by
 *    idempotency_key UUID, not by XDR content.
 *
 * CONCURRENCY NOTE:
 *  Stellar sequence numbers are per-account and monotonically increasing.
 *  If a user fires multiple transactions quickly:
 *    1. Each call to POST /tx/build fetches the *current* sequence from RPC.
 *    2. The wallet must sign them in order and submit sequentially, or use
 *       fee-bump / sequence-bump patterns.
 *    3. We do NOT cache sequence numbers server-side; always fetch fresh from RPC.
 *    4. If submission returns tx_bad_seq, the client should rebuild (re-fetch seq).
 *
 * MEMO USAGE:
 *  NiffyInsure does not use memos for protocol correlation. policy_id is derived
 *  on-chain from the holder counter. Frontends may attach an optional text memo
 *  (≤28 bytes UTF-8) for UI session correlation; it is ignored by the contract.
 *
 * MULTISIG:
 *  authRequirements in the build response lists every address that must sign
 *  Soroban auth entries. Additional signers beyond the source account are
 *  supported — wallets must collect all signatures before calling /tx/submit.
 *
 * HARDWARE WALLET QUIRKS:
 *  Ledger Nano devices enforce a maximum APDU payload of ~512 bytes. Soroban
 *  transactions with large footprints can exceed this limit. Mitigations:
 *    - Keep the number of read/write ledger entries minimal.
 *    - Use the simulate=true path to inspect resource usage before signing.
 *    - Ledger Stellar app ≥ 5.1.0 supports larger envelopes via multi-APDU.
 *  Trezor does not yet support Soroban (invokeHostFunction) as of 2025-Q1.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  Address,
  Transaction,
  FeeBumpTransaction,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { RedisService } from '../cache/redis.service';
import { BuildTxDto, ContractFunctionEnum } from './dto/build-tx.dto';
import { SubmitTxDto } from './dto/submit-tx.dto';
import { SorobanService } from '../rpc/soroban.service';
import { enqueueTxSubmit } from './tx.queue';
import { getTxState, setTxState, TxState } from './tx.state';

const { Api, assembleTransaction } = SorobanRpc;

// Idempotency cache TTL: 10 minutes
const IDEMPOTENCY_TTL_SECONDS = 600;

export interface SimulateOnlyResult {
  type: 'simulate';
  minResourceFee: string;
  readBytes: number;
  writeBytes: number;
  instructions: number;
  authRequirements: Array<{ address: string; isContract: boolean }>;
  currentLedger: number;
}

export interface BuildResult {
  type: 'build';
  unsignedXdr: string;
  minResourceFee: string;
  baseFee: string;
  totalEstimatedFee: string;
  totalEstimatedFeeXlm: string;
  authRequirements: Array<{ address: string; isContract: boolean }>;
  memoConvention: string;
  multisigSupported: boolean;
  currentLedger: number;
  sequenceNumber: string;
  hardwareWalletNote: string;
}

export interface SubmitResult {
  type: 'submit';
  hash: string;
  status: string;
  ledger?: number;
  errorCode?: string;
  errorMessage?: string;
  cached?: boolean;
}

@Injectable()
export class TxService {
  private readonly logger = new Logger(TxService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

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

  // ─── Build / Simulate ────────────────────────────────────────────────────────

  async build(dto: BuildTxDto): Promise<BuildResult | SimulateOnlyResult> {
    const server = this.makeServer();

    // Fetch account — throws structured errors on 404 / wrong network
    let account: import('@stellar/stellar-sdk').Account;
    try {
      account = await server.getAccount(dto.source_account);
    } catch (err: unknown) {
      this.handleAccountError(err, dto.source_account);
    }

    const ledgerInfo = await server.getLatestLedger();
    const contract = new Contract(this.contractId);
    const scArgs = this.buildScArgs(dto, ledgerInfo.sequence);

    const tx = new TransactionBuilder(account!, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(dto.function, ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (Api.isSimulationError(simulation)) {
      const err = simulation as SorobanRpc.Api.SimulateTransactionErrorResponse;
      this.mapSimulationError(err.error);
    }

    const successSim = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const authRequirements = this.extractAuthRequirements(successSim, dto.source_account);

    // simulate=true path: return resources without building the full envelope
    if (dto.simulate) {
      return {
        type: 'simulate',
        minResourceFee: successSim.minResourceFee ?? '0',
        readBytes: 0,
        writeBytes: 0,
        instructions: 0,
        authRequirements,
        currentLedger: ledgerInfo.sequence,
      } satisfies SimulateOnlyResult;
    }

    // Full build path: assemble with footprints attached
    const assembled = assembleTransaction(tx, successSim);
    const builtTx = assembled.build();
    const unsignedXdr = builtTx.toEnvelope().toXDR('base64');

    const baseFee = BigInt(BASE_FEE);
    const resourceFee = BigInt(successSim.minResourceFee ?? '0');
    const totalFee = baseFee + resourceFee;

    this.logger.log(
      `Built tx for ${dto.source_account} fn=${dto.function} seq=${builtTx.sequence}`,
    );

    return {
      type: 'build',
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
      multisigSupported: true,
      currentLedger: ledgerInfo.sequence,
      sequenceNumber: builtTx.sequence,
      hardwareWalletNote:
        'Ledger Nano: requires Stellar app ≥ 5.1.0 for multi-APDU support. ' +
        'Large Soroban footprints may exceed 512-byte APDU limit on older firmware. ' +
        'Trezor does not support invokeHostFunction as of 2025-Q1.',
    } satisfies BuildResult;
  }

  // ─── Submit (async — enqueue and return immediately) ─────────────────────────

  /**
   * Enqueue a signed XDR for async Soroban submission.
   * Returns immediately with { jobId, status: 'queued' }.
   */
  async enqueueSubmit(dto: SubmitTxDto): Promise<{ jobId: string; status: 'queued' }> {
    // Validate XDR structure before enqueuing — fail fast on bad input
    this.parseAndValidateXdr(dto.signed_xdr);

    const jobId = await enqueueTxSubmit({
      signed_xdr: dto.signed_xdr,
      idempotency_key: dto.idempotency_key,
    });

    // Write initial queued state so GET /tx/status/:jobId is immediately usable
    await setTxState(this.redisService, {
      jobId,
      status: 'queued',
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(`Enqueued tx job=${jobId}`);
    return { jobId, status: 'queued' };
  }

  /**
   * Fetch the latest lifecycle state for a job from Redis.
   */
  async getStatus(jobId: string): Promise<TxState> {
    const state = await getTxState(this.redisService, jobId);
    if (!state) {
      throw new NotFoundException({
        code: 'JOB_NOT_FOUND',
        message: `No transaction job found for id ${jobId}. It may have expired or never existed.`,
      });
    }
    return state;
  }

  // ─── Submit (sync — kept for backward compatibility / internal use) ──────────

  async submit(dto: SubmitTxDto): Promise<SubmitResult> {
    // Idempotency: return cached result if key was seen before
    if (dto.idempotency_key) {
      const cached = await this.redisService.get<SubmitResult>(
        `tx:idem:${dto.idempotency_key}`,
      );
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    // Validate XDR structure before touching the network
    const parsedTx = this.parseAndValidateXdr(dto.signed_xdr);

    const server = this.makeServer();

    let response: SorobanRpc.Api.SendTransactionResponse;
    try {
      response = await server.sendTransaction(parsedTx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`sendTransaction RPC error: ${msg}`);
      throw new ServiceUnavailableException({
        code: 'RPC_UNAVAILABLE',
        message: 'Could not reach the Soroban RPC endpoint. Try again shortly.',
      });
    }

    const result = this.mapSubmissionResponse(response);

    // Cache successful (or known-failed) results under the idempotency key
    if (dto.idempotency_key && result.status !== 'ERROR') {
      await this.redisService.set(
        `tx:idem:${dto.idempotency_key}`,
        result,
        IDEMPOTENCY_TTL_SECONDS,
      );
    }

    // Log hash only — never log XDR content
    this.logger.log(
      `Submitted tx hash=${result.hash} status=${result.status}${result.errorCode ? ` code=${result.errorCode}` : ''}`,
    );

    return result;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private buildScArgs(dto: BuildTxDto, currentLedger: number): xdr.ScVal[] {
    if (dto.function === ContractFunctionEnum.InitiatePolicy) {
      const startLedger = dto.start_ledger ?? currentLedger;
      const endLedger = startLedger + (dto.duration_ledgers ?? 1_051_200);
      const assetAddress =
        dto.asset ??
        this.configService.get<string>('DEFAULT_TOKEN_CONTRACT_ID', '');

      return [
        new Address(dto.source_account).toScVal(),
        this.enumVariantToScVal(dto.policy_type),
        this.enumVariantToScVal(dto.region),
        nativeToScVal(BigInt(dto.coverage), { type: 'i128' }),
        nativeToScVal(dto.age, { type: 'u32' }),
        nativeToScVal(dto.risk_score, { type: 'u32' }),
        nativeToScVal(startLedger, { type: 'u32' }),
        nativeToScVal(endLedger, { type: 'u32' }),
        new Address(assetAddress).toScVal(),
      ];
    }
    throw new BadRequestException({
      code: 'UNSUPPORTED_FUNCTION',
      message: `Contract function '${dto.function}' is not yet supported by this endpoint.`,
    });
  }

  private enumVariantToScVal(variant: string): xdr.ScVal {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);
  }

  private extractAuthRequirements(
    sim: SorobanRpc.Api.SimulateTransactionSuccessResponse,
    sourceAccount: string,
  ): Array<{ address: string; isContract: boolean }> {
    const reqs: Array<{ address: string; isContract: boolean }> = [];
    for (const authEntry of sim.result?.auth ?? []) {
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
        reqs.push({ address: stellarAddr.toString(), isContract });
      }
    }
    if (!reqs.some((r) => r.address === sourceAccount)) {
      reqs.unshift({ address: sourceAccount, isContract: false });
    }
    return reqs;
  }

  /**
   * Parse and structurally validate a base64 XDR envelope.
   * Rejects malformed envelopes before any network call.
   * Returns the parsed Transaction (fee-bump envelopes are rejected — wallets
   * should not wrap in fee-bump before submission here).
   */
  private parseAndValidateXdr(signedXdr: string): Transaction {
    let parsed: Transaction | FeeBumpTransaction;
    try {
      parsed = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_XDR',
        message:
          'Could not parse the signed_xdr. Ensure it is a valid base64-encoded ' +
          'TransactionEnvelope for the correct network.',
      });
    }

    if (parsed instanceof FeeBumpTransaction) {
      throw new BadRequestException({
        code: 'FEE_BUMP_NOT_SUPPORTED',
        message:
          'Fee-bump envelopes are not accepted at this endpoint. ' +
          'Submit the inner transaction directly.',
      });
    }

    const tx = parsed as Transaction;

    // Must have at least one signature
    if (!tx.signatures || tx.signatures.length === 0) {
      throw new BadRequestException({
        code: 'MISSING_SIGNATURES',
        message:
          'The transaction envelope has no signatures. ' +
          'Sign the XDR with your wallet before submitting.',
      });
    }

    // Must contain exactly one invokeHostFunction operation
    const ops = tx.operations;
    if (ops.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_OPERATIONS',
        message: 'Transaction has no operations.',
      });
    }

    const hasInvokeHostFn = ops.some(
      (op: { type: string }) => op.type === 'invokeHostFunction',
    );
    if (!hasInvokeHostFn) {
      throw new BadRequestException({
        code: 'INVALID_OPERATION_TYPE',
        message:
          'Expected an invokeHostFunction operation. ' +
          'Only Soroban contract invocations are accepted here.',
      });
    }

    return tx;
  }

  /**
   * Map Soroban RPC submission response to a stable result shape.
   * Error codes are normalised so the UI can display consistent messages.
   */
  private mapSubmissionResponse(
    response: SorobanRpc.Api.SendTransactionResponse,
  ): SubmitResult {
    const base: SubmitResult = {
      type: 'submit',
      hash: response.hash,
      status: response.status,
    };

    if (response.status === 'ERROR') {
      const errorCode = this.mapErrorCode(response);
      return {
        ...base,
        errorCode,
        errorMessage: this.errorCodeToMessage(errorCode),
      };
    }

    return base;
  }

  private mapErrorCode(response: SorobanRpc.Api.SendTransactionResponse): string {
    // Extract result XDR error code when available
    if ('errorResultXdr' in response && response.errorResultXdr) {
      try {
        const result = xdr.TransactionResult.fromXDR(
          response.errorResultXdr as string,
          'base64',
        );
        const code = result.result().switch().name;
        // Map SDK enum names to stable UI codes
        const codeMap: Record<string, string> = {
          txBAD_SEQ: 'TX_BAD_SEQ',
          txBAD_AUTH: 'TX_BAD_AUTH',
          txINSUFFICIENT_FEE: 'TX_INSUFFICIENT_FEE',
          txINSUFFICIENT_BALANCE: 'TX_INSUFFICIENT_BALANCE',
          txNO_ACCOUNT: 'TX_NO_ACCOUNT',
          txFAILED: 'TX_FAILED',
          txTOO_EARLY: 'TX_TOO_EARLY',
          txTOO_LATE: 'TX_TOO_LATE',
          txMISSING_OPERATION: 'TX_MISSING_OPERATION',
          txINTERNAL_ERROR: 'TX_INTERNAL_ERROR',
        };
        return codeMap[code] ?? `TX_ERROR_${code}`;
      } catch {
        // XDR parse failed — return generic
      }
    }
    return 'TX_SUBMISSION_FAILED';
  }

  private errorCodeToMessage(code: string): string {
    const messages: Record<string, string> = {
      TX_BAD_SEQ:
        'Sequence number mismatch. Rebuild the transaction to fetch the latest sequence.',
      TX_BAD_AUTH: 'One or more signatures are invalid or missing.',
      TX_INSUFFICIENT_FEE: 'Fee is too low. Rebuild with a higher fee.',
      TX_INSUFFICIENT_BALANCE: 'Source account has insufficient XLM balance.',
      TX_NO_ACCOUNT: 'Source account does not exist on this network.',
      TX_FAILED: 'Transaction failed. Check operation results for details.',
      TX_TOO_EARLY: 'Transaction submitted before its minTime bound.',
      TX_TOO_LATE: 'Transaction expired. Rebuild with a fresh timeout.',
      TX_MISSING_OPERATION: 'Transaction has no operations.',
      TX_INTERNAL_ERROR: 'Stellar network internal error. Try again.',
      TX_SUBMISSION_FAILED: 'Transaction submission failed.',
    };
    return messages[code] ?? 'An unknown submission error occurred.';
  }

  private handleAccountError(err: unknown, publicKey: string): never {
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
    if (msg.toLowerCase().includes('passphrase') || msg.toLowerCase().includes('network')) {
      throw new BadRequestException({
        code: 'WRONG_NETWORK',
        message:
          'The configured Soroban RPC is on a different network than expected. ' +
          'Check STELLAR_NETWORK_PASSPHRASE and SOROBAN_RPC_URL.',
      });
    }
    this.logger.error(`RPC load account error: ${msg}`);
    throw new ServiceUnavailableException({
      code: 'RPC_UNAVAILABLE',
      message: 'Could not reach the Soroban RPC endpoint. Try again shortly.',
    });
  }

  private mapSimulationError(error: string): never {
    if (
      error.includes('WasmVm') ||
      error.includes('non-existent') ||
      error.includes('InvalidAction')
    ) {
      throw new ServiceUnavailableException({
        code: 'CONTRACT_NOT_DEPLOYED',
        message: 'The smart contract is not yet deployed on this network.',
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
}
