'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { fetchPolicies, PolicyListError } from '../api';
import type { PolicyDto, PolicyListParams, PolicyStatusFilter, PolicySortField } from '../api';

const PAGE_SIZE = 20;

interface State {
  pages: PolicyDto[][];           // one entry per loaded page (cursor-based)
  cursors: (string | null)[];     // cursors[i] = cursor to fetch page i+1
  total: number;
  pageIndex: number;              // 0-based current page index
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; pageIndex: number; data: PolicyDto[]; next_cursor: string | null; total: number }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'SET_PAGE'; pageIndex: number }
  | { type: 'INVALIDATE_PAGE'; pageIndex: number }
  | { type: 'RESET' };

function init(): State {
  return { pages: [], cursors: [null], total: 0, pageIndex: 0, loading: true, error: null };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS': {
      const pages = [...state.pages];
      pages[action.pageIndex] = action.data;
      const cursors = [...state.cursors];
      cursors[action.pageIndex + 1] = action.next_cursor;
      return { ...state, pages, cursors, total: action.total, loading: false };
    }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'SET_PAGE':
      return { ...state, pageIndex: action.pageIndex };
    case 'INVALIDATE_PAGE': {
      const pages = [...state.pages];
      delete pages[action.pageIndex];
      return { ...state, pages };
    }
    case 'RESET':
      return init();
    default:
      return state;
  }
}

export interface UsePoliciesReturn {
  policies: PolicyDto[];
  total: number;
  pageIndex: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  loading: boolean;
  error: string | null;
  goToPage: (index: number) => void;
  retry: () => void;
}

export function usePolicies(
  holder: string | null,
  network: string,
  status: PolicyStatusFilter,
  sort: PolicySortField,
): UsePoliciesReturn {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  // Reset page cache when filter/network changes
  useEffect(() => {
    dispatch({ type: 'RESET' });
  }, [holder, network, status, sort]);

  useEffect(() => {
    if (!holder) {
      dispatch({ type: 'FETCH_ERROR', error: 'wallet_not_connected' });
      return;
    }

    const { pageIndex, cursors, pages } = state;

    // Skip if this page is already cached
    if (pages[pageIndex]) return;

    const controller = new AbortController();
    dispatch({ type: 'FETCH_START' });

    const params: PolicyListParams = {
      holder,
      status,
      limit: PAGE_SIZE,
      after: cursors[pageIndex] ?? undefined,
    };

    fetchPolicies(params, controller.signal)
      .then((result) => {
        dispatch({
          type: 'FETCH_SUCCESS',
          pageIndex,
          data: result.data,
          next_cursor: result.next_cursor,
          total: result.total,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof PolicyListError ? err.message : 'Failed to load policies';
        dispatch({ type: 'FETCH_ERROR', error: msg });
      });

    return () => controller.abort();
    // state.pages is intentionally omitted — we only re-run when pageIndex changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holder, network, status, sort, state.pageIndex]);

  const goToPage = useCallback((index: number) => {
    dispatch({ type: 'SET_PAGE', pageIndex: index });
  }, []);

  // Retry: invalidate the current page's cache entry so the effect re-fetches it
  const retry = useCallback(() => {
    dispatch({ type: 'INVALIDATE_PAGE', pageIndex: state.pageIndex });
  }, [state.pageIndex]);

  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  const rawPolicies = state.pages[state.pageIndex] ?? [];
  const policies = sortPolicies(rawPolicies, sort);

  return {
    policies,
    total: state.total,
    pageIndex: state.pageIndex,
    hasNextPage: state.pageIndex < totalPages - 1 && state.cursors[state.pageIndex + 1] !== undefined,
    hasPrevPage: state.pageIndex > 0,
    loading: state.loading,
    error: state.error,
    goToPage,
    retry,
  };
}

function sortPolicies(policies: PolicyDto[], sort: PolicySortField): PolicyDto[] {
  const copy = [...policies];
  switch (sort) {
    case 'expiry':
      return copy.sort((a, b) => a.expiry_countdown.end_ledger - b.expiry_countdown.end_ledger);
    case 'coverage':
      return copy.sort((a, b) =>
        Number(BigInt(b.coverage_summary.coverage_amount) - BigInt(a.coverage_summary.coverage_amount)),
      );
    case 'premium':
      return copy.sort((a, b) =>
        Number(BigInt(b.coverage_summary.premium_amount) - BigInt(a.coverage_summary.premium_amount)),
      );
    default:
      return copy;
  }
}
