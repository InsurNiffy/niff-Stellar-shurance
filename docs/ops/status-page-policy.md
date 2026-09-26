# Public Status Page Policy

There is currently no customer-facing status page communicating ongoing
incidents or historical uptime. This document defines the policy for what
gets posted and the plan for standing the page up.

## What gets posted

- Any incident causing degraded or unavailable service to a customer-facing
  surface (frontend app, public API, claims processing) for more than 5
  minutes.
- Planned maintenance windows that cause visible downtime, posted in
  advance (see timing below).
- Security incidents, per the disclosure rules in `SECURITY.md` (coordinate
  timing with that process — do not post details that would violate
  responsible disclosure).

Not posted: internal-only tooling outages, individual user account issues,
degradations with no customer-visible impact.

## Timing

- **Ongoing incident:** first status page post within **30 minutes** of
  incident detection/confirmation, even if the update is just "investigating".
- **Updates:** at least every 60 minutes until resolved, or immediately on
  material status change.
- **Resolution:** posted within 15 minutes of confirmed resolution.
- **Planned maintenance:** posted at least 24 hours in advance.

## Plan to stand up the page

1. Use a hosted status page provider (e.g. Statuspage/Instatus) rather than
   building one in-house, to keep incident comms independent of our own
   infra being down.
2. Components tracked: Frontend App, Public API, Claims Processing,
   Contract/Ledger Indexing.
3. History: keep at least 90 days of incident history visible.
4. Ownership: on-call lead posts/updates during an incident, per the
   existing incident rotation.

## Linking

- [ ] Link the status page from the frontend footer / support surface.
- [ ] Link the status page from `docs/` (e.g. `README.md` or a support doc)
      so contributors and support staff can find it.
