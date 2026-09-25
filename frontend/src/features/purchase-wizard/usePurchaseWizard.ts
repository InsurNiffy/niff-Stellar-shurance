import { useCallback, useEffect, useMemo, useReducer } from 'react';

/**
 * Step state machine for the policy purchase wizard (#1513).
 *
 * Steps: 1) confirm quote, 2) options, 3) review terms, 4) sign & pay.
 * The draft is persisted to sessionStorage so a refresh keeps progress.
 */

export type PurchaseStep = 'confirm' | 'options' | 'terms' | 'sign';

export const PURCHASE_STEPS: PurchaseStep[] = ['confirm', 'options', 'terms', 'sign'];

export interface PurchaseOptions {
  beneficiary: string;
  deductible: string;
  duration: string;
}

export interface PurchaseDraft {
  step: PurchaseStep;
  options: PurchaseOptions;
  termsAccepted: boolean;
  termsHash: string | null;
}

export interface WalletState {
  connected: boolean;
  signedIn: boolean;
  /** Balance of the chosen asset, as a decimal string. */
  balance: string;
  /** Whether the trustline for the chosen asset exists. */
  hasTrustline: boolean;
  /** Minimum balance required to complete the purchase. */
  requiredBalance: string;
}

export interface PurchaseWizardState {
  draft: PurchaseDraft;
  wallet: WalletState;
}

export const EMPTY_OPTIONS: PurchaseOptions = {
  beneficiary: '',
  deductible: '',
  duration: '',
};

export const INITIAL_DRAFT: PurchaseDraft = {
  step: 'confirm',
  options: EMPTY_OPTIONS,
  termsAccepted: false,
  termsHash: null,
};

export const INITIAL_WALLET: WalletState = {
  connected: false,
  signedIn: false,
  balance: '0',
  hasTrustline: false,
  requiredBalance: '0',
};

export const STORAGE_KEY = 'purchase-wizard:draft';

type Action =
  | { type: 'hydrate'; draft: PurchaseDraft }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goTo'; step: PurchaseStep }
  | { type: 'setOptions'; options: Partial<PurchaseOptions> }
  | { type: 'setTermsAccepted'; accepted: boolean }
  | { type: 'setTermsHash'; hash: string | null }
  | { type: 'setWallet'; wallet: Partial<WalletState> }
  | { type: 'reset' };

function reducer(state: PurchaseWizardState, action: Action): PurchaseWizardState {
  switch (action.type) {
    case 'hydrate':
      return { ...state, draft: action.draft };
    case 'next': {
      const index = PURCHASE_STEPS.indexOf(state.draft.step);
      const nextStep = PURCHASE_STEPS[Math.min(index + 1, PURCHASE_STEPS.length - 1)];
      return { ...state, draft: { ...state.draft, step: nextStep } };
    }
    case 'back': {
      const index = PURCHASE_STEPS.indexOf(state.draft.step);
      const prevStep = PURCHASE_STEPS[Math.max(index - 1, 0)];
      return { ...state, draft: { ...state.draft, step: prevStep } };
    }
    case 'goTo':
      return { ...state, draft: { ...state.draft, step: action.step } };
    case 'setOptions':
      return {
        ...state,
        draft: { ...state.draft, options: { ...state.draft.options, ...action.options } },
      };
    case 'setTermsAccepted':
      return { ...state, draft: { ...state.draft, termsAccepted: action.accepted } };
    case 'setTermsHash':
      return { ...state, draft: { ...state.draft, termsHash: action.hash } };
    case 'setWallet':
      return { ...state, wallet: { ...state.wallet, ...action.wallet } };
    case 'reset':
      return { draft: INITIAL_DRAFT, wallet: state.wallet };
    default:
      return state;
  }
}

