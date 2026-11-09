// Scrape Google Maps businesses + recent reviews via Apify (compass/crawler-google-places) or Serper (/maps + /reviews).
// Writes runs/<slug>/leads.json. Spends credits only with --approved and a cap.
import { loadEnv, need, parseArgs, runDir, readJson, writeJson, fetchJson, sleep, die, isMain, toIsoDate, requireApproval } from "../../../lib/common.ts";
import type { Lead, Profile, Review } from "../../../lib/types.ts";

const SERPER = "https://google.serper.dev";

function cleanReviews(rows: Omit<Review, "idx">[]): Review[] {
  return rows
    .filter((r) => (r.text && r.text.trim()) || (r.owner_reply && r.owner_reply.trim()))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .map((r, idx) => ({ ...r, idx }));
}

const first = (v: any): string => (Array.isArray(v) ? String(v[0] ?? "") : v ? String(v) : "");

export function normalizeApify(it: any, now = new Date()): Lead {
  const emails: string[] = [];
  for (const e of [].concat(it.emails ?? it.email ?? [])) {
    const s = typeof e === "string" ? e : e?.email;
    if (s) emails.push(String(s).toLowerCase());
  }
  const social: Record<string, string> = {};
  const pairs: [string, any][] = [["facebook", it.facebooks ?? it.facebook], ["instagram", it.instagrams ?? it.instagram],
    ["linkedin", it.linkedIns ?? it.linkedin], ["twitter", it.twitters ?? it.twitter], ["youtube", it.youtubes ?? it.youtube], ["tiktok", it.tiktoks ?? it.tiktok]];
  for (const [k, v] of pairs) if (first(v)) social[k] = first(v);
  const reviews = cleanReviews((it.reviews ?? []).map((r: any) => ({
    date: toIsoDate(r.publishedAtDate ?? r.publishAt, now), rating: r.stars ?? null,
    text: r.text ?? r.textTranslated ?? "", owner_reply: r.responseFromOwnerText ?? "",
  })));
  return {
    place_id: it.placeId ?? it.cid ?? "", name: it.title ?? "", category: it.categoryName ?? (it.categories?.[0] ?? ""),
    address: it.address ?? "", phone: it.phone ?? it.phoneUnformatted ?? "", website: it.website ?? "", maps_url: it.url ?? "",
    rating: it.totalScore ?? null, review_count: it.reviewsCount ?? null,
    emails: [...new Set(emails)], social, reviews, source: "apify",
  };
}

export function normalizeSerperPlace(p: any): Lead {
  return {
    place_id: p.placeId ?? p.cid ?? "", name: p.title ?? "", category: p.type ?? p.category ?? "", address: p.address ?? "",
    phone: p.phoneNumber ?? "", website: p.website ?? "", maps_url: p.cid ? `https://www.google.com/maps?cid=${p.cid}` : "",
    rating: p.rating ?? null, review_count: p.ratingCount ?? null, emails: [], social: {}, reviews: [], source: "serper",
  };
}

export function normalizeSerperReview(r: any, now = new Date()): Omit<Review, "idx"> {
  return {
    date: toIsoDate(r.isoDate ?? r.date, now), rating: r.rating ?? null,
    text: r.snippet ?? r.text ?? "", owner_reply: r.response?.snippet ?? r.response?.text ?? r.ownerResponse?.text ?? "",
  };
}

export function applyFilters(leads: Lead[], f: Profile["filters"]): Lead[] {
  const seen = new Set<string>();
  const pats = (f.exclude_name_patterns ?? []).map((p) => new RegExp(p, "i"));
  return leads.filter((l) => {
    if (!l.place_id || seen.has(l.place_id)) return false;
    seen.add(l.place_id);
    if ((l.review_count ?? 0) < f.min_reviews) return false;
    if (l.rating != null && l.rating < f.min_rating) return false;
    if (pats.some((p) => p.test(l.name))) return false;
    return true;
  });
}

async function viaApify(p: Profile["search"], maxUsd: number | null): Promise<Lead[]> {
  const token = need("APIFY_TOKEN");
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const input = {
    searchStringsArray: [p.query], locationQuery: p.location, maxCrawledPlacesPerSearch: p.max_places, language: "en",
    scrapeContacts: true, maxReviews: p.max_reviews, reviewsSort: "newest", skipClosedPlaces: true, scrapeReviewsPersonalData: false,
  };
  const q = maxUsd ? `?maxTotalChargeUsd=${maxUsd}` : "";
  const run = await fetchJson(`https://api.apify.com/v2/acts/compass~crawler-google-places/runs${q}`, { method: "POST", headers: H, body: JSON.stringify(input) }, { label: "apify start" });
  const id = run.data?.id, ds = run.data?.defaultDatasetId;
  if (!id) die("Apify did not return a run id");
  console.log(`Apify run started: ${id}`);
  for (let i = 0; i < 180; i++) {
    await sleep(10000);
    const st = (await fetchJson(`https://api.apify.com/v2/actor-runs/${id}`, { headers: H }, { label: "apify poll" })).data?.status;
    if (st === "SUCCEEDED") break;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(st)) die(`Apify run ${st}`);
    if (i === 179) die("Apify run still going after 30 min; check the Apify console and re-run with the dataset");
  }
  const items = await fetchJson(`https://api.apify.com/v2/datasets/${ds}/items?clean=true&format=json`, { headers: H }, { label: "apify items" });
  return (items as any[]).map((it) => normalizeApify(it));
}

