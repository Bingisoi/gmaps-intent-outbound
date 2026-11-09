import test from "node:test";
import assert from "node:assert/strict";
import { toIsoDate, norm, sharesNgram, plausibleFirstName } from "../lib/common.ts";
import { mineCandidates } from "../skills/gmaps-owner-finder/scripts/owner_candidates.ts";
import { scoreLead } from "../skills/gmaps-signal-scoring/scripts/score.ts";
import { lintCopy } from "../skills/gmaps-copywriting/scripts/lint.ts";
import { rankEmails, interpret } from "../skills/gmaps-email-verification/scripts/verify.ts";
import { extractEmails, extractSocial, ownerSentences } from "../skills/gmaps-scraper/scripts/enrich_site.ts";
import { normalizeApify, normalizeSerperReview, applyFilters, estimateSerperCredits } from "../skills/gmaps-scraper/scripts/scrape.ts";
import { campaignPayload, leadPayload } from "../skills/gmaps-instantly-upload/scripts/upload.ts";
import { statusFor } from "../skills/gmaps-crm-sync/scripts/sync.ts";
import { readFileSync } from "node:fs";

const NOW = new Date("2026-11-09T12:00:00Z");
const profile = JSON.parse(readFileSync(new URL("../examples/profile.example.json", import.meta.url), "utf8"));
const mkLead = (reviews: any[], extra: any = {}) => ({
  place_id: "p1", name: "Acme Plumbing", category: "Plumber", address: "1 Main St, Austin, TX", phone: "", website: "https://acme.test",
  maps_url: "", rating: 4.6, review_count: 120, emails: [], social: {}, source: "serper" as const,
  reviews: reviews.map((r, idx) => ({ idx, date: null, rating: 5, owner_reply: "", ...r })), ...extra,
});

