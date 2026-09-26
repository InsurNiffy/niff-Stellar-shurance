import { createHash } from 'crypto';

export interface AnonymizationContext {
  walletMap: Map<string, string>;
  emailMap: Map<string, string>;
  idMap: Map<string | number, string>;
}

export function createAnonymizationContext(): AnonymizationContext {
  return {
    walletMap: new Map(),
    emailMap: new Map(),
    idMap: new Map(),
  };
}

function deterministicHash(value: string, prefix = '', maxLen = 32): string {
  const hash = createHash('sha256').update(value).digest('hex');
  const result = prefix + hash.substring(0, maxLen - prefix.length);
  return result;
}

export function anonymizeWallet(wallet: string, ctx: AnonymizationContext): string {
  if (ctx.walletMap.has(wallet)) return ctx.walletMap.get(wallet)!;

  const anon = 'G' + deterministicHash(wallet, '', 55);
  ctx.walletMap.set(wallet, anon);
  return anon;
}

export function anonymizeEmail(email: string, ctx: AnonymizationContext): string {
  if (ctx.emailMap.has(email)) return ctx.emailMap.get(email)!;

  const hash = deterministicHash(email, '', 12);
  const anon = `user_${hash}@staging.example.com`;
  ctx.emailMap.set(email, anon);
  return anon;
}

export function anonymizeName(name: string, ctx: AnonymizationContext): string {
  const hash = deterministicHash(name, '', 8);
  return `User_${hash}`;
}

export function tokenizeId(id: string | number, ctx: AnonymizationContext): string {
  const key = String(id);
  if (ctx.idMap.has(id)) return ctx.idMap.get(id)!;

  const token = 'tok_' + deterministicHash(key, '', 20);
  ctx.idMap.set(id, token);
  return token;
}

export function anonymizePolicies(policies: any[], ctx: AnonymizationContext): any[] {
  return policies.map((policy) => ({
    ...policy,
    id: tokenizeId(policy.id, ctx),
    holderAddress: anonymizeWallet(policy.holderAddress, ctx),
  }));
}

export function anonymizeClaims(claims: any[], ctx: AnonymizationContext): any[] {
  return claims.map((claim) => ({
    id: claim.id,
    policyId: tokenizeId(claim.policyId, ctx),
    creatorAddress: anonymizeWallet(claim.creatorAddress, ctx),
    amount: claim.amount,
    asset: claim.asset,
    status: claim.status,
    severity: claim.severity,
    isFinalized: claim.isFinalized,
    approveVotes: claim.approveVotes,
    rejectVotes: claim.rejectVotes,
    paidAt: claim.paidAt,
    createdAtLedger: claim.createdAtLedger,
    updatedAtLedger: claim.updatedAtLedger,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    tenantId: claim.tenantId,
    deletedAt: claim.deletedAt,
    appealsCount: claim.appealsCount,
  }));
}

export function anonymizeVotes(votes: any[], ctx: AnonymizationContext): any[] {
  return votes.map((vote) => ({
    id: vote.id,
    claimId: vote.claimId,
    vote: vote.vote,
    votingPower: vote.votingPower,
    votedAtLedger: vote.votedAtLedger,
    createdAt: vote.createdAt,
    deletedAt: vote.deletedAt,
  }));
}

export function anonymizeHolderProfiles(profiles: any[], ctx: AnonymizationContext): any[] {
  return profiles.map((profile) => ({
    walletAddress: anonymizeWallet(profile.walletAddress, ctx),
    displayName: anonymizeName(profile.displayName || 'Unknown', ctx),
    email: anonymizeEmail(profile.email || 'noemail@staging.example.com', ctx),
    locale: profile.locale,
    notificationPreferences: profile.notificationPreferences,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastSeenAt: profile.lastSeenAt,
  }));
}

export function anonymizeSupportTickets(tickets: any[], ctx: AnonymizationContext): any[] {
  return tickets.map((ticket) => ({
    id: ticket.id,
    email: anonymizeEmail(ticket.email, ctx),
    status: ticket.status,
    firstRespondedAt: ticket.firstRespondedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  }));
}

export function anonymizeSupportTicketReplies(replies: any[], ctx: AnonymizationContext): any[] {
  return replies.map((reply) => ({
    id: reply.id,
    ticketId: tokenizeId(reply.ticketId, ctx),
    author: reply.author,
    createdAt: reply.createdAt,
  }));
}

export function anonymizeNotifications(notifications: any[], ctx: AnonymizationContext): any[] {
  return notifications.map((notif) => ({
    id: notif.id,
    userId: anonymizeWallet(notif.userId, ctx),
    type: notif.type,
    payload: notif.payload,
    acknowledgedAt: notif.acknowledgedAt,
    expiresAt: notif.expiresAt,
    createdAt: notif.createdAt,
  }));
}

export function anonymizeNotificationPreferences(prefs: any[], ctx: AnonymizationContext): any[] {
  return prefs.map((pref) => ({
    userId: anonymizeWallet(pref.userId, ctx),
    renewalRemindersEnabled: pref.renewalRemindersEnabled,
    claimUpdatesEnabled: pref.claimUpdatesEnabled,
    createdAt: pref.createdAt,
    updatedAt: pref.updatedAt,
  }));
}

export function anonymizeRampTransactions(txns: any[], ctx: AnonymizationContext): any[] {
  return txns.map((txn) => ({
    id: txn.id,
    purchaseId: deterministicHash(txn.purchaseId, 'synth_', 20),
    status: txn.status,
    receiverAddress: anonymizeWallet(txn.receiverAddress, ctx),
    cryptoAmount: txn.cryptoAmount,
    cryptoCurrency: txn.cryptoCurrency,
    fiatValue: txn.fiatValue,
    fiatCurrency: txn.fiatCurrency,
    lastSyncedAt: txn.lastSyncedAt,
    createdAt: txn.createdAt,
    updatedAt: txn.updatedAt,
  }));
}

export function anonymizeClaimComments(comments: any[], ctx: AnonymizationContext): any[] {
  return comments.map((comment) => ({
    id: comment.id,
    claimId: tokenizeId(comment.claimId, ctx),
    authorAddress: anonymizeWallet(comment.authorAddress, ctx),
    createdAt: comment.createdAt,
    deletedAt: comment.deletedAt,
  }));
}

export function anonymizeEvidenceMetadata(evidence: any[], ctx: AnonymizationContext): any[] {
  return evidence.map((ev) => ({
    id: ev.id,
    claimId: tokenizeId(ev.claimId, ctx),
    createdAt: ev.createdAt,
  }));
}

export function anonymizeRegisteredVoters(voters: any[], ctx: AnonymizationContext): any[] {
  return voters.map((voter) => ({
    walletAddress: anonymizeWallet(voter.walletAddress, ctx),
    displayName: anonymizeName(voter.displayName || 'Voter', ctx),
    registeredBy: anonymizeWallet(voter.registeredBy, ctx),
    registeredAt: voter.registeredAt,
  }));
}

export function anonymizePosts(posts: any[], ctx: AnonymizationContext): any[] {
  return posts.map((post) => ({
    id: post.id,
    status: post.status,
    authorAddress: anonymizeWallet(post.authorAddress, ctx),
    publishAt: post.publishAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    deletedAt: post.deletedAt,
  }));
}
