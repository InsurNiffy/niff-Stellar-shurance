/**
 * Seeds the in-memory store with representative dev data.
 * Call once at startup in non-production environments.
 */

import { insertClaim, insertPolicy } from "./store";

export function seedDevData(): void {
  const p1 = insertPolicy({
    holder: "GABC1111111111111111111111111111111111111111111111111111",
    policy_id: 1,
    policy_type: "Auto",
    region: "Medium",
    premium: "5000000",
    coverage: "500000000",
    is_active: true,
    start_ledger: 1000,
    end_ledger: 9000,
  });

  const p2 = insertPolicy({
    holder: "GABC1111111111111111111111111111111111111111111111111111",
    policy_id: 2,
    policy_type: "Health",
    region: "High",
    premium: "8000000",
    coverage: "1000000000",
    is_active: false,
    start_ledger: 500,
    end_ledger: 800,
  });

  const p3 = insertPolicy({
    holder: "GXYZ9999999999999999999999999999999999999999999999999999",
    policy_id: 1,
    policy_type: "Property",
    region: "Low",
    premium: "3000000",
    coverage: "200000000",
    is_active: true,
    start_ledger: 2000,
    end_ledger: 12000,
  });

  insertClaim({
    claim_id: 1,
    policy_id: p2.policy_id,
    claimant: p2.holder,
    amount: "100000000",
    details: "Hospital visit after accident",
    image_urls: ["ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
    status: "Approved",
    approve_votes: 5,
    reject_votes: 1,
  });

  insertClaim({
    claim_id: 2,
    policy_id: p1.policy_id,
    claimant: p1.holder,
    amount: "50000000",
    details: "Rear-end collision repair",
    image_urls: [],
    status: "Processing",
    approve_votes: 2,
    reject_votes: 0,
  });

  insertClaim({
    claim_id: 3,
    policy_id: p3.policy_id,
    claimant: p3.holder,
    amount: "20000000",
    details: "Storm damage to roof",
    image_urls: [],
    status: "Rejected",
    approve_votes: 1,
    reject_votes: 4,
  });
}
