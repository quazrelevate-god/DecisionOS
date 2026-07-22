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
      mywork: {
        eyebrow: "Your day, simplified", title: "My Work", my_tasks: "My Tasks", all_tasks: "All Tasks",
        ai_priority: "AI Priority", ai_priority_on: "AI Priority: On", scoring: "Scoring…",
        view_mywork: "My Work", view_board: "Board", view_workflows: "Workflows", view_leave: "Leave",
        access_restricted: "Access restricted",
        access_restricted_desc: "You don't have access to open this work item. Ask an owner if you think this is a mistake.",
        empty_completed_title: "Nothing completed yet", empty_title: "Nothing here",
        empty_all_hint: "You're all caught up!", empty_cat_hint: "No tasks in this category.",
      },
      inbox: {
        approve: "Approve", reject: "Reject", discuss: "Discuss / who raised this",
        tap_to_speak: "Tap to speak a decision", recording: "Recording…", paused: "Paused", thinking: "Thinking…",
        type_directive: "Type a directive",
        structuring_desc: "DecisionOS is working through it for you — you can keep going. We'll pop up the summary the moment it's ready.",
        decision_approvals: "Decision Approvals", needs_attention: "Needs Your Attention", tasks_activity: "Tasks & Activity",
        filter_all: "All", processing: "processing…", swipe_hint: "Swipe right to view · swipe left to dismiss",
        inbox_zero: "Inbox zero",
        inbox_zero_hint: "Captured voice notes, uploads, invoices, payments and complaints will appear here — classified automatically.",
        change_assignee: "Change assignee", change_to_member: "— Change to a member —", change_to_role: "…or a whole team / role",
        add_task_ph: "What should they do?",
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
      mywork: {
        eyebrow: "आपका दिन, सरल बनाया गया", title: "मेरा काम", my_tasks: "मेरे कार्य", all_tasks: "सभी कार्य",
        ai_priority: "एआई प्राथमिकता", ai_priority_on: "एआई प्राथमिकता: चालू", scoring: "स्कोरिंग…",
        view_mywork: "मेरा काम", view_board: "बोर्ड", view_workflows: "वर्कफ़्लो", view_leave: "अवकाश",
        access_restricted: "पहुँच प्रतिबंधित",
        access_restricted_desc: "आपके पास इस कार्य को खोलने की अनुमति नहीं है। यदि आपको लगता है कि यह गलती है तो किसी मालिक से पूछें।",
        empty_completed_title: "अभी तक कुछ पूरा नहीं हुआ", empty_title: "यहाँ कुछ नहीं है",
        empty_all_hint: "आप पूरी तरह अपडेट हैं!", empty_cat_hint: "इस श्रेणी में कोई कार्य नहीं।",
      },
      inbox: {
        approve: "स्वीकृत करें", reject: "अस्वीकार करें", discuss: "चर्चा करें / किसने उठाया",
        tap_to_speak: "निर्णय बोलने के लिए टैप करें", recording: "रिकॉर्डिंग…", paused: "रुका हुआ", thinking: "सोच रहा है…",
        type_directive: "निर्देश टाइप करें",
        structuring_desc: "DecisionOS इसे आपके लिए संसाधित कर रहा है — आप जारी रख सकते हैं। तैयार होते ही हम सारांश दिखा देंगे।",
        decision_approvals: "निर्णय स्वीकृतियाँ", needs_attention: "आपके ध्यान की आवश्यकता", tasks_activity: "कार्य और गतिविधि",
        filter_all: "सभी", processing: "प्रोसेसिंग…", swipe_hint: "देखने के लिए दाएँ स्वाइप करें · हटाने के लिए बाएँ स्वाइप करें",
        inbox_zero: "इनबॉक्स खाली",
        inbox_zero_hint: "कैप्चर किए गए वॉइस नोट्स, अपलोड, इनवॉइस, भुगतान और शिकायतें यहाँ दिखेंगी — स्वतः वर्गीकृत।",
        change_assignee: "असाइनी बदलें", change_to_member: "— किसी सदस्य को बदलें —", change_to_role: "…या पूरी टीम / भूमिका",
        add_task_ph: "उन्हें क्या करना चाहिए?",
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
      mywork: {
        eyebrow: "உங்கள் நாள், எளிமையாக்கப்பட்டது", title: "எனது வேலை", my_tasks: "எனது பணிகள்", all_tasks: "அனைத்து பணிகள்",
        ai_priority: "AI முன்னுரிமை", ai_priority_on: "AI முன்னுரிமை: இயக்கத்தில்", scoring: "மதிப்பிடுகிறது…",
        view_mywork: "எனது வேலை", view_board: "போர்டு", view_workflows: "பணிப்பாய்வுகள்", view_leave: "விடுப்பு",
        access_restricted: "அணுகல் தடைசெய்யப்பட்டது",
        access_restricted_desc: "இந்த வேலைப் பொருளைத் திறக்க உங்களுக்கு அனுமதி இல்லை. இது தவறு என நினைத்தால் உரிமையாளரிடம் கேளுங்கள்.",
        empty_completed_title: "இதுவரை எதுவும் முடிக்கப்படவில்லை", empty_title: "இங்கே எதுவும் இல்லை",
        empty_all_hint: "அனைத்தும் முடிந்தது!", empty_cat_hint: "இந்த வகையில் பணிகள் இல்லை.",
      },
      inbox: {
        approve: "ஒப்புதல்", reject: "நிராகரி", discuss: "விவாதி / யார் எழுப்பினார்",
        tap_to_speak: "முடிவைப் பேச தட்டவும்", recording: "பதிவு செய்கிறது…", paused: "இடைநிறுத்தப்பட்டது", thinking: "யோசிக்கிறது…",
        type_directive: "வழிமுறையை உள்ளிடவும்",
        structuring_desc: "DecisionOS இதை உங்களுக்காக செயலாக்குகிறது — நீங்கள் தொடரலாம். தயாராகும் போது சுருக்கத்தைக் காட்டுவோம்.",
        decision_approvals: "முடிவு ஒப்புதல்கள்", needs_attention: "உங்கள் கவனம் தேவை", tasks_activity: "பணிகள் & செயல்பாடு",
        filter_all: "அனைத்தும்", processing: "செயலாக்குகிறது…", swipe_hint: "பார்க்க வலம் இழுக்கவும் · நிராகரிக்க இடம் இழுக்கவும்",
        inbox_zero: "இன்பாக்ஸ் காலி",
        inbox_zero_hint: "பதிவு செய்யப்பட்ட குரல் குறிப்புகள், பதிவேற்றங்கள், விலைப்பட்டியல்கள், கட்டணங்கள் மற்றும் புகார்கள் இங்கே தோன்றும் — தானாக வகைப்படுத்தப்படும்.",
        change_assignee: "பொறுப்பாளரை மாற்று", change_to_member: "— உறுப்பினருக்கு மாற்று —", change_to_role: "…அல்லது முழு அணி / பங்கு",
        add_task_ph: "அவர்கள் என்ன செய்ய வேண்டும்?",
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
