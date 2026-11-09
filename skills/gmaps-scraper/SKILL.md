---
name: gmaps-scraper
description: Scrape local businesses and their newest Google reviews from Google Maps using Serper or Apify, then enrich each business website for public emails, social links and owner hints. Use as stage 1 of the gmaps outbound pipeline.
---

# Stage 1: scrape + enrich

Prereq: `runs/<slug>/profile.json` exists and the user approved the signal list.

1. Estimate cost (free):
   `node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-scraper/scripts/scrape.ts --run <slug> --provider serper --dry`
   Serper costs about 3 credits per results page of places plus about 1 credit per page of reviews. Apify bills per place/review on your plan.
2. After approval, scrape:
   - Serper: `... scrape.ts --run <slug> --provider serper --approved --max-credits 300`
   - Apify: `... scrape.ts --run <slug> --provider apify --approved --max-usd 5`
   Add `--sample` (Serper) the first time to print the review field names and confirm the mapping worked.
3. Enrich websites (free; adds emails, socials, about-page owner sentences):
   `node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-scraper/scripts/enrich_site.ts --run <slug>`
4. Report: leads saved, how many have reviews, how many have an email candidate.

Notes
- Google Maps listings rarely publish an email. Emails come from the business website (Apify `scrapeContacts` and `enrich_site.ts`). If few leads have emails, say so plainly; do not guess addresses.
- Leads with zero reviews cannot be scored and are dropped from later stages.
- Apify sets `scrapeReviewsPersonalData: false`, so reviewer names are not collected.
