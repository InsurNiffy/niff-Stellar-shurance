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
  tags: [
    { name: "Policies", description: "Policy lifecycle and listing" },
    { name: "Claims", description: "Claim filing, listing, and voting" },
    { name: "Posts", description: "User-generated posts (CRUD)" },
  ],
  paths: {
    "/claims/{id}/timeline": {
      get: {
        summary: "Get claim status-transition timeline",
        operationId: "getClaimTimeline",
        tags: ["Claims"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Claim numeric identifier.",
            schema: { type: "integer", minimum: 1, example: 42 },
          },
        ],
        responses: {
          "200": {
            description: "Chronological list of status transitions",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ClaimTimelineEntryDto" },
                },
                example: [
                  {
                    status: "pending",
                    ledger: 1000,
                    timestamp: "2026-01-01T00:00:00.000Z",
                    actor: "GABC1111111111111111111111111111111111111111111111111111",
                    reason: null,
                  },
                  {
                    status: "approved",
                    ledger: 1200,
                    timestamp: "2026-01-02T00:00:00.000Z",
                    actor: null,
                    reason: "Vote majority reached",
                  },
                  {
                    status: "paid",
                    ledger: 1300,
                    timestamp: "2026-01-03T00:00:00.000Z",
                    actor: null,
                    reason: "Payout processed",
                  },
                ],
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/claims": {
      get: {
        summary: "List claims",
        operationId: "listClaims",
        tags: ["Claims"],
        parameters: [
          { $ref: "#/components/parameters/after" },
          { $ref: "#/components/parameters/limit" },
          {
            name: "status",
            in: "query",
            description: "Filter by claim status.",
            schema: { type: "string", enum: ["pending", "approved", "rejected", "paid"] },
          },
        ],
        responses: {
          "200": {
            description: "Paginated claim list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ClaimsListDto" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/posts": {
      get: {
        summary: "List posts",
        operationId: "listPosts",
        tags: ["Posts"],
        parameters: [
          { $ref: "#/components/parameters/after" },
          { $ref: "#/components/parameters/limit" },
          {
            name: "status",
            in: "query",
            description: "Filter by post status.",
            schema: { type: "string", enum: ["draft", "published", "archived"] },
          },
          {
            name: "authorAddress",
            in: "query",
            description: "Filter by author Stellar address.",
            schema: { type: "string", example: "GABC1111111111111111111111111111111111111111111111111111" },
          },
        ],
        responses: {
          "200": {
            description: "Paginated post list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PostsListDto" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        summary: "Create a post",
        operationId: "createPost",
        tags: ["Posts"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreatePostDto" },
            },
          },
        },
        responses: {
          "201": {
            description: "Post created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PostDto" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { description: "Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/posts/{id}": {
      get: {
        summary: "Get a single post",
        operationId: "getPost",
        tags: ["Posts"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Post numeric identifier.",
            schema: { type: "integer", minimum: 1, example: 1 },
          },
        ],
        responses: {
          "200": {
            description: "Post detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PostDto" },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        summary: "Update a post (partial)",
        operationId: "updatePost",
        tags: ["Posts"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 1 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdatePostDto" },
            },
          },
        },
        responses: {
          "200": {
            description: "Post updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PostDto" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { description: "Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        summary: "Soft-delete a post",
        operationId: "deletePost",
        tags: ["Posts"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 1 },
          },
        ],
        responses: {
          "204": { description: "Post deleted" },
          "401": { description: "Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
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
          { $ref: "#/components/parameters/after" },
          { $ref: "#/components/parameters/limit" },
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
                  pagination: { next_cursor: null, total: 1 },
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
    parameters: {
      after: {
        name: "after",
        in: "query",
        required: false,
        description:
          "Opaque cursor from a previous response's `pagination.next_cursor`. " +
          "Omit on the first request. Returns HTTP 400 if the cursor is malformed or tampered. " +
          "Cursors encode `(createdAt, id)` and results are ordered newest-first. " +
          "Rows inserted after cursor creation will not appear on subsequent pages — " +
          "clients building infinite-scroll UIs should deduplicate by `id`. " +
          "Cursors are point-in-time: time drift between cursor creation and fetch " +
          "does not affect correctness because comparisons are against DB-stored timestamps.",
        schema: {
          type: "string",
          example: "eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6NDJ9",
        },
      },
      limit: {
        name: "limit",
        in: "query",
        required: false,
        description:
          "Maximum items per page. Values above 100 are silently clamped to 100. " +
          "Values below 1 are clamped to 1. Default: 20.",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
    schemas: {
      CursorPageDto: {
        type: "object",
        required: ["next_cursor", "total"],
        properties: {
          next_cursor: {
            type: ["string", "null"],
            description:
              "Opaque cursor for the next page. Null when no more pages exist. " +
              "Pass as the `after` query parameter on the next request.",
            example: "eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6NDJ9",
          },
          total: {
            type: "integer",
            description:
              "Total rows matching the filter before pagination. " +
              "Eventually consistent — may differ by ±1 under concurrent inserts.",
            example: 42,
          },
        },
      },
      ClaimsListDto: {
        type: "object",
        required: ["data", "pagination"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/ClaimDetailDto" },
          },
          pagination: { $ref: "#/components/schemas/CursorPageDto" },
        },
      },
      ClaimDetailDto: {
        type: "object",
        required: ["metadata", "votes", "quorum", "deadline", "evidence", "consistency"],
        properties: {
          metadata: {
            type: "object",
            properties: {
              id: { type: "integer", example: 1 },
              policyId: { type: "string", example: "GABC...:1" },
              creatorAddress: { type: "string", example: "GABC..." },
              status: { type: "string", enum: ["pending", "approved", "paid", "rejected"] },
              amount: { type: "string", description: "Claim amount in stroops.", example: "50000000" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
          votes: {
            type: "object",
            properties: {
              yesVotes: { type: "integer", example: 3 },
              noVotes: { type: "integer", example: 1 },
              totalVotes: { type: "integer", example: 4 },
            },
          },
          quorum: {
            type: "object",
            properties: {
              required: { type: "integer", example: 3 },
              current: { type: "integer", example: 4 },
              percentage: { type: "integer", example: 100 },
              reached: { type: "boolean", example: true },
            },
          },
          deadline: {
            type: "object",
            properties: {
              votingDeadlineLedger: { type: "integer", example: 1120960 },
              votingDeadlineTime: { type: "string", format: "date-time" },
              isOpen: { type: "boolean", example: true },
              remainingSeconds: { type: "integer", nullable: true, example: 3600 },
            },
          },
          evidence: {
            type: "object",
            properties: {
              gatewayUrl: { type: "string", example: "https://ipfs.io/ipfs/Qm..." },
              hash: { type: "string", example: "QmXyz..." },
            },
          },
          consistency: {
            type: "object",
            properties: {
              isFinalized: { type: "boolean", example: false },
              indexerLag: { type: "integer", example: 2 },
              lastIndexedLedger: { type: "integer", example: 1000000 },
              isStale: { type: "boolean", example: false },
            },
          },
        },
      },
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
          voting_deadline_ledger: {
            type: "integer",
            description: "Last inclusive ledger for voting; frozen at filing.",
            example: 1_250_000,
          },
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
        required: ["data", "pagination"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/PolicyDto" } },
          pagination: { $ref: "#/components/schemas/CursorPageDto" },
        },
      },
      PostDto: {
        type: "object",
        required: ["id", "title", "body", "status", "authorAddress", "createdAt", "updatedAt"],
        properties: {
          id: { type: "integer", example: 1 },
          title: { type: "string", maxLength: 200, example: "My first post" },
          body: { type: "string", maxLength: 10000, example: "This is the post content." },
          status: { type: "string", enum: ["draft", "published", "archived"], example: "published" },
          authorAddress: { type: "string", example: "GABC1111111111111111111111111111111111111111111111111111" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      PostsListDto: {
        type: "object",
        required: ["data", "pagination"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/PostDto" } },
          pagination: { $ref: "#/components/schemas/CursorPageDto" },
        },
      },
      CreatePostDto: {
        type: "object",
        required: ["title", "body", "authorAddress"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200, example: "My post title" },
          body: { type: "string", minLength: 1, maxLength: 10000, example: "Post body content." },
          status: { type: "string", enum: ["draft", "published", "archived"], default: "draft" },
          authorAddress: { type: "string", example: "GABC1111111111111111111111111111111111111111111111111111" },
        },
      },
      UpdatePostDto: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          body: { type: "string", minLength: 1, maxLength: 10000 },
          status: { type: "string", enum: ["draft", "published", "archived"] },
        },
      },
      ClaimTimelineEntryDto: {
        type: "object",
        required: ["status", "ledger", "timestamp", "actor", "reason"],
        properties: {
          status: {
            type: "string",
            description: "Claim status at this point",
            enum: ["pending", "approved", "paid", "rejected", "withdrawn"],
            example: "pending",
          },
          ledger: {
            type: "integer",
            description: "Stellar ledger number",
            minimum: 0,
            example: 1000,
          },
          timestamp: {
            type: "string",
            format: "date-time",
            description: "ISO-8601 UTC timestamp",
            example: "2026-01-01T00:00:00.000Z",
          },
          actor: {
            type: "string",
            nullable: true,
            description: "Actor wallet address who triggered the transition",
            example: "GABC1111111111111111111111111111111111111111111111111111",
          },
          reason: {
            type: "string",
            nullable: true,
            description: "Reason for the transition",
            example: "Vote majority reached",
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
