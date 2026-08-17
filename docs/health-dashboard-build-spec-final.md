# BUILD SPECIFICATION (FINAL) — Wallace Website Performance & Search Health Dashboard

**Date:** August 2026
**Status:** FINAL — BUILD (red-team verdict, round 4). This document incorporates every round-4 B/C correction and embeds all normative tables (Appendices A–C) so a builder needs only this document. No further planning rounds; the acceptance suite (§11) is the launch gate.
**Review history:** 4 rounds. R1: NOT READY (privacy, publishing, metric semantics). R2: NOT READY (browser bearer-key). R3: BUILD-READY WITH CONDITIONS (6 auth/impl conditions). R4: FINAL — BUILD (B/C corrections, all folded in here).

---

## 1. Product definition

- **Name:** Website Performance & Search Health (deliberately not "complete health" — CRM reconciliation, GBP, accessibility automation, structured-data validation, multi-office monitoring, and qualified-lead linkage are the labeled roadmap, §12).
- **What it is:** a private, monthly-updated reporting page on wallacetn.com replacing hand-made monthly reports, readable by someone who does not know what an "impression" is, showing progress and evidence-gated recommended actions.
- **What it is not:** an alerting system (the daily watchdog is separate, §6), an action-taking system (read-only; spends nothing; changes nothing), or a real-time dashboard.

## 2. Architecture

```text
Collectors (GSC API, GA4 API, CrUX/PSI API, SEMrush API-or-validated-scrape,
            direct integrity checks, manual events.yaml)
        v
Normalize -> validate -> render candidate edition -> smoke test
        v                          | required-source failure: live-edition
GitHub private repo (append-only   | pointer does NOT move; only the
snapshots, editions, history,      | authenticated publication_status
manifests, config.yaml)            | record updates (delay banner)
        v
Atomic promotion (active-edition pointer per period)
        v
n8n data API (server-side auth; serves the active edition)
        v
WP page shell on wallacetn.com (zero data; lock screen; renders client-side
from the API; vendored pinned Chart.js; noindex; sitemap-excluded)
```

- The page shell contains NO data, NO secrets, NO analytics, no dashboard-controlled third-party calls. WP revisions of the shell expose no dashboard data or credentials, although they may reveal public application code and endpoint locations (accepted residual).
- Data flows cross-origin (page → n8n) over HTTPS. CORS: `Access-Control-Allow-Origin: https://wallacetn.com` exactly (www handling explicitly tested; the canonical origin only); methods POST only; headers Content-Type + Authorization only; no credentialed CORS; OPTIONS answered with no data. CORS is a browser boundary, not authentication.
- Chart.js vendored into the repo, version-pinned; never CDN; never silently updated between editions.

## 3. Authentication

### 3.1 Two credentials

1. **Shared human password** — rotated quarterly by Howard (access owner and revocation authority), and immediately on any suspicion of exposure. The application never persists the password: it exists transiently in the password field and request memory, is cleared immediately after every authentication attempt, and is never written to browser storage, cookies, logs, analytics, or cache.
2. **Short-lived token** — issued by n8n `/auth` after password verification; lifetime exactly 1,800 seconds; held in a JS closure variable in memory only (no sessionStorage, no localStorage, no cookies).

### 3.2 Token format and validation

```text
claims = { v: 1, iat, exp: iat + 1800, aud: "wallace-health-dash",
           jti: random-128-bit, pwv: password-version }
body   = base64url(UTF8(JSON(claims)))
mac    = HMAC-SHA256(server_secret, ASCII(body))
token  = body + "." + base64url(mac)
```

Server-side validation on EVERY request, in order:
1. Reject oversized inputs and any token without exactly two segments; reject non-base64url segments; require a 32-byte MAC.
2. Verify the MAC in constant time BEFORE parsing any claim.
3. Strictly validate EVERY claim and its type: `v` = 1; `exp - iat` = 1800 exactly; `iat` not in the future beyond limited clock skew; `aud` exact match; `jti` present and well-formed; `pwv` equals current password version.
4. Any failure → generic 401.

