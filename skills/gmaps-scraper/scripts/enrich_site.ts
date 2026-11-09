// Visit each lead's own website (home, contact, about, team) to collect public emails, social links and owner/team hints.
// Free (no API credits). Writes lead.site into runs/<slug>/leads.json.
import { parseArgs, runDir, readJson, writeJson, die, isMain } from "../../../lib/common.ts";
import type { Lead, SiteInfo } from "../../../lib/types.ts";

const JUNK_EMAIL = /(\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.|domain\.com|yourdomain|email\.com$|@2x)/i;
const SOCIAL: [string, RegExp][] = [
  ["facebook", /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|tr\?|plugins|dialog)[^\s"'<>?#]+/i],
  ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore)[^\s"'<>?#]+/i],
  ["linkedin", /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[^\s"'<>?#]+/i],
  ["twitter", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share)[^\s"'<>?#]+/i],
  ["tiktok", /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s"'<>?#]+/i],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:c|channel|user|@)[^\s"'<>?#]*/i],
];

export function extractEmails(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) out.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) out.add(m[0].toLowerCase());
  return [...out].filter((e) => !JUNK_EMAIL.test(e));
}
export function extractSocial(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, re] of SOCIAL) { const m = html.match(re); if (m) out[k] = m[0]; }
  return out;
}
export function htmlToText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;/g, " ").replace(/\s+/g, " ").trim();
}
export function extractPeople(html: string): string[] {
  const people = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: any) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) return n.forEach(walk);
        for (const k of ["founder", "founders", "employee", "member", "owner"]) {
          for (const p of [].concat(n[k] ?? [])) if (p && typeof p === "object" && (p as any).name) people.add(String((p as any).name));
        }
        Object.values(n).forEach(walk);
      };
      walk(JSON.parse(m[1]));
    } catch { /* ignore bad JSON-LD */ }
  }
  return [...people].slice(0, 8);
}
export function ownerSentences(text: string): string {
  const re = /(owner|founder|founded by|family[- ]owned|owned by|general manager|manager|director|president|ceo|proprietor)/i;
  const out: string[] = [];
  for (const s of text.split(/(?<=[.!?])\s+/)) if (re.test(s) && s.length < 300) out.push(s.trim());
  return out.slice(0, 6).join(" ").slice(0, 900);
}

async function get(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; OutboundResearchBot/1.0)" } });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("text/html")) return "";
    return (await r.text()).slice(0, 600000);
  } catch { return ""; } finally { clearTimeout(t); }
}

export async function enrichOne(lead: Lead): Promise<SiteInfo> {
  const base = lead.website.startsWith("http") ? lead.website : "https://" + lead.website;
  let origin = "";
  try { origin = new URL(base).origin; } catch { return { emails: [], social: {}, about_text: "", people: [] }; }
  const paths = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/our-team"];
  const emails = new Set<string>(); const social: Record<string, string> = {}; const people = new Set<string>(); let about = "";
  for (const p of paths) {
    const html = await get(p ? origin + p : base);
    if (!html) continue;
    extractEmails(html).forEach((e) => emails.add(e));
    Object.assign(social, { ...extractSocial(html), ...social });
    extractPeople(html).forEach((n) => people.add(n));
    if (/about|team/.test(p) || p === "") about += " " + ownerSentences(htmlToText(html));
  }
  return { emails: [...emails].slice(0, 6), social, about_text: about.trim().slice(0, 1200), people: [...people] };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const leads = readJson<Lead[]>(`${dir}/leads.json`);
  const todo = leads.filter((l) => l.website && !l.site);
  console.log(`Enriching ${todo.length} websites (free)...`);
  let i = 0;
  const worker = async () => { while (i < todo.length) { const l = todo[i++]; l.site = await enrichOne(l); } };
  await Promise.all(Array.from({ length: 5 }, worker));
  writeJson(`${dir}/leads.json`, leads);
  const withEmail = leads.filter((l) => l.emails.length || l.site?.emails.length).length;
  console.log(`Done. ${withEmail}/${leads.length} leads have at least one email candidate.`);
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
