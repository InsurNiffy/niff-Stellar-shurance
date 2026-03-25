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
import { Claim } from "./claim.entity";

export enum PolicyStatus {
  ACTIVE = "active",
  EXPIRED = "expired",
  CANCELLED = "cancelled",
  PENDING = "pending",
}

export enum PolicyType {
  PREMIUM = "premium",
  CLAIM = "claim",
}

@Entity("policies")
@Index(["tenantId", "holderId"])
@Index(["tenantId", "policyType"])
@Index(["tenantId", "status"])
@Index(["tenantId", "createdAt"])
export class Policy {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64, unique: true })
  @Index()
  policyNumber!: string;

  @Column({
    type: "enum",
    enum: PolicyType,
    default: PolicyType.PREMIUM,
  })
  policyType!: PolicyType;

  @Column({
    type: "enum",
    enum: PolicyStatus,
    default: PolicyStatus.PENDING,
  })
  status!: PolicyStatus;

  // Using numeric for token minor units (avoid floats)
  @Column({ type: "numeric", precision: 20, scale: 0 })
  coverageAmount!: string; // Stored as minor units (e.g., stroops for XLM)

  @Column({ type: "numeric", precision: 20, scale: 0 })
  premiumAmount!: string; // Stored as minor units

  @Column({ type: "numeric", precision: 5, scale: 2 })
  premiumRate!: string; // Annual rate as decimal (e.g., 0.05 = 5%)

  @Column({ type: "timestamp" })
  startDate!: Date;

  @Column({ type: "timestamp" })
  endDate!: Date;

  // Multi-tenancy support - nullable initially
  @Column({ type: "uuid", nullable: true })
  @Index()
  tenantId?: string;

  @Column({ type: "uuid" })
  holderId!: string;

  @ManyToOne(() => User, (user) => user.policies)
  @JoinColumn({ name: "holderId" })
  holder!: User;

  @Column({ type: "varchar", length: 56 })
  holderStellarAddress!: string; // Denormalized for performance

  @Column({ type: "varchar", length: 64, nullable: true })
  smartContractId?: string;

  @Column({ type: "jsonb", nullable: true })
  terms?: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  activatedAt?: Date;

  // Relations
  @OneToMany(() => Claim, (claim) => claim.policy)
  claims!: Claim[];
}