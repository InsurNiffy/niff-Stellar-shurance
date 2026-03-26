import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SorobanRpc } from '@stellar/stellar-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

interface RegistryEntry {
  name: string;
  contractId: string;
  expectedWasmHash: string;
}

interface DeploymentRegistry {
  contracts: RegistryEntry[];
}

@Injectable()
export class WasmDriftService {
  private readonly logger = new Logger(WasmDriftService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Runs every 6 hours in production; can be triggered manually in tests. */
  @Cron(CronExpression.EVERY_6_HOURS)
  async checkDrift(): Promise<void> {
    const registry = this.loadRegistry();
    const rpcUrl = this.config.get<string>('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org');
    const server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

    for (const entry of registry.contracts) {
      const contractId = this.resolveEnv(entry.contractId);
      const expectedHash = this.resolveEnv(entry.expectedWasmHash);

      if (!contractId || !expectedHash) {
        this.logger.warn(`Skipping ${entry.name}: CONTRACT_ID or expected hash not configured`);
        continue;
      }

      try {
        const onChainHash = await this.fetchOnChainWasmHash(server, contractId);
        if (onChainHash !== expectedHash) {
          await this.handleDrift(entry.name, contractId, expectedHash, onChainHash);
        } else {
          this.logger.log(`[wasm-drift] ${entry.name}: OK (${onChainHash.slice(0, 12)}…)`);
        }
      } catch (err) {
        this.logger.error(`[wasm-drift] Failed to check ${entry.name}: ${(err as Error).message}`);
      }
    }
  }

  private async fetchOnChainWasmHash(server: SorobanRpc.Server, contractId: string): Promise<string> {
    // getLedgerEntries for the ContractCode entry returns the wasm hash in the key
    const { entries } = await server.getLedgerEntries(
      // ContractData key for the contract instance stores the wasm hash
      // We use getContractWasmByContractId which is available in stellar-sdk >= 12
      ...([] as any[]),
    );
    // Fallback: use getContractWasmByContractId if available, else parse instance
    const instance = await (server as any).getContractWasmByContractId?.(contractId);
    if (instance?.wasmHash) return instance.wasmHash as string;

    // Manual path: fetch contract instance ledger entry and extract wasm hash
    const { xdr: xdrLib, Contract } = await import('@stellar/stellar-sdk');
    const contract = new Contract(contractId);
    const key = contract.getFootprint();
    const result = await server.getLedgerEntries(key as any);
    if (!result.entries?.length) throw new Error(`No ledger entry for contract ${contractId}`);
    const entry = result.entries[0];
    const data = xdrLib.LedgerEntryData.fromXDR(entry.xdr, 'base64');
    const wasmHash = data.contractData().val().instance().executable().wasmHash();
    return Buffer.from(wasmHash).toString('hex');
  }

  private async handleDrift(
    name: string,
    contractId: string,
    expected: string,
    actual: string,
  ): Promise<void> {
    const dedupKey = `${name}:${actual}`;

    // Dedup: skip if we already alerted for this exact (contract, actual-hash) pair
    const existing = await this.prisma.wasmDriftAlert.findUnique({ where: { dedupKey } });
    if (existing) {
      this.logger.warn(`[wasm-drift] DRIFT on ${name} already alerted (dedup key: ${dedupKey})`);
      return;
    }

    await this.prisma.wasmDriftAlert.create({
      data: { dedupKey, contractName: name, contractId, expectedHash: expected, actualHash: actual },
    });

    this.logger.error(
      `[wasm-drift] DRIFT DETECTED on ${name} | expected=${expected} | actual=${actual}`,
    );

    await this.sendWebhookAlert({ name, contractId, expected, actual });
  }

  private async sendWebhookAlert(payload: {
    name: string;
    contractId: string;
    expected: string;
    actual: string;
  }): Promise<void> {
    const webhookUrl = this.config.get<string>('WASM_DRIFT_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn('[wasm-drift] WASM_DRIFT_WEBHOOK_URL not set — alert logged only');
      return;
    }

    const { default: axios } = await import('axios');
    const secret = this.config.get<string>('WASM_DRIFT_WEBHOOK_SECRET', '');
    try {
      await axios.post(
        webhookUrl,
        {
          event: 'wasm_drift_detected',
          severity: 'critical',
          contract: payload.name,
          contractId: payload.contractId,
          expectedHash: payload.expected,
          actualHash: payload.actual,
          detectedAt: new Date().toISOString(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(secret ? { 'X-Webhook-Secret': secret } : {}),
          },
          timeout: 5_000,
        },
      );
      this.logger.log(`[wasm-drift] Alert webhook delivered for ${payload.name}`);
    } catch (err) {
      this.logger.error(`[wasm-drift] Webhook delivery failed: ${(err as Error).message}`);
    }
  }

  private loadRegistry(): DeploymentRegistry {
    const registryPath = path.resolve(
      this.config.get<string>('DEPLOYMENT_REGISTRY_PATH', 'contracts/deployment-registry.json'),
    );
    const raw = fs.readFileSync(registryPath, 'utf-8');
    return JSON.parse(raw) as DeploymentRegistry;
  }

  /** Resolve ${ENV_VAR} placeholders in registry values. */
  private resolveEnv(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_, key) => this.config.get<string>(key, ''));
  }
}
