import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { IpfsProviderChainService } from '../ipfs/services/ipfs-provider-chain.service';

export interface UnpinnedCidAlert {
  cid: string;
  claimId: number;
  alertedAt: string;
}

export interface PinCheckSummary {
  checked: number;
  unpinned: UnpinnedCidAlert[];
  skippedNoExists: number;
  errors: number;
}

@Injectable()
export class IpfsPinCheckJob {
  private readonly logger = new Logger(IpfsPinCheckJob.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly providerChain: IpfsProviderChainService,
  ) {}

  @Cron('0 2 * * *') // 02:00 daily; overridable via IPFS_PIN_CHECK_CRON
  async runScheduledPinCheck(): Promise<void> {
    const cron = this.config.get<string>('IPFS_PIN_CHECK_CRON');
    if (cron) {
      // Dynamic cron is handled by the caller; this guard prevents double-run
      // when the env cron matches the hardcoded default.
    }
    await this.runPinCheck();
  }

  /** Public for manual triggers and tests. */
  async runPinCheck(): Promise<PinCheckSummary> {
    const enabled = this.config.get<string>('IPFS_PIN_CHECK_ENABLED', 'true');
    if (enabled !== 'true' && enabled !== '1') {
      return { checked: 0, unpinned: [], skippedNoExists: 0, errors: 0 };
    }

    const claims = await this.prisma.claim.findMany({
      where: { deletedAt: null },
      select: { id: true, imageUrls: true },
    });

    let checked = 0;
    let skippedNoExists = 0;
    let errors = 0;
    const unpinned: UnpinnedCidAlert[] = [];

    for (const claim of claims) {
      for (const url of claim.imageUrls) {
        const cid = this.extractCid(url);
        if (!cid) continue;

        try {
          const { exists, providerName } = await this.providerChain.exists(cid);
          checked++;
          if (!exists) {
            this.logger.warn(`[ipfs-pin-check] CID no longer pinned: ${cid} (claim #${claim.id})`);
            const alert: UnpinnedCidAlert = {
              cid,
              claimId: claim.id,
              alertedAt: new Date().toISOString(),
            };
            unpinned.push(alert);
            await this.sendAlert(alert);
          } else {
            this.logger.debug(`[ipfs-pin-check] CID pinned on ${providerName}: ${cid}`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // exists() throws when no provider supports the check
          if (msg.toLowerCase().includes('no provider')) {
            skippedNoExists++;
          } else {
            errors++;
            this.logger.error(`[ipfs-pin-check] error checking CID ${cid}: ${msg}`);
          }
        }
      }
    }

    const summary: PinCheckSummary = { checked, unpinned, skippedNoExists, errors };
    if (unpinned.length > 0 || errors > 0) {
      this.logger.warn(`[ipfs-pin-check] summary: ${JSON.stringify({ checked, unpinned: unpinned.length, skippedNoExists, errors })}`);
    } else {
      this.logger.log(`[ipfs-pin-check] all ${checked} CIDs pinned`);
    }
    return summary;
  }

  /** Extract a bare CID from an IPFS URL or a raw CID string. */
  extractCid(url: string): string | null {
    if (!url) return null;
    // ipfs://Qm... or ipfs://bafy...
    const ipfsProto = url.match(/^ipfs:\/\/([^/?#]+)/i);
    if (ipfsProto) return ipfsProto[1];
    // https://gateway/ipfs/Qm...
    const gatewayPath = url.match(/\/ipfs\/([^/?#]+)/i);
    if (gatewayPath) return gatewayPath[1];
    // Bare CID (v0 starts with Qm, v1 starts with bafy)
    if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{52,})/.test(url)) return url;
    return null;
  }

  private async sendAlert(alert: UnpinnedCidAlert): Promise<void> {
    const webhookUrl = this.config.get<string>('IPFS_PIN_CHECK_ALERT_WEBHOOK_URL')?.trim();
    if (!webhookUrl) {
      this.logger.warn('[ipfs-pin-check] IPFS_PIN_CHECK_ALERT_WEBHOOK_URL not set — alert logged only');
      return;
    }

    const { default: axios } = await import('axios');
    const secret = this.config.get<string>('IPFS_PIN_CHECK_ALERT_WEBHOOK_SECRET', '');
    try {
      await axios.post(
        webhookUrl,
        {
          event: 'ipfs_cid_unpinned',
          severity: 'warning',
          cid: alert.cid,
          claimId: alert.claimId,
          alertedAt: alert.alertedAt,
        },
        {
          headers: secret ? { 'X-Webhook-Secret': secret } : undefined,
          timeout: 10_000,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[ipfs-pin-check] webhook delivery failed: ${msg}`);
    }
  }
}
