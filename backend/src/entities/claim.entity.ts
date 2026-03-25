import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./user.entity";
import { Policy } from "./policy.entity";
import { Vote } from "./vote.entity";

export enum ClaimStatus {
  SUBMITTED = "submitted",
  UNDER_REVIEW = "under_review",
  APPROVED = "approved",
  REJECTED = "rejected",
  PAID = "paid",
  DISPUTED = "disputed",
  EXPIRED = "expired",
}

export enum ClaimPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

@Entity("claims")
@Index(["tenantId", "policyId"])
@Index(["tenantId", "status"])
@Index(["tenantId", "holderId"])
@Index(["tenantId", "createdAt"])
@Index(["tenantId", "priority"])
export class Claim {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64, unique: true })
  @Index()
  claimNumber!: string;

  @Column({
    type: "enum",
    enum: ClaimStatus,
    default: ClaimStatus.SUBMITTED,
  })
  status!: ClaimStatus;

  @Column({
    type: "enum",
    enum: ClaimPriority,
    default: ClaimPriority.MEDIUM,
  })
  priority!: ClaimPriority;

  // Using numeric for token minor units (avoid floats)
  @Column({ type: "numeric", precision: 20, scale: 0 })
  claimedAmount!: string; // Stored as minor units

  @Column({ type: "numeric", precision: 20, scale: 0, nullable: true })
  approvedAmount?: string; // Stored as minor units

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "jsonb", nullable: true })
  evidence?: Record<string, unknown>;

  @Column({ type: "varchar", length: 255, nullable: true })
  incidentDate?: string;

  @Column({ type: "timestamp", nullable: true })
  incidentDateTimestamp?: Date;

  // Multi-tenancy support - nullable initially
  @Column({ type: "uuid", nullable: true })
  @Index()
  tenantId?: string;

  @Column({ type: "uuid" })
  policyId!: string;

  @ManyToOne(() => Policy, (policy) => policy.claims, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "policyId" })
  policy!: Policy;

  @Column({ type: "uuid" })
  holderId!: string;

  @ManyToOne(() => User, (user) => user.claims)
  @JoinColumn({ name: "holderId" })
  holder!: User;

  @Column({ type: "varchar", length: 56 })
  holderStellarAddress!: string; // Denormalized for performance

  @Column({ type: "text", nullable: true })
  reviewerNotes?: string;

  @Column({ type: "uuid", nullable: true })
  reviewedBy?: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "reviewedBy" })
  reviewer?: User;

  @Column({ type: "timestamp", nullable: true })
  reviewedAt?: Date;

  @Column({ type: "varchar", length: 64, nullable: true })
  transactionHash?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  resolvedAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  paidAt?: Date;

  // Vote count for governance (soft delete consideration - kept for audit)
  @Column({ type: "integer", default: 0 })
  voteCount!: number;

  @Column({ type: "integer", default: 0 })
  approvalCount!: number;

  @Column({ type: "integer", default: 0 })
  rejectionCount!: number;

  // Relations
  @OneToMany(() => Vote, (vote) => vote.claim)
  votes!: Vote[];
}