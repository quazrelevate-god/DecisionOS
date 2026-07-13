const SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED ", SGD: "S$", AUD: "A$", CAD: "C$" };

export function money(amount, currency = "INR") {
  if (amount == null || amount === "") return "";
  const sym = SYMBOLS[currency] || `${currency} `;
  return sym + Number(amount).toLocaleString();
}

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
