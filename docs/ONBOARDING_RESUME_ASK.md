# Resuming an interview that was interrupted — the backend half

**For:** Yokesh (backend) · **From:** B05, the Android bug report · **Date:** 2026-09-29

## What is fixed already, and what is not

A founder who was called away mid-signup used to come back to "What's your
company called?". The website scan's findings and the interview's session lived
only in the browser's memory, so killing the app threw away the slowest, most
expensive step in the wizard — and a resumed signup even registered the company
with industry **"General"**, because the scan's answer was the thing that had
been lost.

The client half is done (`lib/onboardingDraft.js`, `pages/Signup.js`): the
draft now carries `world` (what the scan established) and `progress` (the
phase, the interview session id, its language), and the wizard reopens at the
furthest phase it can honestly serve.

**The one case it cannot serve is a half-finished interview.** If a founder
answered four of six questions and the app was killed, they come back to the
interview's *first* question. Their four answers are not lost — they are on the
server, on the session — but the client has no way to pick the thread up,
because `VoiceInterview` mints a new session on mount and there is no endpoint
that says "what is this session's current question?".

## What we need

### One endpoint

```
GET /api/signup/interview/{session_id}
```

Returns enough to draw the live interview screen for a session already in
progress:

| Field | Meaning |
|---|---|
| `session_id` | echoed |
| `question` | the question waiting to be answered |
| `why` | the one-line reason shown under it (the same field `/start` and `/answer` return) |
| `index` | which question this is (1-based) |
| `max` | how many there will be |
| `language_code` | the language it is being conducted in |
| `complete` | true when every question has been answered — the client then goes to the build instead |

Shape it exactly like the answer to `POST /signup/interview/answer`, so the
client can feed it into the same state it already has, with no second code path.

### Rules

- **404** when the session does not exist or has expired.
- **Unauthenticated**, like the rest of the signup surface, and behind the same
  `_guard_signup_endpoint` rate limit as `/interview/answer`. It is a read, and
  cheaper than the calls already exposed there.
- A session id is an unguessable uuid and the draft that holds it is itself
  behind `X-Draft-Token`, so no new exposure — but do not include the *answers*
  in the response. The client only needs the next question; returning the
  transcript would make this a more attractive thing to guess at.

## What the frontend does when it ships

`VoiceInterview` takes an optional `resumeSessionId`. When present it calls this
endpoint instead of `POST /interview/start`, drops straight into the live phase
at the returned question, and never mints a second session. `Signup.js` already
has the id in the draft and already restores it into state — it just has
nowhere to send it today.

Then the last line of the B05 comment in `pages/Signup.js` can be deleted, and
a founder gets back the four answers they already gave.

## Test to add with it

- A session mid-interview returns the current question and index; answering it
  advances as normal.
- A completed session returns `complete: true`.
- An unknown or expired session returns 404.
- The answers already given are **not** in the response.
