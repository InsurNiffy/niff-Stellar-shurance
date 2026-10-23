/**
 * Ramp UI components — fiat on/off-ramp integration.
 *
 * Umbrella tracking: #1714 (feature:ramp)
 *
 * RampButton   — client component that opens the third-party ramp confirmation
 *                dialog and triggers anonymized analytics on click.
 * RampSection  — async server component that fetches the ramp URL from the
 *                backend and renders RampButton; returns null when the feature
 *                flag is off or no URL is available.
 */
export { RampButton } from './ramp-button'
export { RampSection } from './ramp-section'
