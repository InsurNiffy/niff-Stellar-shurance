# Requirements Document

## Introduction

This feature covers two tightly related frontend concerns for the NiffyInsur platform:

1. **Policy Detail Page** — a shareable, public-first page at `app/policies/[id]/page.tsx` that displays a policyholder's coverage summary, expiry countdown, premium history, linked claims with status badges, and contextual renewal or termination CTAs gated by on-chain rules and wallet authentication state.

2. **Responsive Table Component** — a reusable `ResponsiveTable` component with a sticky first column and horizontal scroll container, used by the policy and claim list views to remain usable on narrow viewports without causing page-level overflow.

Both features must be accessible, keyboard-navigable, and consistent with the existing Next.js 15 App Router + Tailwind CSS + Radix UI design system.

## Glossary

- **Policy_Detail_Page**: The Next.js route at `app/policies/[id]/page.tsx` that renders the full detail view for a single policy.
- **Policy**: A single insurance policy record returned by `GET /api/policies/:holder/:policy_id`, typed as `PolicyDto` in `features/policies/api/index.ts`.
- **Coverage_Summary_Card**: The UI card that displays coverage amount, premium amount, currency, policy type, region, and beneficiary for a Policy.
- **Expiry_Countdown**: The UI element that shows ledgers remaining and an estimated wall-clock time until the Policy's `end_ledger`.
- **Premium_History**: The list of on-chain premium payment events associated with a Policy, fetched from the backend.
- **Claim_List**: The section of the Policy_Detail_Page that lists all Claims linked to the Policy via `claims[]` in the `PolicyDto`.
- **Claim**: A single insurance claim record, typed as `ClaimSummaryDto` in `features/policies/api/index.ts`, with fields `claim_id`, `amount`, `status`, `approve_votes`, `reject_votes`, and `_link`.
- **Status_Badge**: A visual label that communicates a Claim's current status (`Processing`, `Approved`, `Rejected`) using both color and text.
- **Renewal_CTA**: The button that initiates the policy renewal flow, rendered only within the renewal window and only for authenticated users.
- **Termination_CTA**: The button that opens the termination confirmation modal, rendered only for authenticated users.
- **Renewal_Window**: The period during which renewal is permitted, defined as the last 30 days (in ledger terms: `ledgers_remaining ≤ 30 * 24 * 60 * 60 / 5`) before `end_ledger`.
- **Unauthenticated_Visitor**: A user who has no connected wallet (wallet `connected` state is `false`).
- **Authenticated_User**: A user with a connected wallet (`connected` state is `true` and `address` is non-null).
- **Error_Boundary**: The React error boundary component at `components/error-boundary.tsx` that catches render errors and displays a fallback UI.
- **Loading_Skeleton**: A placeholder UI rendered while data is being fetched, using the `Skeleton` component from `components/ui/skeleton.tsx`.
- **ResponsiveTable**: The new reusable table component with a sticky first column and horizontal scroll container.
- **Sticky_Column**: The first column of a ResponsiveTable that remains visible during horizontal scroll using CSS `position: sticky`.
- **Scroll_Container**: The `div` wrapper around a ResponsiveTable that enables horizontal overflow scrolling without causing page-body overflow.
- **Indexer_Lag**: The delay (typically ≤ 15 s) between an on-chain event being finalized and the backend indexer reflecting it in the API response.

---

## Requirements

### Requirement 1: Policy Detail Page — Public Data Rendering

**User Story:** As an unauthenticated visitor with a policy link, I want to view the policy's public coverage data without connecting a wallet, so that I can share or bookmark the page and review coverage details.

#### Acceptance Criteria

1. WHEN a visitor navigates to `app/policies/[id]/page.tsx` with a valid policy ID, THE Policy_Detail_Page SHALL fetch policy data from `GET /api/policies/:holder/:policy_id` and render the Coverage_Summary_Card, Expiry_Countdown, and Claim_List without requiring wallet connection.
2. WHEN the policy ID in the URL is not a positive integer, THE Policy_Detail_Page SHALL render an inline error message stating the ID is invalid without making an API request.
3. WHEN the API returns a 404 response, THE Policy_Detail_Page SHALL render a "Policy not found" message and a link back to the policies list.
4. THE Policy_Detail_Page SHALL render a `<title>` and `<meta name="description">` tag containing the policy ID and policy type so that the page is useful when shared via link.
5. WHILE data is loading, THE Policy_Detail_Page SHALL render Loading_Skeleton placeholders for the Coverage_Summary_Card and Claim_List sections.

