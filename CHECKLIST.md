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
- [ ] P2-T1 — Browser session manager (browser/session.ts)
- [ ] P2-T2 — Browser helpers and delay utilities (browser/helpers.ts)
- [ ] P2-T3 — Messages: list threads
- [ ] P2-T4 — Messages: read thread
- [ ] P2-T5 — Messages: send and new thread

## Phase 3 — Feed & Search
- [ ] P3-T1 — Feed: list posts
- [ ] P3-T2 — Search: posts
- [ ] P3-T3 — Search: people
- [ ] P3-T4 — Search: companies

## Phase 4 — Posting
- [ ] P4-T1 — Post: create text post
- [ ] P4-T2 — Post: comment on post

## Phase 5 — Polish
- [ ] P5-T1 — Caching layer
- [ ] P5-T2 — Security hardening
- [ ] P5-T3 — Stdin utility (pipe support)
- [ ] P5-T4 — Debug logging
- [ ] P5-T5 — Smoke test script
