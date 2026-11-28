import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WasmDriftAlert } from '../entities/wasm-drift-alert.entity';

interface DeploymentRegistryEntry {
  contractId: string;
  wasmHash: string;
}

interface DeploymentRegistry {
  contracts: DeploymentRegistryEntry[];
}

/**
 * Monitors deployed contract wasm hashes against the expected values in the
 * deployment registry. Emits (and resolves) WasmDriftAlert records on drift.
 */
@Injectable()
export class WasmDriftService {
  private readonly logger = new Logger(WasmDriftService.name);

  constructor(
    @InjectRepository(WasmDriftAlert)
    private readonly alertRepository: Repository<WasmDriftAlert>,
  ) {}

  /**
   * Scheduled entrypoint: checks every deployed contract for wasm drift.
   */
  async checkForDrift(): Promise<void> {
    const registry = this.loadRegistry();

    for (const entry of registry.contracts) {
      try {
        const actualHash = await this.getWasmHash(entry.contractId);
        await this.evaluateContract(entry.contractId, entry.wasmHash, actualHash);
      } catch (error) {
        this.logger.error(
          `Failed to check wasm drift for contract ${entry.contractId}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Simulates a `get_wasm_hash` invocation for the given contract and returns
   * the deployed wasm hash.
   */
  async getWasmHash(contractId: string): Promise<string> {
    const { SorobanRpc } = await import('@stellar/stellar-sdk');
    const server = new SorobanRpc.Server(
      process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    );

    const { Contract, TransactionBuilder, Networks, BASE_FEE, Account } =
      await import('@stellar/stellar-sdk');

    const contract = new Contract(contractId);
    const sourceAccount = new Account(
      process.env.WASM_DRIFT_SOURCE_ACCOUNT ??
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      '0',
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET,
    })
      .addOperation(contract.call('get_wasm_hash'))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    const result = (simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse)
      .result;
    if (!result) {
      throw new Error('Simulation returned no result');
    }

    return result.retval.value().toString('hex');
  }

  /**
   * Compares expected vs actual hash, emitting or resolving alerts as needed.
   */
  async evaluateContract(
    contractId: string,
    expectedHash: string,
    actualHash: string,
  ): Promise<void> {
    const existing = await this.alertRepository.findOne({
      where: { contractId, wasmHash: actualHash, resolved: false },
    });

    if (actualHash === expectedHash) {
      const openAlerts = await this.alertRepository.find({
        where: { contractId, resolved: false },
      });
      for (const alert of openAlerts) {
        alert.resolved = true;
        alert.resolvedAt = new Date();
        await this.alertRepository.save(alert);
        this.logger.log(
          `Wasm drift resolved for contract ${contractId} (hash ${alert.wasmHash})`,
        );
      }
      return;
    }

    if (existing) {
      // Duplicate alert for this (contract, hash) pair already open.
      return;
    }

    const alert = this.alertRepository.create({
      contractId,
      wasmHash: actualHash,
      expectedHash,
      resolved: false,
    });
    await this.alertRepository.save(alert);
    this.logger.warn(
      `WASM DRIFT detected for contract ${contractId}: expected ${expectedHash}, got ${actualHash}`,
    );
  }

  private loadRegistry(): DeploymentRegistry {
    const registryPath =
      process.env.DEPLOYMENT_REGISTRY_PATH ??
      join(process.cwd(), 'contracts', 'deployment-registry.json');
    const raw = readFileSync(registryPath, 'utf-8');
    return JSON.parse(raw) as DeploymentRegistry;
  }
}
