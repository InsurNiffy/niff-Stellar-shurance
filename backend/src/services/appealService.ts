import { randomUUID } from 'crypto';
import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';

/**
 * Appeals service for issue #1480.
 *
 * Responsibilities:
 *  - Eligibility checks for opening an appeal on a rejected claim.
 *  - Building unsigned XDR for `open_appeal` and appeal vote transactions.
 *  - Appeal-window reminders (window open + 24h before close).
 *  - SLA monitoring for appeals that sit unresolved past their deadline.
 */

export type ClaimStatus = 'Pending' | 'Approved' | 'Rejected' | 'Paid';

export interface ClaimRecord {
  id: string;
  claimant: string;
  status: ClaimStatus;
  /** ISO timestamp when the appeal window opens. */
  appealWindowOpensAt?: string;
  /** ISO timestamp when the appeal window closes. */
  appealWindowClosesAt?: string;
}

export interface AppealRecord {
  id: string;
  claimId: string;
  openedBy: string;
  openedAt: string;
  /** ISO timestamp by which the appeal should be resolved. */
  deadline: string;
  resolvedAt?: string;
  status: 'Open' | 'Resolved' | 'Expired';
}

export interface AppealVoter {
  address: string;
  /** Optional weight; defaults to 1. */
  weight?: number;
}

export interface AppealEligibility {
  eligible: boolean;
  reason?: string;
}

export interface ReminderRecord {
  claimId: string;
  kind: 'window_open' | 'window_closing_24h';
  sentAt: string;
}

export interface SlaAlert {
  appealId: string;
  claimId: string;
  deadline: string;
  overdueMs: number;
}

/**
 * Minimal persistence surface. Implementations may be backed by a DB or an
 * in-memory store; the service only depends on this interface.
 */
export interface AppealStore {
  getClaim(claimId: string): Promise<ClaimRecord | undefined>;
  getAppealByClaim(claimId: string): Promise<AppealRecord | undefined>;
  saveAppeal(appeal: AppealRecord): Promise<void>;
  listOpenAppeals(): Promise<AppealRecord[]>;
  hasReminder(claimId: string, kind: ReminderRecord['kind']): Promise<boolean>;
  saveReminder(reminder: ReminderRecord): Promise<void>;
}

/**
 * Sink for reminders and SLA alerts. In production this is wired to the
 * notification/alerting pipeline; tests can supply a spy.
 */
export interface AppealNotifier {
  sendReminder(reminder: ReminderRecord): Promise<void>;
  sendSlaAlert(alert: SlaAlert): Promise<void>;
}

/**
 * Builds unsigned XDR. Kept injectable so the service can be unit-tested
 * without a live network. The default implementation uses the Stellar SDK.
 */
export interface XdrBuilder {
  buildOpenAppeal(params: {
    sourceAccount: string;
    claimId: string;
    networkPassphrase: string;
  }): Promise<string>;
  buildAppealVote(params: {
    sourceAccount: string;
    claimId: string;
    appealId: string;
    voter: string;
    weight: number;
    networkPassphrase: string;
  }): Promise<string>;
}

export interface AppealServiceConfig {
  networkPassphrase?: string;
  /** Duration of the appeal window in ms. Defaults to 7 days. */
  appealWindowMs?: number;
  /** SLA for resolving an appeal after it is opened. Defaults to 72h. */
  appealSlaMs?: number;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

const DEFAULT_APPEAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_APPEAL_SLA_MS = 72 * 60 * 60 * 1000;
const CLOSING_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * Default XDR builder using the Stellar SDK. `open_appeal` and `appeal_vote`
 * are represented as manage-data operations carrying the claim/appeal id so
 * the on-chain contract can interpret them.
 */
export class StellarXdrBuilder implements XdrBuilder {
  async buildOpenAppeal(params: {
    sourceAccount: string;
    claimId: string;
    networkPassphrase: string;
  }): Promise<string> {
    const account = { accountId: () => params.sourceAccount, sequenceNumber: () => '0' } as any;
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: params.networkPassphrase,
    })
      .addOperation(
        Operation.manageData({
          name: `open_appeal:${params.claimId}`,
          value: params.claimId,
        }),
      )
      .setTimeout(0)
      .build();
    return tx.toXDR();
  }

  async buildAppealVote(params: {
    sourceAccount: string;
    claimId: string;
    appealId: string;
    voter: string;
    weight: number;
    networkPassphrase: string;
  }): Promise<string> {
    const account = { accountId: () => params.sourceAccount, sequenceNumber: () => '0' } as any;
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: params.networkPassphrase,
    })
      .addOperation(
        Operation.manageData({
          name: `appeal_vote:${params.appealId}`,
          value: `${params.voter}:${params.weight}`,
        }),
      )
      .setTimeout(0)
      .build();
    return tx.toXDR();
  }
}

export class AppealService {
  private readonly store: AppealStore;
  private readonly notifier: AppealNotifier;
  private readonly xdrBuilder: XdrBuilder;
  private readonly networkPassphrase: string;
  private readonly appealWindowMs: number;
  private readonly appealSlaMs: number;
  private readonly now: () => Date;

  constructor(
    store: AppealStore,
    notifier: AppealNotifier,
    xdrBuilder: XdrBuilder = new StellarXdrBuilder(),
    config: AppealServiceConfig = {},
  ) {
    this.store = store;
    this.notifier = notifier;
    this.xdrBuilder = xdrBuilder;
    this.networkPassphrase = config.networkPassphrase ?? Networks.TESTNET;
    this.appealWindowMs = config.appealWindowMs ?? DEFAULT_APPEAL_WINDOW_MS;
    this.appealSlaMs = config.appealSlaMs ?? DEFAULT_APPEAL_SLA_MS;
    this.now = config.now ?? (() => new Date());
  }

