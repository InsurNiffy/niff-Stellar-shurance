import { apiFetch } from "./client";

export type VoteOption = "for" | "against" | "abstain";

export interface BuildVoteXdrParams {
  claimId: string;
  option: VoteOption;
  voterAddress: string;
}

export interface BuildVoteXdrResponse {
  xdr: string;
  networkPassphrase?: string;
}

export interface SubmitTxResponse {
  txHash: string;
  status?: string;
}

/**
 * Ask the backend to build an unsigned vote transaction XDR for the given
 * claim, option, and voter. The returned XDR is signed client-side by the
 * wallet before being submitted.
 */
export async function buildVoteXdr(
  params: BuildVoteXdrParams,
): Promise<BuildVoteXdrResponse> {
  return apiFetch<BuildVoteXdrResponse>("/tx/build-vote", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/**
 * Submit a signed transaction envelope to the backend for broadcasting.
 */
export async function submitTx(signedXdr: string): Promise<SubmitTxResponse> {
  return apiFetch<SubmitTxResponse>("/tx/submit", {
    method: "POST",
    body: JSON.stringify({ xdr: signedXdr }),
  });
}
