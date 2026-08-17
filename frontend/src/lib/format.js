const SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED ", SGD: "S$", AUD: "A$", CAD: "C$" };

// NOTE (§5.3): this groups digits in the *runtime* locale, so it renders
// ₹480,000 rather than ₹4,80,000 for an Indian MSME. Deliberately left alone
// on this branch — it is shared with desktop, where §1/§9.2 require a
// pixel-identical render, and changing it would move every money figure on
// every desktop screen. Mobile screens migrate to `inr()` below as each page
// slice lands; the desktop fix wants its own PR with a blast-radius note.
export function money(amount, currency = "INR") {
  if (amount == null || amount === "") return "";
  const sym = SYMBOLS[currency] || `${currency} `;
  return sym + Number(amount).toLocaleString();
}

/**
 * Indian-grouped rupees, no decimals. 480000 -> ₹4,80,000
 *
 * §5.3: no component formats currency inline — everything goes through here.
 */
export const inr = (n) =>
  n == null || n === "" || Number.isNaN(Number(n))
    ? ""
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(Number(n));

/**
 * Short form for glanceable contexts. 18423000 -> ₹1.84Cr
 *
 * §5.3: NEVER use this in an approval or reconciliation context — the owner
 * must see the exact figure he is committing to. Use `inr()` there.
 */
export const inrCompact = (n) => {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  return inr(v);
};

export function slugify(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "1 min ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d > 1 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function fullTime(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const CONTACT_TYPE_LABELS = { customer: "Customer", vendor: "Supplier", dealer: "Dealer" };
export const typeLabel = (t) => CONTACT_TYPE_LABELS[t] || (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : "");

export const INDUSTRIES = [
  "Manufacturing",
  "Textile & Apparel",
  "Retail / E-commerce",
  "Wholesale / Distribution",
  "Restaurant / Food & Beverage",
  "Hospitality & Travel",
  "Professional Services",
  "Consulting",
  "Construction",
  "Real Estate",
  "Healthcare",
  "Pharmaceuticals",
  "Beauty & Wellness",
  "Fitness & Sports",
  "Technology / SaaS",
  "Media & Entertainment",
  "Marketing & Advertising",
  "Logistics & Transport",
  "Automotive",
  "Education",
  "Financial Services",
  "Legal Services",
  "Agriculture",
  "Event Management",
  "Import / Export",
  "Non-profit / NGO",
  "Other",
];

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"];

/**
 * NM-7 (NEUMORPHIC-REVAMP §1) — phone numbers get grouped for reading, the
 * same principle as the Indian digit grouping money() already applies:
 * +919820044558 -> +91 98200 44558.
 *
 * Deliberately narrow: only a +91 followed by exactly 10 digits is regrouped,
 * because that is the one shape we can format without guessing. Anything
 * else — landlines with STD codes, foreign numbers, extensions, or text —
 * comes back untouched, since a wrong grouping is worse than none.
 */
export function formatPhone(raw) {
  if (!raw) return raw;
  const s = String(raw).trim();
  const m = s.replace(/[\s-]/g, "").match(/^\+91(\d{10})$/);
  if (!m) return s;
  return `+91 ${m[1].slice(0, 5)} ${m[1].slice(5)}`;
}
