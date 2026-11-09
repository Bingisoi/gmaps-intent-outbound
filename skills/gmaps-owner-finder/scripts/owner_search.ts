// Fallback owner lookup for leads with no strong candidate: Serper web search for "<business> owner" and public social snippets.
// 1 Serper credit per query. Requires --approved and --max-queries. Writes runs/<slug>/owner_search.json.
import { loadEnv, need, parseArgs, runDir, readJson, writeJson, fetchJson, sleep, die, isMain, requireApproval } from "../../../lib/common.ts";
import type { Lead } from "../../../lib/types.ts";
import type { Candidate } from "./owner_candidates.ts";

async function main() {
  loadEnv();
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const leads = readJson<Lead[]>(`${dir}/leads.json`);
  const cands = readJson<Record<string, Candidate[]>>(`${dir}/owner_candidates.json`);
  const existing = readJson<Record<string, any[]>>(`${dir}/owner_search.json`, {});
  const todo = leads.filter((l) => !existing[l.place_id] && !(cands[l.place_id] ?? []).some((c) => c.kind !== "weak_mention"));
  const max = parseInt(String(a["max-queries"] ?? ""), 10);
  console.log(`${todo.length} leads need the fallback (1 Serper credit each).`);
  if (a.dry) return;
  requireApproval(a, "Owner search");
  if (!max) die("--max-queries <n> is required");
  const key = need("SERPER_API_KEY");
  let n = 0;
  for (const l of todo.slice(0, max)) {
    const city = l.address.split(",").slice(-3, -1).join(",").trim();
    const q = `"${l.name}" ${city} owner OR founder OR "owned by" OR "meet the team"`;
    try {
      const r = await fetchJson("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q, num: 5 }) }, { label: "serper search" });
      existing[l.place_id] = (r.organic ?? []).slice(0, 5).map((o: any) => ({ title: o.title, snippet: o.snippet, link: o.link }));
    } catch (e) { console.warn(`search failed for ${l.name}: ${(e as Error).message}`); }
    n++; await sleep(150);
  }
  writeJson(`${dir}/owner_search.json`, existing);
  console.log(`Ran ${n} searches -> owner_search.json`);
}
if (isMain(import.meta.url)) main().catch((e) => die(e.message));
