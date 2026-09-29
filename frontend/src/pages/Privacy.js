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
 * Public route, like /delete-account: somebody deciding whether to install
 * must be able to read it without an account.
 *
 * CONTACT is one constant. It must reach a real mailbox — India's DPDP Act
 * requires a working grievance contact, and a policy with a dead address is
 * worse than no policy because it looks answered.
 */
import { Link } from "react-router-dom";

const CONTACT = "support@decisionos.biz";
const UPDATED = "29 September 2026";

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12" data-testid="privacy-page">
      <h1 className="font-display text-3xl text-foreground">Privacy at DecisionOS</h1>
      <p className="mt-2 text-xs text-muted-foreground">Last updated {UPDATED}</p>

      <p className="mt-6 text-sm text-muted-foreground">
        DecisionOS is a working tool for a small company. The things you put in
        it — decisions, money, staff, suppliers — are the company&rsquo;s
        business and not ours. This page says exactly what we hold, who else
        ever sees it, and how to make it all go away.
      </p>

      <Section title="What we hold">
        <p>
          <strong className="text-foreground">Because you signed up:</strong> your
          mobile number, your name, and an email address if you give one. The
          mobile number is how you sign in, so we cannot run the product without
          it.
        </p>
        <p>
          <strong className="text-foreground">Because you use it:</strong> whatever
          you and your team put into the workspace — decisions, tasks,
          approvals, invoices, payments, expenses, contacts, staff records,
          leave, attendance, notes, and files you upload.
        </p>
        <p>
          <strong className="text-foreground">When you use the microphone:</strong> the
          audio you record for Dex, and the text it becomes. The app asks for
          the microphone the first time you use it, and never listens otherwise.
        </p>
        <p>
          <strong className="text-foreground">Automatically:</strong> which screens
          get opened, and the ordinary technical details of a request — IP
          address, device and browser. We keep a security log of sign-ins and
          administrative actions.
        </p>
      </Section>

      <Section title="What we do not do">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong className="text-foreground">No screen recording.</strong> Session replay is switched off in the app itself. Nobody watches your screens.</li>
          <li><strong className="text-foreground">No advertising.</strong> No ad identifiers, no ad networks, no profiles sold or shared for advertising. The Android app requests no advertising ID at all.</li>
          <li><strong className="text-foreground">We do not sell your data</strong>, and we do not use your company&rsquo;s records to train AI models.</li>
        </ul>
      </Section>

      <Section title="Who else sees any of it">
        <p>These are the only outside services involved, and what each one gets:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li><strong className="text-foreground">Railway</strong> (hosting) and <strong className="text-foreground">MongoDB</strong> — where the app runs and the data sits.</li>
          <li><strong className="text-foreground">An SMS provider</strong> — your mobile number, to send your sign-in code. WhatsApp (Meta) if your workspace uses WhatsApp messaging.</li>
          <li><strong className="text-foreground">PostHog</strong> (United States) — which screens get opened, plus IP and a device identifier. No screen contents: replay and click-text capture are both off.</li>
          <li><strong className="text-foreground">AI providers</strong> — Anthropic, OpenAI, Google, Voyage or Sarvam, depending on what your workspace is configured with. They only see what a particular AI feature needs, and <strong className="text-foreground">only after an owner has given AI consent in Settings.</strong> Until then the AI features refuse to run.</li>
          <li><strong className="text-foreground">Emergent</strong> — object storage for the files you upload, and an AI gateway.</li>
          <li><strong className="text-foreground">Google Fonts</strong> — your IP address, when the page loads its typefaces.</li>
        </ul>
        <p>
          Some of these are outside India. Where that is so, the transfer is
          because the service is needed to run the product, not because the data
          is wanted anywhere else.
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
        <p>
          Your workspace&rsquo;s records stay until you delete them or delete the
          workspace. Sign-in codes are short-lived. Security logs are kept for a
          limited period so an account problem can be investigated.
        </p>
      </Section>

      <Section title="Deleting your account">
        <p>
          You can do it yourself, at any time, without asking us — in the app
          under <strong className="text-foreground">Settings → Account → Delete your
          account</strong>, or on the web at{" "}
          <Link to="/delete-account" className="font-medium text-foreground underline underline-offset-2">
            /delete-account
          </Link>.
        </p>
        <p>
          If you are the only person in a workspace, deleting your account
          deletes the whole workspace — every record and every uploaded file. If
          other people work there, you leave and the work you did stays in the
          company&rsquo;s history, because a company that loses its records when
          somebody leaves is worse off than one carrying a note that they were
          there. If you own a workspace other people are in, hand it over first;
          we will not delete it from under them.
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
          <a href={`mailto:${CONTACT}`} className="font-medium text-foreground underline underline-offset-2">{CONTACT}</a>
        </p>
      </Section>
    </div>
  );
}
