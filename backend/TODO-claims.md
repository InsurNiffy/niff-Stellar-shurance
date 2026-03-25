# Claims API Implementation

## Overview
Production-ready Claims REST API for the NiffyInsure Stellar insurance system.

## Endpoints

### GET /api/claims
List all claims with aggregated data and pagination.

**Query Parameters:**
- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 20, max: 100) - Items per page
- `status` (optional) - Filter by status: `pending`, `approved`, `rejected`

**Response:**
```json
{
  "data": [
    {
      "metadata": {
        "id": 1,
        "policyId": "policy-123",
        "creatorAddress": "GXXXXXXXXXX",
        "status": "pending",
        "amount": "1000",
        "description": "Insurance claim...",
        "evidenceHash": "QmXXX...",
        "createdAtLedger": 12345678,
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z"
      },
      "votes": {
        "yesVotes": 3,
        "noVotes": 1,
        "totalVotes": 4
      },
      "quorum": {
        "required": 5,
        "current": 4,
        "percentage": 80,
        "reached": false
      },
      "deadline": {
        "votingDeadlineLedger": 12350000,
        "votingDeadlineTime": "2024-01-02T00:00:00Z",
        "isOpen": true,
        "remainingSeconds": 3600
      },
      "evidence": {
        "gatewayUrl": "https://ipfs.io/ipfs/QmXXX...",
        "hash": "QmXXX..."
      },
      "consistency": {
        "isFinalized": false,
        "indexerLag": 2,
        "lastIndexedLedger": 12345680,
        "isStale": false
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5,
    "hasNext": true
  }
}
```

### GET /api/claims/:id
Get detailed claim view by ID.

### GET /api/claims/needs-my-vote (Authenticated)
Get claims where the authenticated user has not voted yet.

**Headers:**
- `Authorization: Bearer <jwt_token>`

## Features

### Aggregation
- Optimized SQL queries with JOINs and GROUP BY
- Vote tallies computed in single query (no N+1)
- Pagination with total count

### Quorum Calculation
```
percentage = (totalVotes / requiredVotes) * 100
reached = totalVotes >= requiredVotes
```

### Deadline Handling
- Deadlines based on ledger numbers, not timestamps
- Stellar: ~5 seconds per ledger
- Remaining time calculated from current indexed ledger

### Caching Strategy
- Redis caching with configurable TTL (default: 60s)
- Cache keys: `claims:list:{page}:{limit}:{status}` and `claims:detail:{id}`
- Pattern-based invalidation on updates
- Graceful degradation if Redis unavailable

### Security
- XSS prevention via HTML entity encoding
- IPFS hash validation (CID v0/v1 format)
- Stellar address validation (G... format, 56 chars)
- Whitelisted evidence URL domains
- Authorization via JWT with wallet address

### Consistency Model
- Indexer lag tracking (ledgers behind current)
- `isStale` flag when lag > 5 ledgers
- `isFinalized` for on-chain finality
- Best-effort deadline accuracy based on indexer state

## Database Schema

### Claims
```sql
CREATE TABLE claims (
  id SERIAL PRIMARY KEY,
  policyId VARCHAR NOT NULL,
  creatorAddress VARCHAR NOT NULL,
  amount VARCHAR NOT NULL,
  description TEXT,
  evidenceHash VARCHAR,
  status VARCHAR DEFAULT 'PENDING',
  isFinalized BOOLEAN DEFAULT FALSE,
  createdAtLedger INT NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP,
  updatedAtLedger INT DEFAULT 0
);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_createdAt ON claims(createdAt);
CREATE INDEX idx_claims_policyId ON claims(policyId);
```

### Votes
```sql
CREATE TABLE votes (
  id SERIAL PRIMARY KEY,
  claimId INT REFERENCES claims(id) ON DELETE CASCADE,
  voterAddress VARCHAR NOT NULL,
  vote VARCHAR NOT NULL, -- 'YES' or 'NO'
  votingPower VARCHAR DEFAULT '1',
  txHash VARCHAR,
  votedAtLedger INT NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW(),
  UNIQUE(claimId, voterAddress)
);
CREATE INDEX idx_votes_voterAddress ON votes(voterAddress);
CREATE INDEX idx_votes_claimId ON votes(claimId);
```

### Policies
```sql
CREATE TABLE policies (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT,
  coverageAmount VARCHAR NOT NULL,
  premium VARCHAR NOT NULL,
  durationDays INT NOT NULL,
  requiredVotes INT DEFAULT 5,
  votingPeriodLedgers INT DEFAULT 720,
  votingDeadlineLedger INT NOT NULL,
  votingDeadlineTime TIMESTAMP NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP
);
```

### IndexerState
```sql
CREATE TABLE indexer_state (
  id SERIAL PRIMARY KEY,
  lastLedger INT NOT NULL,
  lastCursor VARCHAR,
  updatedAt TIMESTAMP
);
```

## Environment Variables
- `CACHE_TTL_SECONDS` - Cache TTL in seconds (default: 60)
- `IPFS_GATEWAY` - IPFS gateway URL (default: https://ipfs.io)
