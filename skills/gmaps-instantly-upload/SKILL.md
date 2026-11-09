---
name: gmaps-instantly-upload
description: Create draft Instantly campaigns per intent tier and add verified leads with tier-specific copy and personalization. Use as stage 6 of the gmaps outbound pipeline, after copy lint passes.
---

# Stage 6: upload to Instantly (drafts only)

Prereqs: `verified.json`, `copy.json`, lint passed, user approved the rendered sample (GATE 3).

1. Preview payloads (no network):
   `node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-instantly-upload/scripts/upload.ts --run <slug> --dry`
2. Upload:
   `... upload.ts --run <slug> --approved`
   Creates one campaign per tier in `profile.instantly.tiers` (named client | query | tier | date), then adds each lead with `personalization` = hook and custom variables `greeting`, `intent_tier`, `intent_score`, `gmaps_place_id`. Use `--campaign-high <id>` / `--campaign-medium <id>` to add to existing campaigns instead. Re-running is safe: uploaded leads are tracked in `instantly.json`.
3. Campaigns stay in draft with no sending accounts. Tell the user to open Instantly, check the preview of the first email, attach warmed-up sending accounts, and press Start.
4. If campaign creation returns a 400, the usual cause is the timezone value in `profile.instantly.timezone` (Instantly accepts a fixed list) or the schedule format. Show the error to the user rather than retrying blindly.
