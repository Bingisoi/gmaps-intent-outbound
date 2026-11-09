export type Review = { idx: number; date: string | null; rating: number | null; text: string; owner_reply: string };
export type SiteInfo = { emails: string[]; social: Record<string, string>; about_text: string; people: string[] };
export type Lead = {
  place_id: string; name: string; category: string; address: string; phone: string; website: string; maps_url: string;
  rating: number | null; review_count: number | null; emails: string[]; social: Record<string, string>;
  reviews: Review[]; site?: SiteInfo; source: "apify" | "serper";
};
export type SignalDef = { id: string; label: string; description: string; weight: number; keywords?: string[] };
export type Profile = {
  client: { name: string; website: string; sender_first_name: string; offer: string; one_line_pitch: string };
  search: { query: string; location: string; max_places: number; max_reviews: number };
  filters: { min_reviews: number; min_rating: number; require_website_or_email: boolean; exclude_name_patterns: string[] };
  signals: SignalDef[];
  scoring: { high_min: number; medium_min: number; cap_per_signal: number; recency: { d90: number; d365: number; older: number }; undated: number };
  verification: { provider: "millionverifier" | "reoon"; tiers: string[] };
  instantly: { timezone: string; send_from: string; send_to: string; tiers: string[] };
  crm: { type: "hubspot" | "csv" };
};
export type OwnerSource = "owner_reply" | "review_mention" | "website" | "social" | "search";
export type Extraction = {
  place_id: string;
  signals: { id: string; review_idx: number; quote: string }[];
  owner: { first_name: string; source: OwnerSource; evidence: string } | null;
  hook: string | null;
  disqualified: string | null;
};
export type ScoredLead = {
  place_id: string; name: string; website: string; phone: string; category: string; address: string; maps_url: string;
  rating: number | null; review_count: number | null; emails: string[];
  tier: "high" | "medium" | "low" | "skip"; score: number;
  signals: { id: string; review_idx: number; date: string | null; quote: string; points: number }[];
  owner: { first_name: string; source: OwnerSource; evidence: string } | null;
  hook: string | null; disqualified: string | null; notes: string[];
};