---

### Requirement 2: Coverage Summary Card

**User Story:** As a policyholder, I want to see all key coverage parameters on one card, so that I can quickly verify my coverage without scrolling through multiple sections.

#### Acceptance Criteria

1. THE Coverage_Summary_Card SHALL display: holder address, policy type, region, coverage amount (formatted in XLM with 7-decimal stroop conversion), premium amount (formatted in XLM), currency, and beneficiary address (or "Not set — payouts go to holder" when `beneficiary` is null).
2. WHEN the connected wallet address differs from the policy's `beneficiary` field, THE Coverage_Summary_Card SHALL display a prominent warning that the payout destination differs from the connected wallet, including a phishing risk notice.
3. THE Coverage_Summary_Card SHALL display the policy's `is_active` status using a Status_Badge with distinct visual treatment for active vs. inactive states, using both color and a text label.

---

### Requirement 3: Expiry Countdown

**User Story:** As a policyholder, I want to see how much time remains on my policy, so that I can plan renewal before coverage lapses.

#### Acceptance Criteria

1. THE Expiry_Countdown SHALL derive the estimated wall-clock time remaining by multiplying `expiry_countdown.ledgers_remaining` by `expiry_countdown.avg_ledger_close_seconds` (5 s) and SHALL display the result as a human-readable duration (e.g., "14 days 3 hours").
2. THE Expiry_Countdown SHALL display the raw `ledgers_remaining` value alongside the estimated duration so that on-chain accuracy is transparent.
3. THE Expiry_Countdown SHALL render an Indexer_Lag disclaimer stating that displayed values may lag on-chain state by up to 15 seconds.
4. WHEN `ledgers_remaining` is 0 or negative, THE Expiry_Countdown SHALL display "Policy expired" instead of a countdown.

---

### Requirement 4: Linked Claims List

**User Story:** As a policyholder, I want to see all claims linked to my policy with their current statuses, so that I can track the progress of each claim without navigating away.

#### Acceptance Criteria

1. THE Claim_List SHALL render one row per entry in `PolicyDto.claims`, displaying: `claim_id`, `amount` (formatted in XLM), `status` as a Status_Badge, `approve_votes`, `reject_votes`, and a link to the claim detail page derived from the claim's `_link` field.
2. WHEN `PolicyDto.claims` is empty, THE Claim_List SHALL display an empty-state message: "No claims filed for this policy."
3. WHEN a new claim is filed and the React Query cache for this policy is invalidated, THE Claim_List SHALL reflect the updated claims list without requiring a hard page refresh.
4. THE Claim_List SHALL use the ResponsiveTable component so that the claims table scrolls horizontally on narrow viewports while keeping the `claim_id` column sticky.

---

### Requirement 5: Renewal CTA

**User Story:** As an authenticated policyholder within the renewal window, I want a clearly labeled renewal button, so that I can initiate renewal before my coverage expires.

#### Acceptance Criteria

1. WHEN the user is an Authenticated_User and `expiry_countdown.ledgers_remaining` is within the Renewal_Window, THE Renewal_CTA SHALL be rendered as an enabled button that opens the existing `RenewModal` component.
2. WHEN the user is an Authenticated_User and `expiry_countdown.ledgers_remaining` is outside the Renewal_Window, THE Renewal_CTA SHALL be rendered as a disabled button with a tooltip explaining the earliest date renewal becomes available.
3. WHEN the user is an Unauthenticated_Visitor, THE Renewal_CTA SHALL NOT be rendered.
4. WHEN the `RenewModal` reports a successful submission, THE Policy_Detail_Page SHALL invalidate the React Query cache for the current policy and display a success toast.

---

### Requirement 6: Termination CTA

**User Story:** As an authenticated policyholder, I want a termination button with a confirmation step, so that I cannot accidentally terminate my policy.

#### Acceptance Criteria

