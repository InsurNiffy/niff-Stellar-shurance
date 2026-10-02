import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  BASE_FEE,
  Contract,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import CircuitBreaker from 'opossum';
import { AppException } from '../common/errors/app.exception';

const { Api, assembleTransaction } = SorobanRpc;

export type ScValInput = xdr.ScVal | string | number | bigint | boolean;

/** Transient RPC errors that should be retried. */
const TRANSIENT_MESSAGES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'socket hang up',
  'network timeout',
  '503',
  '502',
  '504',
];

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return TRANSIENT_MESSAGES.some((m) => err.message.includes(m));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 200,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (!isTransient(err) || attempt >= maxAttempts) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}

@Injectable()
export class SorobanService implements OnModuleInit {
  private readonly logger = new Logger(SorobanService.name);
  private server!: SorobanRpc.Server;
  private breaker!: CircuitBreaker;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const rpcUrl = this.config.get<string>('SOROBAN_RPC_URL') ?? 'https://soroban-testnet.stellar.org';
    this.server = new SorobanRpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith('http://'),
    });

    this.breaker = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        timeout: this.config.get<number>('SOROBAN_SIMULATE_TIMEOUT_MS') ?? 30_000,
        errorThresholdPercentage: 50,
        resetTimeout: 30_000,
        volumeThreshold: 5,
      },
    );

    this.breaker.on('open', () => this.logger.warn('Soroban RPC circuit breaker OPEN'));
    this.breaker.on('halfOpen', () => this.logger.log('Soroban RPC circuit breaker HALF-OPEN'));
    this.breaker.on('close', () => this.logger.log('Soroban RPC circuit breaker CLOSED'));
  }

  private get contractId(): string {
    const id = this.config.get<string>('CONTRACT_ID');
    if (!id) throw new AppException('CONTRACT_NOT_CONFIGURED');
    return id;
  }

  private get networkPassphrase(): string {
    return (
      this.config.get<string>('STELLAR_NETWORK_PASSPHRASE') ??
      'Test SDF Network ; September 2015'
    );
  }

  private async rpc<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await (this.breaker.fire(() => withRetry(fn)) as Promise<T>);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'EOPENBREAKER') {
        throw new AppException('RPC_UNAVAILABLE');
      }
      throw err;
    }
  }

  /** Read-only simulation of a contract method. */
  async simulate(method: string, args: ScValInput[]): Promise<unknown> {
    const account = await this.rpc(() => this.server.getAccount('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'));
    const contract = new Contract(this.contractId);
    const scArgs = args.map((a) => (a instanceof xdr.ScVal ? a : nativeToScVal(a)));

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...scArgs))
      .setTimeout(30)
      .build();

    const result = await this.rpc(() => this.server.simulateTransaction(tx));

    if (Api.isSimulationError(result)) {
      this.mapSimulationError(result);
    }

    const success = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const retval = success.result?.retval;
    return retval ? scValToNative(retval) : null;
  }

  /**
   * Build an unsigned transaction for the caller to sign.
   * Returns the base64 XDR string.
   */
  async buildInvokeTx(source: string, method: string, args: ScValInput[]): Promise<string> {
    const account = await this.rpc(() => this.server.getAccount(source));
    const contract = new Contract(this.contractId);
    const scArgs = args.map((a) => (a instanceof xdr.ScVal ? a : nativeToScVal(a)));

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...scArgs))
      .setTimeout(30)
      .build();

    const simResult = await this.rpc(() => this.server.simulateTransaction(tx));
    if (Api.isSimulationError(simResult)) {
      this.mapSimulationError(simResult);
    }

    const prepared = assembleTransaction(tx, simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse);
    return prepared.toXDR();
  }

  /** Submit a signed XDR transaction. Does NOT retry to avoid double-submission. */
  async submit(signedXdr: string): Promise<string> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase) as Transaction;
    const result = await this.server.sendTransaction(tx);
    if (result.status === 'ERROR') {
      throw new AppException('SUBMISSION_FAILED');
    }
    return result.hash;
  }

  /** Poll until transaction lands or timeout expires. */
  async waitForResult(hash: string, timeoutMs = 30_000): Promise<SorobanRpc.Api.GetTransactionResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.rpc(() => this.server.getTransaction(hash));
      if (res.status !== 'NOT_FOUND') return res;
      await sleep(2_000);
    }
    throw new AppException('TIMEOUT_ERROR');
  }

  private mapSimulationError(result: SorobanRpc.Api.SimulateTransactionErrorResponse): never {
    const msg = result.error ?? 'simulation failed';
    if (msg.includes('WasmVm') || msg.includes('non-existent')) {
      throw new AppException('CONTRACT_NOT_DEPLOYED');
    }
    if (msg.includes('balance') || msg.includes('underfunded')) {
      throw new AppException('INSUFFICIENT_BALANCE');
    }
    throw new AppException('SIMULATION_FAILED', { details: { error: msg } });
  }
}
