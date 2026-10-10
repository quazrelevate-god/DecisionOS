/* PLAY-3 (2026-10-08) · The Terms of Service.
 *
 * Google Play's User Generated Content policy (Play audit C2): people must
 * accept terms before they create content others see, and the terms must
 * define objectionable content and forbid it. Workspace members see each
 * other's tasks, decisions, comments, notes and files, so that is all of us.
 * Accepted at signup (onboarding/SignupConsent) and, for everyone else, by the
 * gate in the app (components/TermsGate) until they match TERMS_VERSION.
 *
 * Public route, like /privacy: it has to be readable before agreeing to it.
 * Changing it materially means bumping TERMS_VERSION (lib/legal.js and
 * backend/services/legal.py), which asks everybody again.
 */
import { Link } from "react-router-dom";
import { TERMS_VERSION } from "../lib/legal";

const CONTACT = "support@decisionos.biz";
/* Who publishes DecisionOS, as named on the Google Play listing. Naming the
   publisher is not a material change, so TERMS_VERSION is untouched and
   nobody is asked to agree again. */
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
const A = ({ to, children }) => (
  <Link to={to} className="font-medium text-foreground underline underline-offset-2">{children}</Link>
);

export default function Terms() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12" data-testid="terms-page">
      <h1 className="font-display text-3xl text-foreground">DecisionOS Terms of Service</h1>
      <p className="mt-2 text-xs text-muted-foreground">Last updated {UPDATED} · version {TERMS_VERSION}</p>

      <p className="mt-6 text-sm text-muted-foreground">
        These terms are the agreement between you and DecisionOS (&ldquo;we&rdquo;)
        for using the DecisionOS app and website. By creating an account, joining
        a workspace, or pressing &ldquo;I agree&rdquo;, you accept them. If you do
        not agree, do not use DecisionOS. How we handle personal data is in our{" "}
        <A to="/privacy">Privacy Policy</A>. DecisionOS is developed and published
        by {DEVELOPER}.
      </p>

      <Section title="Who can use DecisionOS">
        <p>
          DecisionOS is a tool for running a business. You must be at least 18 to
          use it. If you use it for a company, you confirm you are allowed to act
          for that company, and the company is responsible for what its people do
          in its workspace.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You sign in with your mobile number. Keep your phone and any password
          secure, and tell us at once if you think someone else has used your
          account. You are responsible for what happens under your account.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          What you and your team put into a workspace stays yours and your
          company&rsquo;s. You give us permission to store, process and show it
          only so that DecisionOS can work for you — including sending it to the
          AI providers named in the Privacy Policy when you use an AI feature. You
          must have the right to put it there, including any details about
          customers, suppliers or staff.
        </p>
      </Section>

      <Section title="What is not allowed">
        <p>Do not use DecisionOS to create, upload, share or ask the AI to produce:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><B>Harassment or bullying</B> — content that threatens, intimidates, demeans or singles out a person, including colleagues.</li>
          <li><B>Hate</B> — content that attacks people for their race, ethnicity, religion, caste, disability, age, nationality, gender, sexual orientation or similar.</li>
          <li><B>Sexual content</B> — sexually explicit material of any kind, and anything that sexualises or endangers children, which we report to the authorities.</li>
          <li><B>Violence</B> — threats, glorifying violence, or encouraging self-harm.</li>
          <li><B>Illegal activity</B> — fraud, money laundering, selling illegal goods, or anything else against the law.</li>
          <li><B>Other people&rsquo;s private data</B> shared without a right to — identity documents, financial details or private contact information exposed to people who should not see it.</li>
          <li><B>Deception</B> — impersonating someone, fake documents, or misleading content meant to cause harm.</li>
          <li><B>Infringement</B> — material that breaks someone else&rsquo;s copyright, trademark or other rights.</li>
          <li><B>Spam and abuse of the service</B> — unsolicited bulk messages, malware, or trying to break, overload, probe or get around the security of DecisionOS.</li>
        </ul>
      </Section>

      <Section title="Reporting and what we do about it">
        <p>
          Anything you see in DecisionOS — a comment, a task, a note, a person, or
          an answer from the AI — can be reported from inside the app with the{" "}
          <B>Report</B> button, or by writing to{" "}
          <a href={`mailto:${CONTACT}`} className="font-medium text-foreground underline underline-offset-2">{CONTACT}</a>.
          We review every report. Where content breaks these terms we may remove
          it, ask the workspace owner to act, and suspend or close the account of
          the person responsible. Serious or repeated breaches end in removal, and
          illegal content is reported to the authorities.
        </p>
      </Section>

      <Section title="AI features">
        <p>
          AI answers are generated automatically and can be wrong, incomplete or
          out of date. Check anything important before you rely on it — especially
          money, tax, legal and staff decisions. DecisionOS does not give
          professional financial, legal or tax advice. AI features run only after
          AI processing has been agreed to, and an owner can switch them off in
          Settings.
        </p>
      </Section>

      <Section title="Plans and payment">
        <p>
          A company may use DecisionOS on a trial or a paid plan. What a plan
          includes and costs is shown before it is bought. Paid plans are bought
          by the company, outside the Android app.
        </p>
      </Section>

      <Section title="Ending">
        <p>
          You can stop using DecisionOS and delete your account at any time — see{" "}
          <A to="/delete-account">Delete your account</A>. We may suspend or close
          an account that breaks these terms, or that we must close by law; where
          we can, we will tell you first and let you take your data out.
        </p>
      </Section>

      <Section title="Our responsibility">
        <p>
          We work hard to keep DecisionOS available, accurate and secure, but we
          provide it &ldquo;as is&rdquo;. As far as the law allows, we are not liable
          for indirect or consequential losses, or for decisions made on the basis
          of AI output. Nothing in these terms limits rights you have by law that
          cannot be limited.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If these terms change in a way that matters, the app will ask you to
          agree again before you carry on.
        </p>
      </Section>

      <Section title="Law and contact">
        <p>
          These terms are governed by the laws of India. DecisionOS is developed
          and published by {DEVELOPER}. Questions:{" "}
          <a href={`mailto:${CONTACT}`} className="font-medium text-foreground underline underline-offset-2">{CONTACT}</a>.
        </p>
      </Section>
    </div>
  );
}
