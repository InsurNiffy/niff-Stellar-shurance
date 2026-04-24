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

## CI

`npm run build-storybook` runs on every push/PR to `main` via `.github/workflows/storybook.yml`. A failing build blocks merge.

