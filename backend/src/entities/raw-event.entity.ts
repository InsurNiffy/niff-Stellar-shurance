import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum EventStatus {
  PENDING = "pending",
  PROCESSED = "processed",
  FAILED = "failed",
  DUPLICATE = "duplicate",
}

export enum EventType {
  POLICY_CREATED = "policy_created",
  PREMIUM_PAID = "premium_paid",
  CLAIM_SUBMITTED = "claim_submitted",
  CLAIM_APPROVED = "claim_approved",
  CLAIM_REJECTED = "claim_rejected",
  CLAIM_PAID = "claim_paid",
  VOTE_SUBMITTED = "vote_submitted",
  TOKEN_TRANSFER = "token_transfer",
  TOKEN_MINT = "token_mint",
  TOKEN_BURN = "token_burn",
}

@Entity("raw_events")
@Index(["tenantId", "eventType"])
@Index(["tenantId", "status"])
@Index(["tenantId", "ledgerTimestamp"])
@Index(["eventType", "createdAt"])
export class RawEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({
    type: "enum",
    enum: EventType,
  })
  eventType!: EventType;

  @Column({
    type: "enum",
    enum: EventStatus,
    default: EventStatus.PENDING,
  })
  status!: EventStatus;

  @Column({ type: "varchar", length: 64 })
  eventId!: string; // Unique ID from the blockchain event

  @Column({ type: "bigint" })
  ledger!: number;

  @Column({ type: "timestamp" })
  @Index()
  ledgerTimestamp!: Date;

  @Column({ type: "varchar", length: 56 })
  sourceAddress!: string;

  @Column({ type: "jsonb" })
  eventData!: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  // Multi-tenancy support - nullable initially
  @Column({ type: "uuid", nullable: true })
  @Index()
  tenantId?: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  processedBy?: string; // Service or worker that processed this event

  @Column({ type: "timestamp", nullable: true })
  processedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;
}