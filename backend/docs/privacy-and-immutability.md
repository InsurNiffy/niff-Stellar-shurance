# Privacy and Immutability

This document describes how off-chain holder profile data is handled and why
on-chain data cannot be erased.

## Holder profiles (off-chain)

Holder profiles store display name, email, and preferences off-chain. They are
managed through the `HolderProfile` module and authenticated by a wallet JWT:

- `GET /profile` — returns the caller's profile, upserting a `HolderProfile`
  row on first access.
- `PATCH /profile` — updates display name, email, and preferences.

Every field-level change writes a `ProfileAuditLog` row capturing the field
name, old value, new value, actor, and timestamp.

## Privacy requests

`POST /admin/privacy-requests` creates a `PrivacyRequest` row and triggers
anonymisation. Anonymisation replaces PII fields (display name, email) with
hashed or placeholder values so the profile no longer identifies the holder.

## On-chain data is immutable

Data written on-chain (balances, transfers, contract state) is immutable and
**cannot be erased**. Anonymisation and deletion requests only affect the
off-chain `HolderProfile` records described above. On-chain history remains
public and permanent regardless of any privacy request.
