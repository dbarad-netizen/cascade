# Cascade Investor Engine — Prototype

A self-contained, single-file interactive prototype of an investor-growth engine for a late-stage / SPV venture firm. **All data is synthetic and for discussion only.** The 506(b) / Citizen VC eligibility logic shown is illustrative of the product design, not legal advice.

## What's here
- `index.html` — the app UI (HTML/CSS/JS, no build step, no dependencies)
- `api/find-prospects.js` — a Vercel serverless function that pulls **live, public SEC IAPD data** (the Investment Adviser registry): real registered **RIAs and family offices** — the allocator channels that actually invest in pre-IPO SPVs. No API key required. (Richer mandate/AUM/contact data, e.g. FINTRX, is the paid upgrade.)
- `api/competitor-map.js` — a Vercel serverless function that scans a competitor's public SEC **Form D** filings and returns their fund vehicles, **feeder / distribution channels**, **named people** (GPs, officers, signatories, placement agents) and raise sizes. LP names are confidential; this surfaces the channels and people to approach.
- `vercel.json` — minimal static config

## Run locally
Open `index.html` in any browser. The synthetic tabs work offline; the **Prospect Finder** needs the deployed site (it calls `/api/find-prospects`, which only exists on Vercel).

## Deploy (GitHub → Vercel)
1. Push this folder to a new GitHub repo.
2. In Vercel, **Add New → Project → Import** the repo.
3. Framework preset: **Other** (no build command, no output dir — it's static).
4. Deploy. Vercel will redeploy automatically on every push.

## Tabs
- **Overview** — pipeline KPIs and the 506(b) relationship funnel.
- **Investor Pipeline** — investors by sourcing signal and warm path; click any row for the relationship file.
- **Prospect Finder** — *live SEC IAPD data*. Pick a channel (family offices, multi-family offices, RIAs) or type any term + state, run a search, and real registered firms come back scored with their IAPD profile link; "Add to pipeline" drops them in as new prospects.
- **Warm Network** — channel 1: mine the team's relationships and capture existing-investor referrals (synthetic placeholder for now).
- **Competitor Map** — *live SEC data*. Type a rival (e.g. 137 Ventures); it pulls their Form D filings and surfaces the feeder/distribution channels, the named GPs/officers/signatories/placement agents (real outreach names), and raise sizes. Add any name to the pipeline.
- **Deal Matcher** — pick an SPV and fill the allocation; investors without an established relationship are locked (the 506(b) wall).
- **How it works** — Find → Establish → Keep warm → Match & fill.

## Note
Synthetic data except the Prospect Finder, which is live public SEC EDGAR data. It surfaces sourcing signals to begin relationship-building under 506(b); it is not an offer or solicitation, and accreditation is never assumed. Not legal advice.
