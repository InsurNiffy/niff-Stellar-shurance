import { createRequire } from 'module';

/**
 * Read-only GraphQL schema for Policy, Claim, Vote and Holder.
 *
 * Writes intentionally stay on REST: mutations would need to duplicate the
 * REST validation, idempotency and audit pipeline, so this API is read-only.
 *
 * The schema is code-first and resolvers are backed by the same services the
 * REST routes use, so authorization and business rules stay in one place.
 */

const require = createRequire(import.meta.url);

// Apollo / graphql are optional peer deps of the backend. Loading them lazily
// keeps the REST server bootable when GraphQL is not installed.
let apollo: any = null;
let graphql: any = null;

try {
  apollo = require('@apollo/server');
  graphql = require('graphql');
} catch {
  apollo = null;
  graphql = null;
}

export const GRAPHQL_LIMITS = {
  maxDepth: 8,
  maxComplexity: 1000,
  rateLimit: { windowMs: 60_000, max: 60 },
};

export interface GraphQLContext {
  /** Wallet address of the authenticated caller, if any. */
  wallet?: string;
  /** True when the caller passed the admin guard. */
  isAdmin?: boolean;
  /** Per-request DataLoaders, created once per operation. */
  loaders: ReturnType<typeof createLoaders>;
}

/**
 * One DataLoader per request. Batching collapses the N+1 lookups that would
 * otherwise happen when resolving nested Claim/Vote/Holder relations.
 */
export function createLoaders(services: any) {
  const { DataLoader } = require('dataloader');

  const batch = (fn: (keys: readonly string[]) => Promise<any[]>) =>
    new DataLoader(async (keys: readonly string[]) => fn(keys));

  return {
    policyById: batch((ids) => services.policyService.findByIds(ids)),
    claimById: batch((ids) => services.claimService.findByIds(ids)),
    voteById: batch((ids) => services.voteService.findByIds(ids)),
    holderByWallet: batch((wallets) => services.holderService.findByWallets(wallets)),
    claimsByPolicyId: batch((ids) => services.claimService.findByPolicyIds(ids)),
    votesByClaimId: batch((ids) => services.voteService.findByClaimIds(ids)),
  };
}

/**
 * Depth limit: rejects queries nested deeper than GRAPHQL_LIMITS.maxDepth.
 */
export function depthLimit(maxDepth = GRAPHQL_LIMITS.maxDepth) {
  return (context: any) => {
    const { operation } = context;
    const depth = measureDepth(operation?.selectionSet);
    if (depth > maxDepth) {
      throw new Error(`Query depth ${depth} exceeds limit of ${maxDepth}`);
    }
  };
}

function measureDepth(selectionSet: any, current = 0): number {
  if (!selectionSet?.selections?.length) return current;
  let deepest = current;
  for (const selection of selectionSet.selections) {
    const next = selection.selectionSet
      ? measureDepth(selection.selectionSet, current + 1)
      : current + 1;
    if (next > deepest) deepest = next;
  }
  return deepest;
}

/**
 * Complexity limit: each field costs 1, list fields cost 10, so a query that
 * fans out over many relations is rejected before it hits the services.
 */
export function complexityLimit(maxComplexity = GRAPHQL_LIMITS.maxComplexity) {
  return (context: any) => {
    const cost = measureComplexity(context.operation?.selectionSet);
    if (cost > maxComplexity) {
      throw new Error(`Query complexity ${cost} exceeds limit of ${maxComplexity}`);
    }
  };
}

function measureComplexity(selectionSet: any): number {
  if (!selectionSet?.selections?.length) return 0;
  let cost = 0;
  for (const selection of selectionSet.selections) {
    const isList = selection.name?.value?.endsWith('s');
    cost += isList ? 10 : 1;
    if (selection.selectionSet) cost += measureComplexity(selection.selectionSet);
  }
  return cost;
}

/**
 * Per-operation rate limit keyed by wallet (or IP when anonymous).
 */
export function rateLimit(options = GRAPHQL_LIMITS.rateLimit) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (context: any) => {
    const key = context.wallet ?? context.ip ?? 'anonymous';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > options.max) {
      throw new Error('Rate limit exceeded for this operation');
    }
  };
}

/**
 * Auth guards mirroring the REST middleware: wallet auth for own data and
 * admin for admin-only fields.
 */
export function requireWallet(context: GraphQLContext) {
  if (!context.wallet) throw new Error('Unauthorized: wallet authentication required');
  return context.wallet;
}

