# What has and has not been tested

Tested (offline, Node 22): `npm test` runs 10 tests covering date parsing, owner-name mining, signal validation (fabricated quotes rejected), tier math, copy lint, verifier verdict mapping, site enrichment parsers, Apify/Serper normalisers and filters, Instantly payload shape, CRM status logic. A synthetic end-to-end run through the symlinked skills (candidates -> packets -> extraction -> score -> lint -> upload --dry -> CSV) also passed, and the approval gates refuse to run without `--approved`.

NOT tested against live services (no keys were available): Serper `/maps` and `/reviews` field names, Apify run/poll/dataset flow and its review/contact field names, MillionVerifier/Reoon responses, Instantly campaign + lead creation (schedule timezone must be one Instantly accepts), HubSpot property creation/upsert/association.

First live run: use 10 places, `--sample` on Serper to confirm review fields, `--dry` on Instantly, and check one lead in each external system before scaling.
