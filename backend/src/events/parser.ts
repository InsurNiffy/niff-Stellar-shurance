import { Injectable, Logger } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Normalizes a Stellar StrKey address to its canonical form.
 *
 * - Accepts G... (ed25519 public key) and M... (muxed account) StrKeys.
 * - Muxed accounts are canonicalised by stripping the mux ID and returning
 *   the underlying G... account, so the same wallet always maps to one row.
 * - Throws on any invalid / non-StrKey input so callers can reject at the
 *   API boundary (400) or drop malformed events.
 */
export function normalizeAddress(raw: string): string {
  if (typeof raw !== 'string') {
    throw new Error('Invalid Stellar address: expected a string');
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Invalid Stellar address: empty');
  }

  // Muxed account: strip the mux ID and canonicalise to the base G... account.
  if (StrKey.isValidMed25519PublicKey(trimmed)) {
    const muxed = StrKey.decodeMed25519PublicKey(trimmed);
    return StrKey.encodeEd25519PublicKey(muxed.ed25519);
  }

  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    return StrKey.encodeEd25519PublicKey(StrKey.decodeEd25519PublicKey(trimmed));
  }

  throw new Error(`Invalid Stellar address: ${raw}`);
}

export interface ParsedEvent {
  contractId: string;
  topic: string[];
  data: unknown;
  ledger: number;
  txHash: string;
  addresses: string[];
}

@Injectable()
export class EventParser {
  private readonly logger = new Logger(EventParser.name);

  parse(raw: unknown): ParsedEvent | null {
    if (!raw || typeof raw !== 'object') {
      this.logger.warn('Dropping malformed event: not an object');
      return null;
    }

    const event = raw as Record<string, unknown>;
    const contractId = typeof event.contractId === 'string' ? event.contractId : '';
    const txHash = typeof event.txHash === 'string' ? event.txHash : '';
    const ledger = typeof event.ledger === 'number' ? event.ledger : 0;
    const topic = Array.isArray(event.topic)
      ? event.topic.filter((t): t is string => typeof t === 'string')
      : [];

    const addresses: string[] = [];
    const rawAddresses = Array.isArray(event.addresses) ? event.addresses : [];
    for (const candidate of rawAddresses) {
      if (typeof candidate !== 'string') continue;
      try {
        addresses.push(normalizeAddress(candidate));
      } catch (err) {
        this.logger.warn(
          `Dropping invalid address in event ${txHash}: ${(err as Error).message}`,
        );
      }
    }

    return {
      contractId,
      topic,
      data: event.data,
      ledger,
      txHash,
      addresses,
    };
  }
}
