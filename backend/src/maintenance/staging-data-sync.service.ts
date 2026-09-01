import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createAnonymizationContext, anonymizePolicies, anonymizeClaims, anonymizeVotes, anonymizeHolderProfiles, anonymizeSupportTickets, anonymizeSupportTicketReplies, anonymizeNotifications, anonymizeNotificationPreferences, anonymizeRampTransactions, anonymizeClaimComments, anonymizeEvidenceMetadata, anonymizeRegisteredVoters, anonymizePosts } from '../staging/anonymization.transform';

export interface SyncStatistics {
  tablesProcessed: string[];
  rowsPerTable: { [table: string]: number };
  totalRows: number;
  samplingStrategy: string;
  drySyntax: boolean;
  timestamp: Date;
}

@Injectable()
export class StagingDataSyncService {
  private readonly logger = new Logger(StagingDataSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async dryRun(): Promise<SyncStatistics> {
    this.logger.log('[staging-data-sync] Starting dry-run...');

    const stats: SyncStatistics = {
      tablesProcessed: [],
      rowsPerTable: {},
      totalRows: 0,
      samplingStrategy: 'representative_sample: 1000 recent claims + related policies/votes/comments',
      drySyntax: true,
      timestamp: new Date(),
    };

    try {
      // Count claims (sample: last 1000)
      const claimsCount = await this.prisma.claim.count();
      const sampleClaimsCount = Math.min(1000, claimsCount);
      stats.rowsPerTable['claims'] = sampleClaimsCount;
      stats.tablesProcessed.push('claims');
      this.logger.debug(`  claims: ${sampleClaimsCount} rows (out of ${claimsCount} total)`);

      // Count related policies (unique from sample claims)
      const sampleClaims = await this.prisma.claim.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
        select: { policyId: true },
        distinct: ['policyId'],
      });
      const policiesCount = sampleClaims.length;
      stats.rowsPerTable['policies'] = policiesCount;
      stats.tablesProcessed.push('policies');
      this.logger.debug(`  policies: ${policiesCount} rows (related to sample claims)`);

      // Count votes for sample claims
      const votesCount = await this.prisma.vote.count({
        where: {
          claimId: { in: sampleClaims.map((c) => parseInt(c.policyId.split(':')[1] || '0', 10)) },
        },
      });
      stats.rowsPerTable['votes'] = votesCount;
      stats.tablesProcessed.push('votes');
      this.logger.debug(`  votes: ${votesCount} rows (for sample claims)`);

      // Count holder profiles (sample recent active)
      const profilesCount = await this.prisma.holderProfile.count();
      const sampleProfilesCount = Math.min(500, profilesCount);
      stats.rowsPerTable['holder_profiles'] = sampleProfilesCount;
      stats.tablesProcessed.push('holder_profiles');
      this.logger.debug(`  holder_profiles: ${sampleProfilesCount} rows (out of ${profilesCount} total)`);

      // Count support tickets (sample recent)
      const ticketsCount = await this.prisma.supportTicket.count();
      const sampleTicketsCount = Math.min(500, ticketsCount);
      stats.rowsPerTable['support_tickets'] = sampleTicketsCount;
      stats.tablesProcessed.push('support_tickets');
      this.logger.debug(`  support_tickets: ${sampleTicketsCount} rows (out of ${ticketsCount} total)`);

      // Count support ticket replies
      const repliesCount = await this.prisma.supportTicketReply.count();
      const sampleRepliesCount = Math.min(1000, repliesCount);
      stats.rowsPerTable['support_ticket_replies'] = sampleRepliesCount;
      stats.tablesProcessed.push('support_ticket_replies');
      this.logger.debug(`  support_ticket_replies: ${sampleRepliesCount} rows`);

      // Count notifications (sample recent)
      const notificationsCount = await this.prisma.notification.count();
      const sampleNotificationsCount = Math.min(1000, notificationsCount);
      stats.rowsPerTable['notifications'] = sampleNotificationsCount;
      stats.tablesProcessed.push('notifications');
      this.logger.debug(`  notifications: ${sampleNotificationsCount} rows`);

      // Count notification preferences (all, small table)
      const prefsCount = await this.prisma.notificationPreference.count();
      stats.rowsPerTable['notification_preferences'] = prefsCount;
      stats.tablesProcessed.push('notification_preferences');
      this.logger.debug(`  notification_preferences: ${prefsCount} rows`);

      // Count ramp transactions (sample recent)
      const rampsCount = await this.prisma.rampTransaction.count();
      const sampleRampsCount = Math.min(1000, rampsCount);
      stats.rowsPerTable['ramp_transactions'] = sampleRampsCount;
      stats.tablesProcessed.push('ramp_transactions');
      this.logger.debug(`  ramp_transactions: ${sampleRampsCount} rows`);

      // Count claim comments
      const commentsCount = await this.prisma.claimComment.count();
      const sampleCommentsCount = Math.min(1000, commentsCount);
      stats.rowsPerTable['claim_comments'] = sampleCommentsCount;
      stats.tablesProcessed.push('claim_comments');
      this.logger.debug(`  claim_comments: ${sampleCommentsCount} rows`);

      // Count evidence metadata
      const evidenceCount = await this.prisma.evidenceMetadata.count();
      const sampleEvidenceCount = Math.min(1000, evidenceCount);
      stats.rowsPerTable['evidence_metadata'] = sampleEvidenceCount;
      stats.tablesProcessed.push('evidence_metadata');
      this.logger.debug(`  evidence_metadata: ${sampleEvidenceCount} rows`);

      // Count registered voters (all, small table)
      const votersCount = await this.prisma.registeredVoter.count();
      stats.rowsPerTable['registered_voters'] = votersCount;
      stats.tablesProcessed.push('registered_voters');
      this.logger.debug(`  registered_voters: ${votersCount} rows`);

      // Count posts
      const postsCount = await this.prisma.post.count();
      const samplePostsCount = Math.min(1000, postsCount);
      stats.rowsPerTable['posts'] = samplePostsCount;
      stats.tablesProcessed.push('posts');
      this.logger.debug(`  posts: ${samplePostsCount} rows`);

      stats.totalRows = Object.values(stats.rowsPerTable).reduce((a, b) => a + b, 0);

      this.logger.log(`[staging-data-sync] Dry-run complete. Total rows to sync: ${stats.totalRows}`);
    } catch (err) {
      this.logger.error(`[staging-data-sync] Dry-run failed: ${(err as Error).message}`);
      throw err;
    }