async function viaSerper(p: Profile["search"], maxCredits: number, sample: boolean): Promise<Lead[]> {
  const key = need("SERPER_API_KEY");
  const H = { "X-API-KEY": key, "Content-Type": "application/json" };
  let spent = 0;
  const spend = (n: number) => { spent += n; if (spent > maxCredits) die(`Credit cap reached (${spent}/${maxCredits}). Stopping.`); };
  const leads: Lead[] = [];
  for (let page = 1; leads.length < p.max_places && page <= 10; page++) {
    spend(3);
    const r = await fetchJson(`${SERPER}/maps`, { method: "POST", headers: H, body: JSON.stringify({ q: `${p.query} in ${p.location}`, page }) }, { label: "serper maps" });
    const places = r.places ?? [];
    if (!places.length) break;
    for (const pl of places) if (leads.length < p.max_places) leads.push(normalizeSerperPlace(pl));
  }
  console.log(`Found ${leads.length} places (${spent} credits so far). Fetching reviews...`);
  for (const l of leads) {
    const rows: Omit<Review, "idx">[] = [];
    let token: string | undefined;
    while (rows.length < p.max_reviews) {
      spend(1);
      const body: any = { placeId: l.place_id, sortBy: "newest" };
      if (token) body.nextPageToken = token;
      let r: any;
      try { r = await fetchJson(`${SERPER}/reviews`, { method: "POST", headers: H, body: JSON.stringify(body) }, { label: "serper reviews" }); }
      catch (e) { console.warn(`reviews failed for ${l.name}: ${(e as Error).message}`); break; }
      if (sample && !rows.length) console.log("Sample review keys:", Object.keys(r.reviews?.[0] ?? {}), "owner reply keys:", Object.keys(r.reviews?.[0]?.response ?? {}));
      for (const rv of r.reviews ?? []) rows.push(normalizeSerperReview(rv));
      token = r.nextPageToken;
      if (!token || !(r.reviews ?? []).length) break;
      await sleep(150);
    }
    l.reviews = cleanReviews(rows.slice(0, p.max_reviews));
  }
  console.log(`Serper credits used: ${spent}`);
  return leads;
}

export function estimateSerperCredits(maxPlaces: number, maxReviews: number): number {
  return Math.ceil(maxPlaces / 20) * 3 + maxPlaces * Math.max(1, Math.ceil(maxReviews / 10));
}

async function main() {
  loadEnv();
  const a = parseArgs(process.argv.slice(2));
  const dir = runDir(a.run);
  const profile = readJson<Profile>(`${dir}/profile.json`);
  const s = { ...profile.search };
  if (typeof a.query === "string") s.query = a.query;
  if (typeof a.location === "string") s.location = a.location;
  if (typeof a["max-places"] === "string") s.max_places = parseInt(a["max-places"], 10);
  if (typeof a["max-reviews"] === "string") s.max_reviews = parseInt(a["max-reviews"], 10);
  const provider = String(a.provider ?? "serper");
  if (!["serper", "apify"].includes(provider)) die("--provider must be serper or apify");
  if (!s.query || !s.location) die("search.query and search.location are required (profile.json or flags)");

  if (provider === "serper") {
    const est = estimateSerperCredits(s.max_places, s.max_reviews);
    console.log(`Estimated Serper cost: ~${est} credits for ${s.max_places} places x ${s.max_reviews} reviews.`);
    if (a.dry) return;
    requireApproval(a, "Scraping");
    const cap = parseInt(String(a["max-credits"] ?? ""), 10);
    if (!cap) die("--max-credits <n> is required");
    if (cap < est) die(`--max-credits ${cap} is below the estimate ${est}. Raise it or lower --max-places/--max-reviews.`);
    const raw = await viaSerper(s, cap, !!a.sample);
    finish(dir, raw, profile);
  } else {
    console.log(`Apify run: ${s.max_places} places, ${s.max_reviews} reviews each. Cost depends on your Apify plan.`);
    if (a.dry) return;
    requireApproval(a, "Scraping");
    const usd = parseFloat(String(a["max-usd"] ?? ""));
    if (!usd) die("--max-usd <n> is required for Apify (sets a hard spend cap on the run)");
    finish(dir, await viaApify(s, usd), profile);
  }
}

function finish(dir: string, raw: Lead[], profile: Profile) {
  const kept = applyFilters(raw, profile.filters).filter((l) => !profile.filters.require_website_or_email || l.website || l.emails.length);
  writeJson(`${dir}/leads.json`, kept);
  const withReviews = kept.filter((l) => l.reviews.length).length;
  console.log(`Saved ${kept.length} leads (${raw.length - kept.length} filtered out, ${withReviews} with reviews) -> ${dir}/leads.json`);
}

if (isMain(import.meta.url)) main().catch((e) => die(e.message));
