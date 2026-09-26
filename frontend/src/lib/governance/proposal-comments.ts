const STORAGE_KEY = 'niffyinsure:governance-proposal-comments:v1'

export interface ProposalComment {
  id: string
  proposalId: string
  author: string
  body: string
  createdAt: string
}

type CommentStore = Record<string, ProposalComment[]>

function readStore(): CommentStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as CommentStore
  } catch {
    return {}
  }
}

function writeStore(store: CommentStore): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function listProposalComments(proposalId: string): ProposalComment[] {
  const store = readStore()
  return store[proposalId] ?? []
}

export function addProposalComment(
  proposalId: string,
  author: string,
  body: string,
): ProposalComment {
  const trimmed = body.trim()
  if (!trimmed) {
    throw new Error('Comment cannot be empty')
  }

  const comment: ProposalComment = {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    proposalId,
    author,
    body: trimmed,
    createdAt: new Date().toISOString(),
  }

  const store = readStore()
  const existing = store[proposalId] ?? []
  store[proposalId] = [...existing, comment]
  writeStore(store)
  return comment
}

/** Test helper — clears persisted comments. */
export function clearProposalCommentsForTests(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
