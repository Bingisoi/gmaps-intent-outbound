# gmaps-intent-outbound

Claude Code skills that turn Google Maps into an intent-scored outbound list for small local businesses.

```
Google Maps (Serper or Apify) -> website enrich -> owner first name -> Claude verifies buying signals in reviews
 -> deterministic score: HIGH / MEDIUM / LOW -> email verify -> copy per tier -> Instantly (drafts) -> CRM
```

## Install
Needs Node 22.6+ and Claude Code.
```bash
git clone <your-repo-url> gmaps-intent-outbound && cd gmaps-intent-outbound
./install.sh            # symlinks 8 skills (all prefixed gmaps-) into ~/.claude/skills, creates .env
# fill .env, start a NEW Claude Code session, then:
/gmaps-outbound-autopilot
```
Run `npm test` any time (offline, no keys needed).

## Keys (.env)
| Need | Key |
|---|---|
| Scraping (one of) | `SERPER_API_KEY` or `APIFY_TOKEN` |
| Email verify (one of) | `MILLIONVERIFIER_API_KEY` or `REOON_API_KEY` |
| Sending | `INSTANTLY_API_KEY` |
| CRM | `HUBSPOT_TOKEN` (or use the CSV export, no key) |

## How the pieces work
| Skill | What it does |
|---|---|
| `gmaps-outbound-autopilot` | Orchestrator, gates, rules |
| `gmaps-scraper` | Businesses + newest reviews (Serper `/maps` + `/reviews`, or Apify `compass/crawler-google-places`), then crawls each business site for emails, socials and owner sentences |
| `gmaps-owner-finder` | Mines owner/manager first names from owner-reply signatures, "Mike, the owner" style reviews, website about pages; Serper search fallback |
| `gmaps-signal-scoring` | Claude extracts signals with exact quotes + confirms owner + writes a one-line hook; `score.ts` rejects anything not literally in the reviews and sets the tier from weights and recency |
| `gmaps-email-verification` | Best address per lead (owner-name match first), verified, only `send` verdicts move on |
| `gmaps-copywriting` | Sequence per tier, linted against real leads (spam words, length, variables, review-copying) |
| `gmaps-instantly-upload` | One DRAFT campaign per tier, leads with `personalization` + custom variables |
| `gmaps-crm-sync` | Every lead gets a status in the CRM, including low-intent and no-email ones |

## Safety design
- Credits: every spending step has `--dry`, needs `--approved`, and a hard cap (`--max-credits` / `--max-usd` / `--max-queries`).
- Claude cannot invent signals or names: quotes and owner evidence are checked against the stored review text; the tier is computed by code.
- Emails never quote a review or name a reviewer (checked by `lint.ts`).
- Instantly campaigns are drafts with no sending accounts; you press Start.

## Edit this for each client
`runs/<slug>/profile.json` (start from `examples/profile.example.json`): the `signals` list is the product. Write what a reviewer would say that proves the business needs YOUR client's offer, with weights and keywords. Tune `scoring.high_min` / `medium_min` after looking at the first 30 leads.

## Known limits (read before relying on it)
- Google listings rarely show an email. Emails come mostly from business websites, so expect a minority of leads to have one. Apify with `scrapeContacts` finds more than Serper + `enrich_site.ts`.
- Owner names appear in a minority of reviews. Leads with no evidence greet "Hi there," by design.
- Reviews only show what customers wrote; treat tiers as a prioritisation, not proof of buying intent.
- Compliance is on you: Google Maps terms on scraping, GDPR/PECR in the UK/EU (sole traders can count as individuals), CAN-SPAM, and local rules where the target businesses are. Keep reviewer names out of every system.
