// Pick the best email candidate per lead (Maps/Apify email, website email) and verify it. 1 verifier credit per check.
// Writes runs/<slug>/verified.json. Only "send" verdicts are uploaded to Instantly.
import { loadEnv, need, parseArgs, runDir, readJson, writeJson, fetchJson, sleep, die, isMain, requireApproval } from "../../../lib/common.ts";
import type { Profile, ScoredLead } from "../../../lib/types.ts";

const ROLE = /^(info|contact|hello|hi|office|admin|enquiries|enquiry|reception|bookings?|sales|support|service|team|mail)@/i;

export function rankEmails(emails: string[], ownerFirst?: string): string[] {
  const score = (e: string) => {
    const local = e.split("@")[0].toLowerCase();
    if (ownerFirst && local.includes(ownerFirst.toLowerCase())) return 3;
    if (!ROLE.test(e) && /^[a-z]{2,}([._-][a-z]{2,})?$/.test(local)) return 2; // looks like a person
    if (ROLE.test(e)) return 1;
    return 0;
  };
  return [...new Set(emails.map((e) => e.toLowerCase()))].sort((a, b) => score(b) - score(a));
}

export type Verdict = { status: string; verdict: "send" | "held" | "bad"; role_account: boolean };

export function interpret(provider: string, raw: any, acceptCatchAll: boolean, email: string): Verdict {
  const status = String(provider === "reoon" ? raw.status : raw.result ?? "unknown").toLowerCase();
  const role = ROLE.test(email) || status === "role_account";
  const good = provider === "reoon" ? ["safe", "valid", "role_account"] : ["ok"];
  if (good.includes(status)) return { status, verdict: "send", role_account: role };
  if (status === "catch_all") return { status, verdict: acceptCatchAll ? "send" : "held", role_account: role };
  if (["unknown", "inbox_full", "error"].includes(status)) return { status, verdict: "held", role_account: role };
  return { status, verdict: "bad", role_account: role };
}

async function check(provider: string, email: string): Promise<any> {
  if (provider === "reoon") {
    const u = new URL("https://emailverifier.reoon.com/api/v1/verify");
    u.searchParams.set("email", email); u.searchParams.set("key", need("REOON_API_KEY")); u.searchParams.set("mode", "power");
    return fetchJson(u.toString(), {}, { label: "reoon" });
  }
  const u = new URL("https://api.millionverifier.com/api/v3/");
  u.searchParams.set("api", need("MILLIONVERIFIER_API_KEY")); u.searchParams.set("email", email); u.searchParams.set("timeout", "20");
  return fetchJson(u.toString(), {}, { label: "millionverifier" });
}

async function main() {
  loadEnv();
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const profile = readJson<Profile>(`${dir}/profile.json`);
  const provider = String(a.provider ?? profile.verification.provider);
  const tiers = String(a.tiers ?? profile.verification.tiers.join(",")).split(",");
  const scored = readJson<ScoredLead[]>(`${dir}/scored.json`).filter((s) => tiers.includes(s.tier));
  const prior = readJson<Record<string, any>>(`${dir}/verified.json`, {});
  const perLead = parseInt(String(a["per-lead"] ?? "2"), 10);
  const todo = scored.filter((s) => !prior[s.place_id] && s.emails.length);
  const worst = todo.reduce((n, s) => n + Math.min(perLead, s.emails.length), 0);
  console.log(`${todo.length} leads in tiers [${tiers}] have emails to verify (worst case ${worst} credits). ${scored.length - todo.length - Object.keys(prior).length} have no email.`);
  if (a.dry) return;
  requireApproval(a, "Email verification");
  const cap = parseInt(String(a["max-credits"] ?? ""), 10);
  if (!cap) die("--max-credits <n> is required");
  let spent = 0;
  for (const s of scored) {
    if (prior[s.place_id]) continue;
    const ranked = rankEmails(s.emails, s.owner?.first_name).slice(0, perLead);
    let result: any = { place_id: s.place_id, email: ranked[0] ?? null, status: "no_email", verdict: "none", role_account: false };
    for (const email of ranked) {
      if (spent >= cap) { writeJson(`${dir}/verified.json`, prior); die(`Credit cap ${cap} reached. Progress saved; re-run to continue.`); }
      spent++;
      let v: Verdict;
      try { v = interpret(provider, await check(provider, email), !!a["accept-catch-all"], email); } catch (e) { v = { status: "error:" + (e as Error).message.slice(0, 60), verdict: "held", role_account: false }; }
      result = { place_id: s.place_id, email, ...v };
      if (v.verdict === "send") break;
      await sleep(100);
    }
    prior[s.place_id] = result;
  }
  writeJson(`${dir}/verified.json`, prior);
  const vals = Object.values(prior) as any[];
  const c = (v: string) => vals.filter((x) => x.verdict === v).length;
  console.log(`Verified with ${spent} credits: send ${c("send")}, held ${c("held")}, bad ${c("bad")}, none ${c("none")}`);
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