`server_secret` and the password live in n8n's encrypted credential store (never ordinary variables, workflow code, exports, GitHub, notifications, or the page). Password comparison is constant-time.

### 3.3 Response semantics

- Invalid credentials/tokens (any cause) → generic 401 `{"error":"unauthorized"}`: identical status and response body, constant-time password/MAC comparisons, no intentionally distinguishing error details. (Perfectly identical network timing across endpoints is not required.)
- Rate-limited requests → generic 429 with `Retry-After`. 401 vs 429 is the only exposed distinction.
- `/auth` returns the newly issued token exactly once; never echoes the password. Data endpoints never echo the token. Both send `Cache-Control: no-store`; no Set-Cookie. `/auth` accepts only POST with JSON body.

### 3.4 Rate limiting

Durable atomic counter (database table or Redis — mechanism finalized at build against these requirements; NOT n8n static-data): persists across restarts; concurrency-safe under 25 simultaneous attempts; client IP derived ONLY from the named trusted ingress header of n8n Cloud's proxy (the actual header verified at build per n8n reverse-proxy guidance, not assumed; forged forwarding headers must not change the bucket); keyed on IP and credential-version; max 5 failures per IP per 15 minutes; then 429 + `Retry-After` with exponential backoff; rate-limit check runs BEFORE password comparison.

### 3.5 Logging and audit

- `/auth` workflow: saving of execution data disabled for success, failure, and manual runs — verified, not merely pruned.
- Audit log records: event type, timestamp, trusted IP, request ID, password version; `jti` only for token-issuance events. No headers, bodies, passwords, or tokens retained. Retention 12 months; access restricted to Howard + automation identity; if the audit sink is unavailable, authentication still functions and the outage itself is logged when the sink recovers (availability over auditability for a read-only reporting tool — documented tradeoff).
- Acceptance testing uses sentinel credentials scanned across an inventoried list of log stores: n8n execution storage, n8n Cloud instance logs (as accessible), the audit sink, and any proxy logs the plan controls. The inventory is written into the test, not left as "available logs."

### 3.6 Client lifecycle

- Visible **"Lock now"** control on every dashboard view.
- On token expiry, Lock now, refresh, `pagehide`, and back-forward-cache restoration (`pageshow` with `persisted=true`): token variable cleared, in-memory API responses cleared, chart objects destroyed, rendered dashboard DOM removed — THEN the lock screen renders. The Back button cannot resurrect data.
- Lock-screen notice, verbatim: *"Shared access credential. Do not forward or reuse. Access expires after 30 minutes, when this tab closes or refreshes, or when you select Lock now."*

### 3.7 Rotation/revocation

Password rotation increments `pwv` → 100% of outstanding tokens instantly invalid. One n8n credential change.

### 3.8 Residual risks (accepted, stated precisely)

- **A stolen bearer token remains usable for no more than 30 minutes. A stolen shared password remains usable until password rotation; the token lifetime does not limit that case** — potentially a full quarter if undetected. Mitigations: failed-login audit, quarterly rotation, rotation-on-suspicion, zero-data shell.
- A compromised Wallace-origin script could capture the password at entry (Moxi hosting constraint; page-shell headers not controllable).
- Shared credential = no per-user identity (platform constraint; quarterly access review).

## 4. Publishing pipeline

### 4.1 Identities and versioning

```text
snapshot_key = source + reporting_period + collector_version + content_hash
edition_key  = reporting_period + edition_version
active_key   = reporting_period -> active edition_version
```

- Reporting period is separate from edition version. Unchanged rerun (same content hashes) → no duplicate. Late-arriving corrected source data → edition version +1; previous versions retained unchanged; exactly one version active per period. Failed or concurrent promotion → active pointer unchanged.
- A failed run may atomically update a separate authenticated **publication_status** record (which powers the delay banner) but may NOT move the active-edition pointer. "Publish nothing" means the pointer; the status record is the only mutable surface on failure.
- Human approval binds to the exact candidate **manifest hash**, not merely run_id. Any post-approval mutation invalidates the approval.
- Idempotency: snapshot_key dedup + run lock with expiry; duplicate/overlapping runs cannot double-publish or double-append.

