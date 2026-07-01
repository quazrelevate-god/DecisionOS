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
