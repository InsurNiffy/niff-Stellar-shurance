import { renderHook, act } from '@testing-library/react';
import { useDraftPersistence } from '../use-draft-persistence';

describe('useDraftPersistence', () => {
  const formKey = 'test-form';
  const storageKey = `niffyinsur-draft-${formKey}`;
  const schemaVersion = 1;

  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('saves draft to localStorage', () => {
    const { result } = renderHook(() => useDraftPersistence(formKey, schemaVersion));
    
    const data = { name: 'John Doe', amount: '100' };
    act(() => {
      result.current.saveDraft(data);
    });

    const stored = JSON.parse(localStorage.getItem(storageKey)!);
    expect(stored.data).toEqual(data);
    expect(stored._v).toBe(schemaVersion);
    expect(result.current.hasDraft).toBe(true);
  });

  it('restores draft from localStorage', () => {
    const data = { name: 'Jane Doe', amount: '200' };
    const wrapper = {
      _v: schemaVersion,
      _ts: Date.now(),
      data,
    };
    localStorage.setItem(storageKey, JSON.stringify(wrapper));

    const { result } = renderHook(() => useDraftPersistence(formKey, schemaVersion));
    
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.loadDraft()).toEqual(data);
  });

  it('clears draft when version mismatches', () => {
    const wrapper = {
      _v: 0, // Old version
      _ts: Date.now(),
      data: { name: 'Old' },
    };
    localStorage.setItem(storageKey, JSON.stringify(wrapper));

    renderHook(() => useDraftPersistence(formKey, schemaVersion));
    
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('clears draft when expired (24h TTL)', () => {
    const now = Date.now();
    const wrapper = {
      _v: schemaVersion,
      _ts: now - (25 * 60 * 60 * 1000), // 25 hours ago
      data: { name: 'Expired' },
    };
    localStorage.setItem(storageKey, JSON.stringify(wrapper));

    renderHook(() => useDraftPersistence(formKey, schemaVersion));
    
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('sanitizes File objects and IPFS URLs', () => {
    const { result } = renderHook(() => useDraftPersistence(formKey, schemaVersion));
    
    // Mock a File-like object
    const mockFile = { constructor: { name: 'File' }, name: 'evidence.jpg' };
    
    const data = { 
      name: 'John', 
      evidence: [mockFile], 
      ipfsLink: 'ipfs://Qm...',
      deepIpfs: '/ipfs/abc'
    };

    act(() => {
      result.current.saveDraft(data as any);
    });

    const stored = JSON.parse(localStorage.getItem(storageKey)!);
    expect(stored.data.name).toBe('John');
    expect(stored.data.evidence).toBeUndefined();
    expect(stored.data.ipfsLink).toBeUndefined();
    expect(stored.data.deepIpfs).toBeUndefined();
  });

  it('clears draft explicitly', () => {
    const { result } = renderHook(() => useDraftPersistence(formKey, schemaVersion));
    
    act(() => {
      result.current.saveDraft({ test: 'data' });
    });
    expect(result.current.hasDraft).toBe(true);

    act(() => {
      result.current.clearDraft();
    });
    expect(result.current.hasDraft).toBe(false);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
