import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from "typeorm";
import { Policy } from "./policy.entity";
import { Claim } from "./claim.entity";
import { Vote } from "./vote.entity";
import { NotificationPreference } from "./notification-preference.entity";
import { AuditLog } from "./audit-log.entity";

export enum UserRole {
  ADMIN = "admin",
  STAFF = "staff",
  HOLDER = "holder",
}

@Entity("users")
@Index(["tenantId", "stellarAddress"])
@Index(["tenantId", "email"])
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 56, nullable: true })
  @Index()
  stellarAddress?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  email?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  passwordHash?: string;

  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.HOLDER,
  })
  role!: UserRole;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  // Multi-tenancy support - nullable initially
  @Column({ type: "uuid", nullable: true })
  @Index()
  tenantId?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  fullName?: string;

  @Column({ type: "varchar", length: 20, nullable: true })
  phone?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  lastLoginAt?: Date;

  // Relations
  @OneToMany(() => Policy, (policy) => policy.holder)
  policies!: Policy[];

  @OneToMany(() => Claim, (claim) => claim.holder)
  claims!: Claim[];

  @OneToMany(() => Vote, (vote) => vote.voter)
  votes!: Vote[];

  @OneToMany(
    () => NotificationPreference,
    (pref) => pref.user
  )
  notificationPreferences!: NotificationPreference[];

  @OneToMany(() => AuditLog, (log) => log.actor)
  auditLogs!: AuditLog[];
}