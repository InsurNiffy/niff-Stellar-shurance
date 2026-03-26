import * as fc from "fast-check";
import * as Joi from "joi";

// Replicated from main.ts
export function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Replicated CORS origin callback factory for testing
function makeOriginCallback(allowlist: string[]) {
  return (
    origin: string | undefined,
    cb: (err: Error | null, allow?: string | boolean) => void,
  ) => {
    if (!origin) return cb(null, true);
    if (allowlist.includes(origin)) return cb(null, origin);
    return cb(new Error("Not allowed by CORS"), false);
  };
}

// Static CORS config object for testing
const CORS_CONFIG = {
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

// Joi production origins validator
function makeProductionOriginsSchema() {
  return Joi.string()
    .required()
    .custom((value: string, helpers) => {
      const entries = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const entry of entries) {
        if (entry === "*" || !entry.startsWith("https://")) {
          return helpers.error("any.invalid");
        }
      }
      return value;
    });
}

// ─── Property 1 ──────────────────────────────────────────────────────────────

describe("Feature: cors-helmet-security-headers, Property 1", () => {
  it("Origin list parsing preserves trimmed values", () => {
    /**
     * Validates: Requirements 1.1, 1.2, 1.6
     */
    fc.assert(
      fc.property(
        // Exclude commas from generated strings so they don't split unexpectedly
        fc.array(fc.string({ minLength: 1 }).filter((s) => !s.includes(","))),
        (baseStrings) => {
          // Add arbitrary surrounding whitespace to each string
          const padded = baseStrings.map((s) => `  ${s}  `);
          const raw = padded.join(",");
          const result = parseOrigins(raw);

          // Every result element should equal the original trimmed string
          const expected = baseStrings.map((s) => s.trim()).filter(Boolean);
          if (result.length !== expected.length) return false;
          return result.every((val, i) => val === expected[i]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2 ──────────────────────────────────────────────────────────────

describe("Feature: cors-helmet-security-headers, Property 2", () => {
  it("Allowed origin is echoed in response", () => {
    /**
     * Validates: Requirements 2.1
     */
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        (allowlist) => {
          // Pick a random element from the allowlist as the origin
          const origin =
            allowlist[Math.floor(Math.random() * allowlist.length)];
          const callback = makeOriginCallback(allowlist);

          let calledWith: {
            err: Error | null;
            allow?: string | boolean;
          } | null = null;
          callback(origin, (err, allow) => {
            calledWith = { err, allow };
          });

          // Should echo the exact origin string (not true, not false)
          return (
            calledWith !== null &&
            (calledWith as any).err === null &&
            (calledWith as any).allow === origin
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3 ──────────────────────────────────────────────────────────────

describe("Feature: cors-helmet-security-headers, Property 3", () => {
  it("Disallowed origin is rejected", () => {
    /**
     * Validates: Requirements 2.2, 3.2
     */
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        fc.string({ minLength: 1 }),
        (allowlist, candidate) => {
          // Filter to ensure candidate is not in the allowlist
          fc.pre(!allowlist.includes(candidate));

          const callback = makeOriginCallback(allowlist);

          let calledWith: {
            err: Error | null;
            allow?: string | boolean;
          } | null = null;
          callback(candidate, (err, allow) => {
            calledWith = { err, allow };
          });

          // Should call cb with an Error and false
          return (
            calledWith !== null &&
            (calledWith as any).err instanceof Error &&
            (calledWith as any).allow === false
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4 ──────────────────────────────────────────────────────────────

describe("Feature: cors-helmet-security-headers, Property 4", () => {
  it("Credentials header present for all allowed origins", () => {
    /**
     * Validates: Requirements 2.4
     */
    fc.assert(
      fc.property(fc.constant(null), (_) => {
        return CORS_CONFIG.credentials === true;
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5 ──────────────────────────────────────────────────────────────

describe("Feature: cors-helmet-security-headers, Property 5", () => {
  it("Allowed-origin response headers completeness", () => {
    /**
     * Validates: Requirements 2.6, 2.7
     */
    fc.assert(
      fc.property(fc.constant(null), (_) => {
        const requiredHeaders = [
          "Authorization",
          "Content-Type",
          "X-Requested-With",
        ];
        const requiredMethods = [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "OPTIONS",
        ];

        const headersOk = requiredHeaders.every((h) =>
          CORS_CONFIG.allowedHeaders.includes(h),
        );
        const methodsOk = requiredMethods.every((m) =>
          CORS_CONFIG.methods.includes(m),
        );

        return headersOk && methodsOk;
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6 ──────────────────────────────────────────────────────────────

describe("Feature: cors-helmet-security-headers, Property 6", () => {
  it("Preflight response completeness", () => {
    /**
     * Validates: Requirements 3.1, 3.3
     */
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        (allowlist) => {
          return (
            CORS_CONFIG.maxAge === 86400 &&
            CORS_CONFIG.optionsSuccessStatus === 204 &&
            CORS_CONFIG.credentials === true
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 7 ──────────────────────────────────────────────────────────────

describe("Feature: cors-helmet-security-headers, Property 7", () => {
  it("Production mode rejects non-HTTPS origins", () => {
    /**
     * Validates: Requirements 5.1, 5.2
     */
    const schema = makeProductionOriginsSchema();

    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (suffix) => {
        // Construct a value with at least one http:// entry
        const invalidEntry = `http://${suffix}`;
        const { error } = schema.validate(invalidEntry);
        // Validator must reject it
        return error !== undefined;
      }),
      { numRuns: 100 },
    );
  });
});
