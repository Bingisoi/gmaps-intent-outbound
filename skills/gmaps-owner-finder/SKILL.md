---
name: gmaps-owner-finder
description: Find the first name of the owner or person in charge of a small business from its Google reviews and owner replies, falling back to its website and public search snippets. Use as stage 2 of the gmaps outbound pipeline, before scoring.
---

# Stage 2: owner candidates

Most small businesses have no LinkedIn, so the names come from: owner replies signed by a person, reviews like "Mike, the owner, fixed it", website about/team pages, and public search/social snippets.

1. Mine candidates (free):
   `node --experimental-strip-types --no-warnings ~/.claude/skills/gmaps-owner-finder/scripts/owner_candidates.ts --run <slug>`
2. For leads with no strong candidate, the fallback web search costs 1 Serper credit each. After approval (GATE 2):
   `... owner_search.ts --run <slug> --dry` then `... owner_search.ts --run <slug> --approved --max-queries 40`
3. You decide the final owner in stage 3. Evidence strength, strongest first:
   - `owner_reply_signature`: the owner reply is signed "- Mike" or "My name is Mike, the owner".
   - `role_mention`: a review says "Mike (the owner)" or "manager named Sarah".
   - website `site_person`, or a public snippet that says "owned by / founded by".
   - `weak_mention` ("ask for Dave") is usually a technician or staff member. Use it only if nothing better exists and a role is clear.
4. Rules: first name only is fine. Never pick a name that is just a business-name word, a reviewer, or a customer. A reviewer's own name is never an owner candidate. If two people conflict, prefer the owner-reply signature, otherwise leave `owner: null`.
