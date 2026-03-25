import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from "typeorm";

export class CreateCoreTables1700000000000 implements MigrationInterface {
  name = "CreateCoreTables1700000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Create users table
    await queryRunner.createTable(
      new Table({
        name: "users",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "stellarAddress",
            type: "varchar",
            length: "56",
            isNullable: true,
          },
          {
            name: "email",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "passwordHash",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "role",
            type: "enum",
            enum: ["admin", "staff", "holder"],
            default: "'holder'",
          },
          {
            name: "isActive",
            type: "boolean",
            default: true,
          },
          {
            name: "tenantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "fullName",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "phone",
            type: "varchar",
            length: "20",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "lastLoginAt",
            type: "timestamp",
            isNullable: true,
          },
        ],
      }),
      true
    );

    // Create indexes for users
    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "IDX_users_stellarAddress",
        columnNames: ["stellarAddress"],
      })
    );
    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "IDX_users_tenantId",
        columnNames: ["tenantId"],
      })
    );
    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "IDX_users_email",
        columnNames: ["email"],
      })
    );

    // Create policies table
    await queryRunner.createTable(
      new Table({
        name: "policies",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "policyNumber",
            type: "varchar",
            length: "64",
            isUnique: true,
          },
          {
            name: "policyType",
            type: "enum",
            enum: ["premium", "claim"],
            default: "'premium'",
          },
          {
            name: "status",
            type: "enum",
            enum: ["active", "expired", "cancelled", "pending"],
            default: "'pending'",
          },
          {
            name: "coverageAmount",
            type: "numeric",
            precision: 20,
            scale: 0,
          },
          {
            name: "premiumAmount",
            type: "numeric",
            precision: 20,
            scale: 0,
          },
          {
            name: "premiumRate",
            type: "numeric",
            precision: 5,
            scale: 2,
          },
          {
            name: "startDate",
            type: "timestamp",
          },
          {
            name: "endDate",
            type: "timestamp",
          },
          {
            name: "tenantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "holderId",
            type: "uuid",
          },
          {
            name: "holderStellarAddress",
            type: "varchar",
            length: "56",
          },
          {
            name: "smartContractId",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "terms",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "activatedAt",
            type: "timestamp",
            isNullable: true,
          },
        ],
      }),
      true
    );

    // Create indexes for policies
    await queryRunner.createIndex(
      "policies",
      new TableIndex({
        name: "IDX_policies_policyNumber",
        columnNames: ["policyNumber"],
      })
    );
    await queryRunner.createIndex(
      "policies",
      new TableIndex({
        name: "IDX_policies_tenantId_holderId",
        columnNames: ["tenantId", "holderId"],
      })
    );
    await queryRunner.createIndex(
      "policies",
      new TableIndex({
        name: "IDX_policies_tenantId_policyType",
        columnNames: ["tenantId", "policyType"],
      })
    );
    await queryRunner.createIndex(
      "policies",
      new TableIndex({
        name: "IDX_policies_tenantId_status",
        columnNames: ["tenantId", "status"],
      })
    );
    await queryRunner.createIndex(
      "policies",
      new TableIndex({
        name: "IDX_policies_tenantId_createdAt",
        columnNames: ["tenantId", "createdAt"],
      })
    );

    // Create foreign key for policies.holderId -> users.id
    await queryRunner.createForeignKey(
      "policies",
      new TableForeignKey({
        name: "FK_policies_holderId",
        columnNames: ["holderId"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "RESTRICT",
      })
    );

    // Create claims table
    await queryRunner.createTable(
      new Table({
        name: "claims",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "claimNumber",
            type: "varchar",
            length: "64",
            isUnique: true,
          },
          {
            name: "status",
            type: "enum",
            enum: [
              "submitted",
              "under_review",
              "approved",
              "rejected",
              "paid",
              "disputed",
              "expired",
            ],
            default: "'submitted'",
          },
          {
            name: "priority",
            type: "enum",
            enum: ["low", "medium", "high", "critical"],
            default: "'medium'",
          },
          {
            name: "claimedAmount",
            type: "numeric",
            precision: 20,
            scale: 0,
          },
          {
            name: "approvedAmount",
            type: "numeric",
            precision: 20,
            scale: 0,
            isNullable: true,
          },
          {
            name: "description",
            type: "text",
          },
          {
            name: "evidence",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "incidentDate",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "incidentDateTimestamp",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "tenantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "policyId",
            type: "uuid",
          },
          {
            name: "holderId",
            type: "uuid",
          },
          {
            name: "holderStellarAddress",
            type: "varchar",
            length: "56",
          },
          {
            name: "reviewerNotes",
            type: "text",
            isNullable: true,
          },
          {
            name: "reviewedBy",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "reviewedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "transactionHash",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "resolvedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "paidAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "voteCount",
            type: "integer",
            default: 0,
          },
          {
            name: "approvalCount",
            type: "integer",
            default: 0,
          },
          {
            name: "rejectionCount",
            type: "integer",
            default: 0,
          },
        ],
      }),
      true
    );

    // Create indexes for claims
    await queryRunner.createIndex(
      "claims",
      new TableIndex({
        name: "IDX_claims_claimNumber",
        columnNames: ["claimNumber"],
      })
    );
    await queryRunner.createIndex(
      "claims",
      new TableIndex({
        name: "IDX_claims_tenantId_policyId",
        columnNames: ["tenantId", "policyId"],
      })
    );
    await queryRunner.createIndex(
      "claims",
      new TableIndex({
        name: "IDX_claims_tenantId_status",
        columnNames: ["tenantId", "status"],
      })
    );
    await queryRunner.createIndex(
      "claims",
      new TableIndex({
        name: "IDX_claims_tenantId_holderId",
        columnNames: ["tenantId", "holderId"],
      })
    );
    await queryRunner.createIndex(
      "claims",
      new TableIndex({
        name: "IDX_claims_tenantId_createdAt",
        columnNames: ["tenantId", "createdAt"],
      })
    );
    await queryRunner.createIndex(
      "claims",
      new TableIndex({
        name: "IDX_claims_tenantId_priority",
        columnNames: ["tenantId", "priority"],
      })
    );

    // Create foreign keys for claims
    await queryRunner.createForeignKey(
      "claims",
      new TableForeignKey({
        name: "FK_claims_policyId",
        columnNames: ["policyId"],
        referencedTableName: "policies",
        referencedColumnNames: ["id"],
        onDelete: "RESTRICT",
      })
    );
    await queryRunner.createForeignKey(
      "claims",
      new TableForeignKey({
        name: "FK_claims_holderId",
        columnNames: ["holderId"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "RESTRICT",
      })
    );
    await queryRunner.createForeignKey(
      "claims",
      new TableForeignKey({
        name: "FK_claims_reviewedBy",
        columnNames: ["reviewedBy"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "SET NULL",
      })
    );

    // Create votes table
    await queryRunner.createTable(
      new Table({
        name: "votes",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "voteType",
            type: "enum",
            enum: ["approve", "reject"],
          },
          {
            name: "status",
            type: "enum",
            enum: ["pending", "confirmed", "rejected"],
            default: "'pending'",
          },
          {
            name: "reason",
            type: "text",
            isNullable: true,
          },
          {
            name: "stakedAmount",
            type: "numeric",
            precision: 20,
            scale: 0,
          },
          {
            name: "tenantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "claimId",
            type: "uuid",
          },
          {
            name: "voterId",
            type: "uuid",
          },
          {
            name: "voterStellarAddress",
            type: "varchar",
            length: "56",
          },
          {
            name: "transactionHash",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "confirmedAt",
            type: "timestamp",
            isNullable: true,
          },
        ],
      }),
      true
    );

    // Create indexes for votes
    await queryRunner.createIndex(
      "votes",
      new TableIndex({
        name: "IDX_votes_tenantId_claimId",
        columnNames: ["tenantId", "claimId"],
      })
    );
    await queryRunner.createIndex(
      "votes",
      new TableIndex({
        name: "IDX_votes_tenantId_voterId",
        columnNames: ["tenantId", "voterId"],
      })
    );
    await queryRunner.createIndex(
      "votes",
      new TableIndex({
        name: "IDX_votes_tenantId_createdAt",
        columnNames: ["tenantId", "createdAt"],
      })
    );
    await queryRunner.createIndex(
      "votes",
      new TableIndex({
        name: "IDX_votes_tenantId_voteType",
        columnNames: ["tenantId", "voteType"],
      })
    );

    // Create foreign keys for votes
    await queryRunner.createForeignKey(
      "votes",
      new TableForeignKey({
        name: "FK_votes_claimId",
        columnNames: ["claimId"],
        referencedTableName: "claims",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      })
    );
    await queryRunner.createForeignKey(
      "votes",
      new TableForeignKey({
        name: "FK_votes_voterId",
        columnNames: ["voterId"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "RESTRICT",
      })
    );

    // Create raw_events table
    await queryRunner.createTable(
      new Table({
        name: "raw_events",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "eventType",
            type: "enum",
            enum: [
              "policy_created",
              "premium_paid",
              "claim_submitted",
              "claim_approved",
              "claim_rejected",
              "claim_paid",
              "vote_submitted",
              "token_transfer",
              "token_mint",
              "token_burn",
            ],
          },
          {
            name: "status",
            type: "enum",
            enum: ["pending", "processed", "failed", "duplicate"],
            default: "'pending'",
          },
          {
            name: "eventId",
            type: "varchar",
            length: "64",
          },
          {
            name: "ledger",
            type: "bigint",
          },
          {
            name: "ledgerTimestamp",
            type: "timestamp",
          },
          {
            name: "sourceAddress",
            type: "varchar",
            length: "56",
          },
          {
            name: "eventData",
            type: "jsonb",
          },
          {
            name: "errorMessage",
            type: "text",
            isNullable: true,
          },
          {
            name: "tenantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "processedBy",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "processedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
        ],
      }),
      true
    );

    // Create indexes for raw_events
    await queryRunner.createIndex(
      "raw_events",
      new TableIndex({
        name: "IDX_raw_events_tenantId_eventType",
        columnNames: ["tenantId", "eventType"],
      })
    );
    await queryRunner.createIndex(
      "raw_events",
      new TableIndex({
        name: "IDX_raw_events_tenantId_status",
        columnNames: ["tenantId", "status"],
      })
    );
    await queryRunner.createIndex(
      "raw_events",
      new TableIndex({
        name: "IDX_raw_events_tenantId_ledgerTimestamp",
        columnNames: ["tenantId", "ledgerTimestamp"],
      })
    );
    await queryRunner.createIndex(
      "raw_events",
      new TableIndex({
        name: "IDX_raw_events_ledgerTimestamp",
        columnNames: ["ledgerTimestamp"],
      })
    );
    await queryRunner.createIndex(
      "raw_events",
      new TableIndex({
        name: "IDX_raw_events_eventType_createdAt",
        columnNames: ["eventType", "createdAt"],
      })
    );

    // Create ledger_cursors table
    await queryRunner.createTable(
      new Table({
        name: "ledger_cursors",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "ingestionType",
            type: "varchar",
            length: "50",
          },
          {
            name: "lastLedger",
            type: "bigint",
          },
          {
            name: "lastLedgerTimestamp",
            type: "timestamp",
          },
          {
            name: "lastCursor",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "tenantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "lastSyncAt",
            type: "timestamp",
            isNullable: true,
          },
        ],
      }),
      true
    );

    // Create indexes for ledger_cursors
    await queryRunner.createIndex(
      "ledger_cursors",
      new TableIndex({
        name: "IDX_ledger_cursors_tenantId_ingestionType",
        columnNames: ["tenantId", "ingestionType"],
      })
    );
    await queryRunner.createIndex(
      "ledger_cursors",
      new TableIndex({
        name: "IDX_ledger_cursors_tenantId",
        columnNames: ["tenantId"],
      })
    );

    // Create notification_preferences table
    await queryRunner.createTable(
      new Table({
        name: "notification_preferences",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "channel",
            type: "enum",
            enum: ["email", "sms", "push", "webhook"],
          },
          {
            name: "eventType",
            type: "enum",
            enum: [
              "policy_created",
              "premium_due",
              "premium_paid",
              "claim_submitted",
              "claim_status_changed",
              "claim_paid",
              "vote_received",
              "vote_resolved",
              "policy_expiring",
              "policy_expired",
            ],
          },
          {
            name: "enabled",
            type: "boolean",
            default: true,
          },
          {
            name: "destination",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "settings",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "tenantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "userId",
            type: "uuid",
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "now()",
          },
        ],
      }),
      true
    );

    // Create indexes for notification_preferences
    await queryRunner.createIndex(
      "notification_preferences",
      new TableIndex({
        name: "IDX_notification_preferences_tenantId_userId",
        columnNames: ["tenantId", "userId"],
      })
    );
    await queryRunner.createIndex(
      "notification_preferences",
      new TableIndex({
        name: "IDX_notification_preferences_tenantId_channel",
        columnNames: ["tenantId", "channel"],
      })
    );
    await queryRunner.createIndex(
      "notification_preferences",
      new TableIndex({
        name: "IDX_notification_preferences_tenantId_eventType",
        columnNames: ["tenantId", "eventType"],
      })
    );

    // Create foreign key for notification_preferences.userId -> users.id
    await queryRunner.createForeignKey(
      "notification_preferences",
      new TableForeignKey({
        name: "FK_notification_preferences_userId",
        columnNames: ["userId"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      })
    );

    // Create audit_logs table
    await queryRunner.createTable(
      new Table({
        name: "audit_logs",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "action",
            type: "enum",
            enum: [
              "user_created",
              "user_updated",
              "user_deactivated",
              "user_login",
              "user_logout",
              "policy_created",
              "policy_updated",
              "policy_cancelled",
              "policy_activated",
              "claim_created",
              "claim_updated",
              "claim_reviewed",
              "claim_approved",
              "claim_rejected",
              "claim_paid",
              "vote_processed",
              "config_updated",
              "migration_run",
              "manual_override",
            ],
          },
          {
            name: "severity",
            type: "enum",
            enum: ["info", "warning", "error", "critical"],
            default: "'info'",
          },
          {
            name: "description",
            type: "text",
          },
          {
            name: "oldValue",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "newValue",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "tenantId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "actorId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "actorIp",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "actorUserAgent",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "targetType",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "targetId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
        ],
      }),
      true
    );

    // Create indexes for audit_logs
    await queryRunner.createIndex(
      "audit_logs",
      new TableIndex({
        name: "IDX_audit_logs_tenantId_action",
        columnNames: ["tenantId", "action"],
      })
    );
    await queryRunner.createIndex(
      "audit_logs",
      new TableIndex({
        name: "IDX_audit_logs_tenantId_actorId",
        columnNames: ["tenantId", "actorId"],
      })
    );
    await queryRunner.createIndex(
      "audit_logs",
      new TableIndex({
        name: "IDX_audit_logs_tenantId_createdAt",
        columnNames: ["tenantId", "createdAt"],
      })
    );
    await queryRunner.createIndex(
      "audit_logs",
      new TableIndex({
        name: "IDX_audit_logs_tenantId_severity",
        columnNames: ["tenantId", "severity"],
      })
    );
    await queryRunner.createIndex(
      "audit_logs",
      new TableIndex({
        name: "IDX_audit_logs_createdAt",
        columnNames: ["createdAt"],
      })
    );

    // Create foreign key for audit_logs.actorId -> users.id
    await queryRunner.createForeignKey(
      "audit_logs",
      new TableForeignKey({
        name: "FK_audit_logs_actorId",
        columnNames: ["actorId"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "SET NULL",
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    await queryRunner.dropForeignKey("audit_logs", "FK_audit_logs_actorId");
    await queryRunner.dropForeignKey(
      "notification_preferences",
      "FK_notification_preferences_userId"
    );
    await queryRunner.dropForeignKey("votes", "FK_votes_voterId");
    await queryRunner.dropForeignKey("votes", "FK_votes_claimId");
    await queryRunner.dropForeignKey("claims", "FK_claims_reviewedBy");
    await queryRunner.dropForeignKey("claims", "FK_claims_holderId");
    await queryRunner.dropForeignKey("claims", "FK_claims_policyId");
    await queryRunner.dropForeignKey("policies", "FK_policies_holderId");

    // Drop tables
    await queryRunner.dropTable("audit_logs");
    await queryRunner.dropTable("notification_preferences");
    await queryRunner.dropTable("ledger_cursors");
    await queryRunner.dropTable("raw_events");
    await queryRunner.dropTable("votes");
    await queryRunner.dropTable("claims");
    await queryRunner.dropTable("policies");
    await queryRunner.dropTable("users");
  }
}