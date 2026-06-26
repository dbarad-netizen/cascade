# Cascade Investor Engine — Prototype

A self-contained, single-file interactive prototype of an investor-growth engine for a late-stage / SPV venture firm. **All data is synthetic and for discussion only.** The 506(b) / Citizen VC eligibility logic shown is illustrative of the product design, not legal advice.

## What's here
- `index.html` — the entire app (HTML/CSS/JS, no build step, no dependencies, works offline)
- `vercel.json` — minimal static config

## Run locally
Open `index.html` in any browser.

## Deploy (GitHub → Vercel)
1. Push this folder to a new GitHub repo.
2. In Vercel, **Add New → Project → Import** the repo.
3. Framework preset: **Other** (no build command, no output dir — it's static).
4. Deploy. Vercel will redeploy automatically on every push.

## Tabs
- **Overview** — pipeline KPIs and the 506(b) relationship funnel.
- **Investor Pipeline** — synthetic investors by sourcing signal and warm path; click any row for the relationship file.
- **Deal Matcher** — pick an SPV and fill the allocation; investors without an established relationship are locked (the 506(b) wall).
- **How it works** — Find → Establish → Keep warm → Match & fill.
