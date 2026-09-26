# Issue #917 — Claim fraud score badge: display risk score on claim detail when set

## Related issues
- Frontend: this issue (#917)
- Backend: #916 — voter snapshot viewer (related claim-detail surface work)

_Applied retroactively as a demonstration of the
[cross-stack issue linking convention](./cross-stack-linking-convention.md)._

## Summary
Display a colour-coded fraud risk score badge (low / medium / high) on the claim detail page when a `fraud_score` has been set by the on-chain oracle, with a tooltip explaining its source.

## Changes Made

### 1. Schema — `frontend/src/lib/api/claim-detail.ts`
- Added an **optional** `fraud_score: z.number().optional()` field to `ClaimDetailResponseSchema` so the frontend can receive the score from the API response without breaking existing claims that lack one.

### 2. New Component — `frontend/src/components/claims/FraudScoreBadge.tsx`
Created a dedicated `FraudScoreBadge` component that renders a colour-coded `Badge` based on the score:

| Level   | Score Range | Badge Variant | Colour  |
|---------|-------------|---------------|---------|
| Low     | 0–39        | `success`     | Green   |
| Medium  | 40–69       | `warning`     | Yellow  |
| High    | 70–100      | `destructive` | Red     |

- Uses the project's existing `Badge` (`@/components/ui/badge`) component.
- Displays text like `Fraud 85% — High Risk`.
- Includes a native `title` tooltip: *"Fraud risk score assessed by on-chain oracle"*.
- Sets a descriptive `aria-label` for accessibility.

### 3. Integration — `frontend/src/components/claims/ClaimDetailView.tsx`
- Imported `FraudScoreBadge`.
- Added the badge next to the existing status badge in the claim header, conditionally rendered only when `claim.fraud_score` is defined.

### Files Changed
| File | Change |
|------|--------|
| `frontend/src/lib/api/claim-detail.ts` | +1 line (schema field) |
| `frontend/src/components/claims/FraudScoreBadge.tsx` | New file (46 lines) |
| `frontend/src/components/claims/ClaimDetailView.tsx` | +3 lines (import + usage) |

## Testing
- When `fraud_score` is present in the API response, the badge appears next to the status badge with the appropriate colour.
- When `fraud_score` is absent/undefined, no badge is rendered (backward-compatible).
- Hovering over the badge shows the source tooltip.

closes #917
