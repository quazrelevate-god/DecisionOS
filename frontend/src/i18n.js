import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "ta", label: "தமிழ்" },
];

const resources = {
  en: {
    translation: {
      nav: {
        inbox: "Decision Desk", brief: "CEO Brief", mywork: "My Work", people: "People",
        brain: "Company Brain", finance: "Finance", capture: "Capture", meetings: "Meeting Notes", settings: "Settings",
      },
      bottomnav: { desk: "Desk", brief: "Brief", work: "Work", people: "People", brain: "Brain" },
      header: {
        signed_in_as: "Signed in as", send_digest: "Send Daily Digest", sign_out: "Sign out",
        notifications: "Notifications", view_all: "View all", new: "new", all_caught_up: "You're all caught up.",
      },
      common: { language: "Language", save: "Save", cancel: "Cancel", loading: "Loading…" },
      settings: {
        language_title: "Language",
        language_desc: "Choose the language for your interface. This applies only to you — not your whole company.",
        language_saved: "Language updated",
      },
    },
  },
  hi: {
    translation: {
      nav: {
        inbox: "निर्णय डेस्क", brief: "सीईओ ब्रीफ़", mywork: "मेरा काम", people: "लोग",
        brain: "कंपनी ब्रेन", finance: "वित्त", capture: "कैप्चर", meetings: "मीटिंग नोट्स", settings: "सेटिंग्स",
      },
      bottomnav: { desk: "डेस्क", brief: "ब्रीफ़", work: "काम", people: "लोग", brain: "ब्रेन" },
      header: {
        signed_in_as: "साइन इन:", send_digest: "दैनिक डाइजेस्ट भेजें", sign_out: "साइन आउट",
        notifications: "सूचनाएँ", view_all: "सभी देखें", new: "नई", all_caught_up: "आप पूरी तरह अपडेट हैं।",
      },
      common: { language: "भाषा", save: "सहेजें", cancel: "रद्द करें", loading: "लोड हो रहा है…" },
      settings: {
        language_title: "भाषा",
        language_desc: "अपने इंटरफ़ेस के लिए भाषा चुनें। यह केवल आप पर लागू होती है — पूरी कंपनी पर नहीं।",
        language_saved: "भाषा अपडेट हो गई",
      },
    },
  },
  ta: {
    translation: {
      nav: {
        inbox: "முடிவு மேசை", brief: "தலைமை சுருக்கம்", mywork: "எனது வேலை", people: "நபர்கள்",
        brain: "நிறுவன மூளை", finance: "நிதி", capture: "பதிவு", meetings: "கூட்டக் குறிப்புகள்", settings: "அமைப்புகள்",
      },
      bottomnav: { desk: "மேசை", brief: "சுருக்கம்", work: "வேலை", people: "நபர்கள்", brain: "மூளை" },
      header: {
        signed_in_as: "உள்நுழைந்தவர்", send_digest: "தினசரி சுருக்கம் அனுப்பு", sign_out: "வெளியேறு",
        notifications: "அறிவிப்புகள்", view_all: "அனைத்தையும் காண்க", new: "புதியவை", all_caught_up: "அனைத்தும் முடிந்தது.",
      },
      common: { language: "மொழி", save: "சேமி", cancel: "ரத்து", loading: "ஏற்றுகிறது…" },
      settings: {
        language_title: "மொழி",
        language_desc: "உங்கள் இடைமுகத்திற்கான மொழியைத் தேர்ந்தெடுக்கவும். இது உங்களுக்கு மட்டுமே பொருந்தும் — முழு நிறுவனத்திற்கும் அல்ல.",
        language_saved: "மொழி புதுப்பிக்கப்பட்டது",
      },
    },
  },
};

const stored = (typeof localStorage !== "undefined" && localStorage.getItem("dos_lang")) || "en";

i18n.use(initReactI18next).init({
  resources,
  lng: stored,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setAppLanguage(code) {
  if (!LANGUAGES.some((l) => l.code === code)) return;
  i18n.changeLanguage(code);
  try { localStorage.setItem("dos_lang", code); } catch (e) { /* ignore */ }
}

export default i18n;