### 4.2 Manifest

`schema_version, run_id, reporting_period {start,end,timezone: America/New_York}, migration_boundary: 2026-07-22, edition_version, status, required_sources, source_status {state, reason_code, collected_at, max_data_date, last_good_at}, metric_contract_version, content_hashes, approved_by, approved_manifest_hash`.

### 4.3 Validation gates (all must pass before promotion)

```javascript
assert(property.ga4 === "547548268");           // wrong-property fixture must fail
assert(report.timezone === "America/New_York");
assert(allPagesFetched(gsc));                    // no silent truncation
assert(requiredSources.every(s =>
  s.state === "valid" || s.state === "valid_unavailable"));
assert(metrics.every(m =>
  !m.isStale ||
  (m.evidenceClass === "Unavailable" &&
   !m.feedsStatus && !m.feedsComparison && !m.feedsAction)));
assert(noMissingValueWasCoercedToZero());
assert(monthIsClosedAndSourceLagSatisfied());    // GSC windows end >= 3 days back
assert(metricDefinitionsMatchContractVersion());
assert(requiredMetrics.every(m =>
  m.isPresent || m.state === "valid_unavailable"));   // omission caught, not just staleness
assert(atMostOneActiveEditionPerPeriod());     // before promotion (new month has zero)
assert(exactlyOneActiveEditionPerPeriod());    // after promotion
assert(noDuplicateEditionWithSameContentHash());
assert(unauthenticatedFetchContainsNoDashboardData());
assert(archiveAndDataRoutesRequireAuthentication());
assert(renderSmokeTestHasNoBlankRequiredSection());
```

- Sanity review triggers (calibrated from Wallace history; trigger review, not rejection): >40% traffic movement, >20% strategic-page indexing movement, near-zero events.
- Delay banner (from publication_status): *"[Month] edition delayed: [source] collection failed. Last verified edition: [month]."*
- PARTIAL editions: optional sources only, explicit Howard approval, PARTIAL badge, missing source feeds no verdict/comparison/action.
- Page displays **Reporting period** and **Data last verified** timestamps.

## 5. Sources

- **Required (fail-closed):** GSC, GA4 (property 547548268 pinned — a second empty property exists and must never be read), CrUX, direct integrity checks.
- **Optional (PARTIAL-with-approval):** SEMrush, PSI lab — EXCEPT edition #1, where **SEMrush is REQUIRED**: edition #1 does not launch without a valid SEMrush section. Optional status applies only to subsequent monthly runs so a vendor failure cannot freeze the dashboard.
- **Valid-unavailable rule:** a successful API response reporting no/insufficient data (e.g. CrUX insufficient field data) = state `valid_unavailable`, evidence class Unavailable, rendered gray with the label "Valid — insufficient field data"; it does NOT block publication and powers NO status, comparison, or action. Collector errors (HTTP/auth/malformed/schema-change/truncation) = `failed`, fail-closed. Every collector distinguishes the two.
- **SEMrush scrape rules (if no API units):** quarantined adapter; must validate expected labels, row counts, date/database/device context, and value types; a changed page fails loudly, never returns zeros. Raw responses saved privately (retention §10); normalized data + provenance separate; re-rendering an old edition never re-scrapes.
- **SEMrush canonical scope in `config.yaml`:** US database, desktop, existing tracked keyword + competitor set (incl. southerncharm.homes), existing AI prompt set; vendor methodology-change flag displayed when applicable.
- **Direct integrity:** 10 watchdog URLs with browser UA, redirects followed (bot-protective site; `/our-agents` redirects), status/size/expected-phrase.
- **Manual:** `events.yaml` changelog — author + date shown, syntax-validated, future-dated entries rejected.

## 6. Daily watchdog (separate system; summarized on the dashboard)

