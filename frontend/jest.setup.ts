import '@testing-library/jest-dom';
import { webcrypto } from 'crypto';

// Polyfill TextEncoder/TextDecoder for jsdom
if (typeof TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Polyfill Web Crypto API for jsdom
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

// Polyfill fetch for jsdom when the test runtime does not provide it
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      blob: async () => new Blob(),
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: { get: () => null, has: () => false },
    }) as unknown as Response) as typeof fetch;
}

// Polyfill File.arrayBuffer for jsdom when missing only
if (
  typeof File !== 'undefined' &&
  typeof File.prototype.arrayBuffer !== 'function'
) {
  File.prototype.arrayBuffer = function () {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// Mock window.matchMedia (jsdom only — skip in @jest-environment node)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

if (typeof document !== 'undefined' && typeof document.execCommand !== 'function') {
  Object.defineProperty(document, 'execCommand', {
    value: jest.fn(() => true),
    configurable: true,
  });
}
