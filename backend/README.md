# NiffyInsure Backend (NestJS)

Node.js LTS (20.x), npm package manager.

## Setup

1. Copy `.env.example` → `.env` and update values (DB, Redis, RPC, etc.)
2. `npm install`

## Run

- Dev: `npm run start:dev` → http://localhost:3000/api/health , /docs
- Prod: `npm run build && npm run start:prod`
- Lint: `npm run lint`
- Test: `npm run test`

## Docker

```bash
npm run docker:build
npm run docker:up
# Visit localhost:3000/api/health
npm run docker:down
```

## Features

- Env validation (Joi) - fails fast
- Global validation pipe
- Swagger /docs (bearer auth doc'd)
- Structured logging (Winston, secrets redacted)
- Health /api/health
- Modules: rpc, indexer, ipfs, auth, admin (extend as needed)
- Global exception filter (consistent JSON)

## Validation

Critical vars validated at startup:

- DATABASE_URL
- REDIS_URL
- SOROBAN_RPC_URL
- JWT_SECRET
- ADMIN_TOKEN