Ships in this build:
- Existing 10-page integrity checks fixed: browser UA, redirect following, retry after 5–10 min, 2-consecutive-failure rule before alerting, simultaneous all-page failure classified "monitor blocked / status unknown" (separate alert type), real-failure alerting (non-200s, response-size collapse) fully intact.
- **TLS certificate-expiry and DNS-resolution checks daily.**
- **Non-destructive lead-path monitoring daily:** contact form page loads, Zoho script/endpoint responds, required dependencies load, analytics tag present — no synthetic CRM records ever.
- **Unauthorized-auth behavior check:** a periodic unauthenticated probe of the dashboard data API confirming 401-with-no-data (regression guard).
- Dashboard shows monthly incident count, duration, unresolved status; these must reconcile to watchdog records. Alerts remain separate from the monthly edition.

## 7. Metric contract and evidence classes

- Versioned metric contract file; every displayed metric maps to exactly one entry: `metric_id`, plain label, definition, source, window, timezone, filters, unit, freshness, completeness, comparison eligibility, owner (+ formula/version for calculated metrics).
- Evidence classes rendered visibly on every number: **Measured / Estimated / Sampled / Manual / Unavailable**. Unavailable = gray, never zero, never green, never feeds a verdict.
- The full mandatory-label table is **Appendix A** (normative). Key rulings: impressions = "Times Wallace appeared in Google search results"; clicks = "Clicks from unpaid Google Search"; "Average search-result position (blended)" — **edition #1 shows the caveated blended average only; position-distribution bands (1–3/4–10/11–20/21+) begin in Phase 2**; GA4 = "Measured visits in GA4"; forms = **"Recorded website form submissions"** until Zoho reconciliation passes (Phase 2), phone calls explicitly "not measured"; SEMrush traffic = estimate, never mathematically reconciled with GA4; PSI lab never headlined; desktop-LCP = "Known issue under vendor investigation" (no cause attribution).
- Formatting: absolute + relative change (`+820 clicks (+12%)`); no verdict from CTR alone; no up-arrow where up is bad; per-day rates for MoM where month length matters; whole numbers/one decimal unless decision-relevant.

## 8. Comparability and migration

- July 22, 2026 structural break annotated on every affected chart. July 2026 transitional — no MoM grade. No continuous YoY verdict across the boundary; "directional; migration affects comparability" until full comparable post-migration windows exist. No invented adjustment factors.
- Three comparison modes: operational continuity (GSC raw outcomes — domain, GA4 property/tag, GSC property, and event definitions did not change at migration; templates/host/sitemaps did), analytics continuity (GA4 verdicts only where definitions reconciled), page/template diagnostics (mapped URL cohorts).
- GSC 16-month backfill in Phase 2 seeds YoY.

## 9. Page specification

- **Slug / shared API-auth password:** chosen by Howard at build. The slug is not a security control. Page created via REST (proven pattern); noindex meta; verified absent from sitemap; NOT robots.txt-blocked (noindex must be visible to Google).
- **Section order (decision-first):** 1. What needs attention now (confirmed issues, named owner, deadline) → 2. What improved / worsened (comparable metrics only) → 3. Business outcomes → 4. Search discovery (GSC) → 5. Experience & reliability (CWV, incidents, lead-path checks) → 6. Indexing & site integrity (strategic first; IDX/system separately) → 7. Market context (SEMrush/rankings/competitors/AI — all visibly Estimated) → 8. Changelog & evidence (annotations, source status, definitions/glossary).
- **Status vocabulary:** On track / Watch / Act / Unverified — text + icon, never color alone. No overall health score; a status matrix instead (area, status, plain meaning, evidence quality, named owner).
- **Recommended actions:** evidence gates in **Appendix B** (normative). Every executive action requires a **named internal accountable human** (Howard, Kate, or named staff); a vendor ticket (e.g. Moxi ENG-209609) is evidence/tracking alongside the human owner, never the owner itself. Everything not passing the gates = Watch list / Observation. Cross-reference the ad engine only for genuine paid-campaign candidates; neither system inherits the other's scores. Wins obey the same comparability/evidence rules as problems.
- **Readability contract:** verdict sentence first, chart as proof, numbers last; plain caption under every chart stating source/window/scope/caveat; point-of-use glossary; last-year shading on trend charts; mobile-first.
- **Chart/editorial rules:** **Appendix C** (normative).
- **Payload budgets:** shell + current month + 13-month aggregates: initial compressed response <500 KB, JS <250 KB compressed, interactive <2.5 s **measured from successful authentication to interactive dashboard**, no long task >200 ms. Mobile test conditions fixed and reproducible: Chrome DevTools mobile emulation, Moto G Power class device profile, "Fast 3G" network profile, 4× CPU throttling, current stable Chrome — recorded in the test run. Archive months lazy-load from the authenticated API; off-screen charts not initialized until opened.
- **Editions:** last 12 accessible via dropdown (lazy-loaded); editions immutable once promoted; corrections create version +1 with a reason, originals preserved.

