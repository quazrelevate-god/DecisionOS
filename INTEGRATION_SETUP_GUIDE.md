# DecisionOS — Integration Setup Guide

This guide walks you through getting API keys from each provider and where to paste them.
When you have the values, send them to the agent (or paste into `backend/.env`) and the agent will wire + test them.

> Webhook / app base URL used below:
> **https://founder-os-58.preview.emergentagent.com**
> (Your production URL will differ after deployment — the agent will update it then.)

---

## 1. WhatsApp Document Ingestion — Meta (WhatsApp Business Cloud API)

**What it enables:** Employees forward an invoice / PO / payment screenshot to your WhatsApp number, and DecisionOS reads it and files it automatically.

**Values you'll collect:** `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`

### Steps
1. Go to **https://developers.facebook.com/** and log in with a Facebook account.
2. Top-right → **My Apps** → **Create App**.
3. Use case: choose **Other** → click **Next**.
4. App type: select **Business** → **Next**.
5. Enter an **App name** (e.g., "DecisionOS") + your email → **Create App**.
6. On the app dashboard, find **WhatsApp** → click **Set up**.
7. Left sidebar → **WhatsApp → API Setup**. Here you will see:
   - **Temporary access token** → copy it → this is `WA_ACCESS_TOKEN` (valid 24h; see step 10 for a permanent one).
   - **Phone number ID** (under "Send and receive messages") → copy → this is `WA_PHONE_NUMBER_ID`.
8. **Invent your own verify token** — any random string, e.g. `decisionos_verify_9f3k` → this is `WA_VERIFY_TOKEN`. Write it down.
9. Left sidebar → **App settings → Basic** → click **Show** next to **App secret** → copy → this is `WA_APP_SECRET`.
10. **(For production) Permanent token:** Business Settings → **System users** → create a system user → **Generate token** → select your app → add permissions `whatsapp_business_messaging` + `whatsapp_business_management` → generate → use THIS as `WA_ACCESS_TOKEN`.

### Connect the webhook (do this AFTER the agent adds your keys)
11. Left sidebar → **WhatsApp → Configuration → Webhook** → **Edit**.
12. **Callback URL:** `https://founder-os-58.preview.emergentagent.com/api/webhooks/whatsapp`
13. **Verify token:** the same `WA_VERIFY_TOKEN` you invented in step 8 → click **Verify and save**.
14. Under **Webhook fields**, click **Manage** → **Subscribe** to the **messages** field.
15. Test: from your phone, send an invoice image to the test number shown in API Setup.

**Send to agent:** WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN, WA_APP_SECRET, and which workspace should receive documents.

---

## 2. SMS Employee Invites — Twilio

**What it enables:** Real SMS invitations to the mobile numbers you add during onboarding / in Team.

**Values you'll collect:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (or Messaging Service SID)

### Steps
1. Go to **https://www.twilio.com/try-twilio** and sign up (free trial gives credit).
2. Verify your email and your own phone number.
3. Open the **Twilio Console** → **https://console.twilio.com/**.
4. On the dashboard home, find **Account Info**:
   - **Account SID** → copy → `TWILIO_ACCOUNT_SID`
   - **Auth Token** → click to reveal → copy → `TWILIO_AUTH_TOKEN`
5. Get a sender number: left menu → **Phone Numbers → Manage → Buy a number** (choose one with SMS capability). Copy it in E.164 format (e.g., `+14155551234`) → `TWILIO_FROM_NUMBER`.
   - *(Trial note: you can only send to phone numbers you've verified in "Verified Caller IDs" until you upgrade.)*
6. *(Optional, better for scale)* Create a **Messaging Service** (Messaging → Services) and use its **Messaging Service SID** instead of a from-number.

**Send to agent:** TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.

---

## 3. Zoho Books Connector — Zoho

**What it enables:** Pull customers, invoices, payments and bills from Zoho Books into DecisionOS.

**Values you'll collect:** `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` (OAuth), and your **Organization ID**.

### Steps
1. Go to **https://api-console.zoho.com/** and log in with your Zoho account.
2. Click **Add Client** → choose **Server-based Applications**.
3. Fill in:
   - **Client Name:** DecisionOS
   - **Homepage URL:** `https://founder-os-58.preview.emergentagent.com`
   - **Authorized Redirect URI:** `https://founder-os-58.preview.emergentagent.com/api/zoho/callback`
4. Click **Create**. You'll now see:
   - **Client ID** → copy → `ZOHO_CLIENT_ID`
   - **Client Secret** → copy → `ZOHO_CLIENT_SECRET`
5. Find your **Organization ID:** log in to **Zoho Books** → **Settings (gear) → Organization → Profile** (or the URL contains it). Copy it.
6. Note your Zoho **data center/domain** (e.g., `.com`, `.in`, `.eu`) — tell the agent which one your account uses.

**Send to agent:** ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, Organization ID, and your Zoho domain (.com/.in/.eu). The agent will guide the one-time OAuth consent to generate the refresh token.

---

## 4. Email Daily Digest — Resend

**What it enables:** Real daily CEO digest emails (currently mocked/logged).

**Values you'll collect:** `RESEND_API_KEY` (+ a verified sender domain/email)

### Steps
1. Go to **https://resend.com/** → **Sign up**.
2. Left menu → **API Keys** → **Create API Key** → name it "DecisionOS" → permission **Full access** (or Sending) → **Create** → copy → `RESEND_API_KEY` (shown once).
3. Left menu → **Domains** → **Add Domain** → enter your domain → add the shown **DNS records** (TXT/CNAME) at your domain registrar → click **Verify**.
   - *(No domain? For quick testing you can send from Resend's `onboarding@resend.dev`, but production needs a verified domain.)*
4. Decide your **from address**, e.g. `digest@yourcompany.com` → this becomes `RESEND_FROM_EMAIL`.

**Send to agent:** RESEND_API_KEY and your verified from-email.

---

## 5. Tally Connector (P2 — no API key)

Tally has **no cloud API**. Integration requires a small local agent/bridge running on the same machine/network as Tally (Tally's ODBC/XML on port 9000). No signup needed — when you're ready, tell the agent and we'll plan the local bridge approach.

---

## Where these values live

All keys go into **`/app/backend/.env`** (the agent adds them; never commit real secrets to source control). The AI features (OCR, extraction, Ask AI, Whisper) already run on the built-in **Emergent LLM key** — no action needed from you.

## Quick checklist
- [ ] Meta: WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN, WA_APP_SECRET
- [ ] Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
- [ ] Zoho: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, Organization ID, domain
- [ ] Resend: RESEND_API_KEY, verified from-email
