import { ApiProperty } from '@nestjs/swagger';

export class TenantConfigAuditEntryDto {
  @ApiProperty({
    description: 'Unique identifier for this audit log entry',
    example: 'c7f8e9c0-1a2b-4d5e-6f7g-8h9i0j1k2l3m',
  })
  id!: string;

  @ApiProperty({
    description: 'Tenant identifier',
    example: 'acme-corp',
  })
  tenantId!: string;

  @ApiProperty({
    description: 'Actor who made the change (wallet address or email)',
    example: 'admin@example.com',
  })
  actor!: string;

  @ApiProperty({
    description: 'Configuration key that was changed',
    example: 'solvency_buffer_threshold',
  })
  key!: string;

  @ApiProperty({
    description: 'Previous value (JSON-serialized), null if newly added',
    example: '"5000000000"',
    nullable: true,
  })
  oldValue!: string | null;

  @ApiProperty({
    description: 'New value (JSON-serialized)',
    example: '"10000000000"',
  })
  newValue!: string;

  @ApiProperty({
    description: 'Timestamp when the change was recorded (UTC)',
    example: '2026-07-26T10:30:45.123Z',
  })
  createdAt!: Date;
}

export class TenantConfigAuditHistoryDto {
  @ApiProperty({
    description: 'Audit log entries in chronological order',
    type: [TenantConfigAuditEntryDto],
  })
  entries!: TenantConfigAuditEntryDto[];

  @ApiProperty({
    description: 'Total count of audit entries matching the query',
    example: 42,
  })
  total!: number;

  @ApiProperty({
    description: 'Number of entries returned',
    example: 20,
  })
  count!: number;
}
