/**
 * Claim Voting State Diagram (Issue #1126)
 *
 * Reflects the on-chain niffyinsure contract state machine:
 *   Filed → Processing → Approved | Rejected | Withdrawn
 *
 * The diagram is an inline SVG so it renders correctly in both
 * light and dark themes without external dependencies.
 */
export function ClaimVotingDiagram() {
  return (
    <figure className="my-8 not-prose" aria-label="Claim voting state diagram">
      <figcaption className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
        Claim Voting State Machine
      </figcaption>

      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 680 320"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="w-full max-w-2xl rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
          style={{ minWidth: '480px' }}
        >
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" className="fill-gray-500 dark:fill-gray-400" fill="#6b7280" />
            </marker>
          </defs>

          {/* ── States ── */}
          {/* Filed */}
          <rect x="10" y="130" width="110" height="44" rx="8" fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5" />
          <text x="65" y="156" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1d4ed8">Filed</text>

          {/* Processing */}
          <rect x="200" y="130" width="130" height="44" rx="8" fill="#fef9c3" stroke="#eab308" strokeWidth="1.5" />
          <text x="265" y="156" textAnchor="middle" fontSize="13" fontWeight="600" fill="#713f12">Processing</text>

          {/* Approved */}
          <rect x="430" y="30" width="120" height="44" rx="8" fill="#dcfce7" stroke="#22c55e" strokeWidth="1.5" />
          <text x="490" y="56" textAnchor="middle" fontSize="13" fontWeight="600" fill="#15803d">Approved</text>

          {/* Rejected */}
          <rect x="430" y="138" width="120" height="44" rx="8" fill="#fee2e2" stroke="#ef4444" strokeWidth="1.5" />
          <text x="490" y="164" textAnchor="middle" fontSize="13" fontWeight="600" fill="#991b1b">Rejected</text>

          {/* Withdrawn */}
          <rect x="430" y="246" width="120" height="44" rx="8" fill="#f3f4f6" stroke="#9ca3af" strokeWidth="1.5" />
          <text x="490" y="272" textAnchor="middle" fontSize="13" fontWeight="600" fill="#374151">Withdrawn</text>

          {/* ── Transitions ── */}
          {/* Filed → Processing */}
          <line x1="120" y1="152" x2="198" y2="152" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <text x="159" y="144" textAnchor="middle" fontSize="10" fill="#6b7280">file_claim</text>

          {/* Processing → Approved */}
          <path d="M330 140 Q380 80 428 52" fill="none" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <text x="372" y="84" textAnchor="middle" fontSize="10" fill="#6b7280">C≥R, approve&gt;reject</text>

          {/* Processing → Rejected (quorum met, reject wins) */}
          <line x1="330" y1="160" x2="428" y2="160" stroke="#6b7280" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <text x="378" y="153" textAnchor="middle" fontSize="10" fill="#6b7280">C≥R, reject≥approve</text>

          {/* Processing → Rejected (deadline, no quorum) */}
          <path d="M265 174 Q265 220 428 175" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrow)" />
          <text x="310" y="218" textAnchor="middle" fontSize="10" fill="#6b7280">deadline, C&lt;R</text>

          {/* Processing → Withdrawn */}
          <path d="M330 165 Q380 230 428 262" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrow)" />
          <text x="354" y="240" textAnchor="middle" fontSize="10" fill="#9ca3af">withdraw_claim</text>

          {/* Legend */}
          <line x1="16" y1="294" x2="46" y2="294" stroke="#6b7280" strokeWidth="1.5" />
          <text x="52" y="298" fontSize="10" fill="#6b7280">transition</text>
          <line x1="130" y1="294" x2="160" y2="294" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x="166" y="298" fontSize="10" fill="#9ca3af">conditional / deadline</text>
        </svg>
      </div>

      <figcaption className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        State transitions match the <code>niffyinsure</code> contract. Dashed arrows indicate
        deadline or conditional paths. <strong>C</strong> = cast ballots;{' '}
        <strong>R</strong> = required minimum (ceil(E × Q ÷ 10 000)).
      </figcaption>
    </figure>
  )
}
