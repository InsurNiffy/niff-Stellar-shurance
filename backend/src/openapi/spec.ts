/**
 * OpenAPI 3.1 specification served at GET /openapi.json.
 * All DTO fields are documented with examples matching actual responses.
 * This spec is the source of truth — CI can diff it against generated output.
 */

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "niffyInsure API",
    version: "0.1.0",
    description:
      "REST API for the niffyInsure decentralized insurance platform. " +
      "All token amounts are strings representing i128 stroops (7 decimals). " +
      "Never use floating-point arithmetic on amount fields.",
  },
  servers: [{ url: "/", description: "Current server" }],
  tags: [{ name: "Policies", description: "Policy lifecycle and listing" }],
  paths: {
    "/policies": {
      get: {
        summary: "List policies",
        operationId: "listPolicies",
        tags: ["Policies"],
        parameters: [
          {
            name: "status",
            in: "query",
            description: 'Filter by policy status. "active" = is_active true; "expired" = is_active false.',
            schema: { type: "string", enum: ["active", "expired"] },
          },
          {
            name: "holder",
            in: "query",
            description: "Filter by policyholder Stellar address (G... format).",
            schema: { type: "string", example: "GABC1111111111111111111111111111111111111111111111111111" },
          },
          {
            name: "after",
            in: "query",
            description:
              "Opaque cursor from a previous response's next_cursor field. " +
              "Returns 400 if the cursor is malformed.",
            schema: { type: "string", example: "MjA" },
          },
          {
            name: "limit",
            in: "query",
            description: "Items per page. Clamped to [1, 100]. Default 20.",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        ],
        responses: {
          "200": {
            description: "Paginated policy list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PolicyListDto" },
                example: {
                  data: [
                    {
                      holder: "GABC1111111111111111111111111111111111111111111111111111",
                      policy_id: 1,
                      policy_type: "Auto",
                      region: "Medium",
                      is_active: true,
                      coverage_summary: {
                        coverage_amount: "500000000",
                        premium_amount: "5000000",
                        currency: "XLM",
                        decimals: 7,
                      },
                      expiry_countdown: {
                        start_ledger: 1000,
                        end_ledger: 9000,
                        ledgers_remaining: 4000,
                        avg_ledger_close_seconds: 5,
                      },
                      claims: [
                        {
                          claim_id: 2,
                          amount: "50000000",
                          status: "Processing",
                          approve_votes: 2,
                          reject_votes: 0,
                          _link: "/claims/2",
                        },
                      ],
                      _link: "/policies/GABC.../1",
                    },
                  ],
                  next_cursor: null,
                  total: 1,
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/policies/{holder}/{policy_id}": {
      get: {
        summary: "Get a single policy",
        operationId: "getPolicy",
        tags: ["Policies"],
        parameters: [
          {
            name: "holder",
            in: "path",
            required: true,
            description: "URL-encoded Stellar address of the policyholder.",
            schema: { type: "string", example: "GABC1111111111111111111111111111111111111111111111111111" },
          },
          {
            name: "policy_id",
            in: "path",
            required: true,
            description: "Per-holder policy identifier (u32, starts at 1).",
            schema: { type: "integer", minimum: 1, example: 1 },
          },
        ],
        responses: {
          "200": {
            description: "Policy detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PolicyDto" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
  },
  components: {
    schemas: {
      CoverageSummaryDto: {
        type: "object",
        required: ["coverage_amount", "premium_amount", "currency", "decimals"],
        properties: {
          coverage_amount: {
            type: "string",
            description: "Maximum payout in stroops (i128, 7 decimals). Never a float.",
            example: "500000000",
          },
          premium_amount: {
            type: "string",
            description: "Annual premium in stroops (i128, 7 decimals). Never a float.",
            example: "5000000",
          },
          currency: {
            type: "string",
            enum: ["XLM"],
            description: "ISO 4217 currency code for the Stellar-native token.",
          },
          decimals: {
            type: "integer",
            enum: [7],
            description: "Decimal places for all stroop amounts. Divide by 10^7 to get XLM.",
          },
        },
      },
      ExpiryCountdownDto: {
        type: "object",
        required: ["start_ledger", "end_ledger", "ledgers_remaining", "avg_ledger_close_seconds"],
        properties: {
          start_ledger: { type: "integer", example: 1000 },
          end_ledger: { type: "integer", example: 9000 },
          ledgers_remaining: {
            type: "integer",
            description: "end_ledger minus current ledger. Negative if expired.",
            example: 4000,
          },
          avg_ledger_close_seconds: {
            type: "integer",
            enum: [5],
            description: "Stellar mainnet average ledger close time in seconds.",
          },
        },
      },
      ClaimSummaryDto: {
        type: "object",
        required: ["claim_id", "amount", "status", "approve_votes", "reject_votes", "_link"],
        properties: {
          claim_id: { type: "integer", example: 42 },
          amount: {
            type: "string",
            description: "Requested payout in stroops (7 decimals, string).",
            example: "50000000",
          },
          status: { type: "string", enum: ["Processing", "Approved", "Rejected"] },
          approve_votes: { type: "integer", example: 3 },
          reject_votes: { type: "integer", example: 1 },
          _link: { type: "string", example: "/claims/42" },
        },
      },
      PolicyDto: {
        type: "object",
        required: [
          "holder", "policy_id", "policy_type", "region", "is_active",
          "coverage_summary", "expiry_countdown", "claims", "_link",
        ],
        properties: {
          holder: { type: "string", example: "GABC1111111111111111111111111111111111111111111111111111" },
          policy_id: { type: "integer", minimum: 1, example: 1 },
          policy_type: { type: "string", enum: ["Auto", "Health", "Property"] },
          region: { type: "string", enum: ["Low", "Medium", "High"] },
          is_active: { type: "boolean", example: true },
          coverage_summary: { $ref: "#/components/schemas/CoverageSummaryDto" },
          expiry_countdown: { $ref: "#/components/schemas/ExpiryCountdownDto" },
          claims: {
            type: "array",
            items: { $ref: "#/components/schemas/ClaimSummaryDto" },
          },
          _link: { type: "string", example: "/policies/GABC.../1" },
        },
      },
      PolicyListDto: {
        type: "object",
        required: ["data", "next_cursor", "total"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/PolicyDto" } },
          next_cursor: {
            type: ["string", "null"],
            description: "Opaque cursor for the next page. Null when no more pages.",
            example: "MjA",
          },
          total: {
            type: "integer",
            description: "Total matching policies before pagination.",
            example: 42,
          },
        },
      },
      ApiError: {
        type: "object",
        required: ["error", "message"],
        properties: {
          error: { type: "string", example: "invalid_cursor" },
          message: { type: "string", example: 'Invalid cursor: "abc"' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: "Bad request — invalid parameter or cursor",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
        },
      },
      NotFound: {
        description: "Resource not found",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
        },
      },
      RateLimited: {
        description: "Rate limit exceeded",
        headers: {
          "Retry-After": { schema: { type: "integer" }, description: "Seconds until the window resets" },
        },
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
        },
      },
    },
  },
};