    return stats;
  }

  async sync(): Promise<SyncStatistics> {
    this.logger.warn(
      '[staging-data-sync] WARNING: This job is NOT PRODUCTION-READY and should NOT be enabled without compliance review.',
    );
    this.logger.log('[staging-data-sync] Starting anonymized data sync to staging...');

    const stats: SyncStatistics = {
      tablesProcessed: [],
      rowsPerTable: {},
      totalRows: 0,
      samplingStrategy: 'representative_sample: 1000 recent claims + related policies/votes/comments',
      drySyntax: false,
      timestamp: new Date(),
    };

    const ctx = createAnonymizationContext();

    try {
      // Sync claims (last 1000)
      const claims = await this.prisma.claim.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });
      const anonClaims = anonymizeClaims(claims, ctx);
      stats.rowsPerTable['claims'] = anonClaims.length;
      stats.tablesProcessed.push('claims');
      this.logger.debug(`  Anonymized ${anonClaims.length} claims`);

      // Sync related policies
      const policyIds = [...new Set(claims.map((c) => c.policyId))];
      const policies = await this.prisma.policy.findMany({
        where: { id: { in: policyIds } },
      });
      const anonPolicies = anonymizePolicies(policies, ctx);
      stats.rowsPerTable['policies'] = anonPolicies.length;
      stats.tablesProcessed.push('policies');
      this.logger.debug(`  Anonymized ${anonPolicies.length} policies`);

      // Sync votes for claims
      const votes = await this.prisma.vote.findMany({
        where: { claimId: { in: claims.map((c) => c.id) } },
      });
      const anonVotes = anonymizeVotes(votes, ctx);
      stats.rowsPerTable['votes'] = anonVotes.length;
      stats.tablesProcessed.push('votes');
      this.logger.debug(`  Anonymized ${anonVotes.length} votes`);

      // Sync holder profiles (last 500)
      const profiles = await this.prisma.holderProfile.findMany({
        take: 500,
        orderBy: { createdAt: 'desc' },
      });
      const anonProfiles = anonymizeHolderProfiles(profiles, ctx);
      stats.rowsPerTable['holder_profiles'] = anonProfiles.length;
      stats.tablesProcessed.push('holder_profiles');
      this.logger.debug(`  Anonymized ${anonProfiles.length} holder profiles`);

      // Sync support tickets (last 500)
      const tickets = await this.prisma.supportTicket.findMany({
        take: 500,
        orderBy: { createdAt: 'desc' },
      });
      const anonTickets = anonymizeSupportTickets(tickets, ctx);
      stats.rowsPerTable['support_tickets'] = anonTickets.length;
      stats.tablesProcessed.push('support_tickets');
      this.logger.debug(`  Anonymized ${anonTickets.length} support tickets`);

      // Sync support ticket replies
      const replies = await this.prisma.supportTicketReply.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });
      const anonReplies = anonymizeSupportTicketReplies(replies, ctx);
      stats.rowsPerTable['support_ticket_replies'] = anonReplies.length;
      stats.tablesProcessed.push('support_ticket_replies');
      this.logger.debug(`  Anonymized ${anonReplies.length} support ticket replies`);

      // Sync notifications (last 1000)
      const notifications = await this.prisma.notification.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });
      const anonNotifications = anonymizeNotifications(notifications, ctx);
      stats.rowsPerTable['notifications'] = anonNotifications.length;
      stats.tablesProcessed.push('notifications');
      this.logger.debug(`  Anonymized ${anonNotifications.length} notifications`);

      // Sync notification preferences
      const prefs = await this.prisma.notificationPreference.findMany();
      const anonPrefs = anonymizeNotificationPreferences(prefs, ctx);
      stats.rowsPerTable['notification_preferences'] = anonPrefs.length;
      stats.tablesProcessed.push('notification_preferences');
      this.logger.debug(`  Anonymized ${anonPrefs.length} notification preferences`);

      // Sync ramp transactions (last 1000)
      const ramps = await this.prisma.rampTransaction.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });
      const anonRamps = anonymizeRampTransactions(ramps, ctx);
      stats.rowsPerTable['ramp_transactions'] = anonRamps.length;
      stats.tablesProcessed.push('ramp_transactions');
      this.logger.debug(`  Anonymized ${anonRamps.length} ramp transactions`);

      // Sync claim comments
      const comments = await this.prisma.claimComment.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });
      const anonComments = anonymizeClaimComments(comments, ctx);
      stats.rowsPerTable['claim_comments'] = anonComments.length;
      stats.tablesProcessed.push('claim_comments');
      this.logger.debug(`  Anonymized ${anonComments.length} claim comments`);

      // Sync evidence metadata
      const evidence = await this.prisma.evidenceMetadata.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });
      const anonEvidence = anonymizeEvidenceMetadata(evidence, ctx);
      stats.rowsPerTable['evidence_metadata'] = anonEvidence.length;
      stats.tablesProcessed.push('evidence_metadata');
      this.logger.debug(`  Anonymized ${anonEvidence.length} evidence metadata records`);

      // Sync registered voters
      const voters = await this.prisma.registeredVoter.findMany();
      const anonVoters = anonymizeRegisteredVoters(voters, ctx);
      stats.rowsPerTable['registered_voters'] = anonVoters.length;
      stats.tablesProcessed.push('registered_voters');
      this.logger.debug(`  Anonymized ${anonVoters.length} registered voters`);

      // Sync posts
      const posts = await this.prisma.post.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });
      const anonPosts = anonymizePosts(posts, ctx);
      stats.rowsPerTable['posts'] = anonPosts.length;
      stats.tablesProcessed.push('posts');
      this.logger.debug(`  Anonymized ${anonPosts.length} posts`);

      stats.totalRows = Object.values(stats.rowsPerTable).reduce((a, b) => a + b, 0);

      this.logger.log(
        `[staging-data-sync] Sync complete. Total rows anonymized and prepared: ${stats.totalRows}`,
      );
      this.logger.warn(
        '[staging-data-sync] NOTE: This is a dry-implementation. Actual write to staging DB must be configured by maintainers with staging DB access.',
      );
    } catch (err) {
      this.logger.error(`[staging-data-sync] Sync failed: ${(err as Error).message}`);
      throw err;
    }

    return stats;
  }
}
