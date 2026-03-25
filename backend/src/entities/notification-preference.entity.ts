import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./user.entity";

export enum NotificationChannel {
  EMAIL = "email",
  SMS = "sms",
  PUSH = "push",
  WEBHOOK = "webhook",
}

export enum NotificationEventType {
  POLICY_CREATED = "policy_created",
  PREMIUM_DUE = "premium_due",
  PREMIUM_PAID = "premium_paid",
  CLAIM_SUBMITTED = "claim_submitted",
  CLAIM_STATUS_CHANGED = "claim_status_changed",
  CLAIM_PAID = "claim_paid",
  VOTE_RECEIVED = "vote_received",
  VOTE_RESOLVED = "vote_resolved",
  POLICY_EXPIRING = "policy_expiring",
  POLICY_EXPIRED = "policy_expired",
}

@Entity("notification_preferences")
@Index(["tenantId", "userId"])
@Index(["tenantId", "channel"])
@Index(["tenantId", "eventType"])
export class NotificationPreference {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({
    type: "enum",
    enum: NotificationChannel,
  })
  channel!: NotificationChannel;

  @Column({
    type: "enum",
    enum: NotificationEventType,
  })
  eventType!: NotificationEventType;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  destination?: string; // Email, phone, webhook URL

  @Column({ type: "jsonb", nullable: true })
  settings?: Record<string, unknown>; // Channel-specific settings

  // Multi-tenancy support - nullable initially
  @Column({ type: "uuid", nullable: true })
  @Index()
  tenantId?: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, (user) => user.notificationPreferences, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "userId" })
  user!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}