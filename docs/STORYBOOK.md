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

### Excluding a story from the visual check

Add the `skip-visual-test` tag to a story's `meta.tags` if it cannot render
in isolation (e.g. it throws without a provider it can't be given in
Storybook). See `PolicyCard.stories.tsx` for an example.

