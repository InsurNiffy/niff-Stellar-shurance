# Claim Filing Flow — WCAG 2.1 AA Accessibility Conformance

This document records the accessibility audit of the claim filing flow
(`/claims/new` and its steps) against **WCAG 2.1 Level AA**, mirroring the
approach previously applied to the appeal UI.

## Scope

The claim filing flow consists of the following steps, each of which is
scanned independently:

| Step | Route | Description |
| --- | --- | --- |
| 1 | `/claims/new` | Claimant / policy details |
| 2 | `/claims/new/incident` | Incident details |
| 3 | `/claims/new/documents` | Supporting documents |
| 4 | `/claims/new/review` | Review & submit |

## Automated Testing

Accessibility is verified with **axe-core** driven through **Playwright** E2E
tests. Each step of the flow is loaded, advanced to, and scanned with the
`wcag2a`, `wcag2aa`, and `wcag21aa` rule tags. Any violation fails the test.

The same pages are included in the automated accessibility CI job so that
regressions are caught on every pull request.

## Findings & Fixes

### Focus management

- On step transitions, focus is moved to the step heading (`tabindex="-1"`)
  so keyboard and screen-reader users are placed at the start of the new
  content.
- Validation errors move focus to the first invalid field.
- The review step traps focus within the confirmation dialog while open and
  restores focus to the triggering control on close.

### Label associations

- Every form control has an associated `<label>` (via `htmlFor`/`id`) or an
  `aria-label`/`aria-labelledby` where a visible label is not appropriate.
- Grouped inputs (radio/checkbox sets) use `<fieldset>`/`<legend>`.
- Required fields are marked with `aria-required="true"` in addition to the
  visual indicator.

### Error announcements

- Validation errors are announced via an `aria-live="assertive"` region.
- Each invalid field is linked to its error message with `aria-describedby`
  and marked `aria-invalid="true"`.
- A summary of errors is rendered in a focusable region at the top of the form
  on submit failure.

## Conformance Status

After the fixes above, all four steps of the claim filing flow pass the
axe-core WCAG 2.1 AA rule set with **zero violations**. The flow is considered
**conformant with WCAG 2.1 Level AA** for the audited criteria.

## Maintenance

- New steps or fields added to the claim filing flow must be added to the
  Playwright accessibility scan and the CI accessibility job.
- Re-run the audit whenever the flow's markup or interaction model changes.
