---
name: gmaps-copywriting
description: Write cold email sequences matched to each lead's intent tier (high, medium, low) for a Google Maps outbound campaign, and lint them against real leads before upload. Use as stage 5 of the gmaps outbound pipeline.
---

# Stage 5: copy by intent tier

Read `profile.json` (client offer, pitch, sender) and `scored.json` (look at 5 to 8 real hooks per tier). Write `runs/<slug>/copy.json`:
```json
{
  "high":   { "steps": [ { "day": 0, "subject": "quick question", "body": "{{greeting}}\n\n{{personalization}} ...\n\nAlex" }, { "day": 3, "subject": "re: quick question", "body": "..." } ] },
  "medium": { "steps": [ ... ] }
}
```
Variables allowed (nothing else): `{{greeting}}` ("Hi Mike," or "Hi there,"), `{{companyName}}`, `{{personalization}}` (the lead's hook). The first body line must be `{{greeting}}`. Sign with the sender's first name as plain text.

## By tier
- High intent: direct. Open with `{{personalization}}`, connect it to one concrete outcome of the offer, one clear low-friction ask (a 10-minute call or a yes/no question). 2 to 3 steps, days 0, 3, 7.
- Medium intent: softer. Lead with a relevant observation in `{{personalization}}`, offer something useful (a short idea or example) before asking for time. 3 steps, days 0, 4, 9.
- Low intent: not uploaded by default. Write copy only if the user asks for a nurture sequence; otherwise leave `low` out and tell them those leads sit in the CRM as `low_intent_hold`.

## Rules
- First email 110 words max, follow-ups 90. Plain text, no images, at most one link.
- Never quote or closely paraphrase a customer review, and never name a reviewer. The hook already states the pattern; do not add more detail than the hook.
- Never accuse the business of bad service. Talk about demand, timing and outcomes.
- No hype or spam triggers (free, guarantee, act now, urgent, 100%, multiple exclamation marks). No fake "re:" on the first email.
- Write like one person to one person. Short sentences. One idea per email.

## Lint (required)
`node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-copywriting/scripts/lint.ts --run <slug>`
Exit 0 means pass. Fix every problem and re-run. Then show the user one fully rendered high-tier email for approval (GATE 3).
