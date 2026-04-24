'use client';

import React from 'react';
import { History, X } from 'lucide-react';
import { Button } from '@/components/ui';

interface DraftResumeBannerProps {
  onConfirm: () => void;
  onDismiss: () => void;
}

export function DraftResumeBanner({ onConfirm, onDismiss }: DraftResumeBannerProps) {
  return (
    <div 
      className="flex items-center justify-between gap-4 rounded-lg bg-primary/5 border border-primary/20 p-4 mb-6 animate-in fade-in slide-in-from-top-4 duration-500"
      role="alert"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-primary/20 p-2 text-primary">
          <History className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold">Incomplete Claim Draft Found</p>
          <p className="text-xs text-muted-foreground">
            You have a partially completed claim for this policy. Would you like to resume?
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onDismiss} aria-label="Dismiss draft">
          <X className="h-4 w-4" />
        </Button>
        <Button size="sm" className="h-8" onClick={onConfirm}>
          Resume Draft
        </Button>
      </div>
    </div>
  );
}
