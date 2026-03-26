# Requirements Document

## Introduction

This document specifies requirements for a claim rate limiting system to mitigate spam and governance fatigue while allowing legitimate catastrophic events where multiple claims may be filed in rapid succession. The system tracks claim counts per policy within rolling time windows, enforces configurable limits with absolute maximum bounds, and provides clear audit trails when limits are modified.

## Glossary

- **Rate_Limiter**: The service responsible for tracking claim counts and enforcing rate limits
- **Policy**: An insurance policy identified by a unique policyId against which claims are filed
- **Rolling_Window**: A time-based window (measured in ledgers) that slides forward as new claims are filed
- **Claim_Counter**: A data structure tracking the number of claims filed for a specific policy within a rolling window
- **Admin**: An authenticated user with administrative privileges who can modify rate limit configurations
- **Window_Anchor**: The ledger number marking the start of the current rolling window for a policy
- **Limit_Configuration**: Admin-configurable settings defining maximum claims per window per policy
- **Absolute_Max_Cap**: A hard-coded system maximum that cannot be exceeded by admin configuration
- **Legitimate_Surge**: A scenario where multiple valid claims occur in rapid succession due to a catastrophic event
- **Rate_Limit_Event**: An audit log entry emitted when rate limit configurations are modified

## Requirements

### Requirement 1: Track Claims Per Policy in Rolling Windows

**User Story:** As a system operator, I want to track how many claims have been filed against each policy within a rolling time window, so that I can detect and prevent spam patterns.

#### Acceptance Criteria

1. WHEN a claim is filed against a policy, THE Rate_Limiter SHALL increment the Claim_Counter for that policy
2. THE Rate_Limiter SHALL maintain a Window_Anchor ledger number for each policy to define the start of the rolling window
3. WHEN the current ledger exceeds the Window_Anchor plus the configured window size, THE Rate_Limiter SHALL reset the Claim_Counter to zero and update the Window_Anchor to the current ledger
4. THE Rate_Limiter SHALL perform counter lookups and updates in O(1) time complexity per transaction
5. THE Rate_Limiter SHALL key Claim_Counter records by policyId for efficient retrieval

### Requirement 2: Enforce Configurable Rate Limits with Maximum Bounds

**User Story:** As an administrator, I want to configure rate limits per policy with safety guardrails, so that I can balance spam prevention with legitimate use cases.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL reject claim transactions when the Claim_Counter for a policy exceeds the configured limit within the current rolling window
2. WHEN a claim exceeds the rate limit, THE Rate_Limiter SHALL revert the transaction with an informative error message including the current count, limit, and window reset time
3. THE Admin SHALL be able to set custom rate limits per policy through an administrative endpoint
4. THE Rate_Limiter SHALL enforce an Absolute_Max_Cap that cannot be exceeded by any admin configuration
5. WHEN an admin attempts to set a limit above the Absolute_Max_Cap, THE Rate_Limiter SHALL reject the configuration change with a clear error message
6. THE Rate_Limiter SHALL apply a system-wide default limit to policies that do not have custom configurations

### Requirement 3: Provide Clear Error Messages for Rate Limit Violations

**User Story:** As a user filing a claim, I want to understand why my claim was rejected and when I can retry, so that I can take appropriate action.

#### Acceptance Criteria

1. WHEN a claim is rejected due to rate limiting, THE Rate_Limiter SHALL return an error message containing the policy ID, current claim count, configured limit, and estimated window reset time
2. THE Rate_Limiter SHALL calculate the window reset time based on the Window_Anchor and configured window duration
3. THE Rate_Limiter SHALL format error messages in a user-friendly manner suitable for display in the UI
4. THE Rate_Limiter SHALL include the remaining ledgers until window reset in the error response

### Requirement 4: Emit Audit Events for Limit Configuration Changes

**User Story:** As a compliance officer, I want to track all changes to rate limit configurations, so that I can audit administrative actions and ensure policy compliance.

#### Acceptance Criteria

1. WHEN an admin modifies a rate limit configuration, THE Rate_Limiter SHALL emit a Rate_Limit_Event containing the admin wallet address, policy ID, old limit, new limit, and timestamp
2. THE Rate_Limiter SHALL persist Rate_Limit_Event records in the AdminAuditLog table
3. THE Rate_Limiter SHALL include the IP address of the admin in the audit log entry
4. THE Rate_Limiter SHALL emit events for both successful and rejected configuration changes

### Requirement 5: Support Manual Override Paths for Legitimate Surges

**User Story:** As an administrator, I want the ability to temporarily increase or bypass rate limits during catastrophic events, so that legitimate claims are not blocked.

#### Acceptance Criteria

1. WHERE manual override is enabled for a policy, THE Rate_Limiter SHALL allow claims to exceed the standard configured limit
2. THE Admin SHALL be able to enable manual override mode for specific policies through an administrative endpoint
3. WHEN manual override is enabled, THE Rate_Limiter SHALL emit a Rate_Limit_Event documenting the override activation
4. THE Rate_Limiter SHALL require admin authentication and authorization for all override operations
5. THE Admin SHALL be able to disable manual override mode, returning the policy to standard rate limiting

### Requirement 6: Document Operational Defaults and Reset Semantics

**User Story:** As a product manager, I want clear documentation of default rate limits and window behavior, so that I can communicate system behavior to stakeholders and coordinate with legal teams.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL document the default claims-per-window limit in the system configuration
2. THE Rate_Limiter SHALL document the default rolling window duration in ledgers
3. THE Rate_Limiter SHALL document the Absolute_Max_Cap value and its rationale
4. THE Rate_Limiter SHALL document the window reset semantics, including how Window_Anchor values are updated
5. THE Rate_Limiter SHALL document recommended limits for different policy types based on product and legal input

### Requirement 7: Maintain Normal Operation Performance

**User Story:** As a system operator, I want rate limiting checks to have minimal performance impact, so that normal claim filing operations remain fast and responsive.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL complete rate limit checks in O(1) time complexity
2. THE Rate_Limiter SHALL use indexed database queries for counter lookups
3. WHEN a claim is within rate limits, THE Rate_Limiter SHALL add no more than 50ms of latency to the claim filing operation
4. THE Rate_Limiter SHALL cache rate limit configurations in memory to avoid repeated database queries

### Requirement 8: Coordinate with KYC Systems for Jurisdictional Compliance

**User Story:** As a compliance officer, I want rate limiting to integrate with KYC verification systems, so that jurisdictional requirements are enforced.

#### Acceptance Criteria

1. WHERE KYC verification is required by jurisdiction, THE Rate_Limiter SHALL check KYC status before applying rate limits
2. WHEN a user lacks required KYC verification, THE Rate_Limiter SHALL reject claims with a KYC-specific error message
3. THE Rate_Limiter SHALL support configurable KYC requirements per jurisdiction
4. THE Rate_Limiter SHALL log KYC-related rejections separately from rate limit violations for compliance reporting

### Requirement 9: Test Rate Limiting Across Threshold Boundaries

**User Story:** As a quality assurance engineer, I want comprehensive test coverage of rate limiting behavior, so that edge cases and boundary conditions are validated.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL include automated tests for sequences of claims that approach but do not exceed limits
2. THE Rate_Limiter SHALL include automated tests for sequences that exceed limits by exactly one claim
3. THE Rate_Limiter SHALL include automated tests for window rollover scenarios where counters reset
4. THE Rate_Limiter SHALL include automated tests for concurrent claim submissions at the limit boundary
5. THE Rate_Limiter SHALL include automated tests verifying that normal usage patterns remain unaffected by rate limiting
