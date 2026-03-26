'use client';

import { useCallback, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FaqItem } from '@/lib/faq-data';
import { trackFaqExpansion } from '@/lib/api/support';

interface FaqAccordionProps {
  items: FaqItem[];
}

export function FaqAccordion({ items }: FaqAccordionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const toggle = useCallback((id: string) => {
    setOpenId((prev) => {
      const opening = prev !== id;
      if (opening) trackFaqExpansion(id);
      return opening ? id : null;
    });
  }, []);

  /** Keyboard navigation: arrow keys move focus between items */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      const ids = items.map((i) => i.id);
      const idx = ids.indexOf(id);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        buttonRefs.current.get(ids[(idx + 1) % ids.length])?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        buttonRefs.current.get(ids[(idx - 1 + ids.length) % ids.length])?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        buttonRefs.current.get(ids[0])?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        buttonRefs.current.get(ids[ids.length - 1])?.focus();
      }
    },
    [items],
  );

  return (
    <div role="list" className="divide-y divide-border rounded-lg border">
      {items.map((item) => {
        const isOpen = openId === item.id;
        const panelId = `faq-panel-${item.id}`;
        const headingId = `faq-heading-${item.id}`;

        return (
          <div key={item.id} role="listitem">
            <h3 id={headingId} className="m-0">
              <button
                ref={(el) => {
                  if (el) buttonRefs.current.set(item.id, el);
                  else buttonRefs.current.delete(item.id);
                }}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                onKeyDown={(e) => handleKeyDown(e, item.id)}
                className={cn(
                  'flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium',
                  'transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2',
                  'focus-visible:ring-ring focus-visible:ring-inset',
                  isOpen && 'text-primary',
                )}
              >
                <span>{item.question}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'ml-4 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                    isOpen && 'rotate-180 text-primary',
                  )}
                />
              </button>
            </h3>

            <div
              id={panelId}
              role="region"
              aria-labelledby={headingId}
              hidden={!isOpen}
              className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed"
            >
              {item.answer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
