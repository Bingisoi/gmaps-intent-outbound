// Create one DRAFT Instantly campaign per intent tier and add verified leads with their tier-specific personalization.
// Nothing sends: campaigns have no sending accounts attached and are never activated by this script.
import { loadEnv, need, parseArgs, runDir, readJson, writeJson, fetchJson, sleep, die, isMain, requireApproval } from "../../../lib/common.ts";
import type { Profile, ScoredLead } from "../../../lib/types.ts";
import type { Copy } from "../../gmaps-copywriting/scripts/lint.ts";
import { render, vars } from "../../gmaps-copywriting/scripts/lint.ts";

const API = "https://api.instantly.ai/api/v2";
const toHtml = (t: string) => t.trim().split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
const toInstantlyVars = (t: string) => t; // {{greeting}}, {{companyName}}, {{personalization}} are native/custom variables in Instantly

export function campaignPayload(name: string, steps: Copy[string]["steps"], p: Profile["instantly"]) {
  return {
    name,
    campaign_schedule: { schedules: [{ name: "Weekdays", timing: { from: p.send_from, to: p.send_to }, days: { "1": true, "2": true, "3": true, "4": true, "5": true }, timezone: p.timezone }] },
    sequences: [{ steps: steps.map((s, i) => ({ type: "email", delay: i === 0 ? 0 : s.day - steps[i - 1].day, variants: [{ subject: toInstantlyVars(s.subject), body: toHtml(toInstantlyVars(s.body)) }] })) }],
  };
}

export function leadPayload(campaign: string, s: ScoredLead, email: string) {
  const v = vars(s);
  return {
    campaign, email, first_name: s.owner?.first_name ?? "", company_name: s.name, website: s.website, phone: s.phone,
    personalization: v.personalization, skip_if_in_workspace: true, skip_if_in_campaign: true, verify_leads_on_import: false,
    custom_variables: { greeting: v.greeting, intent_tier: s.tier, intent_score: s.score, gmaps_place_id: s.place_id },
  };
}

async function main() {
  loadEnv();
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const profile = readJson<Profile>(`${dir}/profile.json`);
  const copy = readJson<Copy>(`${dir}/copy.json`);
  const scored = readJson<ScoredLead[]>(`${dir}/scored.json`);
  const verified = readJson<Record<string, any>>(`${dir}/verified.json`);
  const tiers = profile.instantly.tiers;
  const state = readJson<{ campaigns: Record<string, string>; uploaded: Record<string, string> }>(`${dir}/instantly.json`, { campaigns: {}, uploaded: {} });
  const eligible = scored.filter((s) => tiers.includes(s.tier) && verified[s.place_id]?.verdict === "send" && !state.uploaded[s.place_id]);
  console.log(`Eligible to upload: ${eligible.length} (` + tiers.map((t) => `${t}: ${eligible.filter((s) => s.tier === t).length}`).join(", ") + ")");
  const stamp = new Date().toISOString().slice(0, 10);
  const nameOf = (t: string) => `${profile.client.name} | gmaps ${profile.search.query} | ${t} intent | ${stamp}`;
  if (a.dry) {
    for (const t of tiers) console.log(`Campaign "${nameOf(t)}":`, JSON.stringify(campaignPayload(nameOf(t), copy[t].steps, profile.instantly)).slice(0, 600));
    if (eligible[0]) console.log("Sample lead:", JSON.stringify(leadPayload("<campaign-id>", eligible[0], verified[eligible[0].place_id].email)));
    return;
  }
  requireApproval(a, "Instantly upload");
  const H = { Authorization: `Bearer ${need("INSTANTLY_API_KEY")}`, "Content-Type": "application/json" };
  for (const t of tiers) {
    if (!eligible.some((s) => s.tier === t)) continue;
    const given = a[`campaign-${t}`];
    if (typeof given === "string") state.campaigns[t] = given;
    if (!state.campaigns[t]) {
      const c = await fetchJson(`${API}/campaigns`, { method: "POST", headers: H, body: JSON.stringify(campaignPayload(nameOf(t), copy[t].steps, profile.instantly)) }, { label: "create campaign" });
      if (!c.id) die(`Instantly did not return a campaign id for ${t}: ${JSON.stringify(c).slice(0, 200)}`);
      state.campaigns[t] = c.id;
      console.log(`Created draft campaign for ${t}: ${c.id}`);
    }
    writeJson(`${dir}/instantly.json`, state);
  }
  let ok = 0, skipped = 0, failed = 0;
  for (const s of eligible) {
    const email = verified[s.place_id].email as string;
    try {
      const r = await fetchJson(`${API}/leads`, { method: "POST", headers: H, body: JSON.stringify(leadPayload(state.campaigns[s.tier], s, email)) }, { label: "add lead" });
      if (r.id) { state.uploaded[s.place_id] = state.campaigns[s.tier]; ok++; } else { state.uploaded[s.place_id] = state.campaigns[s.tier]; skipped++; }
    } catch (e) { failed++; console.warn(`${s.name}: ${(e as Error).message.slice(0, 160)}`); }
    writeJson(`${dir}/instantly.json`, state);
    await sleep(200);
  }
  console.log(`Uploaded ${ok}, skipped/duplicates ${skipped}, failed ${failed}. Campaigns are DRAFTS: attach sending accounts and press Start in Instantly yourself.`);
  void render;
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