1. WHEN the user is an Authenticated_User and the policy `is_active` is true, THE Termination_CTA SHALL be rendered as an enabled button that opens the existing `TerminateModal` component.
2. WHEN the user is an Authenticated_User and the policy `is_active` is false, THE Termination_CTA SHALL be rendered as a disabled button with a tooltip stating "Policy is already inactive."
3. WHEN the user is an Unauthenticated_Visitor, THE Termination_CTA SHALL NOT be rendered.
4. WHEN the `TerminateModal` reports a successful submission, THE Policy_Detail_Page SHALL invalidate the React Query cache for the current policy and display a success toast.

---

### Requirement 7: Error Boundary and Fetch Error Handling

**User Story:** As a user, I want the page to degrade gracefully when data cannot be loaded, so that I see a helpful message rather than a blank screen or unhandled exception.

#### Acceptance Criteria

1. THE Policy_Detail_Page SHALL be wrapped in the existing `ErrorBoundary` component so that unexpected render errors are caught and a fallback UI is displayed.
2. WHEN the `GET /api/policies/:holder/:policy_id` request fails with a non-404 HTTP error, THE Policy_Detail_Page SHALL display the error message returned by the API (or a generic fallback) and a "Retry" button that re-triggers the fetch.
3. IF the network is unavailable when the page loads, THEN THE Policy_Detail_Page SHALL display an offline error message and a "Retry" button.

---

### Requirement 8: Responsive Table Component — Core Behavior

**User Story:** As a user on a narrow viewport, I want to scroll policy and claim tables horizontally while keeping the row identifier visible, so that I can read all columns without losing context.

#### Acceptance Criteria

1. THE ResponsiveTable SHALL render a `<table>` element with correct `<thead>` and `<tbody>` elements, preserving native HTML table semantics for screen readers.
2. THE ResponsiveTable SHALL wrap the `<table>` in a Scroll_Container (`<div>` with `overflow-x: auto`) so that horizontal overflow is contained within the component and does not cause page-body overflow.
3. THE Sticky_Column (first `<th>` and first `<td>` in each row) SHALL use CSS `position: sticky; left: 0` with a solid background so that it remains visible during horizontal scroll.
4. WHEN the viewport width is 375 px, THE Sticky_Column SHALL remain visible and SHALL NOT overlap adjacent column content by more than 0 px (minimum supported viewport width is 320 px, documented in the component's JSDoc).
5. THE ResponsiveTable SHALL accept a generic `columns` prop (array of `{ key, label, render? }`) and a `data` prop (array of row objects), consistent with the existing `DataTable` component API in `components/ui/data-table.tsx`.

---

### Requirement 9: Responsive Table Component — Accessibility

**User Story:** As a keyboard or screen reader user, I want to navigate the table and have headers announced correctly for each cell, so that the table is fully accessible without a mouse.

#### Acceptance Criteria

1. THE ResponsiveTable SHALL assign `scope="col"` to all `<th>` elements in the header row so that screen readers correctly associate headers with data cells.
2. THE ResponsiveTable SHALL support keyboard-driven horizontal scrolling: WHEN the Scroll_Container has focus, pressing the ArrowLeft or ArrowRight key SHALL scroll the container by a configurable step (default: 120 px).
3. THE Scroll_Container SHALL have `tabIndex={0}` and an `aria-label` prop so that keyboard users can focus it and screen readers announce its purpose.
4. THE ResponsiveTable SHALL render a visually hidden `<caption>` element when a `caption` prop is provided, so that screen readers announce the table's purpose.
5. WHEN the table is in a loading state (`isLoading` prop is true), THE ResponsiveTable SHALL render Loading_Skeleton rows and set `aria-busy="true"` on the `<table>` element.

---

### Requirement 10: Responsive Table Component — Overflow Safety

**User Story:** As a user on any supported viewport, I want the page body to never scroll horizontally due to a table, so that the layout remains stable.

#### Acceptance Criteria

1. THE Scroll_Container SHALL have `max-width: 100%` so that it never exceeds its parent's width.
2. AT viewport widths of 375 px, 768 px, and 1280 px, THE ResponsiveTable SHALL not cause horizontal overflow on the `<body>` element.
3. THE ResponsiveTable SHALL expose a `stickyColumnWidth` prop (default: `"auto"`) that sets an explicit width on the Sticky_Column, preventing it from collapsing to zero on very narrow viewports.
4. WHERE the `showScrollbar` prop is true (default), THE Scroll_Container SHALL use `scrollbar-width: thin` (Firefox) and a `::-webkit-scrollbar` style so that the scrollbar is visible on touch devices that hide it by default.