## 10. Repository and governance

- Private repo: `/collectors` (gsc, ga4, psi+crux, semrush, integrity), `/build` (render + template), `/publish` (WP REST), `/data` (snapshots, editions, history, events.yaml, publication_status), `config.yaml` (page id, strategic-URL registry, keywords, competitors, SEMrush scope), orchestrator.
- **Strategic URL registry:** versioned allowlist in `config.yaml` — explicit strategic URLs (hand-built landing pages: East Tennessee, Gated Communities, Tellico Village, Sequoyah Hills, single-family, Del Rio, etc.; core company/careers/resources pages; blog) PLUS rules classifying canonical IDX community landing pages as strategic; faceted/paginated/parameterized IDX inventory = system; new unclassified URLs → "unclassified — needs triage" bucket, never silently classified. Every change is a versioned commit.
- GitHub controls: branch protection, force-push/deletion blocked, dedicated automation identity, append-only snapshots, off-repo backup of history + manifests + publication_status, secrets scan in CI. GitHub is version history hardened toward a ledger, not assumed immutable.
- Retention: raw snapshots 24 months; normalized history indefinite; rendered editions 12 online + archived in repo; access/failure/audit logs 12 months.
- Governance: Howard approves editions (approval bound to manifest hash), owns access + rotation, receives failed-run alerts; named per-area owners in the status matrix; quarterly access review.

## 11. Acceptance suite (launch-gating; edition #1 not live until 100% pass)

**Authentication (built first; expiry tests use a fake/injected clock — production TTL stays exactly 1,800 seconds and is never changed for testing):**
1. Missing, altered, expired, or wrong-audience tokens → zero dashboard data or dashboard-derived content (generic 401 JSON error only).
2. Strict token validation: malformed base64url, extra segments, invalid `iat`/`jti`/`pwv`/`v`, oversized inputs, wrong MAC length, future-issued tokens, and lifetimes other than 1,800 seconds all fail with generic 401 and no dashboard content.
3. Rate-limit determinism: 25 simultaneous wrong attempts from one trusted IP → exactly five 401s and twenty 429s; forged forwarding headers cannot change the bucket; state survives restart; a correct password succeeds after window expiry. After five failed attempts, the next request — tested once wrong and once correct — returns 429 before password comparison.
4. Sentinel password + token strings: zero matches across the inventoried log stores (n8n execution storage, instance logs as accessible, audit sink, controlled proxy logs).
5. Rendered data destroyed at expiry / Lock now / refresh / pagehide / bfcache-restore; Back button cannot resurrect it.
6. Password rotation invalidates 100% of outstanding tokens immediately.
7. /auth returns the token once, never echoes the password; data endpoints never echo the token; both `no-store`; no cookies.
8. Cross-origin request from a non-Wallace origin (including the www variant if non-canonical): CORS-blocked AND 401 without a valid token.
9. Audit-log correctness: event type, timestamp, trusted IP, request ID, password version present; `jti` only on issuance; no headers/bodies/credentials retained.
10. Repo + workflow-export scan: no secrets.

