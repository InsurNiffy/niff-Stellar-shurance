# API & Contract Deprecation Policy

## Overview

This document defines the minimum notice period and announcement mechanism
required before a public REST/GraphQL field or a contract entrypoint may be
removed. It exists so external integrators are never broken without warning.

## Minimum Notice Period

| Surface | Minimum notice before removal |
|---|---|
| REST endpoint / field | 90 calendar days |
| GraphQL field / type | 90 calendar days |
| Contract entrypoint (Soroban) | 180 calendar days |

Security-driven removals (e.g. a field that leaks sensitive data) are exempt
from the minimum notice period but must still be announced at time of removal.

## Announcement Mechanism

A deprecation is not valid until **all** of the following have happened:

1. **HTTP headers** — REST responses for a deprecated field/endpoint include
   `Deprecation: <date>` and `Sunset: <date>` headers (RFC 8594) from the day
   the deprecation is announced until removal.
2. **GraphQL schema** — the field is annotated with `@deprecated(reason: "... removal on <date>, see CHANGELOG")`.
3. **Changelog entry** — an entry is added to `CHANGELOG.md` under a
   `Deprecated` heading, stating the surface, removal date, and migration path.
4. **Docs banner** — a visible banner/note is added to the relevant page in
   `backend/docs/graphql.md` (or the equivalent REST doc) linking to the
   changelog entry.

## Contract Entrypoints vs. REST/GraphQL Fields

Contract entrypoints get a longer notice period and a stricter process than
REST/GraphQL fields because:

- Removing or changing a deployed contract entrypoint cannot be rolled back
  the way a backend deploy can — integrators building against an entrypoint
  may have no fallback once it's gone.
- Contract entrypoint deprecation must additionally be recorded as an ADR
  (see `docs/adr/`) and reference the WASM version in which the entrypoint
  was first marked deprecated vs. the version in which it is removed.
- REST/GraphQL fields may be deprecated and removed within the same minor
  backend release cycle, provided the notice period has elapsed; contract
  entrypoints are only removed in a version bump that is explicitly called
  out as breaking.

## Relationship to Versioning Policy

This policy is referenced from, and should be read together with, the
[API versioning policy](./api-versioning-policy.md), which defines how
version numbers themselves are incremented when a deprecation results in a
breaking change.
