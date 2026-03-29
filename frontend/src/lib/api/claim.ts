import { getConfig } from '@/config/env';

const { apiUrl: API_BASE_URL } = getConfig();

export interface Claim {
  id: number;
  policyId: string;
  creatorAddress: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  amount: string;
  description?: string;
  evidenceHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuildClaimTransactionResponse {
  unsignedXdr: string;
  minResourceFee: string;
  baseFee: string;
  totalEstimatedFee: string;
  totalEstimatedFeeXlm: string;
  authRequirements: Array<{ address: string; isContract: boolean }>;
}

export class ClaimAPI {
  private static async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        message: 'An unexpected error occurred',
      }));
      throw new Error(errorData.message || 'API Error');
    }
    return response.json();
  }

  static async buildTransaction(data: {
    holder: string;
    policyId: number;
    amount: string;
    details: string;
    /** From IPFS/proxy: URL + 64-char hex SHA-256 of file bytes. */
    evidence: { url: string; contentSha256Hex: string }[];
  }): Promise<BuildClaimTransactionResponse> {
    const response = await fetch(`${API_BASE_URL}/api/claims/build-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return this.handleResponse<BuildClaimTransactionResponse>(response);
  }

  static async submitTransaction(transactionXdr: string): Promise<{ claimId: number; transactionHash: string }> {
    const response = await fetch(`${API_BASE_URL}/api/claims/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionXdr }),
    });
    return this.handleResponse<{ claimId: number; transactionHash: string }>(response);
  }

  static async getClaim(claimId: number): Promise<Claim> {
    const response = await fetch(`${API_BASE_URL}/api/claims/${claimId}`);
    return this.handleResponse<Claim>(response);
  }

  static async pollClaimStatus(
    claimId: number,
    maxAttempts = 20,
    interval = 3000
  ): Promise<Claim> {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        const claim = await this.getClaim(claimId);
        // In a real app, we might wait for the status to change from a temporary one
        // but for now, if we get the claim, it's a good sign.
        return claim;
      } catch (error) {
        if (attempts === maxAttempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, interval));
        attempts++;
      }
    }
    throw new Error('Claim confirmation timeout');
  }
}
