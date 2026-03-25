export type ClaimOutcome = 'Approved' | 'Rejected';

export interface ClaimFinalizedEvent {
  claimId: string;
  policyId: number;
  claimantPublicKey: string;
  outcome: ClaimOutcome;
  finalizedAt: string;
}

export interface UserPreferences {
  claimantPublicKey: string;
  emailEnabled: boolean;
  email?: string;
  discordEnabled: boolean;
  discordUserId?: string;
  telegramEnabled: boolean;
  telegramChatId?: string;
}

export interface NotificationRecord {
  idempotencyKey: string;
  channel: 'email' | 'discord' | 'telegram';
  status: 'sent' | 'failed' | 'skipped';
  sentAt?: string;
  error?: string;
}
