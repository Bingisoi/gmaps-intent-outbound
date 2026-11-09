---
name: gmaps-outbound-autopilot
description: Run the full Google Maps intent-outbound pipeline for a client - scrape local businesses, verify buying signals in their Google reviews, find the owner's first name, score leads high/medium/low, verify emails, write intent-based copy, upload drafts to Instantly and sync the CRM. Use when the user wants to prospect local/SMB businesses from Google Maps.
---

# Google Maps intent outbound: orchestrator

Each stage is its own skill. Run them in order, stop at every GATE, and never skip a gate. All data lives in `runs/<slug>/` inside the repo (gitignored). Pick `<slug>` as `client-segment-city`, lowercase.

All scripts run as: `node --experimental-strip-types --no-warnings ~/.claude/skills/<skill>/scripts/<script>.ts --run <slug> [flags]`

## Stages
| # | Skill | Output | Spends money? |
|---|-------|--------|---------------|
| 0 | this skill | `profile.json` (copy `examples/profile.example.json`, rewrite signals for THIS client's offer) | no |
| 1 | gmaps-scraper | `leads.json` | Serper/Apify credits |
| 2 | gmaps-owner-finder | `owner_candidates.json`, `owner_search.json` | free, then 1 Serper credit per fallback |
| 3 | gmaps-signal-scoring | `extractions/*.json` (you write), `scored.json` | no |
| 4 | gmaps-email-verification | `verified.json` | 1 verifier credit per email |
| 5 | gmaps-copywriting | `copy.json` (you write) | no |
| 6 | gmaps-instantly-upload | draft campaigns + leads | no credits, but writes to Instantly |
| 7 | gmaps-crm-sync | CRM records / `crm_export.csv` | writes to the CRM |

## Stage 0: intake
Ask only what you cannot infer: client website/offer, the business type + city to target, which scraper (Serper or Apify), CRM. Then write `runs/<slug>/profile.json`. The `signals` list is the most important part: each signal must be something a Google reviewer would plausibly say that shows the business needs the client's offer (pain, demand or timing). Weights: 1 to 3 for normal signals, negative for disqualifiers. Show the signals to the user and get a yes before scraping.

## Gates (non-negotiable)
- GATE 1 before scraping: run with `--dry` first, show the credit estimate, get explicit approval, then re-run with `--approved` and a cap (`--max-credits` for Serper, `--max-usd` for Apify). Start small (20 to 40 places).
- GATE 2 before verification and owner search: show counts and worst-case credits, get approval.
- GATE 3 before upload: run `lint.ts` until it passes, run `upload.ts --dry`, show the user one rendered high-tier email, get approval.
- Uploaded campaigns are DRAFTS. Never try to activate a campaign or attach sending accounts. The user presses Start.

## Hard rules
- Tiers come from `score.ts`, not from your judgment. You only extract signals and owners; the script validates them against the real review text.
- Never put a reviewer's name or a verbatim review sentence in an email or CRM note. Paraphrase the pattern, never the person.
- Only say what the data shows. No invented owner names: if there is no evidence, `owner` is `null`, and the email greets "Hi there,".
- Finish with a short report: counts per tier, owner-name hit rate, emails verified, what was uploaded, what was held and why.
