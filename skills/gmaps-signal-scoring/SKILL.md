---
name: gmaps-signal-scoring
description: Read each business's Google reviews, extract verified buying signals with exact quotes, confirm the owner's first name with evidence, and score leads high, medium or low intent. Use as stage 3 of the gmaps outbound pipeline.
---

# Stage 3: extract signals, then score deterministically

You extract. `score.ts` validates and scores. A signal only counts if its quote really appears in the review you cite, so quote exactly.

1. Build batches:
   `node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-signal-scoring/scripts/prepare.ts --run <slug>`
2. Read `runs/<slug>/profile.json` (the signal catalog) and each `runs/<slug>/packets/batch-NNN.json`. For every lead in the batch, write one object. Save the array of a batch as `runs/<slug>/extractions/batch-NNN.json`:
```json
{
  "place_id": "...",
  "signals": [ { "id": "unanswered_calls", "review_idx": 3, "quote": "called three times and just got voicemail" } ],
  "owner": { "first_name": "Mike", "source": "owner_reply", "evidence": "- Mike, Owner" },
  "hook": "A lot of customers praise the work but say it is hard to reach the office by phone.",
  "disqualified": null
}
```
3. Signal rules
   - Use only signal ids from the profile. `quote` is an exact contiguous span (at least 3 words) copied from `reviews[review_idx].text`. `keyword_hints` point at likely reviews but are hints, not proof: read the review and confirm the meaning (sarcasm, negation, "never had to wait" are NOT signals).
   - One signal per review per id. Prefer recent reviews. Do not stretch: if it is not clearly there, skip it.
   - Set `disqualified` to a short reason for: permanently closed, clearly a large chain/franchise, not the client's target type, or a closing/sold signal. Otherwise `null`.
4. Owner rules
   - `source` is one of `owner_reply`, `review_mention`, `website`, `social`, `search`. `evidence` must be copied from the packet (a review, owner reply, `site_about`, `site_people`, social URL, or `owner_search` snippet) and must contain the first name. No evidence means `"owner": null`.
5. Hook rules
   - One sentence, max 160 characters, plain words, no quotation marks, no reviewer names, not copied from any review (5+ shared words is rejected).
   - Describe the pattern the business would recognise as true and useful, framed as an observation about their demand or situation, never as an accusation. Prefer "busy and in demand" framing over "your customers complain".
   - Leave `hook` null for leads with no signals.
6. Score and review:
   `node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-signal-scoring/scripts/score.ts --run <slug>`
   Read the printed counts. Open `scored.csv` and spot-check 3 high and 3 low leads against their reviews. If the `notes` column shows many rejections, fix the extraction files and re-run.
7. Tiers are computed: score = sum of signal weight x recency (90 days full, 12 months 0.6, older 0.3, undated 0.5), capped per signal id. Defaults: high at 6+, medium at 3+. Do not hand-edit `scored.json`. If the user wants different cut-offs, change `scoring` in `profile.json`.
