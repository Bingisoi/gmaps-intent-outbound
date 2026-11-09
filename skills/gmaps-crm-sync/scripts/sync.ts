// Write every scored lead (not just the uploaded ones) back to the CRM with tier, score, signals, owner and outreach status.
// Adapters: hubspot (companies + contacts) or csv (import file for any CRM).
import { loadEnv, need, parseArgs, runDir, readJson, die, isMain, requireApproval, toCsv, hostOf, fetchJson, sleep } from "../../../lib/common.ts";
import type { Profile, ScoredLead } from "../../../lib/types.ts";
import { writeFileSync } from "node:fs";

export type Row = { lead: ScoredLead; email: string | null; status: string; campaign: string };

export function statusFor(s: ScoredLead, verdict: any, uploaded: string | undefined): string {
  if (s.tier === "skip") return "disqualified";
  if (uploaded) return "queued_instantly_draft";
  if (!s.emails.length) return "no_email_found";
  if (verdict && verdict.verdict !== "send") return `email_${verdict.verdict}`;
  if (s.tier === "low") return "low_intent_hold";
  return "pending";
}

const PROPS: [string, string, string][] = [
  ["gmo_intent_tier", "Intent tier", "string"], ["gmo_intent_score", "Intent score", "number"], ["gmo_top_signals", "Top signals", "string"],
  ["gmo_owner_source", "Owner source", "string"], ["gmo_status", "Outreach status", "string"], ["gmo_place_id", "Google place id", "string"],
  ["gmo_instantly_campaign", "Instantly campaign id", "string"], ["gmo_maps_url", "Google Maps URL", "string"],
];
const props = (r: Row) => ({
  gmo_intent_tier: r.lead.tier, gmo_intent_score: r.lead.score, gmo_top_signals: [...new Set(r.lead.signals.map((x) => x.id))].join(", "),
  gmo_owner_source: r.lead.owner?.source ?? "", gmo_status: r.status, gmo_place_id: r.lead.place_id,
  gmo_instantly_campaign: r.campaign, gmo_maps_url: r.lead.maps_url,
});

async function hubspot(rows: Row[], init: boolean) {
  const H = { Authorization: `Bearer ${need("HUBSPOT_TOKEN")}`, "Content-Type": "application/json" };
  const B = "https://api.hubapi.com";
  if (init) {
    for (const obj of ["companies", "contacts"]) for (const [name, label, type] of PROPS) {
      try {
        await fetchJson(`${B}/crm/v3/properties/${obj}`, { method: "POST", headers: H, body: JSON.stringify({ name, label, type, fieldType: type === "number" ? "number" : "text", groupName: obj === "companies" ? "companyinformation" : "contactinformation", ...(name === "gmo_place_id" && obj === "companies" ? { hasUniqueValue: true } : {}) }) }, { label: "create property", retries: 0 });
      } catch (e) { if (!/409|already exists/i.test((e as Error).message)) console.warn(`${obj}.${name}: ${(e as Error).message.slice(0, 120)}`); }
    }
    console.log("Custom properties ensured on companies and contacts.");
  }
  let n = 0;
  for (const r of rows) {
    const l = r.lead;
    const companyProps: any = { name: l.name, phone: l.phone, address: l.address, domain: hostOf(l.website), ...props(r) };
    const found = await fetchJson(`${B}/crm/v3/objects/companies/search`, { method: "POST", headers: H, body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "gmo_place_id", operator: "EQ", value: l.place_id }] }], limit: 1 }) }, { label: "company search" });
    let companyId = found.results?.[0]?.id as string | undefined;
    if (companyId) await fetchJson(`${B}/crm/v3/objects/companies/${companyId}`, { method: "PATCH", headers: H, body: JSON.stringify({ properties: companyProps }) }, { label: "company update" });
    else companyId = (await fetchJson(`${B}/crm/v3/objects/companies`, { method: "POST", headers: H, body: JSON.stringify({ properties: companyProps }) }, { label: "company create" })).id;
    if (r.email) {
      const up = await fetchJson(`${B}/crm/v3/objects/contacts/batch/upsert`, { method: "POST", headers: H, body: JSON.stringify({ inputs: [{ idProperty: "email", id: r.email, properties: { email: r.email, firstname: l.owner?.first_name ?? "", company: l.name, phone: l.phone, website: l.website, ...props(r) } }] }) }, { label: "contact upsert" });
      const contactId = up.results?.[0]?.id;
      if (contactId && companyId) await fetchJson(`${B}/crm/v4/objects/contacts/${contactId}/associations/default/companies/${companyId}`, { method: "PUT", headers: H }, { label: "associate" });
    }
    n++; await sleep(120);
  }
  console.log(`HubSpot: synced ${n} companies (and their contacts).`);
}

async function main() {
  loadEnv();
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const profile = readJson<Profile>(`${dir}/profile.json`);
  const scored = readJson<ScoredLead[]>(`${dir}/scored.json`);
  const verified = readJson<Record<string, any>>(`${dir}/verified.json`, {});
  const inst = readJson<{ uploaded: Record<string, string> }>(`${dir}/instantly.json`, { uploaded: {} });
  const rows: Row[] = scored.map((s) => ({ lead: s, email: verified[s.place_id]?.verdict === "send" ? verified[s.place_id].email : null, status: statusFor(s, verified[s.place_id], inst.uploaded[s.place_id]), campaign: inst.uploaded[s.place_id] ?? "" }));
  const crm = String(a.crm ?? profile.crm.type);
  console.log(`Statuses: ` + Object.entries(rows.reduce((m: any, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", "));
  if (crm === "csv" || a.dry) {
    const cols = ["name", "email", "first_name", "phone", "website", "address", "category", "tier", "score", "signals", "owner_source", "status", "campaign", "place_id", "maps_url"];
    writeFileSync(`${dir}/crm_export.csv`, toCsv(rows.map((r) => ({ name: r.lead.name, email: r.email ?? "", first_name: r.lead.owner?.first_name ?? "", phone: r.lead.phone, website: r.lead.website, address: r.lead.address, category: r.lead.category, tier: r.lead.tier, score: r.lead.score, signals: [...new Set(r.lead.signals.map((x) => x.id))].join("|"), owner_source: r.lead.owner?.source ?? "", status: r.status, campaign: r.campaign, place_id: r.lead.place_id, maps_url: r.lead.maps_url })), cols));
    console.log(`Wrote ${dir}/crm_export.csv${a.dry ? " (dry run: nothing sent to a CRM)" : ""}`);
    return;
  }
  if (crm !== "hubspot") die(`Unsupported CRM "${crm}". Use hubspot or csv, or add an adapter in sync.ts.`);
  requireApproval(a, "CRM sync");
  await hubspot(rows, !!a["init-properties"]);
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
