/* PLAY-2 (2026-09-29) · The privacy policy.
 *
 * Play makes this URL a required field on every submission and cross-checks
 * it against the Data Safety form, so it has to be public, live, and TRUE.
 * Every third party named below was read out of this repository rather than
 * assumed — the AI providers from backend/config.py, object storage from
 * integrations/storage.py, OTP from services/otp.py, analytics and fonts from
 * public/index.html. docs/PRIVACY.md is the same inventory in the form the
 * Data Safety questionnaire asks for.
 *
 * 2026-10-08 (Play audit C5) — brought back in line with the code: push
 * (Firebase), email (Gmail SMTP, Resend), search (Voyage, Qdrant), bot checks
 * (Cloudflare Turnstile, hCaptcha), error monitoring (Sentry), the SMS
 * providers by name, payments (Razorpay), and retention per kind of record
 * instead of "a limited period". Google Fonts is now the website only — the
 * app bundles its own typefaces (src/fonts.css). A provider added in code is
 * added here in the same change, or the Data Safety form stops being true.
 *
 * Public route, like /delete-account: somebody deciding whether to install
 * must be able to read it without an account.
 *
 * CONTACT is one constant. It must reach a real mailbox — India's DPDP Act
 * requires a working grievance contact, and a policy with a dead address is
 * worse than no policy because it looks answered.
 */
import { Link } from "react-router-dom";

const CONTACT = "support@decisionos.biz";
/* Play requires the developer named on the store listing to be named in the
   privacy policy (2026-10-10: the Play Console account's developer name). */
const DEVELOPER = "Bhuvanesh Kumar";
const UPDATED = "10 October 2026";

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

const B = ({ children }) => <strong className="text-foreground">{children}</strong>;

