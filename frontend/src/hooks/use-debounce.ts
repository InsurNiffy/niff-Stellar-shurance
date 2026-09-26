import { useEffect, useState } from 'react'

/**
 * Returns `value` only after it has stayed unchanged for `delayMs`.
 * No leading-edge emission: the first value is also delayed so rapid
 * successive changes collapse to a single update of the latest value.
 *
 * Pass `hold` as the value to expose until the first quiet window elapses
 * (typically `null` / `undefined` for “nothing until settled”).
 */
export function useDebounce<T>(value: T, delayMs: number, hold: T): T {
  const [debounced, setDebounced] = useState(hold)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