export function requireAdmin(context: GraphQLContext) {
  if (!context.isAdmin) throw new Error('Forbidden: admin access required');
  return true;
}

/**
 * Code-first schema. Resolvers delegate to the same services as REST and use
 * the per-request loaders for nested relations.
 */
export function buildSchema(services: any) {
  if (!graphql) throw new Error('graphql is not installed');
  const { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLInt, GraphQLList, GraphQLNonNull } = graphql;

  const PolicyType: any = new GraphQLObjectType({
    name: 'Policy',
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLString) },
      holder: { type: GraphQLString },
      status: { type: GraphQLString },
      claims: {
        type: new GraphQLList(ClaimType),
        resolve: (policy: any, _args: any, ctx: GraphQLContext) =>
          ctx.loaders.claimsByPolicyId.load(policy.id),
      },
    }),
  });

  const ClaimType: any = new GraphQLObjectType({
    name: 'Claim',
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLString) },
      policyId: { type: GraphQLString },
      amount: { type: GraphQLInt },
      status: { type: GraphQLString },
      policy: {
        type: PolicyType,
        resolve: (claim: any, _args: any, ctx: GraphQLContext) =>
          ctx.loaders.policyById.load(claim.policyId),
      },
      votes: {
        type: new GraphQLList(VoteType),
        resolve: (claim: any, _args: any, ctx: GraphQLContext) =>
          ctx.loaders.votesByClaimId.load(claim.id),
      },
    }),
  });

  const VoteType: any = new GraphQLObjectType({
    name: 'Vote',
    fields: () => ({
      id: { type: new GraphQLNonNull(GraphQLString) },
      claimId: { type: GraphQLString },
      voter: { type: GraphQLString },
      weight: { type: GraphQLInt },
      claim: {
        type: ClaimType,
        resolve: (vote: any, _args: any, ctx: GraphQLContext) =>
          ctx.loaders.claimById.load(vote.claimId),
      },
    }),
  });

  const HolderType: any = new GraphQLObjectType({
    name: 'Holder',
    fields: () => ({
      wallet: { type: new GraphQLNonNull(GraphQLString) },
      balance: { type: GraphQLInt },
      policies: {
        type: new GraphQLList(PolicyType),
        resolve: (holder: any, _args: any, ctx: GraphQLContext) =>
          services.policyService.findByHolder(holder.wallet),
      },
    }),
  });

  const QueryType: any = new GraphQLObjectType({
    name: 'Query',
    fields: () => ({
      policy: {
        type: PolicyType,
        args: { id: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_root: any, args: any, ctx: GraphQLContext) =>
          ctx.loaders.policyById.load(args.id),
      },
      claim: {
        type: ClaimType,
        args: { id: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_root: any, args: any, ctx: GraphQLContext) =>
          ctx.loaders.claimById.load(args.id),
      },
      vote: {
        type: VoteType,
        args: { id: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_root: any, args: any, ctx: GraphQLContext) =>
          ctx.loaders.voteById.load(args.id),
      },
      holder: {
        type: HolderType,
        args: { wallet: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: (_root: any, args: any, ctx: GraphQLContext) => {
          requireWallet(ctx);
          return ctx.loaders.holderByWallet.load(args.wallet);
        },
      },
      // Admin-only field, mirrors the REST admin guard.
      allHolders: {
        type: new GraphQLList(HolderType),
        resolve: (_root: any, _args: any, ctx: GraphQLContext) => {
          requireAdmin(ctx);
          return services.holderService.findAll();
        },
      },
    }),
  });

  return new GraphQLSchema({ query: QueryType });
}

/**
 * Builds the Apollo server with the depth, complexity and rate-limit plugins.
 * Introspection is disabled in production.
 */
export function createGraphQLServer(services: any) {
  if (!apollo) throw new Error('@apollo/server is not installed');
  const { ApolloServer } = apollo;

  return new ApolloServer({
    schema: buildSchema(services),
    introspection: process.env.NODE_ENV !== 'production',
    plugins: [
      {
        async requestDidStart() {
          return {
            async didResolveOperation(requestContext: any) {
              const ctx = requestContext.contextValue as GraphQLContext;
              rateLimit()(ctx);
              depthLimit()(requestContext);
              complexityLimit()(requestContext);
            },
          };
        },
      },
    ],
  });
}

export default createGraphQLServer;
