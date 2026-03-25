-- Seed data for demo environment
-- Run this after migrations to populate demo data

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create demo users
INSERT INTO users (id, stellar_address, email, role, "isActive", "fullName", phone)
VALUES 
  (
    uuid_generate_v4(),
    'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q1',
    'admin@niffyinsure.demo',
    'admin',
    true,
    'Demo Admin',
    '+1234567890'
  ),
  (
    uuid_generate_v4(),
    'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q2',
    'staff@niffyinsure.demo',
    'staff',
    true,
    'Demo Staff',
    '+1234567891'
  ),
  (
    uuid_generate_v4(),
    'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q3',
    'holder1@niffyinsure.demo',
    'holder',
    true,
    'Alice Holder',
    '+1234567892'
  ),
  (
    uuid_generate_v4(),
    'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q4',
    'holder2@niffyinsure.demo',
    'holder',
    true,
    'Bob Holder',
    '+1234567893'
  ),
  (
    uuid_generate_v4(),
    'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q5',
    'holder3@niffyinsure.demo',
    'holder',
    true,
    'Charlie Holder',
    '+1234567894'
  )
ON CONFLICT DO NOTHING;

-- Get user IDs for reference
-- Note: In production, you'd use the returned IDs

-- Create demo policies
INSERT INTO policies (id, "policyNumber", "policyType", status, "coverageAmount", "premiumAmount", "premiumRate", "startDate", "endDate", "holderId", "holderStellarAddress", "smartContractId", "activatedAt")
SELECT 
  uuid_generate_v4(),
  'POL-' || LPAD(i::text, 6, '0'),
  'premium',
  'active',
  (1000000 + (random() * 9000000))::numeric(20,0),
  (10000 + (random() * 90000))::numeric(20,0),
  (0.01 + (random() * 0.04))::numeric(5,2),
  NOW() - (random() * 30 || ' days')::interval,
  NOW() + (365 + random() * 30 || ' days')::interval,
  (SELECT id FROM users WHERE role = 'holder' ORDER BY created_at LIMIT 1),
  'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q3',
  'CA' || LPAD(i::text, 10, '0'),
  NOW() - (random() * 10 || ' days')::interval
FROM generate_series(1, 5) i
ON CONFLICT DO NOTHING;

-- Create demo claims
INSERT INTO claims (id, "claimNumber", status, priority, "claimedAmount", "approvedAmount", description, "tenantId", "policyId", "holderId", "holderStellarAddress", "reviewedBy", "reviewedAt", "resolvedAt")
SELECT 
  uuid_generate_v4(),
  'CLM-' || LPAD(i::text, 6, '0'),
  CASE i 
    WHEN 1 THEN 'submitted'
    WHEN 2 THEN 'under_review'
    WHEN 3 THEN 'approved'
    WHEN 4 THEN 'rejected'
    WHEN 5 THEN 'paid'
  END,
  CASE i 
    WHEN 1 THEN 'low'
    WHEN 2 THEN 'medium'
    WHEN 3 THEN 'high'
    WHEN 4 THEN 'critical'
    WHEN 5 THEN 'medium'
  END,
  (50000 + (random() * 450000))::numeric(20,0),
  CASE WHEN i IN (3, 5) THEN (40000 + (random() * 400000))::numeric(20,0) ELSE NULL END,
  'Demo claim for policy: Incident occurred during the policy period. Supporting documentation attached.',
  NULL,
  (SELECT id FROM policies ORDER BY created_at LIMIT 1),
  (SELECT id FROM users WHERE role = 'holder' ORDER BY created_at LIMIT 1),
  'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q3',
  (SELECT id FROM users WHERE role = 'admin' LIMIT 1),
  CASE WHEN i IN (3, 4, 5) THEN NOW() - (random() * 5 || ' days')::interval ELSE NULL END,
  CASE WHEN i IN (3, 4, 5) THEN NOW() - (random() * 3 || ' days')::interval ELSE NULL END