  /**
   * Eligibility for opening an appeal. All rules from the issue:
   *  - caller is the claimant
   *  - claim status is Rejected
   *  - the appeal window is open
   *  - no previous appeal exists
   */
  async checkEligibility(claimId: string, caller: string): Promise<AppealEligibility> {
    const claim = await this.store.getClaim(claimId);
    if (!claim) {
      return { eligible: false, reason: 'claim_not_found' };
    }
    if (claim.claimant !== caller) {
      return { eligible: false, reason: 'caller_not_claimant' };
    }
    if (claim.status !== 'Rejected') {
      return { eligible: false, reason: 'claim_not_rejected' };
    }

    const now = this.now().getTime();
    const opensAt = claim.appealWindowOpensAt ? Date.parse(claim.appealWindowOpensAt) : undefined;
    const closesAt = claim.appealWindowClosesAt ? Date.parse(claim.appealWindowClosesAt) : undefined;
    if (opensAt !== undefined && now < opensAt) {
      return { eligible: false, reason: 'appeal_window_not_open' };
    }
    if (closesAt !== undefined && now > closesAt) {
      return { eligible: false, reason: 'appeal_window_closed' };
    }

    const existing = await this.store.getAppealByClaim(claimId);
    if (existing) {
      return { eligible: false, reason: 'appeal_already_exists' };
    }

    return { eligible: true };
  }

  /**
   * Builds the unsigned XDR for `open_appeal`. Throws when ineligible so the
   * route can map the reason to an HTTP status.
   */
  async buildOpenAppeal(claimId: string, caller: string): Promise<{ xdr: string; appealId: string }> {
    const eligibility = await this.checkEligibility(claimId, caller);
    if (!eligibility.eligible) {
      throw new AppealError(eligibility.reason ?? 'ineligible', eligibility.reason);
    }

    const xdr = await this.xdrBuilder.buildOpenAppeal({
      sourceAccount: caller,
      claimId,
      networkPassphrase: this.networkPassphrase,
    });

    const appealId = randomUUID();
    const openedAt = this.now();
    const deadline = new Date(openedAt.getTime() + this.appealSlaMs);
    await this.store.saveAppeal({
      id: appealId,
      claimId,
      openedBy: caller,
      openedAt: openedAt.toISOString(),
      deadline: deadline.toISOString(),
      status: 'Open',
    });

    return { xdr, appealId };
  }

  /**
   * Builds unsigned appeal vote transactions for each appeal voter.
   */
  async buildAppealVotes(
    claimId: string,
    appealId: string,
    voters: AppealVoter[],
  ): Promise<Array<{ voter: string; xdr: string }>> {
    const results: Array<{ voter: string; xdr: string }> = [];
    for (const voter of voters) {
      const xdr = await this.xdrBuilder.buildAppealVote({
        sourceAccount: voter.address,
        claimId,
        appealId,
        voter: voter.address,
        weight: voter.weight ?? 1,
        networkPassphrase: this.networkPassphrase,
      });
      results.push({ voter: voter.address, xdr });
    }
    return results;
  }

  /**
   * Appeal state for the claim detail response.
   */
  async getAppealState(claimId: string): Promise<AppealRecord | undefined> {
    return this.store.getAppealByClaim(claimId);
  }

  /**
   * Sends appeal-window reminders: one when the window opens and one 24h
   * before it closes. Idempotent via the store's reminder log.
   */
  async sendWindowReminders(claim: ClaimRecord): Promise<ReminderRecord[]> {
    const sent: ReminderRecord[] = [];
    const now = this.now().getTime();

    const opensAt = claim.appealWindowOpensAt ? Date.parse(claim.appealWindowOpensAt) : undefined;
    if (opensAt !== undefined && now >= opensAt) {
      if (!(await this.store.hasReminder(claim.id, 'window_open'))) {
        const reminder: ReminderRecord = {
          claimId: claim.id,
          kind: 'window_open',
          sentAt: this.now().toISOString(),
        };
        await this.notifier.sendReminder(reminder);
        await this.store.saveReminder(reminder);
        sent.push(reminder);
      }
    }

    const closesAt = claim.appealWindowClosesAt ? Date.parse(claim.appealWindowClosesAt) : undefined;
    if (closesAt !== undefined) {
      const reminderAt = closesAt - CLOSING_REMINDER_LEAD_MS;
      if (now >= reminderAt && now <= closesAt) {
        if (!(await this.store.hasReminder(claim.id, 'window_closing_24h'))) {
          const reminder: ReminderRecord = {
            claimId: claim.id,
            kind: 'window_closing_24h',
            sentAt: this.now().toISOString(),
          };
          await this.notifier.sendReminder(reminder);
          await this.store.saveReminder(reminder);
          sent.push(reminder);
        }
      }
    }

    return sent;
  }

  /**
   * SLA monitor: alerts for appeals that are still open past their deadline.
   */
  async runSlaMonitor(): Promise<SlaAlert[]> {
    const now = this.now().getTime();
    const open = await this.store.listOpenAppeals();
    const alerts: SlaAlert[] = [];

    for (const appeal of open) {
      if (appeal.resolvedAt) continue;
      const deadline = Date.parse(appeal.deadline);
      if (now > deadline) {
        const alert: SlaAlert = {
          appealId: appeal.id,
          claimId: appeal.claimId,
          deadline: appeal.deadline,
          overdueMs: now - deadline,
        };
        await this.notifier.sendSlaAlert(alert);
        alerts.push(alert);
      }
    }

    return alerts;
  }
}

export class AppealError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'AppealError';
    this.code = code;
  }
}
