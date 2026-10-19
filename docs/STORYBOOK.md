# Storybook

Visual component catalogue for NiffyInsur's UI primitives.

## Running

```bash
cd frontend
npm run storybook        # dev server → http://localhost:6006
npm run build-storybook  # static build → frontend/storybook-static/
```

Storybook is configured under `frontend/.storybook/` (`main.ts` for the
framework/addons, `preview.ts` for global decorators and parameters). No
environment variables or backend are required to run it locally.

## Writing a Story for a New Component

1. Create the story file next to the component (see **File Location** below).
2. Use the Component Story Format (CSF3): a default `meta` export plus one
   named export per state.
3. Type the meta with `Meta`/`StoryObj` from `@storybook/react` so `args` are
   checked against the component's props.
4. Prefer `args` over hand-written JSX so controls work in the Storybook UI.
5. Add a `decorator` only when the component needs a provider (React Query,
   theme, router). Global providers belong in `.storybook/preview.ts`.

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "Submit", variant: "primary" },
} satisfies Meta<typeof Button>;

export default meta;
export type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
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

- **File names**: `<component>.stories.tsx`, lowercase, matching the component
  file name.
- **Story export names**: PascalCase and describe the **state** being shown,
  e.g. `Active`, `Disabled`, `DeadlinePassed`, `AllStates`.
- **Titles**: `Category/ComponentName` — use `UI/` for primitives and a
  feature category (e.g. `Policies/`) for feature components.

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

## Chromatic CI Visual Regression

Chromatic runs on every pull request that touches `frontend/` and publishes a
visual diff of each story against the accepted baseline.

- **Trigger**: the Chromatic GitHub Action runs on `pull_request` (and on
  `main` after merge to refresh the baseline).
- **Token**: the workflow authenticates with the `CHROMATIC_PROJECT_TOKEN`
  repository secret. It is never committed to the repo.
- **Review flow**: the action posts a status check and a Chromatic build link
  on the PR. Open the link to review changed/new stories side by side.
- **Accepting a baseline**: once the visual changes are intended, click
  **Accept** in the Chromatic UI. That snapshot becomes the new baseline for
  future builds. Unreviewed changes keep the check failing.

### Excluding a story from the visual check

Add the `skip-visual-test` tag to a story's `meta.tags` if it cannot render
in isolation (e.g. it throws without a provider it can't be given in
Storybook). See `PolicyCard.stories.tsx` for an example.

## Coverage Expectation

New shared components under `src/components/` must ship with a baseline
`.stories.tsx` covering the default state plus key variants (e.g.
loading/error/empty) alongside the component in the same PR.

### Components currently lacking stories

The following components do not yet have a `.stories.tsx` file and are good
candidates for contribution:

- `src/components/ui/` — any primitive not listed in the naming table above
  (e.g. `Card`, `Dialog`, `Tooltip`).
- Feature components under `src/components/policies/` and
  `src/components/wallet/` that render independently of live data.

When adding a story for one of these, remove it from this list in the same PR.