**Pipeline and data:**
11. Unauthenticated fetch, REST call, archive request, and page-source inspection reveal no dashboard data.
12. Wrong-property and wrong-date fixtures fail validation.
13. Each required-collector failure → active pointer unchanged, no zero substitution, publication_status + delay banner correct.
14. Atomic publication and correction: corrupt content hashes, simultaneous promotions, expired run locks, and post-approval manifest mutation cannot move the live pointer; failed runs update only publication_status; a legitimate correction creates edition version +1 preserving the original; unchanged rerun creates no duplicate.
15. CrUX insufficient-field-data fixture → publishes with "Valid — insufficient field data" (gray), does NOT block, feeds no status/comparison/action.
16. SEMrush schema-change fixture → loud failure, no zeros; edition #1 specifically requires a valid SEMrush section.
17. Strategic vs IDX/system classified per the versioned registry; unclassified URLs land in the triage bucket; exclusion volume alone drives no status.
18. Migration annotations on every affected comparison; July receives no simplistic grade.
19. Contract enforcement: every rendered metric maps to exactly one contract entry and evidence class; stale/unavailable values never generate statuses or actions; every chart has its required caption and table fallback; every executive action passes every Appendix-B gate field including named human owner.

**Watchdog fixtures:**
20. One transient failure does not alert; two consecutive real failures do; simultaneous blocking becomes "status unknown," not outage; TLS/DNS/Zoho-dependency failures alert correctly; no CRM record is created; incident counts/durations reconcile to the dashboard summary.

**Hosting and presentation:**
21. noindex present, sitemap exclusion verified, no robots blocking, Chart.js locally pinned, no dashboard-controlled third-party calls, canonical CORS behavior including www handling.
22. Page readable with the chart script blocked (verdicts + tables intact).
23. Mobile budgets met under the named §9 test conditions.
24. Form-submission metric uses the weak label; lock-screen notice text exact per §3.6.
25. Human approval recorded against the manifest hash; notification links to the promoted run_id.

## 12. Roadmap (labeled, out of edition #1)

Phase 2: Zoho reconciliation (upgrades the submissions label if passed); GSC position bands + branded/non-branded + query-intent cohorts; 16-month GSC backfill; GBP (main office); run-observability polish. Phase 3: accessibility smoke tests; structured-data validation by template; security-header/integrity checks; multi-office GBP; qualified-lead linkage via privacy-preserving aggregates; peer benchmark bands for proprietary SEMrush scores; multi-region synthetic performance tests.

---

## Appendix A — Mandatory metric display rules (normative)

