/**
 * Default wallet signer — asks the connected wallet to sign the challenge
 * message (Freighter / xBull / LOBSTR via Stellar Wallets Kit).
 */

export type SignMessageFn = (message: string, address: string) => Promise<string>;

export async function signWithWallet(message: string, address: string): Promise<string> {
  const { StellarWalletsKit } = await import('@creit.tech/stellar-wallets-kit');
  const { signedMessage } = await StellarWalletsKit.signMessage(message, { address });
  if (typeof signedMessage !== 'string' || signedMessage.length === 0) {
    throw new Error('The wallet returned an empty signature');
  }
  return signedMessage;
}

/** True when the error looks like a user-initiated rejection/cancellation. */
export function isUserRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const lower = message.toLowerCase();
  return (
    lower.includes('reject') ||
    lower.includes('cancel') ||
    lower.includes('declin') ||
    lower.includes('denied') ||
    lower.includes('closed')
  );
}
