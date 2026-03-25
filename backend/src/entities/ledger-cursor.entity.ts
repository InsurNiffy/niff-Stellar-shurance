import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("ledger_cursors")
@Index(["tenantId", "ingestionType"])
export class LedgerCursor {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 50 })
  ingestionType!: string; // e.g., "events", "transactions", "effects"

  @Column({ type: "bigint" })
  lastLedger!: number;

  @Column({ type: "timestamp" })
  lastLedgerTimestamp!: Date;

  @Column({ type: "varchar", length: 64, nullable: true })
  lastCursor?: string; // Horizon cursor for pagination

  // Multi-tenancy support - nullable initially
  @Column({ type: "uuid", nullable: true })
  @Index()
  tenantId?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  lastSyncAt?: Date;
}