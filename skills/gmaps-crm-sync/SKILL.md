---
name: gmaps-crm-sync
description: Write all scored leads back to the CRM (HubSpot, or a CSV for any CRM) with intent tier, score, signals, owner source and outreach status. Use as the final stage of the gmaps outbound pipeline, after the Instantly upload.
---

# Stage 7: CRM sync

Every scored lead is synced, not only uploaded ones, so nothing is scraped twice: low-intent, no-email, held and disqualified leads are recorded with a status (`queued_instantly_draft`, `low_intent_hold`, `no_email_found`, `email_held`, `email_bad`, `disqualified`).

- CSV (default, no credentials): `node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-crm-sync/scripts/sync.ts --run <slug> --crm csv` writes `runs/<slug>/crm_export.csv`.
- HubSpot: set `HUBSPOT_TOKEN` (private app with companies + contacts read/write and schemas read/write). First time: `... sync.ts --run <slug> --crm hubspot --approved --init-properties` creates the `gmo_*` custom properties. Later: `--crm hubspot --approved`. Companies are matched on `gmo_place_id`, contacts on email, and associated.
- Other CRMs: add an adapter in `sync.ts` (the `Row` type is the contract) or import the CSV.
- Store only business data and the owner's first name with its source. Never store reviewer names or full review text.
