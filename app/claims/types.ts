export type ClaimStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "paid"
  | "expired";

export type ClaimSeverity = "low" | "medium" | "high" | "critical";

export type PolicyType =
  | "health"
  | "life"
  | "property"
  | "travel"
  | "auto"
  | "other";

export interface ClaimVoteTally {
  approve: number;
  reject: number;
  /** Total number of eligible voters for the claim's quorum. */
  total: number;
}

export interface Claim {
  id: string;
  policyId: string;
  policyType: PolicyType;
  /** Claim amount in stroops (string to avoid precision loss). */
  amount: string;
  status: ClaimStatus;
  severity: ClaimSeverity;
  votes: ClaimVoteTally;
  /** ISO-8601 timestamp of the voting deadline. */
  deadline: string;
  createdAt: string;
}

export interface ClaimsFilters {
  status?: ClaimStatus;
  severity?: ClaimSeverity;
  /** Free-text search by claim ID or policy ID. */
  search?: string;
}

export interface ClaimsPage {
  claims: Claim[];
  /** Opaque cursor for the next page; null when there are no more results. */
  nextCursor: string | null;
}

export interface ClaimsQueryParams extends ClaimsFilters {
  cursor?: string;
  limit?: number;
}
