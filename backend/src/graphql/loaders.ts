import DataLoader from 'dataloader';
import type { PolicyService } from '../services/policyService';
import type { ClaimService } from '../services/claimService';
import type { VoteService } from '../services/voteService';
import type { HolderService } from '../services/holderService';

/**
 * Per-request DataLoader registry.
 *
 * A fresh instance is created for every GraphQL operation (see the Apollo
 * context factory) so that batching never leaks across requests or users.
 * Each loader collapses the N+1 lookups that the read-only Policy, Claim,
 * Vote and Holder resolvers would otherwise issue when walking relations.
 */
export interface GraphQLContext {
  loaders: Loaders;
  /** Wallet address of the authenticated caller, if any. */
  wallet?: string;
  /** True when the caller passed the admin guard. */
  isAdmin: boolean;
}

export interface Loaders {
  policyById: DataLoader<string, unknown>;
  claimsByPolicyId: DataLoader<string, unknown[]>;
  votesByClaimId: DataLoader<string, unknown[]>;
  holderByAddress: DataLoader<string, unknown>;
  policiesByHolderAddress: DataLoader<string, unknown[]>;
}

export interface LoaderServices {
  policyService: PolicyService;
  claimService: ClaimService;
  voteService: VoteService;
  holderService: HolderService;
}

/**
 * Build the per-request loader set. Every batch function receives the keys
 * collected during a single tick of the event loop and must return results in
 * the exact same order as the keys it was given.
 */
export function createLoaders(services: LoaderServices): Loaders {
  const { policyService, claimService, voteService, holderService } = services;

  const policyById = new DataLoader<string, unknown>(async (ids) => {
    const policies = await policyService.findByIds(ids as string[]);
    const byId = new Map(policies.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id) ?? null);
  });

  const claimsByPolicyId = new DataLoader<string, unknown[]>(async (policyIds) => {
    const claims = await claimService.findByPolicyIds(policyIds as string[]);
    const grouped = new Map<string, unknown[]>();
    for (const claim of claims) {
      const bucket = grouped.get(claim.policyId);
      if (bucket) {
        bucket.push(claim);
      } else {
        grouped.set(claim.policyId, [claim]);
      }
    }
    return policyIds.map((id) => grouped.get(id) ?? []);
  });

  const votesByClaimId = new DataLoader<string, unknown[]>(async (claimIds) => {
    const votes = await voteService.findByClaimIds(claimIds as string[]);
    const grouped = new Map<string, unknown[]>();
    for (const vote of votes) {
      const bucket = grouped.get(vote.claimId);
      if (bucket) {
        bucket.push(vote);
      } else {
        grouped.set(vote.claimId, [vote]);
      }
    }
    return claimIds.map((id) => grouped.get(id) ?? []);
  });

  const holderByAddress = new DataLoader<string, unknown>(async (addresses) => {
    const holders = await holderService.findByAddresses(addresses as string[]);
    const byAddress = new Map(holders.map((h) => [h.address, h]));
    return addresses.map((address) => byAddress.get(address) ?? null);
  });

  const policiesByHolderAddress = new DataLoader<string, unknown[]>(async (addresses) => {
    const policies = await policyService.findByHolderAddresses(addresses as string[]);
    const grouped = new Map<string, unknown[]>();
    for (const policy of policies) {
      const bucket = grouped.get(policy.holderAddress);
      if (bucket) {
        bucket.push(policy);
      } else {
        grouped.set(policy.holderAddress, [policy]);
      }
    }
    return addresses.map((address) => grouped.get(address) ?? []);
  });

  return {
    policyById,
    claimsByPolicyId,
    votesByClaimId,
    holderByAddress,
    policiesByHolderAddress,
  };
}
