'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { getConfig } from '@/config/env'
import { ExternalLink } from 'lucide-react'

interface RampButtonProps {
  rampUrl: string
}

function trackRampClick() {
  const { rampAnalytics } = getConfig()
  if (!rampAnalytics) return
  // Anonymized: event name + timestamp only — no wallet address or PII
  try {
    if (typeof window !== 'undefined' && 'gtag' in window) {
      ;(window as unknown as { gtag: (...a: unknown[]) => void }).gtag(
        'event',
        'ramp_click',
        { event_category: 'onramp', value: Date.now() },
      )
    }
  } catch {
    // analytics must never throw
  }
}

export function RampButton({ rampUrl }: RampButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Buy XLM / Stablecoins <ExternalLink className="ml-2 h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Third-Party On-Ramp</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  You are about to leave NiffyInsur and visit an independent
                  third-party service. <strong>InsureFii does not custody,
                  control, or endorse this service.</strong>
                </p>
                <p>
                  Any KYC or identity verification performed on the ramp is
                  conducted solely by that provider and is{' '}
                  <strong>
                    entirely separate from NiffyInsur insurance underwriting
                  </strong>
                  . Completing ramp KYC does not constitute an insurance
                  application or approval.
                </p>
                <p>
                  This feature may not be available in all jurisdictions.
                  Availability does not constitute legal or financial advice.
                  Consult a qualified adviser before transacting.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              asChild
              onClick={() => {
                trackRampClick()
                setOpen(false)
              }}
            >
              <a
                href={rampUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Continue to Ramp <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
