import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function die(msg: string): never {
  console.error("ERROR: " + msg);
  process.exit(1);
}

/** True when this file is the entry script (works through ~/.claude/skills symlinks). */
export function isMain(metaUrl: string): boolean {
  try { return realpathSync(process.argv[1]) === fileURLToPath(metaUrl); } catch { return false; }
}

export function loadEnv(file = join(ROOT, ".env")): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, "");
    if (v && !process.env[m[1]]) process.env[m[1]] = v;
  }
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) die(`Missing ${name}. Add it to ${join(ROOT, ".env")}`);
  return v as string;
}

export type Args = Record<string, string | boolean>;
export function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const eq = key.indexOf("=");
    if (eq >= 0) { out[key.slice(0, eq)] = key.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

export function runDir(slug: unknown): string {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) die("--run <slug> required (lowercase letters, digits, - or _)");
  const d = join(ROOT, "runs", slug);
  mkdirSync(d, { recursive: true });
  return d;
}

export function readJson<T = any>(path: string, fallback?: T): T {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    die(`Missing file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch + JSON with retry on 429/5xx. Never logs headers or URLs with keys. */
export async function fetchJson(url: string, init: RequestInit = {}, opts: { retries?: number; label?: string } = {}): Promise<any> {
  const retries = opts.retries ?? 3;
  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init);
    const text = await res.text();
    if (res.ok) { try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; } }
    lastErr = `${opts.label ?? "request"} failed: HTTP ${res.status} ${text.slice(0, 300)}`;
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    break;
  }
  throw new Error(lastErr);
}

/** Lowercase, strip accents/punctuation, collapse spaces. Used to verify quotes really exist. */
export function norm(s: string): string {
  return String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** True if any run of `n` consecutive words of `a` appears in `b`. Guards against verbatim review quotes. */
export function sharesNgram(a: string, b: string, n = 6): boolean {
  const w = norm(a).split(" ").filter(Boolean);
  const hay = " " + norm(b) + " ";
  for (let i = 0; i + n <= w.length; i++) if (hay.includes(" " + w.slice(i, i + n).join(" ") + " ")) return true;
  return false;
}

/** "2 weeks ago", "a year ago", "Edited 3 months ago", ISO strings -> ISO date, or null. */
export function toIsoDate(input: unknown, now = new Date()): string | null {
  if (input == null || input === "") return null;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return isNaN(+d) ? null : d.toISOString(); }
  const t = s.toLowerCase().replace(/^edited\s+/, "");
  if (t === "today" || t === "just now") return now.toISOString();
  if (t === "yesterday") return new Date(+now - 864e5).toISOString();
  const m = t.match(/^(a|an|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/);
  if (m) {
    const n = m[1] === "a" || m[1] === "an" ? 1 : parseInt(m[1], 10);
    const unit: Record<string, number> = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
    return new Date(+now - n * unit[m[2]]).toISOString();
  }
  const d = new Date(s);
  return isNaN(+d) ? null : d.toISOString();
}

const NOT_NAMES = new Set(("the this that these those very great good best always super really absolutely highly not never "
  + "just also only both all any some many most one two three first second last next new old our your their his her its "
  + "and but for with from into over so too here there when where what who which will would could should can may might "
  + "owner manager supervisor founder director boss team staff service customer customers company business store shop office "
  + "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september "
  + "october november december yes no ok okay thanks thank please sorry hello dear hi hey regards sincerely cheers warmly "
  + "google review reviews star stars").split(" "));
export function plausibleFirstName(s: string): boolean {
  return /^[A-Z][a-z'’-]{1,19}$/.test(s) && !NOT_NAMES.has(s.toLowerCase());
}

export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: Record<string, unknown>[], cols: string[]): string {
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

export function requireApproval(args: Args, what: string): void {
  if (!args.approved) die(`${what} spends credits or writes to external systems. Re-run with --approved after the user confirms.`);
}

export function hostOf(url: string): string {
  try { return new URL(/^https?:/.test(url) ? url : "https://" + url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
