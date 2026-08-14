# Adwerx Pilot Preflight Checklist (manual — required before ANY money moves)

Complete one copy of this checklist per pilot. Every box must be checked and the
values recorded in `data/registry.json` before the campaign is set live in Adwerx.
Pilot 2 may only launch after Pilot 1's **operational chain** section passes (~3–7 days).

## 1. Fair-housing compliance (broker/compliance sign-off required)
- [ ] No demographic or protected-class targeting (race, color, religion, sex, familial status, national origin, disability) and no obvious proxies for them
- [ ] Copy contains no protected-class implications (e.g. "perfect for young families", "safe neighborhood", "exclusive community")
- [ ] Geographic targeting has a documented legitimate business rationale (record it below)
- [ ] Imagery and copy are inclusive
- [ ] Reviewed and approved by: ______________ (broker/compliance) on ____-__-__

Geo rationale: _______________________________________________

## 2. Branding, destination & creative
- [ ] Destination page is public, loads correctly (desktop + mobile), and is relevant to the ad
- [ ] Ad creative and destination use consistent Wallace branding (logo, colors, name)
- [ ] Ad message matches what the destination actually offers
- [ ] Forms / phone links on the destination were test-fired and the GA4 key events recorded

## 3. Campaign setup in Adwerx
- [ ] Campaign uses the EXACT destination URL from the brief, including all UTM parameters (`utm_id` = WAL ID, `utm_campaign` = slug, `utm_source=adwerx`)
- [ ] Adwerx campaign ID recorded: ______________
- [ ] Adwerx approval status confirmed (network accepted the ad): yes / no
- [ ] Planned/promised impressions per month recorded: ______________
- [ ] Expected frequency recorded: ______________
- [ ] Channel coverage recorded (web only vs web + Facebook/Instagram): ______________
- [ ] If the campaign type uses Facebook/Instagram: the Facebook page connection is verified (disconnected social impressions are lost, not reallocated)
- [ ] Budget matches the registry `plannedBudget`; registry status flipped to `launched` with the real `launchedDate` and `actualBudget`

## 4. Operational chain verification (within 3–7 days of launch — gates Pilot 2)
- [ ] Adwerx shows the campaign live/serving (record date live: ____-__-__)
- [ ] GA4 Realtime/Traffic shows sessions arriving with `utm_source=adwerx` and the correct `sessionManualCampaignId` (WAL ID)
- [ ] First Adwerx report/receipt forwarded to wallacetn1936@gmail.com and the parser produced a VERIFIED entry (not UNVERIFIED SPEND) in `data/spend.json`
- [ ] Reported impressions/spend reconcile with the Adwerx dashboard
- [ ] No registry duplication or budget-state error in the following weekly brief

Sign-off to launch Pilot 2: ______________ on ____-__-__

## Delivery report snapshot schema (`data/spend.json` entries)
`sourceReportId, fileHash, campaign, subject, amount, date, periodStart, periodEnd, asOf,
isCumulative, channelCoverage, plannedImpressions, impressions, clicks, status
(VERIFIED | UNVERIFIED SPEND), parseConfidence, verifiedAt`

Rules: cumulative reports REPLACE the prior cumulative snapshot (never stacked);
overlapping periods are never blindly summed; web-only site reports exclude
Facebook/Instagram and cannot support total-delivery verdicts; UNVERIFIED SPEND
entries are excluded from all verdicts until a human fixes them.
