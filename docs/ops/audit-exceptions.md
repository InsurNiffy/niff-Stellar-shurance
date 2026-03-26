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

---

_No exceptions recorded yet._
