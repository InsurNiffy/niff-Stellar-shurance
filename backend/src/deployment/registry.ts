import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface DeploymentRecord {
  version: string;
  wasmHash: string;
  deployedAt: string;
  network: string;
  contractId: string;
}

export interface DeploymentRegistry {
  schemaVersion: number;
  deployments: DeploymentRecord[];
}

const REGISTRY_PATH = join(__dirname, '../../../contracts/deployment-registry.json');
const SCHEMA_VERSION = 2;

/**
 * Minimal Soroban client surface used by the registry. The concrete client is
 * injected so the registry stays decoupled from a specific SDK version.
 */
export interface SorobanContractClient {
  /**
   * Invokes the contract's `get_wasm_hash() -> BytesN<32>` entrypoint via
   * simulation and returns the hex-encoded wasm hash.
   */
  getWasmHash(): Promise<string>;
}

export interface DeployResult {
  version: string;
  network: string;
  contractId: string;
}

export interface AlertSink {
  alert(message: string, details: Record<string, unknown>): void;
}

function loadRegistry(): DeploymentRegistry {
  if (!existsSync(REGISTRY_PATH)) {
    return { schemaVersion: SCHEMA_VERSION, deployments: [] };
  }
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Partial<DeploymentRegistry>;
  return {
    schemaVersion: raw.schemaVersion ?? SCHEMA_VERSION,
    deployments: Array.isArray(raw.deployments) ? raw.deployments : [],
  };
}

function saveRegistry(registry: DeploymentRegistry): void {
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

function normalizeHash(hash: string): string {
  return hash.trim().toLowerCase().replace(/^0x/, '');
}

/**
 * Records a deployment by querying the contract's wasm hash after deploy.
 * Emits an alert when the on-chain hash does not match the expected hash
 * (e.g. the deployed artifact differs from what was built).
 */
export async function recordDeployment(
  client: SorobanContractClient,
  result: DeployResult,
  alerts: AlertSink,
  expectedWasmHash?: string,
): Promise<DeploymentRecord> {
  const wasmHash = normalizeHash(await client.getWasmHash());

  if (expectedWasmHash && normalizeHash(expectedWasmHash) !== wasmHash) {
    alerts.alert('Deployment wasm hash mismatch', {
      version: result.version,
      contractId: result.contractId,
      network: result.network,
      expected: normalizeHash(expectedWasmHash),
      actual: wasmHash,
    });
  }

  const record: DeploymentRecord = {
    version: result.version,
    wasmHash,
    deployedAt: new Date().toISOString(),
    network: result.network,
    contractId: result.contractId,
  };

  const registry = loadRegistry();
  registry.schemaVersion = SCHEMA_VERSION;
  registry.deployments.push(record);
  saveRegistry(registry);

  return record;
}

/**
 * Returns the most recent deployment for a network, if any.
 */
export function latestDeployment(network: string): DeploymentRecord | undefined {
  const registry = loadRegistry();
  for (let i = registry.deployments.length - 1; i >= 0; i -= 1) {
    if (registry.deployments[i].network === network) {
      return registry.deployments[i];
    }
  }
  return undefined;
}

/**
 * Computes the expected wasm hash from a compiled artifact for comparison.
 */
export function hashWasm(wasm: Buffer): string {
  return createHash('sha256').update(wasm).digest('hex');
}
