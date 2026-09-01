'use client'

import { useState, type DragEvent, type ReactNode } from 'react'
import { useDashboardCardOrder } from '@/hooks/use-dashboard-card-order'
import { cn } from '@/lib/utils'

export interface DashboardCardDef {
  id: string
  label: string
  content: ReactNode
}

/**
 * Renders `cards` in a user-reorderable, drag-and-drop layout. The chosen
 * order is persisted to localStorage (per browser) and restored on the next
 * load; a user with no saved preference sees `cards` in the order given.
 *
 * Uses native HTML5 drag-and-drop (no extra dependency) — draggable cards
 * fire onDragStart/onDragOver/onDrop to swap positions in the order array.
 */
export function DraggableDashboardCards({ cards }: { cards: DashboardCardDef[] }) {
  const defaultOrder = cards.map((c) => c.id)
  const { order, reorder, hydrated } = useDashboardCardOrder(defaultOrder)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const cardsById = new Map(cards.map((c) => [c.id, c]))
  // Fall back to the default order until localStorage has been read once,
  // so server-rendered and pre-hydration markup match.
  const orderedIds = hydrated ? order : defaultOrder

  function handleDragStart(id: string) {
    return (e: DragEvent<HTMLDivElement>) => {
      setDraggingId(id)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', id)
    }
  }

  function handleDragOver(id: string) {
    return (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (id !== dragOverId) setDragOverId(id)
    }
  }

  function handleDrop(id: string) {
    return (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const fromId = e.dataTransfer.getData('text/plain') || draggingId
      if (fromId) reorder(fromId, id)
      setDraggingId(null)
      setDragOverId(null)
    }
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverId(null)
  }

  return (
    <div className="space-y-4" data-testid="dashboard-card-list">
      {orderedIds.map((id) => {
        const card = cardsById.get(id)
        if (!card) return null
        return (
          <div
            key={card.id}
            role="listitem"
            aria-label={`${card.label} card`}
            data-card-id={card.id}
            draggable
            onDragStart={handleDragStart(card.id)}
            onDragOver={handleDragOver(card.id)}
            onDrop={handleDrop(card.id)}
            onDragEnd={handleDragEnd}
            className={cn(
              'rounded-lg border border-transparent transition-colors',
              draggingId === card.id && 'opacity-50',
              dragOverId === card.id && draggingId !== card.id && 'border-dashed border-primary',
            )}
          >
            <div
              className="mb-1 flex cursor-grab items-center gap-1 text-xs text-muted-foreground select-none active:cursor-grabbing"
              aria-hidden="true"
            >
              <span>⠿</span>
              <span>{card.label}</span>
            </div>
            {card.content}
          </div>
        )
      })}
    </div>
  )
}
