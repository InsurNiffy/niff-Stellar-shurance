# Alert Fatigue Review Process

**Effective:** 2026-Q3  
**Cadence:** Quarterly (every 13 weeks, on-cycle with calendar quarters)  
**Last reviewed:** Pending first real review  
**Next review due:** 2026-11-30 (end of Q4 2026)

---

## Purpose

This document defines the repeatable, objective process for identifying and addressing alert fatigue in the NiffyInsure API monitoring system. Alert fatigue occurs when alert fire rates are high relative to actual incidents, or when an alert reliably fires for conditions operators cannot or do not act on — wasting on-call time and eroding trust in the alerting system.

This process runs on a **quarterly cadence** to regularly audit the active alert rules against real production fire data and actionability, tuning or removing rules that are demonstrably noisy or dead.

---

## Alert Classification Criteria

### "Noisy" Alert (High Fire Rate, Low Actionability)

An alert is classified as **noisy** if it meets one or more of these criteria, observed over the 13-week review window:

- **High raw fire frequency:** Fires more than **2 times per week** (on average) during the review window, AND
- **Low incident correlation:** Does not correlate with actual production incidents (on-call tickets, escalations, or customer-reported issues) in the same window, OR
- **Regularly dismissed:** On-call responders document dismissing or snoozing the alert >50% of the time it fires without taking action

**Rationale:** An alert firing 2+ times/week that correlates to no actual incident or action is wasting context-switching time and eroding on-call morale. If an alert must fire that frequently for legitimate reasons, it should trigger an action; if there's no action, the condition is not worth alerting on at that threshold.

### "Dead" Alert (No Fire, No Known Use)

An alert is classified as **dead** if it meets both criteria:

- **Zero fires in review window:** Did not fire at all during the 13-week review period, AND
- **No known use:** The owning team (or on-call) cannot articulate a recent incident or scenario where this alert would/should have fired, or state that the condition it monitors is no longer relevant

**Rationale:** An alert that never fires in a 13-week window is either: (1) the condition it monitors no longer occurs in production (dead rule), or (2) the threshold is miscalibrated so high it will never fire for realistic conditions (also a problem, but fixable differently). Either way, it should be removed or its owners should explicitly confirm its necessity.

### "Actionable" Alert (Normal)

An alert is **actionable** if it fires at a sustainable rate and responders reliably take action when it fires:

- **Sustainable fire frequency:** Fires on average ≤ 1 time per week, **and** that fire correlates with a documented incident or a documented decision to tune the threshold, OR
- **Clear runbook:** Has a linked runbook or documented escalation path that on-call responders follow, AND
- **Owner accountability:** The owning team (backend, infra, etc.) acknowledges the alert and can describe at least one action they'd take if it fired

---

## Review Procedure: Step-by-Step

### Step 1: Prepare Data (Days 1–2 of review week)

