// Render copy.json against real leads and flag problems before anything is uploaded.
import { parseArgs, runDir, readJson, die, isMain, sharesNgram } from "../../../lib/common.ts";
import type { Lead, ScoredLead } from "../../../lib/types.ts";

export type Step = { day: number; subject: string; body: string };
export type Copy = Record<string, { steps: Step[] }>;
const ALLOWED = new Set(["greeting", "companyName", "personalization"]);
const BANNED = /\b(free|guarantee[d]?|act now|limited time|risk[- ]free|click here|buy now|urgent|winner|100%|no obligation|once in a lifetime)\b|\$\$\$|!!/i;

export function render(t: string, v: Record<string, string>): string {
  return t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => v[k] ?? `{{${k}}}`);
}
export function vars(s: ScoredLead): Record<string, string> {
  return { greeting: s.owner ? `Hi ${s.owner.first_name},` : "Hi there,", companyName: s.name, personalization: s.hook ?? "" };
}

export function lintCopy(copy: Copy, leads: Lead[], scored: ScoredLead[], tiers: string[]): string[] {
  const problems: string[] = [];
  const byId = new Map(leads.map((l) => [l.place_id, l]));
  for (const tier of tiers) {
    const steps = copy[tier]?.steps;
    if (!steps?.length) { problems.push(`[${tier}] no copy written`); continue; }
    steps.forEach((st, i) => {
      const where = `[${tier} step ${i + 1}]`;
      for (const m of (st.subject + " " + st.body).matchAll(/\{\{\s*(\w+)\s*\}\}/g)) if (!ALLOWED.has(m[1])) problems.push(`${where} unknown variable {{${m[1]}}}`);
      if (i === 0 && !/^\s*\{\{greeting\}\}/.test(st.body)) problems.push(`${where} body must start with {{greeting}}`);
      const words = st.body.replace(/\{\{.*?\}\}/g, "x").split(/\s+/).filter(Boolean).length;
      if (words > (i === 0 ? 110 : 90)) problems.push(`${where} ${words} words (max ${i === 0 ? 110 : 90})`);
      if (st.subject.length > 60 || /^[^a-z]*$/.test(st.subject)) problems.push(`${where} subject too long or all caps`);
      if (BANNED.test(st.subject + " " + st.body)) problems.push(`${where} spam-trigger wording`);
      if ((st.body.match(/!/g) ?? []).length > 1) problems.push(`${where} more than one exclamation mark`);
      if ((st.body.match(/https?:\/\//g) ?? []).length > 1) problems.push(`${where} more than one link`);
      if (tier !== "low" && i === 0 && !st.body.includes("{{personalization}}")) problems.push(`${where} ${tier} copy should use {{personalization}}`);
      if (/\b(\w+)\s+\1\b/i.test(st.body)) problems.push(`${where} repeated word`);
      if (/\ba\s+[aeio]\w+/i.test(st.body.replace(/\{\{.*?\}\}/g, ""))) problems.push(`${where} check a/an usage`);
    });
    for (const s of scored.filter((x) => x.tier === tier).slice(0, 25)) {
      const reviews = (byId.get(s.place_id)?.reviews ?? []).map((r) => r.text).join(" \n ");
      steps.forEach((st, i) => {
        const text = render(st.subject + "\n" + st.body, vars(s));
        if (/\{\{/.test(text)) problems.push(`[${tier} step ${i + 1}] ${s.name}: unresolved variable after render`);
        if (sharesNgram(text, reviews, 6)) problems.push(`[${tier} step ${i + 1}] ${s.name}: email copies 6+ words from a customer review`);
        if (tier !== "low" && i === 0 && !s.hook) problems.push(`[${tier}] ${s.name}: no valid hook, personalization line would be empty`);
      });
    }
  }
  return [...new Set(problems)];
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const profile = readJson<any>(`${dir}/profile.json`);
  const problems = lintCopy(readJson<Copy>(`${dir}/copy.json`), readJson<Lead[]>(`${dir}/leads.json`), readJson<ScoredLead[]>(`${dir}/scored.json`), profile.instantly.tiers);
  if (!problems.length) return void console.log("Copy lint passed.");
  console.log(`${problems.length} problem(s):\n- ` + problems.join("\n- "));
  process.exit(2);
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