function readStoredDraft(): PurchaseDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PurchaseDraft>;
    if (!parsed || !PURCHASE_STEPS.includes(parsed.step as PurchaseStep)) return null;
    return {
      step: parsed.step as PurchaseStep,
      options: { ...EMPTY_OPTIONS, ...(parsed.options ?? {}) },
      termsAccepted: Boolean(parsed.termsAccepted),
      termsHash: parsed.termsHash ?? null,
    };
  } catch {
    return null;
  }
}

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface UsePurchaseWizardResult {
  step: PurchaseStep;
  stepIndex: number;
  totalSteps: number;
  draft: PurchaseDraft;
  wallet: WalletState;
  /** Whether the current step's inputs are valid and navigation forward is allowed. */
  canGoNext: boolean;
  /** Whether the wallet can sign: connected, signed in, trustline present, sufficient balance. */
  canSign: boolean;
  /** True when the wallet is connected but lacks funds or a trustline. */
  insufficientFunds: boolean;
  next: () => void;
  back: () => void;
  goTo: (step: PurchaseStep) => void;
  setOptions: (options: Partial<PurchaseOptions>) => void;
  setTermsAccepted: (accepted: boolean) => void;
  setTermsHash: (hash: string | null) => void;
  setWallet: (wallet: Partial<WalletState>) => void;
  reset: () => void;
}

export function usePurchaseWizard(
  initialWallet: Partial<WalletState> = {},
): UsePurchaseWizardResult {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    draft: INITIAL_DRAFT,
    wallet: { ...INITIAL_WALLET, ...initialWallet },
  }));

  // Restore any persisted draft on mount so a refresh keeps progress.
  useEffect(() => {
    const stored = readStoredDraft();
    if (stored) dispatch({ type: 'hydrate', draft: stored });
  }, []);

  // Persist the draft whenever it changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.draft));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [state.draft]);

  const stepIndex = PURCHASE_STEPS.indexOf(state.draft.step);

  const canGoNext = useMemo(() => {
    switch (state.draft.step) {
      case 'confirm':
        return true;
      case 'options':
        return (
          state.draft.options.beneficiary.trim().length > 0 &&
          state.draft.options.deductible.trim().length > 0 &&
          state.draft.options.duration.trim().length > 0
        );
      case 'terms':
        return state.draft.termsAccepted && Boolean(state.draft.termsHash);
      case 'sign':
        return false;
      default:
        return false;
    }
  }, [state.draft]);

  const insufficientFunds = useMemo(() => {
    if (!state.wallet.connected || !state.wallet.signedIn) return false;
    return (
      !state.wallet.hasTrustline ||
      toNumber(state.wallet.balance) < toNumber(state.wallet.requiredBalance)
    );
  }, [state.wallet]);

  const canSign = useMemo(
    () =>
      state.wallet.connected &&
      state.wallet.signedIn &&
      state.wallet.hasTrustline &&
      toNumber(state.wallet.balance) >= toNumber(state.wallet.requiredBalance),
    [state.wallet],
  );

  const next = useCallback(() => dispatch({ type: 'next' }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const goTo = useCallback((step: PurchaseStep) => dispatch({ type: 'goTo', step }), []);
  const setOptions = useCallback(
    (options: Partial<PurchaseOptions>) => dispatch({ type: 'setOptions', options }),
    [],
  );
  const setTermsAccepted = useCallback(
    (accepted: boolean) => dispatch({ type: 'setTermsAccepted', accepted }),
    [],
  );
  const setTermsHash = useCallback(
    (hash: string | null) => dispatch({ type: 'setTermsHash', hash }),
    [],
  );
  const setWallet = useCallback(
    (wallet: Partial<WalletState>) => dispatch({ type: 'setWallet', wallet }),
    [],
  );
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return {
    step: state.draft.step,
    stepIndex,
    totalSteps: PURCHASE_STEPS.length,
    draft: state.draft,
    wallet: state.wallet,
    canGoNext,
    canSign,
    insufficientFunds,
    next,
    back,
    goTo,
    setOptions,
    setTermsAccepted,
    setTermsHash,
    setWallet,
    reset,
  };
}
