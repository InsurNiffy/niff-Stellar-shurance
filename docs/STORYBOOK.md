# Storybook

Visual component catalogue for NiffyInsur's UI primitives.

## Running

```bash
cd frontend
npm run storybook        # dev server → http://localhost:6006
npm run build-storybook  # static build → frontend/storybook-static/
```

## Naming Conventions

Stories follow the `Category/ComponentName` pattern:

| Title | Component |
|---|---|
| `UI/Button` | `Button` |
| `UI/Input` | `Input` |
| `UI/StatusBadge` | `StatusBadge` |
| `UI/WalletAddress` | `WalletAddress` |
| `UI/LedgerCountdown` | `LedgerCountdown` |
| `UI/SkeletonRow` | `SkeletonRow` |

Story names within a file describe the **state** being shown, e.g. `Active`, `Disabled`, `DeadlinePassed`, `AllStates`.

## File Location

Story files live next to the component they document:

```
src/components/ui/button.tsx
src/components/ui/button.stories.tsx   ← same directory
```

## Mocking Rules

- Stories must **not** require a live Stellar wallet or backend.
- Use static mock addresses and ledger numbers.
- Wrap components that need React Query in a `QueryClientProvider` decorator if needed (see `.storybook/preview.ts`).

## Coverage Expectation

New shared components under `src/components/` must ship with a baseline
`.stories.tsx` covering the default state plus key variants (e.g.
loading/error/empty) alongside the component in the same PR.

## CI

`.github/workflows/storybook.yml` runs on every push/PR to `main` and has two jobs:

- **Build** — `npm run build-storybook`. A failing build blocks merge.
- **Visual regression** — renders every story and diffs a screenshot against
  the committed baseline in `frontend/.storybook/__snapshots__/`. An
  unreviewed visual diff fails the job and blocks merge.

### Reviewing and approving a visual diff

When the visual regression job fails on your PR:

1. Open the failed run in the Checks tab and download the `storybook-visual-diffs`
   artifact. Each file is named `<story-id>-diff.png` and shows baseline,
   actual, and diff side by side.
2. If the change is a regression, fix the component and push again.
3. If the change is intentional, update the baselines locally and commit them:

   ```bash
   cd frontend
   npm run build-storybook
   npx http-server storybook-static --port 6006 &
   npx wait-on tcp:6006
   npx test-storybook -u
   ```

   This overwrites the PNGs under `.storybook/__snapshots__/` for any story
   whose rendered output changed. Review the updated PNGs, commit them, and
   push — the check will pass against the new baseline.

### Excluding a story from the visual check

Add the `skip-visual-test` tag to a story's `meta.tags` if it cannot render
in isolation (e.g. it throws without a provider it can't be given in
Storybook). This only skips the visual regression job — the story still
renders in the Storybook UI. See `PolicyCard.stories.tsx` for an example.

