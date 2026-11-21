/**
 * Session-only optimistic mutation events.
 *
 * Wizards and vote panels submit transactions far away from the tables that
 * display the affected rows. This in-memory bus lets those rows switch to a
 * "pending" state immediately, before the indexer has confirmed the change.
 * Nothing is written to storage, so state is always discarded on reload.
 */

export type OptimisticMutation =
  | { type: 'claim_filing'; claimId: string; txHash?: string }
  | {
      type: 'vote_submission';
      claimId: string;
      vote: 'Approve' | 'Reject';
      txHash?: string;
    };

type Listener = (mutation: OptimisticMutation) => void;

const listeners = new Set<Listener>();

export function emitOptimisticMutation(mutation: OptimisticMutation): void {
  listeners.forEach((listener) => listener(mutation));
}

export function subscribeOptimisticMutations(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
