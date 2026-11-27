import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SorobanService } from '../soroban/soroban.service';
import { WasmDriftAlert } from './entities/wasm-drift-alert.entity';

interface DeploymentRegistryEntry {
  contractId: string;
  wasmHash: string;
}

interface DeploymentRegistry {
  contracts: DeploymentRegistryEntry[];
}

@Injectable()
export class WasmDriftJob {
  private readonly logger = new Logger(WasmDriftJob.name);

  constructor(
    private readonly sorobanService: SorobanService,
    @InjectRepository(WasmDriftAlert)
    private readonly alertRepository: Repository<WasmDriftAlert>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const registry = this.loadRegistry();
    if (!registry) {
      return;
    }

    for (const entry of registry.contracts) {
      try {
        await this.checkContract(entry);
      } catch (error) {
        this.logger.error(
          `Failed to check wasm drift for ${entry.contractId}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async checkContract(entry: DeploymentRegistryEntry): Promise<void> {
    const actualHash = await this.sorobanService.getWasmHash(entry.contractId);
    const expectedHash = entry.wasmHash;

    if (actualHash === expectedHash) {
      await this.resolveAlerts(entry.contractId);
      return;
    }

    await this.raiseAlert(entry.contractId, expectedHash, actualHash);
  }

  private async raiseAlert(
    contractId: string,
    expectedHash: string,
    actualHash: string,
  ): Promise<void> {
    const existing = await this.alertRepository.findOne({
      where: { contractId, actualHash, resolvedAt: null as unknown as Date },
    });

    if (existing) {
      return;
    }

    const alert = this.alertRepository.create({
      contractId,
      expectedHash,
      actualHash,
      resolvedAt: null,
    });
    await this.alertRepository.save(alert);

    this.logger.warn(
      `WASM DRIFT detected for ${contractId}: expected ${expectedHash}, got ${actualHash}`,
    );
  }

  private async resolveAlerts(contractId: string): Promise<void> {
    const openAlerts = await this.alertRepository.find({
      where: { contractId, resolvedAt: null as unknown as Date },
    });

    if (openAlerts.length === 0) {
      return;
    }

    const now = new Date();
    for (const alert of openAlerts) {
      alert.resolvedAt = now;
    }
    await this.alertRepository.save(openAlerts);

    this.logger.log(
      `WASM drift resolved for ${contractId} (${openAlerts.length} alert(s) closed)`,
    );
  }

  private loadRegistry(): DeploymentRegistry | null {
    try {
      const path = join(process.cwd(), 'contracts', 'deployment-registry.json');
      const raw = readFileSync(path, 'utf8');
      return JSON.parse(raw) as DeploymentRegistry;
    } catch (error) {
      this.logger.error(
        `Unable to load deployment registry: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
