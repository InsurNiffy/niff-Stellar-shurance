'use client';

/**
 * Sign-in flow UI (#1507): explainer modal → loading → error/success.
 *
 * Explainer copy: "Signing proves you own this wallet; it costs nothing."
 * No transaction is proposed — the wallet only signs a challenge message.
 */

import { ShieldCheck, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSession } from '../hooks/useSession';

export interface SignInDialogViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: 'authenticated' | 'unauthenticated' | 'loading';
  error: string | null;
  onSignIn: () => void;
}

/** Presentational modal — pure props, easy to unit test. */
export function SignInDialogView({
  open,
  onOpenChange,
  status,
  error,
  onSignIn,
}: SignInDialogViewProps) {
  const loading = status === 'loading';

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent className="max-w-sm" aria-describedby="sign-in-explainer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            Sign in with your wallet
          </DialogTitle>
          <DialogDescription id="sign-in-explainer">
            Signing proves you own this wallet; it costs nothing. No transaction is created and
            no funds move — you are only signing a one-time challenge message.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            data-testid="sign-in-error"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onSignIn} disabled={loading} aria-busy={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Waiting for signature…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface SignInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Container — wires the explainer modal to the session hook. */
export function SignInModal({ open, onOpenChange }: SignInModalProps) {
  const { status, error, signIn } = useSession();

  return (
    <SignInDialogView
      open={open}
      onOpenChange={onOpenChange}
      status={status}
      error={error}
      onSignIn={() => {
        void signIn().then((ok) => {
          if (ok) onOpenChange(false);
        });
      }}
    />
  );
}
