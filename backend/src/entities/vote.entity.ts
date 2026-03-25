import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./user.entity";
import { Claim } from "./claim.entity";

export enum VoteType {
  APPROVE = "approve",
  REJECT = "reject",
}

export enum VoteStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  REJECTED = "rejected",
}

@Entity("votes")
@Index(["tenantId", "claimId"])
@Index(["tenantId", "voterId"])
@Index(["tenantId", "createdAt"])
@Index(["tenantId", "voteType"])
export class Vote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({
    type: "enum",
    enum: VoteType,
  })
  voteType!: VoteType;

  @Column({
    type: "enum",
    enum: VoteStatus,
    default: VoteStatus.PENDING,
  })
  status!: VoteStatus;

  @Column({ type: "text", nullable: true })
  reason?: string;

  // Using numeric for token minor units (avoid floats)
  @Column({ type: "numeric", precision: 20, scale: 0 })
  stakedAmount!: string; // Amount of tokens staked on this vote

  // Multi-tenancy support - nullable initially
  @Column({ type: "uuid", nullable: true })
  @Index()
  tenantId?: string;

  @Column({ type: "uuid" })
  claimId!: string;

  @ManyToOne(() => Claim, (claim) => claim.votes, { onDelete: "CASCADE" })
  @JoinColumn({ name: "claimId" })
  claim!: Claim;

  @Column({ type: "uuid" })
  voterId!: string;

  @ManyToOne(() => User, (user) => user.votes)
  @JoinColumn({ name: "voterId" })
  voter!: User;

  @Column({ type: "varchar", length: 56 })
  voterStellarAddress!: string; // Denormalized for performance

  @Column({ type: "varchar", length: 64, nullable: true })
  transactionHash?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  confirmedAt?: Date;
}