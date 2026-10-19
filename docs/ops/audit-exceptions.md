# Dependency Audit Exceptions

Entries here document accepted risks that would otherwise fail the `dependency-audit` CI job.
Each entry requires approval from a second engineer before the `audit-exception-approved`
label may be applied to a PR.

## Format

```
### CVE-YYYY-NNNNN — <package>@<version>
- **Severity:** Critical | High
- **Affected code path:** <describe whether the vulnerable code is reachable in production>
- **Justification:** <why this is acceptable>
- **Mitigations:** <what reduces the risk>
- **Review-by date:** YYYY-MM-DD
- **Approved by:** <engineer 1>, <engineer 2>
```

## Review Process

Every open exception below is reviewed on the cadence set by its **Review-by date** and on
any PR that touches `Cargo.toml` / `Cargo.lock`. The `dependency-audit` CI job annotates such
PRs with the list of open exceptions (see `.github/workflows/dependency-audit.yml`) so reviewers
can confirm each entry is still warranted. When an upstream fix is released, the affected crate
is upgraded and the exception is removed rather than renewed.

## Open Exceptions

_No exceptions recorded yet._

All previously tracked exceptions have been reviewed and either remediated by upgrade or
confirmed as no longer applicable. New exceptions must follow the format above and be approved
by a second engineer before being added here.
