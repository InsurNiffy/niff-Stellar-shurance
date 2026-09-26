# Issue #916 — Voter snapshot viewer: list eligible voters for a specific claim

## Related issues
- Backend/Frontend: this issue (#916)
- Frontend: #917 — fraud score badge (related claim-detail surface work)

_Applied retroactively as a demonstration of the
[cross-stack issue linking convention](./cross-stack-linking-convention.md)._

## Summary
Add a Voters panel on the claim detail page showing the eligible voter list from the on-chain registry with vote status (voted/not voted) for each address.

## Changes Made

### Backend

**New DTO** — `backend/src/claims/dto/claim-voter.dto.ts`
- `ClaimVoterDto` with fields: `walletAddress`, `displayName?`, `voted`, `vote?`

**New service method** — `backend/src/claims/claims.service.ts`
- `getClaimVoters(claimId)` — queries `registered_voters` table for all eligible voters, then joins against the `votes` table to determine each voter's status (voted yes, voted no, or not voted)

**New endpoint** — `backend/src/claims/claims.controller.ts`
- `GET /api/claims/:id/voters` — returns `ClaimVoterDto[]`

### Frontend

**New API function** — `frontend/src/lib/api/claim-detail.ts`
- `fetchClaimVoters(claimId)` with Zod schema `ClaimVoterSchema`
- Type `ClaimVoter` exported for use in components

**New component** — `frontend/src/components/claims/ClaimVotersPanel.tsx`
- Displays a card with voter list showing each address and vote status
- **Voted Yes** — green/success badge
- **Voted No** — red/destructive badge
- **Not voted** — outline badge
- Header shows summary: `X/Y voted`
- Loading, error, and empty states handled
- Uses `useQuery` for data fetching with `['claim-voters', claimId]` key

**Integration** — `frontend/src/components/claims/ClaimDetailView.tsx`
- Imported `ClaimVotersPanel`
- Added as a card in the sidebar between the vote panel and indexer status card

### Files Changed
| File | Change |
|------|--------|
| `backend/src/claims/dto/claim-voter.dto.ts` | New file (27 lines) |
| `backend/src/claims/claims.service.ts` | +25 lines (import + method) |
| `backend/src/claims/claims.controller.ts` | +11 lines (endpoint) |
| `frontend/src/lib/api/claim-detail.ts` | +20 lines (schema + API) |
| `frontend/src/components/claims/ClaimVotersPanel.tsx` | New file (97 lines) |
| `frontend/src/components/claims/ClaimDetailView.tsx` | +2 lines (import + usage) |

### Testing
- Visit a claim detail page — Voters card appears in the sidebar
- Shows `X/Y voted` summary in the header
- Each registered voter shows their wallet address (and display name if set)
- Vote status badges are colour-coded: green for yes, red for no, outline for not voted
- Backward-compatible: voters without display name show only the address
- Error/loading states handled gracefully

closes #916
