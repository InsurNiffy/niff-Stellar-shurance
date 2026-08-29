# Appeal UI accessibility conformance (#1363)

## Target level

Project standard (see `CONTRIBUTING.md` Accessibility section and
`frontend/tests/accessibility.spec.ts`): **WCAG 2.1 Level AA**.

Automated checks use axe-core tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
and fail on any **critical** or **serious** violations.

## Scope reviewed

| Surface | Location | Checks |
|---------|----------|--------|
| `AppealButton` | `frontend/src/components/claims/AppealButton.tsx` | jest-axe (component); labelled button / ineligibility note / loading `aria-busy` |
| `AppealConfirmModal` | `frontend/src/components/claims/AppealConfirmModal.tsx` | jest-axe (open dialog); Playwright axe + focus trap / ESC (when appeal UI is present) |
| Claim detail appeal flow | `/claims/:id` via vote panel | Covered by claim-detail route axe scan + appeal-specific Playwright cases |

## Result

| Date | Target | Status | Evidence |
|------|--------|--------|----------|
| 2026-08-29 | WCAG 2.1 AA | **Conforms** (automated critical/serious = 0) | `frontend/src/components/claims/__tests__/appeal-accessibility.test.tsx`; appeal cases in `frontend/tests/accessibility.spec.ts` |

## Notes

- Color-contrast is asserted in Playwright (real browser). jest-axe disables
  `color-contrast` in jsdom because computed styles are unavailable.
- Modal focus trap / ESC-during-submit behavior follows the existing
  `VoteConfirmModal` pattern (#1339).
- Manual assistive-technology review (VoiceOver / NVDA) remains recommended for
  release sign-off but is outside the automated CI gate.
