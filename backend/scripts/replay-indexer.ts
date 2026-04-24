import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { SorobanService } from '../src/rpc/soroban.service';
import { IndexerService } from '../src/indexer/indexer.service';

interface CliArgs {
  fromLedger?: number;
  network?: string;
  output?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--from-ledger' && next) {
      args.fromLedger = Number(next);
      index += 1;
      continue;
    }

    if (token === '--network' && next) {
      args.network = next;
      index += 1;
      continue;
    }

    if (token === '--output' && next) {
      args.output = next;
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = new ConfigService(process.env as Record<string, string>);
  const databaseUrl = config.get<string>('DATABASE_URL');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  const soroban = new SorobanService(config);
  const indexer = new IndexerService(prisma as never, soroban, config);
  const startedAt = new Date();

  await prisma.$connect();

  try {
    const network = args.network ?? config.get<string>('STELLAR_NETWORK', 'testnet');

    if (typeof args.fromLedger === 'number') {
      if (!Number.isInteger(args.fromLedger) || args.fromLedger < 0) {
        throw new Error(`Invalid --from-ledger value: ${args.fromLedger}`);
      }

      await prisma.ledgerCursor.upsert({
        where: { network },
        create: {
          network,
          lastProcessedLedger: Math.max(0, args.fromLedger - 1),
        },
        update: {
          lastProcessedLedger: Math.max(0, args.fromLedger - 1),
        },
      });
    }

    const cursorBefore = await prisma.ledgerCursor.findUnique({
      where: { network },
    });
    const latestLedgerAtStart = await soroban.getLatestLedger();
    const result = await indexer.processUntilCaughtUp(network);
    const cursorAfter = await prisma.ledgerCursor.findUnique({
      where: { network },
    });
    const completedAt = new Date();

    const evidence = {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      network,
      requestedFromLedger: args.fromLedger ?? null,
      latestLedgerAtStart,
      cursorBefore: cursorBefore?.lastProcessedLedger ?? null,
      cursorAfter: cursorAfter?.lastProcessedLedger ?? null,
      batchesProcessed: result.batches,
      eventsProcessed: result.events,
      durationSeconds: Number(
        ((completedAt.getTime() - startedAt.getTime()) / 1000).toFixed(3),
      ),
    };

    if (args.output) {
      mkdirSync(dirname(args.output), { recursive: true });
      writeFileSync(args.output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    }

    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
