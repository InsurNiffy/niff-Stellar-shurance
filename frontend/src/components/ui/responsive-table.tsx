'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface ResponsiveTableProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  /** Enable sticky first column (default: true) */
  stickyFirstColumn?: boolean
}

const ResponsiveTable = React.forwardRef<HTMLDivElement, ResponsiveTableProps>(
  ({ className, children, stickyFirstColumn = true, ...props }, ref) => {
    const scrollRef = React.useRef<HTMLDivElement>(null)

    // Keyboard navigation for horizontal scrolling
    React.useEffect(() => {
      const container = scrollRef.current
      if (!container) return

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target !== container && !container.contains(e.target as Node)) return

        const scrollAmount = 100
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          container.scrollLeft -= scrollAmount
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          container.scrollLeft += scrollAmount
        }
      }

      container.addEventListener('keydown', handleKeyDown)
      return () => container.removeEventListener('keydown', handleKeyDown)
    }, [])

    return (
      <div
        ref={ref}
        className={cn('relative w-full', className)}
        {...props}
      >
        <div
          ref={scrollRef}
          className={cn(
            'overflow-x-auto overflow-y-visible',
            // Visible scrollbar on touch devices
            '[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-muted [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full',
            // Focus styles for keyboard navigation
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
          )}
          tabIndex={0}
          role="region"
          aria-label="Scrollable table"
        >
          <div className={cn(stickyFirstColumn && 'responsive-table-sticky')}>
            {children}
          </div>
        </div>
      </div>
    )
  }
)
ResponsiveTable.displayName = 'ResponsiveTable'

const ResponsiveTableTable = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn('w-full caption-bottom text-sm', className)}
    {...props}
  />
))
ResponsiveTableTable.displayName = 'ResponsiveTableTable'

const ResponsiveTableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn('bg-background', className)}
    {...props}
  />
))
ResponsiveTableHeader.displayName = 'ResponsiveTableHeader'

const ResponsiveTableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
))
ResponsiveTableBody.displayName = 'ResponsiveTableBody'

const ResponsiveTableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b transition-colors hover:bg-muted/50',
      className
    )}
    {...props}
  />
))
ResponsiveTableRow.displayName = 'ResponsiveTableRow'

const ResponsiveTableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { sticky?: boolean }
>(({ className, sticky, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap',
      sticky && 'sticky-cell',
      className
    )}
    {...props}
  />
))
ResponsiveTableHead.displayName = 'ResponsiveTableHead'

const ResponsiveTableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { sticky?: boolean }
>(({ className, sticky, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'p-4 align-middle whitespace-nowrap',
      sticky && 'sticky-cell',
      className
    )}
    {...props}
  />
))
ResponsiveTableCell.displayName = 'ResponsiveTableCell'

export {
  ResponsiveTable,
  ResponsiveTableTable,
  ResponsiveTableHeader,
  ResponsiveTableBody,
  ResponsiveTableRow,
  ResponsiveTableHead,
  ResponsiveTableCell,
}