| Metric | Why it can mislead | Mandatory display rule |
|---|---|---|
| GSC impressions | A search-results appearance, not a person/page view; one search can produce multiple appearances | "Times Wallace appeared in Google search results"; never "reach" or "visitors" |
| GSC clicks | Google-search clicks only; not total visits; won't reconcile exactly to GA4 | "Clicks from unpaid Google Search" + source/window |
| CTR | Mix/ranking shifts move CTR without content change | Show only beside impressions/clicks; no verdict from CTR alone |
| Average position | Impression-weighted, blended across query/geo/device/result type; 6.9 ≠ "we rank #7" | "Average search-result position (blended)"; edition #1 blended-with-caveat only; distribution bands (1–3/4–10/11–20/21+) from Phase 2 |
| Indexed pages | Approximate counts; huge IDX inventories make raw totals ambiguous | Strategic canonical pages separated from IDX/system URLs; trend + reason buckets, no giant total |
| Exclusion buckets | Many exclusions intentional; volumes overlap platform behavior | Classify expected / investigate-sample / confirmed-defect; never red-grade raw volume |
| Sessions/users | Consent/blockers/identity affect counts; "users" ≠ known people | "Measured visits in GA4" / "measured devices or browser identities" + coverage caveat |
| Engagement rate/time | Config-dependent; easy to anthropomorphize | Secondary only; exact rule defined; no "people loved it" |
| Form submissions | Event ≠ accepted/unique/qualified/delivered lead | "Recorded website form submissions" until CRM reconciliation; show exclusions + coverage after |
| CrUX CWV | Rolling 28-day field data; URL data may be absent; origin blends page types | Label field/rolling-28d/URL-or-origin; no data = gray "Valid — insufficient field data", never green |
| PSI lab scores | Single synthetic run is noisy | Never headline the 0–100 score; median of ≥3 controlled runs, diagnostic only |
| Desktop TTFB/LCP | Ticket correlation ≠ proven cause | "Known issue under vendor investigation"; no cause attribution without confirmation |
| SEMrush traffic | Proprietary estimate, not Wallace analytics | "SEMrush estimated monthly organic traffic"; never combined/reconciled mathematically with GA4 |
| SEMrush keywords | Database coverage shifts; low-value rankings exist | "Keywords detected by SEMrush"; branded/non-branded + top-3/10/20 segmentation (Phase 2) |
| Authority Score | Proprietary comparative score, not Google authority | Detail sections only; "SEMrush proprietary comparative score"; no status without peer benchmark |
| Backlink count | Sitewide/duplicate/low-quality links dominate | Prefer referring domains, new/lost domains, relevant domains, suspicious-link review; raw links secondary |
| AI Visibility | Sensitive to vendor prompt set/model/geo/methodology | "SEMrush AI Visibility for its tracked prompt set" + prompt count, engines, location, methodology-change flag; never market-wide AI share |
| Competitor traffic/rank | Modeled, database-dependent, unequal scope | Same locale/device/date benchmark set; directional bands, no fake precision |
| MoM change | Month length/weekday/seasonality differ | Per-day rates where appropriate; YoY/seasonality context; no color on small changes |

Formatting (normative): whole numbers or one decimal unless decision-relevant; absolute AND relative change; neutral thresholds with a gray "not enough evidence" state; never an up-arrow where up is bad; every status shows its rule beside it.

## Appendix B — Recommended-action evidence gates (normative)

An item may appear under **Recommended actions** only with ALL of:
1. specific affected asset/audience;
2. evidence from ≥1 authoritative source AND a corroborating check, or a confirmed defect;
3. expected mechanism (no invented ROI);
4. impact band, effort band, confidence;
5. **named internal accountable human owner** (vendor tickets are tracking evidence, not owners) and deadline/review date;
6. measurable completion and outcome check;
7. duplicate/history check;
8. explicit dependencies and risks.

Anything failing a gate = Watch list or Observation. Example row:

| Status | Action | Evidence | Impact | Effort | Confidence | Owner | Validate by |
|---|---|---|---|---|---|---|---|
| Act | Restore three broken recruiting CTAs | 3/3 repeat checks 404; 412 prior-month entrances | High | Low | High | Kate | All return 200 and CTA event fires |

## Appendix C — Chart and editorial rules (normative)

- Line charts only for real time series; migration/incident annotations shown.
- Grouped bars for current-vs-comparable-prior with few categories.
- 100% stacked bars for bands/channel mix; no pie/donut for close comparisons.
- Bullet charts only with defensible targets; never invent targets for a gauge.
- Indexing: table or small multiples by intentional / investigate / confirmed-defect, strategic and IDX/system separated.
- CWV: pass/needs-improvement/fail proportions + field-data scope; lab diagnostics below.
- Rankings: distribution + strategic-query cohorts, no vanity average alone.
- Every chart: table/downloadable accessible alternative, keyboard navigation, non-color status text, 44px touch targets.
- Every caption states source, window, scope, caveat (e.g. "Unpaid Google Search clicks to wallacetn.com, July 2026. Google Search Console; data through July 31; migration on July 22 affects page-level comparisons.").
- Status vocabulary On track / Watch / Act / Unverified with icon + text; status never color alone.
- Wins require the same comparability and evidence rules as problems.
