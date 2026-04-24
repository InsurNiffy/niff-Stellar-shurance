#!/usr/bin/env ts-node
/**
 * Exports the error catalog as a JSON file for frontend i18n consumption.
 * Output: src/common/errors/error-catalog.json
 *
 * Run: ts-node scripts/export-error-catalog.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ERROR_CATALOG, CatalogEntry } from '../src/common/errors/error-catalog';

const OUT = path.resolve(__dirname, '../src/common/errors/error-catalog.json');

const output = Object.fromEntries(
  Object.entries(ERROR_CATALOG).map(([code, entry]) => {
    const e = entry as CatalogEntry;
    return [
      code,
      {
        httpStatus: e.httpStatus,
        i18nKey: e.i18nKey,
        description: e.description,
        ...(e.deprecated ? { deprecated: true, replacedBy: e.replacedBy } : {}),
      },
    ];
  }),
);

fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
console.log(`Exported ${Object.keys(output).length} error codes to ${OUT}`);
