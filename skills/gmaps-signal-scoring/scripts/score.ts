// Validate Claude's extractions against the real review text, then compute the intent tier deterministically.
// Claude finds and quotes the signals; this script decides what counts and which tier a lead lands in.
import { parseArgs, runDir, readJson, writeJson, die, isMain, norm, sharesNgram, toCsv } from "../../../lib/common.ts";
import type { Lead, Profile, Extraction, ScoredLead } from "../../../lib/types.ts";
import { readdirSync, writeFileSync } from "node:fs";

const OWNER_SOURCES = new Set(["owner_reply", "review_mention", "website", "social", "search"]);

export function recencyFactor(date: string | null, p: Profile["scoring"], now: Date): number {
  if (!date) return p.undated;
  const days = (+now - +new Date(date)) / 864e5;
  return days <= 90 ? p.recency.d90 : days <= 365 ? p.recency.d365 : p.recency.older;
}

export function scoreLead(lead: Lead, ex: Extraction | undefined, profile: Profile, extras: { search?: any[] } = {}, now = new Date()): ScoredLead {
  const notes: string[] = [];
  const base: ScoredLead = {
    place_id: lead.place_id, name: lead.name, website: lead.website, phone: lead.phone, category: lead.category, address: lead.address,
    maps_url: lead.maps_url, rating: lead.rating, review_count: lead.review_count,
    emails: [...new Set([...lead.emails, ...(lead.site?.emails ?? [])])],
    tier: "low", score: 0, signals: [], owner: null, hook: null, disqualified: null, notes,
  };
  if (!ex) { notes.push("no extraction provided"); return base; }
  if (ex.disqualified) { base.tier = "skip"; base.disqualified = String(ex.disqualified); return base; }

  const defs = new Map(profile.signals.map((s) => [s.id, s]));
  const reviewByIdx = new Map(lead.reviews.map((r) => [r.idx, r]));
  const seen = new Set<string>();
  const perSignal = new Map<string, number[]>();
  for (const s of ex.signals ?? []) {
    const def = defs.get(s.id);
    const rv = reviewByIdx.get(s.review_idx);
    if (!def) { notes.push(`rejected signal: unknown id "${s.id}"`); continue; }
    if (!rv) { notes.push(`rejected ${s.id}: review_idx ${s.review_idx} not found`); continue; }
    const q = norm(s.quote);
    if (q.split(" ").length < 3 || !norm(rv.text).includes(q)) { notes.push(`rejected ${s.id}: quote not found verbatim in review ${s.review_idx}`); continue; }
    const key = `${s.id}#${s.review_idx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const points = +(def.weight * recencyFactor(rv.date, profile.scoring, now)).toFixed(2);
    base.signals.push({ id: s.id, review_idx: s.review_idx, date: rv.date?.slice(0, 10) ?? null, quote: s.quote, points });
    perSignal.set(s.id, [...(perSignal.get(s.id) ?? []), points]);
  }
  let score = 0;
  for (const [id, pts] of perSignal) {
    const sorted = pts.sort((x, y) => Math.abs(y) - Math.abs(x)).slice(0, profile.scoring.cap_per_signal);
    score += sorted.reduce((t, x) => t + x, 0);
    void id;
  }
  base.score = +score.toFixed(2);
  base.tier = score >= profile.scoring.high_min ? "high" : score >= profile.scoring.medium_min ? "medium" : "low";

  // Owner: the evidence must exist in the lead's own material and contain the first name.
  if (ex.owner) {
    const o = ex.owner;
    const corpus = norm([
      ...lead.reviews.flatMap((r) => [r.text, r.owner_reply]), lead.site?.about_text ?? "", ...(lead.site?.people ?? []),
      ...(extras.search ?? []).flatMap((x: any) => [x.title, x.snippet, x.link]), ...Object.values({ ...lead.social, ...(lead.site?.social ?? {}) }),
    ].join(" \n "));
    const ev = norm(o.evidence);
    const nameOk = /^[A-Z][a-z'’-]{1,19}$/.test(o.first_name) && ev.split(" ").includes(norm(o.first_name));
    if (!OWNER_SOURCES.has(o.source)) notes.push(`owner rejected: bad source "${o.source}"`);
    else if (!nameOk) notes.push("owner rejected: first_name not a clean first name or not in evidence");
    else if (ev.split(" ").length < 2 || !corpus.includes(ev)) notes.push("owner rejected: evidence not found in the lead's own data");
    else base.owner = { first_name: o.first_name, source: o.source, evidence: o.evidence.slice(0, 200) };
  }

  // Hook: short, paraphrased, never a verbatim review quote.
  if (ex.hook) {
    const reviewsText = lead.reviews.map((r) => r.text).join(" \n ");
    if (ex.hook.length > 160) notes.push("hook rejected: over 160 chars");
    else if (/["“”]/.test(ex.hook)) notes.push("hook rejected: contains quotation marks");
    else if (sharesNgram(ex.hook, reviewsText, 5)) notes.push("hook rejected: copies 5+ words from a review");
    else base.hook = ex.hook.trim();
  }
  if ((base.tier === "high" || base.tier === "medium") && !base.hook) notes.push("no valid hook: copy will use the generic opener");
  return base;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const profile = readJson<Profile>(`${dir}/profile.json`);
  const leads = readJson<Lead[]>(`${dir}/leads.json`);
  const search = readJson<Record<string, any[]>>(`${dir}/owner_search.json`, {});
  const exDir = `${dir}/extractions`;
  const exs = new Map<string, Extraction>();
  for (const f of readdirSync(exDir).filter((f) => f.endsWith(".json")).sort()) for (const e of readJson<Extraction[]>(`${exDir}/${f}`)) exs.set(e.place_id, e);
  const scored = leads.filter((l) => l.reviews.length).map((l) => scoreLead(l, exs.get(l.place_id), profile, { search: search[l.place_id] }));
  writeJson(`${dir}/scored.json`, scored);
  writeFileSync(`${dir}/scored.csv`, toCsv(scored.map((s) => ({ ...s, signals: s.signals.map((x) => x.id).join("|"), owner: s.owner?.first_name ?? "", owner_source: s.owner?.source ?? "", emails: s.emails.join("|"), notes: s.notes.join(" ; ") })),
    ["name", "tier", "score", "signals", "owner", "owner_source", "hook", "emails", "website", "phone", "address", "disqualified", "notes"]));
  const c = (t: string) => scored.filter((s) => s.tier === t).length;
  console.log(`Scored ${scored.length}: high ${c("high")}, medium ${c("medium")}, low ${c("low")}, skipped ${c("skip")}`);
  console.log(`Owner first name found for ${scored.filter((s) => s.owner).length}/${scored.length}. Missing extractions: ${scored.filter((s) => !exs.has(s.place_id)).length}`);
  console.log(`Rejected items: ${scored.reduce((n, s) => n + s.notes.filter((x) => x.includes("rejected")).length, 0)} (see notes column in scored.csv)`);
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