1. **Extract fire data from Prometheus:**
   - Query the Prometheus alerting API or use Prometheus UI to export **all firing events** for each alert rule in the review window (13 weeks prior to review start date)
   - Export as: alert name, fire timestamp, duration, labels (severity, team, route/rpc_method if applicable)
   - Save to a CSV or JSON file for analysis
   - Reference: See [Prometheus Alertmanager Querying](#appendix-prometheus-querying) in appendix

2. **Correlate with incident tracking:**
   - Pull on-call incident list from the incident tracking system (e.g., status page, PagerDuty, or internal ticket system) for the same 13-week window
   - Link by timestamp: which alerts have a corresponding incident opened within ±30 minutes?
   - Document: alert name → incident count

3. **Gather runbook status:**
   - Review each alert rule definition (see [Alert Inventory](./alert-inventory.md)) and note which have linked runbooks
   - For alerts without runbooks, check if there's an internal wiki or a PR comment linking one

4. **Identify rule ownership:**
   - Check the alert rule's `team` label (all rules are labeled `team: backend` currently)
   - Confirm with the team: is this alert still owned by them, or has responsibility shifted?

### Step 2: Classify Each Alert (Days 2–3)

1. **For each alert in the [inventory](./alert-inventory.md):**
   - Count fires in the review window (from Prometheus data)
   - Calculate average fires/week: `total_fires / 13`
   - Check incident correlation: does this alert have ≥1 correlated incident?
   - Apply the classification criteria from [Alert Classification Criteria](#alert-classification-criteria) above
   - Classify as: **Actionable**, **Noisy**, or **Dead**

2. **Document findings:**
   - Use the [Findings Log Template](./alert-review-log.md) to record each alert's classification
   - For noisy/dead alerts, add a note on why (fire count, lack of runbook, etc.)

### Step 3: Recommend Actions (Days 3–4)

For each **Noisy** alert, recommend one of:

1. **Tune threshold higher** (if the threshold is too permissive): Increase the threshold so that routine operational events don't trigger it, or adjust the evaluation window (e.g., `[10m]` → `[30m]`)
2. **Consolidate with related alerts:** If multiple alerts monitor the same condition (e.g., High5xxRate and High5xxErrorRate both track 5xx errors), merge them into a single rule with per-route granularity
3. **Add/improve runbook:** If the alert lacks actionable documentation, add a link to a runbook that describes troubleshooting steps
4. **Remove rule:** If the condition is no longer relevant or a newer rule supersedes it, recommend removal

For each **Dead** alert, recommend one of:

1. **Remove rule:** If the condition is truly no longer relevant or the owning team cannot articulate a use case
2. **Keep as-is with explicit justification:** If the owning team confirms they want to keep a "canary" rule that very rarely fires, document this decision and the rationale

### Step 4: Review & Decide with Owners (Days 4–5)

1. **Present findings to backend team** (and any relevant infra teams):
   - Share the list of noisy/dead alerts and recommended actions
   - Discuss trade-offs: is raising a threshold worth reducing alert volume, or does that mask real incidents?

2. **Get sign-off:**
   - Confirm recommended actions with the owning team
   - Update recommendations based on their feedback

3. **Plan changes:**
   - Create GitHub issues for each recommended change (tune, consolidate, add runbook, remove)
   - Link to the review log for traceability

### Step 5: Document Review Completion (Day 5)

1. **Finalize findings log:**
   - Update [Findings Log](./alert-review-log.md) with final decisions and sign-off date
   - Record reviewer name and date

2. **Schedule next review:**
   - Calculate due date: today + 13 weeks = next review due date
   - Create a calendar event (repeating, or manual) for the team lead to trigger the next review
   - File a GitHub issue (label: `ops`, `recurring`) as a reminder to schedule the next review

---

## Monitoring System & Data Sources

### Prometheus & Alertmanager

This repository's alert rules are defined as **Prometheus alert rules** (YAML format, located in `backend/docs/prometheus-*.yml`).

**Fire data location:**
- Query the live Prometheus instance via HTTP API: `GET /api/v1/query_range`
- Or export from Prometheus UI: Graph tab → "ALERTS" or custom PromQL query (see appendix)
- Sample query to export all fires for one alert:
  ```
  ALERTS{alertname="HighP99Latency"}[13w]
  ```

**Alertmanager routing & grouping:**
- The deployed Alertmanager instance will group related fires and deduplicate alerts based on labels (severity, team, route)
- Review the live Alertmanager Config (deployed to your monitoring infrastructure) to understand grouping and routing to on-call

### Incident Tracking System

**Assumption:** Your incident tracking system (PagerDuty, internal ticket system, status page) has timestamps for when incidents were opened.

- Link by timestamp: if Prometheus shows an alert firing at 2026-08-20T14:30:00Z, check if an incident was opened in the same 30-minute window
- If no incident tracking is in place, this step cannot be completed; defer this review until incident data is available

---

## Cadence & Scheduling

### Review Window
- **Duration:** 13 weeks (one quarter)
- **Frequency:** Every 13 weeks, starting from 2026-Q3

### Scheduled Review Dates
| Quarter | Review Start | Review End | Deadline for Action | Next Review Due |
|---------|--------------|------------|---------------------|-----------------|
| 2026-Q3 | 2026-09-03   | 2026-09-05 | 2026-09-30          | 2026-11-28      |
| 2026-Q4 | 2026-12-03   | 2026-12-05 | 2026-12-31          | 2027-02-28      |
| 2027-Q1 | 2027-03-02   | 2027-03-04 | 2027-03-31          | 2027-05-28      |

### Tracking Reminders
- **Calendar:** Add a repeating calendar event for the team lead (e.g., "Alert Fatigue Review Week") starting 2026-09-03, recurring every 13 weeks
- **GitHub:** Create a recurring GitHub issue template (label: `ops`, `recurring`) with this checklist, auto-filed by automation or manually each quarter
- **Slack:** Post a reminder in the on-call or backend team channel 1 week before review is due

---

## Roles & Responsibilities

| Role | Responsibility |
|------|-----------------|
| **Review Owner** (On-Call Lead or Backend Lead) | Schedule and run the review; coordinate with team owners to classify alerts and decide on actions |
| **Prometheus Operator / Monitoring Team** | Provide access to Prometheus API and query support; ensure fire data is exportable |
| **Backend Team** | Respond to classification questions; decide whether to tune/consolidate/remove alerts owned by backend |
| **Documentation** | Update this runbook if criteria or cadence changes |

---

## Success Metrics

A successful alert fatigue review should result in:

1. ✓ All 15 currently-active alerts have been classified (Actionable, Noisy, or Dead)
2. ✓ Noisy and dead alerts have recommended actions linked to GitHub issues
3. ✓ Recommended actions (tune, consolidate, add runbook, remove) are prioritized and scheduled
4. ✓ Changes are implemented before the start of the next review window
5. ✓ Next review date is scheduled and a reminder is in place

---

## Appendix: Prometheus Querying

### Export All Alert Fires for a Time Range

**Via Prometheus Web UI:**
1. Go to the Prometheus instance: `https://<prometheus-host>/graph`
2. In the query box, enter: `ALERTS{alertname="AlertName"}[13w]` (replace AlertName with the rule name)
3. Click **Execute** → **Graph** tab
4. Hover over data points to see exact fire times
5. Alternatively, export as JSON via the API (see below)

**Via Prometheus HTTP API:**
```bash
curl 'https://<prometheus-host>/api/v1/query_range' \
  --data-urlencode 'query=ALERTS{alertname="HighP99Latency"}' \
  --data-urlencode 'start=1693612800' \
  --data-urlencode 'end=1710201600' \
  --data-urlencode 'step=3600' \
  | jq '.data.result[]'
```

Replace:
- `<prometheus-host>`: your Prometheus instance URL
- `start` / `end`: Unix timestamps for the review window (use `date -d '2026-06-13' +%s` to convert)
- `step`: evaluation interval (e.g., 3600 = 1 hour)

### Count Fires Per Alert

**PromQL query to count fires in the review window:**
```promql
count(changes(ALERTS{alertname="HighP99Latency"}[13w]))
```

This counts state changes (transitions from absent → firing → resolved); divide by 2 to get approximate fire count.

---

## References

- [Alert Inventory](./alert-inventory.md) — Complete enumeration of current alert rules
- [Alert Review Findings Log Template](./alert-review-log.md) — Template for recording review results
- Prometheus Documentation: https://prometheus.io/docs/prometheus/latest/
- Alertmanager Documentation: https://prometheus.io/docs/alerting/latest/overview/
