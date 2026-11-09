// Mine likely owner/manager first names from a lead's reviews, owner replies and website. Free, no API.
// Output: runs/<slug>/owner_candidates.json. Claude makes the final call in the scoring step; this only surfaces evidence.
import { parseArgs, runDir, readJson, writeJson, die, isMain, plausibleFirstName } from "../../../lib/common.ts";
import type { Lead } from "../../../lib/types.ts";

export type Candidate = { name: string; kind: "owner_reply_signature" | "role_mention" | "weak_mention" | "site_person"; role: string | null; evidence: string; review_idx: number | null; count: number };

const ROLE = "(?:[Oo]wner|[Cc]o-[Oo]wner|[Gg]eneral [Mm]anager|[Mm]anager|[Ss]upervisor|[Pp]roprietor|[Ff]ounder|[Dd]irector|[Bb]oss)";
const NAME = "([A-Z][a-z]{1,15})";
const RANK: Record<Candidate["kind"], number> = { owner_reply_signature: 4, role_mention: 3, site_person: 3, weak_mention: 1 };

function snip(text: string, index: number, len: number): string {
  return text.slice(Math.max(0, index - 50), Math.min(text.length, index + len + 50)).replace(/\s+/g, " ").trim();
}

export function mineCandidates(lead: Lead): Candidate[] {
  const found: Candidate[] = [];
  const add = (c: Omit<Candidate, "count">) => { if (plausibleFirstName(c.name)) found.push({ ...c, count: 1 }); };

  for (const r of lead.reviews) {
    const t = r.text;
    for (const m of t.matchAll(new RegExp(`\\b${NAME}\\s*(?:,\\s*|\\(\\s*|\\s+is\\s+|\\s+the\\s+|\\s+our\\s+|\\s+their\\s+)(?:the\\s+|our\\s+|their\\s+|an?\\s+)?(${ROLE})\\b`, "g")))
      add({ name: m[1], kind: "role_mention", role: m[2].toLowerCase(), evidence: snip(t, m.index!, m[0].length), review_idx: r.idx });
    for (const m of t.matchAll(new RegExp(`\\b(${ROLE})\\s*(?:,|named|called|is|was|-)?\\s+${NAME}\\b`, "g")))
      add({ name: m[2], kind: "role_mention", role: m[1].toLowerCase(), evidence: snip(t, m.index!, m[0].length), review_idx: r.idx });
    for (const m of t.matchAll(new RegExp(`(?:ask for|asked for|thanks to|thank you to|shout out to|big thanks to)\\s+${NAME}\\b`, "gi"))) {
      const nm = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      if (m[1][0] === m[1][0].toUpperCase()) add({ name: nm, kind: "weak_mention", role: null, evidence: snip(t, m.index!, m[0].length), review_idx: r.idx });
    }
    const reply = r.owner_reply;
    if (reply) {
      const tail = reply.slice(-90);
      const sig = tail.match(new RegExp(`(?:[-–—~]|Regards,?|Best(?: regards)?,?|Sincerely,?|Thanks,?|Thank you,?|Cheers,?|Warmly,?)\\s*${NAME}(?:\\s+[A-Z][a-z]+)?\\s*(?:,?\\s*(${ROLE}))?\\s*$`));
      if (sig) add({ name: sig[1], kind: "owner_reply_signature", role: sig[2]?.toLowerCase() ?? null, evidence: tail.trim(), review_idx: r.idx });
      const intro = reply.match(new RegExp(`(?:[Mm]y name is|I'm|I am)\\s+${NAME}\\b(?:,?\\s*(?:the\\s+)?(${ROLE}))?`));
      if (intro) add({ name: intro[1], kind: "owner_reply_signature", role: intro[2]?.toLowerCase() ?? null, evidence: snip(reply, intro.index!, intro[0].length), review_idx: r.idx });
    }
  }
  for (const p of lead.site?.people ?? []) { const fn = p.trim().split(/\s+/)[0]; add({ name: fn, kind: "site_person", role: null, evidence: `website structured data lists: ${p}`, review_idx: null }); }
  for (const m of (lead.site?.about_text ?? "").matchAll(new RegExp(`(?:[Oo]wned by|[Ff]ounded by|[Ff]ounder|[Oo]wner)[,:]?\\s+${NAME}\\b`, "g")))
    add({ name: m[1], kind: "site_person", role: "owner", evidence: snip(lead.site!.about_text, m.index!, m[0].length), review_idx: null });

  const byName = new Map<string, Candidate>();
  for (const c of found) {
    const prev = byName.get(c.name);
    if (!prev) { byName.set(c.name, c); continue; }
    prev.count += 1;
    if (RANK[c.kind] > RANK[prev.kind]) { prev.kind = c.kind; prev.evidence = c.evidence; prev.review_idx = c.review_idx; }
    if (!prev.role && c.role) prev.role = c.role;
  }
  return [...byName.values()].sort((x, y) => RANK[y.kind] - RANK[x.kind] || y.count - x.count).slice(0, 5);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const leads = readJson<Lead[]>(`${dir}/leads.json`);
  const out: Record<string, Candidate[]> = {};
  let strong = 0;
  for (const l of leads) {
    out[l.place_id] = mineCandidates(l);
    if (out[l.place_id].some((c) => RANK[c.kind] >= 3)) strong++;
  }
  writeJson(`${dir}/owner_candidates.json`, out);
  console.log(`Candidates mined for ${leads.length} leads; ${strong} have a strong candidate (reply signature, role mention or website). ${leads.length - strong} need the search fallback.`);
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
