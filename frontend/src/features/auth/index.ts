export { useSession, REFRESH_LEAD_MS } from './hooks/useSession';
export type { SessionStatus, UseSessionResult, UseSessionOptions } from './hooks/useSession';
export { SignInModal, SignInDialogView } from './components/SignInModal';
export type { SignInDialogViewProps } from './components/SignInModal';
export { RequireAuth } from './components/RequireAuth';
export type { RequireAuthProps } from './components/RequireAuth';
export { sessionStore, msUntilExpiry } from './session/sessionStore';
export type { SessionSnapshot } from './session/sessionStore';
export { signWithWallet, isUserRejection } from './session/walletSigner';
export type { SignMessageFn } from './session/walletSigner';
export {
  requestChallenge,
  verifyChallenge,
  refreshAccessToken,
  revokeSession,
} from './session/authApi';
