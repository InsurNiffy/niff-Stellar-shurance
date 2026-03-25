import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./user.entity";

export enum AuditAction {
  // User management
  USER_CREATED = "user_created",
  USER_UPDATED = "user_updated",
  USER_DEACTIVATED = "user_deactivated",
  USER_LOGIN = "user_login",
  USER_LOGOUT = "user_logout",

  // Policy management
  POLICY_CREATED = "policy_created",
  POLICY_UPDATED = "policy_updated",
  POLICY_CANCELLED = "policy_cancelled",
  POLICY_ACTIVATED = "policy_activated",

  // Claim management
  CLAIM_CREATED = "claim_created",
  CLAIM_UPDATED = "claim_updated",
  CLAIM_REVIEWED = "claim_reviewed",
  CLAIM_APPROVED = "claim_approved",
  CLAIM_REJECTED = "claim_rejected",
  CLAIM_PAID = "claim_paid",

  // Vote management
  VOTE_PROCESSED = "vote_processed",

  // System
  CONFIG_UPDATED = "config_updated",
  MIGRATION_RUN = "migration_run",
  MANUAL_OVERRIDE = "manual_override",
}

export enum AuditSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

@Entity("audit_logs")
@Index(["tenantId", "action"])
@Index(["tenantId", "actorId"])
@Index(["tenantId", "createdAt"])
@Index(["tenantId", "severity"])
@Index(["createdAt"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({
    type: "enum",
    enum: AuditAction,
  })
  @Index()
  action!: AuditAction;

  @Column({
    type: "enum",
    enum: AuditSeverity,
    default: AuditSeverity.INFO,
  })
  severity!: AuditSeverity;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "jsonb", nullable: true })
  oldValue?: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  newValue?: Record<string, unknown>;

  // Multi-tenancy support - nullable initially
  @Column({ type: "uuid", nullable: true })
  @Index()
  tenantId?: string;

  @Column({ type: "uuid", nullable: true })
  actorId?: string;

  @ManyToOne(() => User, (user) => user.auditLogs, { nullable: true })
  @JoinColumn({ name: "actorId" })
  actor?: User;

  @Column({ type: "varchar", length: 255, nullable: true })
  actorIp?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  actorUserAgent?: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  targetType?: string; // e.g., "Policy", "Claim", "User"

  @Column({ type: "uuid", nullable: true })
  targetId?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}