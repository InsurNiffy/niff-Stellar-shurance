import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';

const HIGH_CHURN_TABLES = ['claims', 'votes', 'raw_events'];

@Injectable()
export class VacuumService {
  private readonly logger = new Logger(VacuumService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Execute non-blocking VACUUM ANALYZE on high-churn tables.
   * Uses SKIP_LOCKED to avoid blocking reads/writes during the operation.
   */
  async runWeeklyVacuum(): Promise<{ success: boolean; tablesVacuumed: string[] }> {
    const vacuumed: string[] = [];
    this.logger.log('Starting weekly VACUUM ANALYZE job');

    for (const table of HIGH_CHURN_TABLES) {
      try {
        await this.prisma.$queryRawUnsafe(`VACUUM (ANALYZE, SKIP_LOCKED) "${table}"`);
        vacuumed.push(table);
        this.logger.log(`Successfully vacuumed table: ${table}`);
        this.metrics?.recordVacuumOperation(table, 'success');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to vacuum table ${table}: ${msg}`);
        this.metrics?.recordVacuumOperation(table, 'failure');
      }
    }

    this.logger.log(`Weekly VACUUM ANALYZE completed: ${vacuumed.length}/${HIGH_CHURN_TABLES.length} tables`);
    return { success: vacuumed.length === HIGH_CHURN_TABLES.length, tablesVacuumed: vacuumed };
  }

  /**
   * Check table bloat ratio for high-churn tables.
   * Returns bloat as a percentage (0-100).
   */
  async getTableBloatRatio(table: string): Promise<number> {
    try {
      const result = await this.prisma.$queryRawUnsafe<
        Array<{ bloat_ratio: number }>
      >(
        `
        SELECT
          ROUND(
            (CASE WHEN live_tuples = 0 THEN 0 ELSE
              (n_dead_tuples::float / (live_tuples + n_dead_tuples)) * 100
            END)::numeric, 2
          ) AS bloat_ratio
        FROM pg_stat_user_tables
        WHERE relname = $1
      `,
        table,
      );

      return result.length > 0 ? result[0].bloat_ratio : 0;
    } catch (err) {
      this.logger.warn(`Failed to get bloat ratio for ${table}: ${err}`);
      return 0;
    }
  }

  /**
   * Check bloat for all high-churn tables and record metrics.
   */
  async monitorTableBloat(): Promise<Record<string, number>> {
    const bloatMap: Record<string, number> = {};

    for (const table of HIGH_CHURN_TABLES) {
      const bloatRatio = await this.getTableBloatRatio(table);
      bloatMap[table] = bloatRatio;
      this.metrics?.recordTableBloat(table, bloatRatio);

      if (bloatRatio > 30) {
        this.logger.warn(`High bloat detected on ${table}: ${bloatRatio}%`);
      }
    }

    return bloatMap;
  }
}