test("relative dates", () => {
  assert.equal(toIsoDate("2 weeks ago", NOW)?.slice(0, 10), "2026-10-26");
  assert.equal(toIsoDate("a year ago", NOW)?.slice(0, 4), "2025");
  assert.equal(toIsoDate("Edited 3 months ago", NOW) !== null, true);
  assert.equal(toIsoDate("garbage", NOW), null);
});
test("quote + name helpers", () => {
  assert.equal(norm("Couldn't get through!"), "couldn t get through");
  assert.equal(sharesNgram("they never answer the phone at all", "We said they never answer the phone at all today", 5), true);
  assert.equal(plausibleFirstName("Mike"), true);
  assert.equal(plausibleFirstName("Great"), false);
  assert.equal(plausibleFirstName("Owner"), false);
});
test("owner mining: reply signature, role mention, stoplist", () => {
  const l = mkLead([
    { text: "Mike, the owner, came out himself on a Sunday.", owner_reply: "Thank you for the kind words! We appreciate it. - Mike" },
    { text: "The owner was Great and fast." },
    { text: "Ask for Dave, he is a super tech." },
  ]);
  const c = mineCandidates(l);
  assert.equal(c[0].name, "Mike");
  assert.ok(["owner_reply_signature", "role_mention"].includes(c[0].kind));
  assert.ok(!c.some((x) => x.name === "Great"));
  assert.equal(c.find((x) => x.name === "Dave")?.kind, "weak_mention");
});
test("scoring: verified signals, recency, caps, tiers, rejection of fabricated quotes", () => {
  const l = mkLead([
    { text: "Called three times and just got voicemail every time.", date: "2026-10-20T00:00:00Z" },
    { text: "Never answered the phone, had to call back twice.", date: "2026-10-01T00:00:00Z" },
    { text: "Needed help on a Sunday night and they showed up fast.", date: "2026-09-15T00:00:00Z" },
    { text: "Great work, very clean.", date: "2024-01-01T00:00:00Z" },
  ]);
  const ex = {
    place_id: "p1", disqualified: null,
    signals: [
      { id: "unanswered_calls", review_idx: 0, quote: "just got voicemail every time" },
      { id: "unanswered_calls", review_idx: 1, quote: "Never answered the phone" },
      { id: "after_hours_demand", review_idx: 2, quote: "Needed help on a Sunday night" },
      { id: "slow_response", review_idx: 3, quote: "they took forever to reply" }, // fabricated
      { id: "not_a_signal", review_idx: 0, quote: "Called three times" },
    ],
    owner: { first_name: "Mike", source: "owner_reply" as const, evidence: "- Mike, Owner" }, // not in data
    hook: "Customers value the work but say the phone is hard to catch during busy weeks.",
  };
  const s = scoreLead(l, ex as any, profile, {}, NOW);
  assert.equal(s.signals.length, 3);
  assert.equal(s.score, 8); // 3 + 3 + 2 (all inside 90 days)
  assert.equal(s.tier, "high");
  assert.equal(s.owner, null);
  assert.ok(s.notes.some((n) => n.includes("not found verbatim")));
  assert.ok(s.notes.some((n) => n.includes("unknown id")));
  assert.ok(s.notes.some((n) => n.includes("owner rejected")));
  assert.ok(s.hook);
});
test("scoring: valid owner evidence accepted; hook copying a review rejected; disqualified -> skip", () => {
  const l = mkLead([{ text: "Mike the owner answered at midnight and fixed the leak.", owner_reply: "Glad we could help! - Mike", date: "2026-10-30T00:00:00Z" }]);
  const ok = scoreLead(l, { place_id: "p1", signals: [], disqualified: null, hook: "Mike the owner answered at midnight and fixed", owner: { first_name: "Mike", source: "owner_reply", evidence: "Glad we could help! - Mike" } } as any, profile, {}, NOW);
  assert.equal(ok.owner?.first_name, "Mike");
  assert.equal(ok.hook, null);
  assert.equal(ok.tier, "low");
  const dq = scoreLead(l, { place_id: "p1", signals: [], owner: null, hook: null, disqualified: "large franchise" } as any, profile, {}, NOW);
  assert.equal(dq.tier, "skip");
});
test("verify helpers", () => {
  assert.deepEqual(rankEmails(["info@a.com", "mike@a.com", "x@a.com"], "Mike")[0], "mike@a.com");
  assert.equal(interpret("millionverifier", { result: "ok" }, false, "a@b.com").verdict, "send");
  assert.equal(interpret("millionverifier", { result: "catch_all" }, false, "a@b.com").verdict, "held");
  assert.equal(interpret("millionverifier", { result: "catch_all" }, true, "a@b.com").verdict, "send");
  assert.equal(interpret("millionverifier", { result: "invalid" }, false, "a@b.com").verdict, "bad");
  assert.equal(interpret("reoon", { status: "safe" }, false, "a@b.com").verdict, "send");
});
test("site enrichment helpers", () => {
  const html = `<a href="mailto:Mike@acme.test?subject=hi">x</a> logo@2x.png sentry@abc.ingest.sentry.io <a href="https://www.facebook.com/acmeplumbing">f</a>`;
  assert.deepEqual(extractEmails(html), ["mike@acme.test"]);
  assert.equal(extractSocial(html).facebook, "https://www.facebook.com/acmeplumbing");
  assert.ok(ownerSentences("We are family-owned. Our plumbers are great. Founded by Sam in 1999.").includes("Sam"));
});
test("scrape normalizers, filters, estimate", () => {
  const l = normalizeApify({ placeId: "x", title: "T", reviewsCount: 50, totalScore: 4.5, emails: ["A@b.com"], facebooks: ["https://facebook.com/t"], reviews: [{ text: "ok", stars: 5, publishedAtDate: "2026-10-01T00:00:00Z", responseFromOwnerText: "thx - Ann" }] }, NOW);
  assert.equal(l.emails[0], "a@b.com"); assert.equal(l.social.facebook, "https://facebook.com/t"); assert.equal(l.reviews[0].owner_reply, "thx - Ann");
  assert.equal(normalizeSerperReview({ snippet: "hi", isoDate: "2026-10-01T00:00:00Z", rating: 4, response: { snippet: "yo" } }, NOW).owner_reply, "yo");
  const kept = applyFilters([l, { ...l }, { ...l, place_id: "y", name: "Roto-Rooter" }, { ...l, place_id: "z", review_count: 2 }], profile.filters);
  assert.equal(kept.length, 1);
  assert.equal(estimateSerperCredits(40, 30), 6 + 120);
});
const copy = {
  high: { steps: [{ day: 0, subject: "quick question", body: "{{greeting}}\n\n{{personalization}} We text back every missed call in seconds.\n\nWorth a 10-minute look?\n\nAlex" }, { day: 3, subject: "re: quick question", body: "Hi again, did this reach the right person at {{companyName}}?\n\nAlex" }] },
  medium: { steps: [{ day: 0, subject: "idea for {{companyName}}", body: "{{greeting}}\n\n{{personalization}} Happy to share a short example.\n\nAlex" }] },
};
test("copy lint passes clean copy and flags bad copy", () => {
  const l = mkLead([{ text: "Called three times and just got voicemail every time." }]);
  const good = scoreLead(l, { place_id: "p1", signals: [{ id: "unanswered_calls", review_idx: 0, quote: "just got voicemail every time" }], owner: null, hook: "Phone coverage looks tight when the team is out on jobs.", disqualified: null } as any, profile, {}, NOW);
  assert.deepEqual(lintCopy(copy as any, [l], [{ ...good, tier: "high" }], ["high"]), []);
  const bad = { high: { steps: [{ day: 0, subject: "FREE GUARANTEED RESULTS", body: "Hello {{firstName}} act now!! {{personalization}}" }] } };
  const p = lintCopy(bad as any, [l], [{ ...good, tier: "high" }], ["high"]).join("\n");
  assert.match(p, /unknown variable/); assert.match(p, /spam-trigger/); assert.match(p, /start with \{\{greeting\}\}/);
  const leaky = { high: { steps: [{ day: 0, subject: "hi", body: "{{greeting}}\n\n{{personalization}} Reviews say you called three times and just got voicemail every time.\n\nAlex" }] } };
  assert.match(lintCopy(leaky as any, [l], [{ ...good, tier: "high" }], ["high"]).join("\n"), /copies 6\+ words/);
});
test("instantly payloads and crm status", () => {
  const l = mkLead([{ text: "x y z", date: null }]);
  const s: any = { ...scoreLead(l, undefined, profile, {}, NOW), tier: "high", score: 7, hook: "Busy season ahead.", owner: { first_name: "Mike", source: "owner_reply", evidence: "- Mike" } };
  const cp = campaignPayload("n", copy.high.steps, profile.instantly) as any;
  assert.equal(cp.sequences[0].steps[1].delay, 3); assert.match(cp.sequences[0].steps[0].variants[0].body, /^<p>/);
  const lp = leadPayload("cid", s, "mike@acme.test") as any;
  assert.equal(lp.custom_variables.greeting, "Hi Mike,"); assert.equal(lp.personalization, "Busy season ahead."); assert.equal(lp.campaign, "cid");
  assert.equal(statusFor(s, { verdict: "send" }, "cid"), "queued_instantly_draft");
  assert.equal(statusFor({ ...s, emails: [] }, undefined, undefined), "no_email_found");
  assert.equal(statusFor({ ...s, emails: ["a@b.c"], tier: "low" }, { verdict: "send" }, undefined), "low_intent_hold");
});
