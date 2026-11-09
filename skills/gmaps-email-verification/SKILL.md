---
name: gmaps-email-verification
description: Choose the best email address per scored lead (from the Google/Apify data or the business website) and verify it with MillionVerifier or Reoon before sending. Use as stage 4 of the gmaps outbound pipeline.
---

# Stage 4: verify emails

1. Dry run (free): shows how many leads in the chosen tiers have an email and the worst-case credits:
   `node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-email-verification/scripts/verify.ts --run <slug> --dry`
2. After approval (GATE 2):
   `... verify.ts --run <slug> --approved --max-credits 150`
   By default only high and medium leads are verified (`profile.verification.tiers`). Up to 2 candidates per lead are tried, best first: an address containing the owner's first name, then a personal-looking address, then role addresses (info@, contact@).
3. Verdicts: `send` (valid), `held` (catch-all / unknown / inbox full), `bad`, `none` (no email). Only `send` is uploaded. Small businesses are often catch-all: add `--accept-catch-all` only if the user knowingly accepts that bounce risk.
4. Role addresses (info@, office@) are normal for small businesses and are allowed when they verify; the greeting stays "Hi there," unless an owner name was confirmed.
5. Report send/held/bad/none counts. Tell the user if the send count is too low to be worth a campaign.
