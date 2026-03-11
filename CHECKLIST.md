# LinkedIn CLI — Build Checklist

Live progress tracker. Updated as each task completes.

---

## Phase 1 — Auth + Profile (Foundation)
- [x] P1-T1 — Project scaffold (package.json, tsconfig, bin/linkedin.ts, src/types/index.ts)
- [x] P1-T2 — Output helpers and error handling (output.ts, errors.ts)
- [x] P1-T3 — Storage layer (keytar wrapper, config.ts)
- [x] P1-T4 — Auth command: OAuth flow (oauth.ts, commands/auth.ts)
- [x] P1-T5 — Global flags middleware (context.ts)
- [x] P1-T6 — Profile command via official API (api/client.ts, commands/profile.ts)

## Phase 2 — Messages
- [x] P2-T1 — Browser session manager (browser/session.ts)
- [x] P2-T2 — Browser helpers and delay utilities (browser/helpers.ts)
- [x] P2-T3 — Messages: list threads
- [x] P2-T4 — Messages: read thread
- [x] P2-T5 — Messages: send and new thread

## Phase 3 — Feed & Search
- [x] P3-T1 — Feed: list posts
- [x] P3-T2 — Search: posts
- [x] P3-T3 — Search: people
- [x] P3-T4 — Search: companies

## Phase 4 — Posting
- [x] P4-T1 — Post: create text post
- [x] P4-T2 — Post: comment on post

## Phase 5 — Polish
- [x] P5-T1 — Caching layer
- [x] P5-T2 — Security hardening
- [x] P5-T3 — Stdin utility (pipe support)
- [x] P5-T4 — Debug logging
- [x] P5-T5 — Smoke test script
