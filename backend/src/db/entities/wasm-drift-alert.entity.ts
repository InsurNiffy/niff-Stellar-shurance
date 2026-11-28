import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WasmDriftAlertStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

/**
 * Persisted record of a wasm hash drift detected for a deployed contract.
 *
 * Alerts are deduplicated per `(contractId, actualHash)` pair: while an alert
 * for a given pair is open, further detections do not create new rows. When the
 * deployed hash matches the registry again the open alert is resolved.
 */
@Entity('wasm_drift_alerts')
@Index('IDX_wasm_drift_alerts_contract_hash', ['contractId', 'actualHash'])
export class WasmDriftAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_id', type: 'varchar', length: 128 })
  contractId: string;

  @Column({ name: 'expected_hash', type: 'varchar', length: 128 })
  expectedHash: string;

  @Column({ name: 'actual_hash', type: 'varchar', length: 128 })
  actualHash: string;

  @Column({
    type: 'enum',
    enum: WasmDriftAlertStatus,
    default: WasmDriftAlertStatus.OPEN,
  })
  status: WasmDriftAlertStatus;

  @Column({ name: 'detected_at', type: 'timestamptz' })
  detectedAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
