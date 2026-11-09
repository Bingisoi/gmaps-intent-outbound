// Build compact "packets" (one per lead) and split them into batches Claude can read and extract signals from.
import { parseArgs, runDir, readJson, writeJson, die, isMain, norm } from "../../../lib/common.ts";
import type { Lead, Profile } from "../../../lib/types.ts";
import { mkdirSync } from "node:fs";

export function buildPacket(l: Lead, profile: Profile, cands: any[], search: any[], maxReviews = 30) {
  const reviews = l.reviews.slice(0, maxReviews).map((r) => ({
    idx: r.idx, date: r.date?.slice(0, 10) ?? null, rating: r.rating, text: r.text.slice(0, 500), owner_reply: r.owner_reply.slice(0, 300),
  }));
  const hints: Record<string, number[]> = {};
  for (const s of profile.signals) {
    const kws = (s.keywords ?? []).map(norm).filter(Boolean);
    const hit = reviews.filter((r) => kws.some((k) => norm(r.text).includes(k))).map((r) => r.idx);
    if (hit.length) hints[s.id] = hit;
  }
  return {
    place_id: l.place_id, name: l.name, category: l.category, rating: l.rating, review_count: l.review_count,
    website: l.website, social: { ...l.social, ...(l.site?.social ?? {}) },
    site_about: l.site?.about_text ?? "", site_people: l.site?.people ?? [],
    owner_candidates: cands, owner_search: search, keyword_hints: hints, reviews,
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const profile = readJson<Profile>(`${dir}/profile.json`);
  const leads = readJson<Lead[]>(`${dir}/leads.json`);
  const cands = readJson<Record<string, any[]>>(`${dir}/owner_candidates.json`, {});
  const search = readJson<Record<string, any[]>>(`${dir}/owner_search.json`, {});
  const size = parseInt(String(a["batch-size"] ?? "8"), 10);
  const packets = leads.filter((l) => l.reviews.length).map((l) => buildPacket(l, profile, cands[l.place_id] ?? [], search[l.place_id] ?? []));
  mkdirSync(`${dir}/packets`, { recursive: true });
  mkdirSync(`${dir}/extractions`, { recursive: true });
  let b = 0;
  for (let i = 0; i < packets.length; i += size) writeJson(`${dir}/packets/batch-${String(++b).padStart(3, "0")}.json`, packets.slice(i, i + size));
  console.log(`${packets.length} packets in ${b} batches -> ${dir}/packets/. Write one extraction file per batch to ${dir}/extractions/batch-NNN.json`);
  console.log(`${leads.length - packets.length} leads have no reviews and were left out (they cannot be scored).`);
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