export default function Privacy() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12" data-testid="privacy-page">
      <h1 className="font-display text-3xl text-foreground">DecisionOS Privacy Policy</h1>
      <p className="mt-2 text-xs text-muted-foreground">Last updated {UPDATED}</p>

      <p className="mt-6 text-sm text-muted-foreground">
        This privacy policy covers the DecisionOS app for Android and the web, and
        the website at decisionos.biz. DecisionOS is developed and published by{" "}
        {DEVELOPER}, the developer named on its Google Play listing. It is a
        working tool for a small company. The things you put in it — decisions, money, staff, suppliers —
        are the company&rsquo;s business and not ours. This page says exactly what
        we hold, who else ever sees it, how long we keep it, and how to make it go
        away. Questions go to{" "}
        <a href={`mailto:${CONTACT}`} className="font-medium text-foreground underline underline-offset-2">{CONTACT}</a>.
      </p>

      <Section title="What we hold">
        <p>
          <B>Because you signed up:</B> your mobile number, your name, and an email
          address if you give one; for a company, its name and, if you add them,
          its GST number and phone. The mobile number is how you sign in, so we
          cannot run the product without it.
        </p>
        <p>
          <B>Because you use it:</B> whatever you and your team put into the
          workspace — decisions, tasks, approvals, comments, invoices, payments,
          expenses, assets, inventory, contacts of your customers and suppliers
          (names, phone numbers, emails, addresses), staff records, leave,
          attendance, calendar events, notes, files and documents you upload,
          photos of bills and profile photos, and WhatsApp messages sent to your
          workspace&rsquo;s business number if you connect one.
        </p>
        <p>
          <B>When you use the microphone:</B> the audio you record for Dex or during
          signup, and the text it becomes. Recordings are stored with their text in
          your workspace. The app asks for the microphone the first time you use
          it, and never listens otherwise.
        </p>
        <p>
          <B>For notifications:</B> on Android, a push token for your device, so we
          can tell you when work is assigned to you or needs your approval. You can
          turn notifications off in your phone&rsquo;s settings at any time.
        </p>
        <p>
          <B>Automatically:</B> the ordinary technical details of a request — IP
          address, device and browser — in a sign-in session record and a security
          log of sign-ins and administrative actions; and a record of each AI
          request (which feature, how long it took, whether it worked) with
          personal details removed.
        </p>
        <p>
          <B>If you report something:</B> the content you reported, why, and who
          reported it, so we can act on it.
        </p>
      </Section>

      <Section title="How we use it">
        <p>
          Only to run DecisionOS for you: signing you in, showing your team its
          work, sending the notifications and emails the product sends, the AI
          features your workspace has switched on, keeping accounts secure and
          preventing abuse, answering support requests, and billing a paid plan.
        </p>
      </Section>

      <Section title="What we do not do">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><B>No screen recording.</B> Session replay is switched off. Nobody watches your screens.</li>
          <li><B>No advertising.</B> No ad identifiers, no ad networks, no profiles sold or shared for advertising. The Android app requests no advertising ID at all.</li>
          <li><B>We do not sell your data</B>, and we do not use your company&rsquo;s records to train AI models.</li>
        </ul>
      </Section>

      <Section title="AI features">
        <p>
          Dex, the Company Brain, AI task plans, reading bills and the signup
          interview use AI. To answer, the text you type, the audio you record,
          the documents you give it and the workspace records a feature needs are
          sent to an AI provider listed below. Nothing goes until you agree:
          signup asks before the first AI step, and inside a workspace the AI
          features refuse to run until an owner has given AI consent, which can be
          withdrawn in Settings at any time. AI can be wrong — every AI answer has
          a <B>Report</B> button that sends it to us for review.
        </p>
      </Section>

      <Section title="Who else sees any of it">
        <p>
          These are the only outside services involved. Each processes data on our
          behalf, only for the purpose given, and gets only what that purpose needs:
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li><B>Railway</B> (hosting) and <B>MongoDB</B> (database) — where the app runs and the data sits.</li>
          <li><B>Emergent</B> — storage for the files and recordings you upload, and a gateway that routes AI requests.</li>
          <li><B>AI providers: Anthropic, OpenAI, Google (Gemini)</B> — the text, documents and records an AI feature needs. <B>Sarvam</B> (India) and <B>OpenAI</B> — your audio, to turn speech into text, and text Dex speaks aloud. <B>Voyage</B> — text from your documents and notes, turned into search vectors that are stored in <B>Qdrant</B> so the Company Brain can find things.</li>
          <li><B>APM Technologies</B> (India) and <B>Twilio</B> — your mobile number and sign-in code, to send it by SMS.</li>
          <li><B>Google Gmail</B> and <B>Resend</B> — your email address and the message, to send sign-in, verification and notification emails.</li>
          <li><B>Firebase Cloud Messaging</B> (Google) — your device&rsquo;s push token and the notification&rsquo;s text, to deliver push notifications on Android.</li>
          <li><B>WhatsApp</B> (Meta) — only if your workspace connects WhatsApp: the messages sent to and from its business number.</li>
          <li><B>Cloudflare Turnstile</B> or <B>hCaptcha</B> — your IP address and browser details, to check a signup is not a bot.</li>
          <li><B>Sentry</B> — technical details of an error (which part of the app failed), configured not to send personal data.</li>
          <li><B>PostHog</B> (United States) — which screens get opened, plus IP and a device identifier. No screen contents: replay and click-text capture are both off.</li>
          <li><B>Razorpay</B> — when a company buys a paid plan on our website, the payment details needed to take it. We never see card numbers.</li>
          <li><B>Google Fonts</B> — your IP address, when our website&rsquo;s home page loads its typefaces. The app itself does not.</li>
        </ul>
        <p>
          Several of these are outside India, mostly in the United States. Data goes
          there because the service is needed to run the product, under the
          provider&rsquo;s own security and data-protection terms. We may also
          disclose data where the law requires it, or to a buyer of the business,
          who would be bound by this policy.
        </p>
      </Section>

      <Section title="How we keep it safe">
        <p>
          Everything between your device and our servers travels over HTTPS.
          Passwords and sign-in codes are stored only as one-way hashes. Each
          company&rsquo;s data is kept apart from every other company&rsquo;s,
          and people inside a company see only what their role allows. Signing out
          ends a session on the server, not just on your device, and every
          sign-in and administrative action is logged.
        </p>
      </Section>

      <Section title="Cookies and what stays on your device">
        <p>
          A sign-in cookie, so you stay signed in, and a second cookie that
          protects against forged requests. Both are necessary; there are no
          advertising or tracking cookies. Your device also remembers small
          preferences locally — the tab you were on, an unsent draft — which
          never leave it.
        </p>
      </Section>

      <Section title="How long we keep it">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><B>Workspace records and files</B> — until you delete them, or the workspace is deleted. On request we can switch on automatic clean-up of a company&rsquo;s activity logs, notifications and voice notes after a set period.</li>
          <li><B>Sign-in codes</B> — 5 minutes. <B>Email links</B> — up to 3 days. <B>Sign-in sessions</B> — removed automatically when they expire, at most 7 days after they were last renewed.</li>
          <li><B>Push tokens</B> — until you sign out on that device or delete your account.</li>
          <li><B>Security log and AI request records</B> — for as long as the workspace exists, so an account problem can be investigated. When you delete your account, your email, IP address and device details are removed from the security log.</li>
          <li><B>An unfinished signup</B> — kept so you can come back to it; removed when you delete your account, or on request.</li>
          <li><B>Payment records for a paid plan</B> — for as long as tax and accounting law requires.</li>
          <li><B>Reports you send</B> — until we have dealt with them, and for as long as the workspace exists after that.</li>
        </ul>
      </Section>

      <Section title="Deleting your account">
        <p>
          You can do it yourself, at any time, without asking us — in the app
          under <B>Settings → Account → Delete your account</B>, or on the web at{" "}
          <Link to="/delete-account" className="font-medium text-foreground underline underline-offset-2">
            decisionos.biz/delete-account
          </Link>.
        </p>
        <p>
          Deleting your account removes your sign-in, your profile, your push
          tokens, sessions, notifications and sign-in codes. If you are the only
          person in a workspace, the whole workspace goes too — every record and
          every uploaded file. If other people work there, you leave and the work
          you did for the company (tasks, decisions, comments) stays in the
          company&rsquo;s records, because it is the company&rsquo;s. If you own a
          workspace other people are in, you can choose to delete it as well, or
          remove them first. The only things kept afterwards are payment records,
          for as long as the law requires.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Under India&rsquo;s Digital Personal Data Protection Act you can ask
          what we hold about you, ask us to correct it, ask us to erase it, and
          complain if we get it wrong. Most of it you can do yourself inside the
          app. For anything else, write to{" "}
          <a href={`mailto:${CONTACT}`} className="font-medium text-foreground underline underline-offset-2">{CONTACT}</a>{" "}
          from the address or number on the account and we will answer.
        </p>
        <p>
          Some data belongs to the company rather than to you personally — a
          decision you approved is the company&rsquo;s record. Where that is the
          case we will tell you plainly instead of quietly doing nothing.
        </p>
      </Section>

      <Section title="Children">
        <p>DecisionOS is a tool for running a business and is not for anyone under 18.</p>
      </Section>

      <Section title="Changes">
        <p>
          If this changes in a way that matters, we will say so in the app rather
          than quietly changing the date at the top.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          DecisionOS, developed and published by {DEVELOPER} —{" "}
          <a href={`mailto:${CONTACT}`} className="font-medium text-foreground underline underline-offset-2">{CONTACT}</a>.
          See also our{" "}
          <Link to="/terms" className="font-medium text-foreground underline underline-offset-2">Terms of Service</Link>.
        </p>
      </Section>
    </div>
  );
}
