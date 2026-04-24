import { ERROR_CATALOG, getCatalogEntry, ErrorCode, CatalogEntry } from './error-catalog';
import { AppException } from './app.exception';
import * as fs from 'fs';
import * as path from 'path';

const CATALOG_ENTRIES = Object.entries(ERROR_CATALOG) as [ErrorCode, CatalogEntry][];

describe('ERROR_CATALOG structure', () => {
  it('has at least one entry', () => {
    expect(CATALOG_ENTRIES.length).toBeGreaterThan(0);
  });

  it.each(CATALOG_ENTRIES)('%s has required fields', (code, entry) => {
    expect(entry.code).toBe(code);
    expect(typeof entry.httpStatus).toBe('number');
    expect(entry.httpStatus).toBeGreaterThanOrEqual(100);
    expect(entry.httpStatus).toBeLessThan(600);
    expect(typeof entry.i18nKey).toBe('string');
    expect(entry.i18nKey.length).toBeGreaterThan(0);
    expect(typeof entry.description).toBe('string');
    expect(entry.description.length).toBeGreaterThan(0);
  });

  it.each(CATALOG_ENTRIES)('%s code field matches its key', (code, entry) => {
    expect(entry.code).toBe(code);
  });
});

describe('getCatalogEntry', () => {
  it('returns the entry for a known code', () => {
    const entry = getCatalogEntry('CLAIM_NOT_FOUND');
    expect(entry).toBeDefined();
    expect(entry?.code).toBe('CLAIM_NOT_FOUND');
  });

  it('returns undefined for an unknown code', () => {
    expect(getCatalogEntry('DOES_NOT_EXIST')).toBeUndefined();
  });
});

describe('AppException', () => {
  it('sets the correct HTTP status from the catalog', () => {
    const ex = new AppException('CLAIM_NOT_FOUND');
    expect(ex.getStatus()).toBe(ERROR_CATALOG.CLAIM_NOT_FOUND.httpStatus);
  });

  it('includes the error code in the response body', () => {
    const ex = new AppException('RATE_LIMIT_EXCEEDED');
    const body = ex.getResponse() as Record<string, unknown>;
    expect(body.error).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('includes the i18nKey in the response body', () => {
    const ex = new AppException('UNAUTHORIZED');
    const body = ex.getResponse() as Record<string, unknown>;
    expect(body.i18nKey).toBe(ERROR_CATALOG.UNAUTHORIZED.i18nKey);
  });

  it('accepts an optional custom message', () => {
    const ex = new AppException('VALIDATION_ERROR', { message: 'field X is required' });
    const body = ex.getResponse() as Record<string, unknown>;
    expect(body.message).toBe('field X is required');
  });

  it('accepts optional details', () => {
    const ex = new AppException('RATE_LIMIT_EXCEEDED', { details: { retryAfter: 30 } });
    const body = ex.getResponse() as Record<string, unknown>;
    expect((body.details as Record<string, unknown>).retryAfter).toBe(30);
  });

  it('stores the errorCode property', () => {
    const ex = new AppException('POLICY_NOT_FOUND');
    expect(ex.errorCode).toBe('POLICY_NOT_FOUND');
  });
});

describe('error-catalog.json export', () => {
  const jsonPath = path.resolve(__dirname, 'error-catalog.json');

  it('error-catalog.json exists', () => {
    expect(fs.existsSync(jsonPath)).toBe(true);
  });

  it('contains all catalog codes', () => {
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
    for (const code of Object.keys(ERROR_CATALOG)) {
      expect(json).toHaveProperty(code);
    }
  });

  it('each JSON entry has httpStatus and i18nKey', () => {
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<
      string,
      { httpStatus: number; i18nKey: string; description: string }
    >;
    for (const [code, entry] of Object.entries(json)) {
      expect(typeof entry.httpStatus).toBe('number');
      expect(typeof entry.i18nKey).toBe('string');
      expect(typeof entry.description).toBe('string');
    }
  });

  it('JSON is consistent with the TypeScript catalog', () => {
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Record<
      string,
      { httpStatus: number; i18nKey: string }
    >;
    for (const [code, entry] of CATALOG_ENTRIES) {
      expect(json[code]?.httpStatus).toBe(entry.httpStatus);
      expect(json[code]?.i18nKey).toBe(entry.i18nKey);
    }
  });
});
