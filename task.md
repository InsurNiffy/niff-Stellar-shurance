#1347 Frontend — Appeal Storybook coverage
Repo Avatar
InsurNiffy/niff-Stellar-shurance
Description
Add Storybook stories for AppealButton and AppealConfirmModal covering their key states (visible, hidden for non-claimant, submitting, error).

Tasks
Add .stories files for AppealButton and AppealConfirmModal under the existing Storybook setup.
Cover at minimum: default, submitting, and post-error states.
Acceptance Criteria
Appeal components are documented and visually testable in Storybook.

#1344 Frontend — ClaimDetailView.tsx orphan component cleanup
Repo Avatar
InsurNiffy/niff-Stellar-shurance
Description
frontend/src/components/claims/ClaimDetailView.tsx renders its own read-only appeal/dispute cards but is not referenced by any route — the actually-used route (app/claims/[claimId]/page.tsx) renders ClaimVotePanel instead. This dead code is confusing for anyone extending the appeal UI.

Tasks
Confirm ClaimDetailView.tsx has no live route referencing it.
Either remove it, or wire it into a route and reconcile it with claim-vote-panel.tsx so there is a single source of truth for claim detail rendering.
Acceptance Criteria
There is exactly one live claim-detail component, with no unreferenced duplicate.

#1346 Frontend — Appeal transaction explorer link styling
Repo Avatar
InsurNiffy/niff-Stellar-shurance
Description
The post-appeal success state's explorer link should visually match the existing vote/withdrawal transaction link patterns for consistency.

Tasks
Compare the appeal success block's explorer link against the vote and withdrawal equivalents in claim-vote-panel.tsx.
Align styling/copy if there is drift.
Acceptance Criteria
Appeal, vote, and withdrawal transaction links look and read consistently.

#1345 Frontend — Appeal outcome push-notification opt-in
Repo Avatar
InsurNiffy/niff-Stellar-shurance
Description
Let claimants opt into a push/email notification for when their appeal round resolves, rather than needing to poll the claim detail page.

Tasks
Add an opt-in control near the appeal confirmation flow.
Wire to the backend appeal-round notification work (tracked separately on the backend).
Acceptance Criteria
Claimants can opt into being notified when their appeal resolves.