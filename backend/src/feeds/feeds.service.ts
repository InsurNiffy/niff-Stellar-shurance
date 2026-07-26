import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type FinalizedClaim = {
  id: number;
  policyId: string;
  creatorAddress: string;
  amount: string;
  asset: string | null;
  description: string | null;
  status: string;
  updatedAt: Date;
};

export interface ClaimFeedItemDto {
  id: number;
  url: string;
  title: string;
  policyId: string;
  creatorAddress: string;
  amount: string;
  asset: string;
  status: string;
  summary: string;
  updatedAt: string;
}

@Injectable()
export class FeedsService {
  private readonly baseUrl: string;

  /** In-memory cache for the claims Atom feed, warmed at boot via warmClaimsAtomFeedCache(). */
  private claimsAtomFeedCache: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('APP_BASE_URL', 'https://app.niffyinsure.com');
  }

  /** Builds and caches the feed so the first HTTP request doesn't pay generation cost. */
  async warmClaimsAtomFeedCache(): Promise<void> {
    this.claimsAtomFeedCache = await this.buildClaimsAtomFeed();
  }

  async getCachedClaimsAtomFeed(): Promise<string> {
    if (this.claimsAtomFeedCache === null) {
      await this.warmClaimsAtomFeedCache();
    }
    return this.claimsAtomFeedCache as string;
  }

  /** Same underlying data as the Atom feed, as structured JSON (Accept: application/json). */
  async buildClaimsJsonFeed(): Promise<ClaimFeedItemDto[]> {
    const claims = await this.getFinalizedClaims();
    return claims.map((claim) => this.buildJsonItem(claim));
  }

  private async getFinalizedClaims(): Promise<FinalizedClaim[]> {
    return this.prisma.claim.findMany({
      where: { isFinalized: true, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        policyId: true,
        creatorAddress: true,
        amount: true,
        asset: true,
        description: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  async buildClaimsAtomFeed(): Promise<string> {
    const claims = await this.getFinalizedClaims();

    const feedUpdated =
      claims.length > 0 ? claims[0].updatedAt.toISOString() : new Date().toISOString();

    const entries = claims.map((claim) => this.buildEntry(claim)).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>NiffyInsure — Finalized Claims</title>
  <subtitle>The 50 most recently finalized insurance claims on NiffyInsure</subtitle>
  <link href="${this.escapeXml(this.baseUrl)}/feeds/claims.atom" rel="self" type="application/atom+xml"/>
  <link href="${this.escapeXml(this.baseUrl)}" rel="alternate" type="text/html"/>
  <id>${this.escapeXml(this.baseUrl)}/feeds/claims.atom</id>
  <updated>${feedUpdated}</updated>
  <generator uri="https://github.com/InsurNiffy/niff-Stellar-shurance">NiffyInsure API</generator>
${entries}
</feed>`;
  }

  private buildEntry(claim: FinalizedClaim): string {
    const claimUrl = `${this.baseUrl}/claims/${claim.id}`;
    const outcome = claim.status.toLowerCase();
    const asset = claim.asset ?? 'XLM';
    const summary = claim.description
      ? this.escapeXml(claim.description.slice(0, 200))
      : `Claim #${claim.id} for policy ${this.escapeXml(claim.policyId)} was ${outcome}.`;

    return `  <entry>
    <id>${this.escapeXml(claimUrl)}</id>
    <title>Claim #${claim.id} — ${outcome.toUpperCase()} (${this.escapeXml(claim.amount)} ${this.escapeXml(asset)})</title>
    <link href="${this.escapeXml(claimUrl)}" rel="alternate"/>
    <updated>${claim.updatedAt.toISOString()}</updated>
    <author><name>${this.escapeXml(claim.creatorAddress)}</name></author>
    <category term="${outcome}" label="${outcome.charAt(0).toUpperCase() + outcome.slice(1)}"/>
    <summary type="text">${summary}</summary>
    <content type="text">Policy: ${this.escapeXml(claim.policyId)}
Claimant: ${this.escapeXml(claim.creatorAddress)}
Amount: ${this.escapeXml(claim.amount)} ${this.escapeXml(asset)}
Outcome: ${outcome.toUpperCase()}
Finalized: ${claim.updatedAt.toISOString()}</content>
  </entry>`;
  }

  private buildJsonItem(claim: FinalizedClaim): ClaimFeedItemDto {
    const outcome = claim.status.toLowerCase();
    const asset = claim.asset ?? 'XLM';
    const summary = claim.description
      ? claim.description.slice(0, 200)
      : `Claim #${claim.id} for policy ${claim.policyId} was ${outcome}.`;

    return {
      id: claim.id,
      url: `${this.baseUrl}/claims/${claim.id}`,
      title: `Claim #${claim.id} — ${outcome.toUpperCase()} (${claim.amount} ${asset})`,
      policyId: claim.policyId,
      creatorAddress: claim.creatorAddress,
      amount: claim.amount,
      asset,
      status: outcome,
      summary,
      updatedAt: claim.updatedAt.toISOString(),
    };
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
