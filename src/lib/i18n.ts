/**
 * Phase 6: Scalable Internationalization (i18n) Architecture
 * Supports English (en), Hindi (hi), and Bengali (bn) with typed keys
 * and deterministic parameter interpolation.
 */

export const SUPPORTED_LOCALES = ["en", "hi", "bn"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export interface TranslationDictionary {
  "common.orderflow": string;
  "common.verified": string;
  "common.unverified": string;
  "common.loading": string;
  "common.save": string;
  "common.cancel": string;
  "common.export": string;
  "nav.marketplace": string;
  "nav.developers": string;
  "nav.purchases": string;
  "nav.identity": string;
  "marketplace.title": string;
  "marketplace.subtitle": string;
  "marketplace.searchPlaceholder": string;
  "marketplace.verifiedSellersOnly": string;
  "marketplace.inStockOnly": string;
  "marketplace.noResults": string;
  "marketplace.optInRequired": string;
  "buyer.universalHistory": string;
  "buyer.privacyVisibility": string;
  "buyer.exportData": string;
  "buyer.deactivateAccount": string;
  "seller.profile.title": string;
  "seller.profile.fulfillmentRate": string;
  "seller.profile.disputeRate": string;
  "seller.profile.verifiedBadge": string;
  "review.verifiedBuyer": string;
  "review.writeReview": string;
  "review.submitted": string;
  "developer.portalTitle": string;
  "developer.createApp": string;
  "developer.createApiKey": string;
  "developer.sandboxBadge": string;
  "developer.liveBadge": string;
  "tax.subtotal": string;
  "tax.discount": string;
  "tax.shipping": string;
  "tax.tax": string;
  "tax.fees": string;
  "tax.grandTotal": string;
}

const DICTIONARIES: Record<SupportedLocale, TranslationDictionary> = {
  en: {
    "common.orderflow": "OrderFlow",
    "common.verified": "Verified",
    "common.unverified": "Unverified",
    "common.loading": "Loading...",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.export": "Export",
    "nav.marketplace": "Network Discovery",
    "nav.developers": "Developers",
    "nav.purchases": "Purchases",
    "nav.identity": "Identity",
    "marketplace.title": "OrderFlow Transaction Network",
    "marketplace.subtitle": "Discover verified social sellers and products backed by auditable commerce infrastructure.",
    "marketplace.searchPlaceholder": "Search products, sellers, categories, or brands...",
    "marketplace.verifiedSellersOnly": "Verified sellers only",
    "marketplace.inStockOnly": "In stock only",
    "marketplace.noResults": "No matching discoverable listings found.",
    "marketplace.optInRequired": "Only sellers who explicitly opt into network discovery appear here.",
    "buyer.universalHistory": "Universal Purchases",
    "buyer.privacyVisibility": "Network Visibility",
    "buyer.exportData": "Export My Data",
    "buyer.deactivateAccount": "Deactivate Account",
    "seller.profile.title": "Verified Seller Network Profile",
    "seller.profile.fulfillmentRate": "Fulfillment Rate",
    "seller.profile.disputeRate": "Dispute Rate",
    "seller.profile.verifiedBadge": "Evidence-Backed Verification",
    "review.verifiedBuyer": "Verified Buyer",
    "review.writeReview": "Write a Transaction-Backed Review",
    "review.submitted": "Review published",
    "developer.portalTitle": "OrderFlow Developer Platform",
    "developer.createApp": "Create Application",
    "developer.createApiKey": "Generate Scoped API Key",
    "developer.sandboxBadge": "Sandbox",
    "developer.liveBadge": "Live",
    "tax.subtotal": "Subtotal",
    "tax.discount": "Discount",
    "tax.shipping": "Shipping",
    "tax.tax": "Tax",
    "tax.fees": "Fees",
    "tax.grandTotal": "Grand Total",
  },
  hi: {
    "common.orderflow": "ऑर्डरफ्लो (OrderFlow)",
    "common.verified": "सत्यापित",
    "common.unverified": "असत्यापित",
    "common.loading": "लोड हो रहा है...",
    "common.save": "सहेजें",
    "common.cancel": "रद्द करें",
    "common.export": "निर्यात करें",
    "nav.marketplace": "नेटवर्क डिस्कवरी",
    "nav.developers": "डेवलपर्स",
    "nav.purchases": "खरीदारी",
    "nav.identity": "पहचान",
    "marketplace.title": "ऑर्डरफ्लो ट्रांजेक्शन नेटवर्क",
    "marketplace.subtitle": "ऑडिट योग्य वाणिज्य बुनियादी ढांचे द्वारा समर्थित सत्यापित विक्रेताओं और उत्पादों को खोजें।",
    "marketplace.searchPlaceholder": "उत्पाद, विक्रेता, श्रेणी या ब्रांड खोजें...",
    "marketplace.verifiedSellersOnly": "केवल सत्यापित विक्रेता",
    "marketplace.inStockOnly": "केवल स्टॉक में उपलब्ध",
    "marketplace.noResults": "कोई मिलान सूची नहीं मिली।",
    "marketplace.optInRequired": "केवल वे विक्रेता यहाँ दिखाई देते हैं जिन्होंने नेटवर्क डिस्कवरी चुनी है।",
    "buyer.universalHistory": "सार्वभौमिक खरीदारी इतिहास",
    "buyer.privacyVisibility": "नेटवर्क दृश्यता",
    "buyer.exportData": "मेरा डेटा निर्यात करें",
    "buyer.deactivateAccount": "खाता निष्क्रिय करें",
    "seller.profile.title": "सत्यापित विक्रेता नेटवर्क प्रोफ़ाइल",
    "seller.profile.fulfillmentRate": "पूर्ति दर",
    "seller.profile.disputeRate": "विवाद दर",
    "seller.profile.verifiedBadge": "साक्ष्य-आधारित सत्यापन",
    "review.verifiedBuyer": "सत्यापित खरीदार",
    "review.writeReview": "लेन-देन आधारित समीक्षा लिखें",
    "review.submitted": "समीक्षा प्रकाशित हुई",
    "developer.portalTitle": "ऑर्डरफ्लो डेवलपर प्लेटफ़ॉर्म",
    "developer.createApp": "एप्लिकेशन बनाएं",
    "developer.createApiKey": "स्कोप्ड API कुंजी बनाएं",
    "developer.sandboxBadge": "सैंडबॉक्स",
    "developer.liveBadge": "लाइव",
    "tax.subtotal": "उप-योग",
    "tax.discount": "छूट",
    "tax.shipping": "शिपिंग",
    "tax.tax": "कर",
    "tax.fees": "शुल्क",
    "tax.grandTotal": "कुल योग",
  },
  bn: {
    "common.orderflow": "অর্ডারফ্লো (OrderFlow)",
    "common.verified": "যাচাইকৃত",
    "common.unverified": "অযাচাইকৃত",
    "common.loading": "লোড হচ্ছে...",
    "common.save": "সংরক্ষণ করুন",
    "common.cancel": "বাতিল করুন",
    "common.export": "এক্সপোর্ট করুন",
    "nav.marketplace": "নেটওয়ার্ক ডিসকভারি",
    "nav.developers": "ডেভেলপার",
    "nav.purchases": "কেনাকাটা",
    "nav.identity": "পরিচয়",
    "marketplace.title": "অর্ডারফ্লো ট্রানজেকশন নেটওয়ার্ক",
    "marketplace.subtitle": "নিরীক্ষণযোগ্য বাণিজ্য অবকাঠামো দ্বারা সমর্থিত যাচাইকৃত বিক্রেতা এবং পণ্য খুঁজুন।",
    "marketplace.searchPlaceholder": "পণ্য, বিক্রেতা, বিভাগ বা ব্র্যান্ড অনুসন্ধান করুন...",
    "marketplace.verifiedSellersOnly": "শুধুমাত্র যাচাইকৃত বিক্রেতা",
    "marketplace.inStockOnly": "শুধুমাত্র স্টকে আছে",
    "marketplace.noResults": "কোনো মিলিত তালিকা পাওয়া যায়নি।",
    "marketplace.optInRequired": "শুধুমাত্র নেটওয়ার্ক ডিসকভারি চালু করা বিক্রেতাদের এখানে দেখানো হয়।",
    "buyer.universalHistory": "সর্বজনীন কেনাকাটার ইতিহাস",
    "buyer.privacyVisibility": "নেটওয়ার্ক দৃশ্যমানতা",
    "buyer.exportData": "আমার ডেটা এক্সপোর্ট করুন",
    "buyer.deactivateAccount": "অ্যাকাউন্ট নিষ্ক্রিয় করুন",
    "seller.profile.title": "যাচাইকৃত বিক্রেতা নেটওয়ার্ক প্রোফাইল",
    "seller.profile.fulfillmentRate": "সম্পাদনের হার",
    "seller.profile.disputeRate": "বিরোধের হার",
    "seller.profile.verifiedBadge": "প্রমাণ-ভিত্তিক যাচাইকরণ",
    "review.verifiedBuyer": "যাচাইকৃত ক্রেতা",
    "review.writeReview": "লেনদেন-ভিত্তিক রিভিউ লিখুন",
    "review.submitted": "রিভিউ প্রকাশিত হয়েছে",
    "developer.portalTitle": "অর্ডারফ্লো ডেভেলপার প্ল্যাটফর্ম",
    "developer.createApp": "অ্যাপ্লিকেশন তৈরি করুন",
    "developer.createApiKey": "স্কোপড API কী তৈরি করুন",
    "developer.sandboxBadge": "স্যান্ডবক্স",
    "developer.liveBadge": "লাইভ",
    "tax.subtotal": "উপ-মোট",
    "tax.discount": "ছাড়",
    "tax.shipping": "শিপিং",
    "tax.tax": "ট্যাক্স",
    "tax.fees": "ফি",
    "tax.grandTotal": "সর্বমোট",
  },
};

export function resolveLocale(
  preferredLocale?: string | null,
  acceptLanguageHeader?: string | null
): SupportedLocale {
  const candidates = [
    preferredLocale,
    ...(acceptLanguageHeader
      ? acceptLanguageHeader.split(",").map((part) => part.split(";")[0].trim())
      : []),
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    const base = raw.toLowerCase().split(/[-_]/)[0];
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
      return base as SupportedLocale;
    }
  }
  return "en";
}

export function getDictionary(locale?: string | null): TranslationDictionary {
  return DICTIONARIES[resolveLocale(locale)];
}

export function t(
  key: keyof TranslationDictionary,
  locale?: string | null,
  vars?: Record<string, string | number>
): string {
  const resolved = resolveLocale(locale);
  let text = DICTIONARIES[resolved][key] ?? DICTIONARIES.en[key] ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
    }
  }
  return text;
}