FROM generate_series(1, 5) i
ON CONFLICT DO NOTHING;

-- Create demo votes
INSERT INTO votes (id, "voteType", status, reason, "stakedAmount", "tenantId", "claimId", "voterId", "voterStellarAddress", "confirmedAt")
SELECT 
  uuid_generate_v4(),
  CASE WHEN random() > 0.5 THEN 'approve' ELSE 'reject' END,
  'confirmed',
  'Voted based on claim merit and evidence provided.',
  (1000 + (random() * 9000))::numeric(20,0),
  NULL,
  (SELECT id FROM claims ORDER BY created_at LIMIT 1),
  (SELECT id FROM users WHERE role = 'holder' ORDER BY created_at OFFSET 1 LIMIT 1),
  'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q4',
  NOW() - (random() * 2 || ' days')::interval
FROM generate_series(1, 3) i
ON CONFLICT DO NOTHING;

-- Create demo raw events
INSERT INTO raw_events (id, "eventType", status, "eventId", ledger, "ledgerTimestamp", "sourceAddress", "eventData")
SELECT 
  uuid_generate_v4(),
  CASE 
    WHEN i <= 3 THEN 'policy_created'
    WHEN i <= 6 THEN 'premium_paid'
    WHEN i <= 9 THEN 'claim_submitted'
    ELSE 'vote_submitted'
  END,
  'processed',
  'evt_' || LPAD(i::text, 8, '0'),
  1000000 + i,
  NOW() - ((10 + random() * 50) || ' days')::interval,
  'GD7GHL6ZVWQZ7D7CN7UWJT7WIVD7C6KZHK5Z3V4X3K6Z5L6M7N8O9P0Q' || (i % 10),
  ('{"transactionHash": "tx_hash_' || LPAD(i::text, 8, '0') || '", "amount": ' || (1000 + random() * 9000) || ', "currency": "XLM"}')::jsonb
FROM generate_series(1, 12) i
ON CONFLICT DO NOTHING;

-- Create demo ledger cursors
INSERT INTO ledger_cursors (id, "ingestionType", "lastLedger", "lastLedgerTimestamp", "lastCursor", "lastSyncAt")
VALUES 
  (uuid_generate_v4(), 'events', 1000150, NOW() - '1 hour'::interval, '0000000000000000000000000000000000000000000000000000000000000001', NOW() - '1 hour'::interval),
  (uuid_generate_v4(), 'transactions', 1000150, NOW() - '1 hour'::interval, '0000000000000000000000000000000000000000000000000000000000000002', NOW() - '1 hour'::interval),
  (uuid_generate_v4(), 'effects', 1000150, NOW() - '1 hour'::interval, '0000000000000000000000000000000000000000000000000000000000000003', NOW() - '1 hour'::interval)
ON CONFLICT DO NOTHING;

-- Create demo notification preferences for admin user
INSERT INTO notification_preferences (id, channel, "eventType", enabled, destination, "userId")
SELECT 
  uuid_generate_v4(),
  'email',
  'claim_status_changed',
  true,
  'admin@niffyinsure.demo',
  id
FROM users WHERE role = 'admin' LIMIT 1
ON CONFLICT DO NOTHING;

-- Create demo audit logs
INSERT INTO audit_logs (id, action, severity, description, "tenantId", "actorId")
SELECT 
  uuid_generate_v4(),
  'user_login',
  'info',
  'User logged in successfully',
  NULL,
  id
FROM users WHERE role = 'admin' LIMIT 1
ON CONFLICT DO NOTHING;

-- Verify data
SELECT 'Users created: ' || COUNT(*) FROM users;
SELECT 'Policies created: ' || COUNT(*) FROM policies;
SELECT 'Claims created: ' || COUNT(*) FROM claims;
SELECT 'Votes created: ' || COUNT(*) FROM votes;
SELECT 'Raw events created: ' || COUNT(*) FROM raw_events;
SELECT 'Ledger cursors created: ' || COUNT(*) FROM ledger_cursors;