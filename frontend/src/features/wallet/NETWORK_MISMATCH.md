# Wallet vs app network mismatch

## What we compare

1. **App network** — `WalletContext` state (`AppNetwork`: `testnet` | `mainnet` | `futurenet`), persisted under `niffyinsure:appNetwork` and passed into `StellarWalletsKit.init` / `setNetwork`.
2. **Wallet network** — The `network` string from `StellarWalletsKit.getNetwork()` (Stellar network passphrase), mapped with `passphraseToAppNetwork()` in `src/config/networkManifest.ts`.

We re-fetch the wallet passphrase on connect, reconnect, app network changes, successful `signTransaction`, and on `KitEventType.STATE_UPDATED` when an address is present so extension network switches are picked up quickly.

## When the blocking overlay shows

The full-screen overlay is shown only on routes that are **not** read-only (see `isReadOnlyWalletInteractionPath` in `utils/networkMismatch.ts`): excluded paths include `/`, `/docs` (and subpaths), `/privacy`, and `/support`, with optional locale prefixes (`/en`, `/es`).

`computeNetworkMismatch` returns true when:

- The wallet is **connected**, and
- The last `getNetwork()` call **succeeded** (`resolution.status === 'ok'`), and
- Either the passphrase did **not** match any manifest (`mappedNetwork === null`), or `mappedNetwork !== appNetwork`.

## Edge cases

| Situation | Behavior |
|-----------|----------|
| Custom Soroban RPC in Settings | Does not affect passphrase comparison; only the wallet’s reported passphrase matters. |
| Wallet on a private / unknown chain | Passphrase does not match manifests → `mappedNetwork === null` → mismatch overlay (when on a wallet-required route). |
| `getNetwork()` throws or fails | Resolution stays non-`ok` → overlay hidden (we do not block on unknown read failure). |
| Settings “Network” (testnet / mainnet) | `SettingsPanel` calls `setAppNetwork` so the kit and app passphrase stay aligned with the same control users reach via “Switch Network”. The Network card uses `SETTINGS_NETWORK_SECTION_ID` (`settings-network`) so `/settings#settings-network` scrolls/focuses the right block. |

## Accessibility

The overlay uses a Radix `Dialog` with `role="alertdialog"`, `aria-modal`, labelled title/description, and an `aria-live="assertive"` region so assistive tech announces the mismatch when the dialog opens.
