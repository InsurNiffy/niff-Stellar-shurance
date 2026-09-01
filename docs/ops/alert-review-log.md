# Alert Review Findings Log

This document logs the results of each quarterly alert-fatigue review. Use this template to record fire counts, classifications, and actions for each alert rule.

**See also:** [Alert Fatigue Review Process](./alert-fatigue-review-process.md) for methodology and criteria.

---

## Log Entry Template

When running a review, copy the section below and fill in the review details. Keep all entries in this file for historical reference.

```markdown
## Review Cycle: [YYYY-Q#] (dates: YYYY-MM-DD to YYYY-MM-DD)

**Reviewer:** [Name]  
**Review Date:** YYYY-MM-DD  
**Data Window:** 13 weeks prior to review date  
**Status:** [In Progress / Completed]

### Summary

- **Total alerts reviewed:** [#]
- **Actionable:** [#]
- **Noisy:** [#]
- **Dead:** [#]
- **Actions scheduled:** [#] (tune, consolidate, add runbook, remove)

### Individual Alert Classifications

| Alert Name | Severity | Fires (Window) | Fires/Week | Classification | Runbook | Incident Correlation | Notes | Action Recommended |
|------------|----------|:-:|:-:|-----------|:-:|:-:|---|---|
| ... | ... | ... | ... | Actionable/Noisy/Dead | Y/N | Y/N | ... | None / Tune / Consolidate / Add Runbook / Remove |

### High-Priority Findings

[List any critical or surprising findings that require urgent action]

### Decisions & Follow-Up

[Document decisions made with the owning team, trade-offs, and any open questions]

### Next Review Date

**Scheduled:** YYYY-MM-DD  
**Calendar reminder:** [Y/N]
**GitHub issue reminder:** [Issue #, if created]
```

---

## 2026-Q3 Review (Preliminary — Unvalidated Static Flags)

**Status:** PENDING REAL REVIEW  
**Analysis Source:** Static rule definitions only (no fire-frequency data)  
**Next Step:** Run the [Alert Fatigue Review Process](./alert-fatigue-review-process.md) against live Prometheus data

### Summary of Preliminary Flags

This section contains **unconfirmed observations** from a static analysis of the rule definitions. These are starting points for the first real review — not conclusions.

**See:** [Alert Review Preliminary Findings](./alert-review-preliminary-findings.md) for detailed reasoning.

### Flagged Alerts (Requires Real Data to Confirm)

| Alert Name | Issue | Severity | Status | Confirm/Dismiss |
|------------|-------|----------|--------|---|
| RedisConnectionErrors | Permissive threshold (`>0`); may be noisy | Critical | Flagged | [ ] Confirm Noisy / [ ] Dismiss |
| RedisCacheHitRateLow | Unusually low threshold (50%); may mask problems | Warning | Flagged | [ ] Review Threshold / [ ] Dismiss |
| HighRpcP95Latency | High threshold (8s); may miss degradation | Warning | Flagged | [ ] Review Threshold / [ ] Dismiss |
| High5xxRate + High5xxErrorRate | Overlapping rules on same metric; redundant | Critical + Warning | Flagged | [ ] Consolidate / [ ] Keep Separate |
| IndexerLagHigh + IndexerLedgerGapHigh | Overlapping rules on indexer lag; unclear if same metric | Warning + Warning | Flagged | [ ] Consolidate / [ ] Clarify |
| HighP99Latency + HighP95Latency + CriticalP95Latency | Three alerts on latency; cascading, unclear SLA | Warning + Warning + Critical | Flagged | [ ] Consolidate / [ ] Clarify Thresholds |
| High5xxRate, HighRpcErrorRate, HighP99Latency, HighRpcP95Latency, IndexerLagHigh, SolvencyBufferLow, RedisCacheHitRateLow, RedisConnectionErrors, IndexerLedgerGapHigh, IndexerLastLedgerAgeHigh | Missing runbook links (11 alerts in niffyinsure_api group) | Various | Flagged | [ ] Create Runbooks / [ ] Link Existing Docs |
| SolvencyBufferLow | Dynamic threshold (not visible in rule); lacks transparency | Critical | Flagged | [ ] Document Threshold / [ ] Clarify Intent |

### Actions for First Real Review

- [ ] **Step 1:** Extract fire-frequency data from Prometheus for the 13-week review window
- [ ] **Step 2:** Correlate fires with incident tracking (PagerDuty, status page, etc.)
- [ ] **Step 3:** For each flagged item, run the [Alert Fatigue Review Process](./alert-fatigue-review-process.md) Step 2 (classify alert)
- [ ] **Step 4:** For each Noisy/Dead alert, recommend actions (tune, consolidate, add runbook, remove) in Step 3
- [ ] **Step 5:** Present findings to backend team and get sign-off
- [ ] **Step 6:** Create GitHub issues for recommended actions and link to this review
- [ ] **Step 7:** Update this log entry with final classifications and decisions

---

## Historical Review Log (To Be Populated)

Future review cycles will be documented below. Each entry should follow the template above.

### Example Structure (not real data):

```markdown
## Review Cycle: [YYYY-Q#] (dates: YYYY-MM-DD to YYYY-MM-DD)

**Reviewer:** [Name]  
**Review Date:** YYYY-MM-DD  
...
```

---

## Maintenance

**Keep this file updated when:**
- A new alert rule is added (add to the log with "new rule" status)
- A review cycle is completed (record findings and actions)
- An alert is removed or consolidated (note in historical log)

**Archive old reviews:** Once a review cycle is >1 year old, consider moving its entry to `alert-reviews/[YYYY-Q#].md` for historical reference (keep the template and current/pending reviews in this file).

---

## Related Documents

- [Alert Inventory](./alert-inventory.md) — All currently-active alert rules
- [Alert Fatigue Review Process](./alert-fatigue-review-process.md) — Step-by-step review methodology
- [Alert Review Preliminary Findings](./alert-review-preliminary-findings.md) — Detailed static analysis of rule definitions
