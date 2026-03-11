# LinkedIn CLI — Product Requirements Document

## 1. Purpose

A personal command-line tool that lets the user (and their AI agent, Claude) interact with LinkedIn from the terminal. The tool authenticates as the user, persists the session securely, and exposes commands for reading messages, browsing the feed, searching, and posting.

Primary consumer: Claude Code (AI agent) invoking the CLI to perform LinkedIn tasks on the user's behalf.
Secondary consumer: The user directly from the terminal.

---

## 2. Goals

- Full LinkedIn workflow coverage from the terminal: auth, messages, feed, search, posting
- Machine-readable JSON output by default so Claude can parse and act on results
- Secure, persistent session storage so re-auth is rare
- Personal use only — no bulk automation, no background daemons
- Simple, predictable CLI UX: `linkedin <noun> <verb> [options]`

---

## 3. Non-Goals

- Multi-account support (single user only)
- Company page management
- LinkedIn Ads or Marketing API features
- Bulk/scheduled posting or automation bots
- Web UI or GUI

---

## 4. Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript (Node.js) | Strong typing, good Playwright bindings, fast CLI startup |
| CLI framework | `commander` | Lightweight, familiar, good subcommand support |
| Browser automation | `playwright` (Chromium, headful) | Reliable, human-like, session cookie support |
| Auth | LinkedIn OAuth 2.0 + OIDC | Official, generates real session cookies |
| Secure storage | `keytar` (OS keychain) | Tokens never touch disk in plaintext |
| Config | JSON at `~/.linkedin-cli/config.json` | Simple, inspectable |
| Package manager | `npm` | Default, widely compatible |
| Build | `ts-node` for dev, `tsc` for production build | Fast iteration |

---

## 5. Authentication

### 5.1 Login Flow

1. User runs `linkedin auth login`
2. CLI registers/reads LinkedIn OAuth app credentials from config or env vars (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`)
3. CLI opens a Playwright Chromium browser window directed to LinkedIn's OAuth authorization URL:
   `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=...&redirect_uri=...&scope=openid profile email w_member_social`
4. User completes login in the browser (handles MFA, CAPTCHA naturally)
5. On redirect to `localhost` callback, CLI captures the authorization code
6. CLI exchanges code for access token + ID token via `https://www.linkedin.com/oauth/v2/accessToken`
7. CLI extracts Playwright browser session cookies (for use in Playwright-based commands)
8. Tokens and cookies stored securely via `keytar` (OS keychain)
9. Lite profile fetched from `GET /v2/me` and cached at `~/.linkedin-cli/cache/profile.json`
10. Browser closed

### 5.2 Session Persistence

- Access token TTL: 60 days (LinkedIn default)
- CLI checks token expiry before each command; if expired, prompts re-auth
- Browser session cookies stored separately; refreshed on next login if expired
- `linkedin auth status` shows: logged-in state, token expiry, cached profile name

### 5.3 Logout

- Clears all keychain entries
- Deletes `~/.linkedin-cli/cache/`
- Does not revoke LinkedIn token (no revoke endpoint in self-serve tier)

### 5.4 Storage Layout

```
~/.linkedin-cli/
  config.json          # Client ID, client secret, preferences
  cache/
    profile.json       # Cached own profile (from /v2/me + /v2/userinfo)
    feed.json          # Last feed fetch
    messages.json      # Last message list fetch
```

Tokens and session cookies: stored in OS keychain via `keytar` under service name `linkedin-cli`.

---

## 6. Command Specification

All commands output **JSON to stdout** by default. Errors output JSON to stderr with shape `{ "error": string, "code": string }`. Exit codes: `0` success, `1` user error, `2` auth error, `3` network/LinkedIn error.

### 6.1 Auth Commands

#### `linkedin auth login`
Opens browser OAuth flow. On success: stores tokens, caches profile, prints profile summary.

Output:
```json
{ "status": "authenticated", "profile": { "name": "...", "headline": "...", "email": "..." } }
```

#### `linkedin auth logout`
Clears all stored credentials and cache.

Output:
```json
{ "status": "logged_out" }
```

#### `linkedin auth status`
Shows current auth state without making network calls.

Output:
```json
{
  "authenticated": true,
  "token_expires_at": "2026-05-10T00:00:00Z",
  "profile": { "name": "...", "headline": "...", "email": "..." }
}
```

---

### 6.2 Profile Commands

#### `linkedin profile`
Returns cached profile. Fetches fresh if `--refresh` passed.

Flags:
- `--refresh` — force re-fetch from API

Output:
```json
{
  "id": "...",
  "name": "...",
  "headline": "...",
  "email": "...",
  "picture": "...",
  "vanity_url": "..."
}
```

---

### 6.3 Messages Commands

#### `linkedin messages list`
Lists recent message threads using Playwright.

Flags:
- `--limit N` (default: 20) — number of threads to return
- `--unread` — only unread threads

Output:
```json
{
  "threads": [
    {
      "id": "...",
      "participants": [{ "name": "...", "headline": "..." }],
      "last_message": "...",
      "last_message_at": "...",
      "unread": true
    }
  ]
}
```

#### `linkedin messages read <thread_id>`
Reads full conversation thread.

Flags:
- `--limit N` (default: 50) — number of messages to return

Output:
```json
{
  "thread_id": "...",
  "participants": [{ "name": "...", "headline": "..." }],
  "messages": [
    {
      "id": "...",
      "sender": "...",
      "body": "...",
      "sent_at": "...",
      "is_mine": true
    }
  ]
}
```

#### `linkedin messages send <thread_id> --message "..."`
Sends a message to an existing thread.

Flags:
- `--message` (required) — message body

Output:
```json
{ "status": "sent", "thread_id": "...", "sent_at": "..." }
```

#### `linkedin messages new --to "Name or profile URL" --message "..."`
Starts a new message thread.

Flags:
- `--to` (required) — recipient name (searches for them) or profile URL
- `--message` (required) — message body

Output:
```json
{ "status": "sent", "thread_id": "...", "sent_at": "..." }
```

---

### 6.4 Feed Commands

#### `linkedin feed`
Reads the home feed via Playwright.

Flags:
- `--limit N` (default: 20) — number of posts to return

Output:
```json
{
  "posts": [
    {
      "id": "...",
      "author": { "name": "...", "headline": "..." },
      "body": "...",
      "posted_at": "...",
      "reactions": 42,
      "comments": 7,
      "url": "..."
    }
  ]
}
```

---

### 6.5 Search Commands

#### `linkedin search posts <query>`
Searches LinkedIn posts via Playwright.

Flags:
- `--limit N` (default: 10)
- `--sort recent|relevant` (default: relevant)

Output:
```json
{
  "query": "...",
  "results": [
    {
      "id": "...",
      "author": { "name": "...", "headline": "..." },
      "body": "...",
      "posted_at": "...",
      "url": "..."
    }
  ]
}
```

#### `linkedin search people <query>`
Searches LinkedIn people via Playwright.

Flags:
- `--limit N` (default: 10)

Output:
```json
{
  "query": "...",
  "results": [
    {
      "name": "...",
      "headline": "...",
      "location": "...",
      "profile_url": "...",
      "connection_degree": "2nd"
    }
  ]
}
```

#### `linkedin search companies <query>`
Searches LinkedIn companies via Playwright.

Flags:
- `--limit N` (default: 10)

Output:
```json
{
  "query": "...",
  "results": [
    {
      "name": "...",
      "industry": "...",
      "size": "...",
      "url": "..."
    }
  ]
}
```

---

### 6.6 Post Commands

#### `linkedin post create --body "..." [--image path]`
Creates a LinkedIn post via official API (`w_member_social`).

Flags:
- `--body` (required) — post text
- `--image` — path to local image file to attach

Output:
```json
{ "status": "posted", "post_urn": "...", "url": "..." }
```

#### `linkedin post comment <post_url_or_urn> --body "..."`
Comments on a post via official API.

Flags:
- `--body` (required) — comment text

Output:
```json
{ "status": "commented", "comment_urn": "..." }
```

---

## 7. Global Flags

Available on all commands:

| Flag | Description |
|---|---|
| `--pretty` | Human-readable formatted output instead of JSON |
| `--json` | Force JSON output (default, explicit override) |
| `--debug` | Verbose logging including Playwright actions |
| `--no-cache` | Skip local cache, always fetch fresh |

---

## 8. Playwright Session Management

- A single shared Playwright browser context is reused across commands within a session
- Browser storage state (cookies, localStorage) is serialized and stored in the OS keychain alongside OAuth tokens
- On first command after login, storage state is hydrated into Playwright context
- Session is considered valid if LinkedIn's `li_at` cookie is present and not expired
- If session is invalid, CLI prompts: "Session expired. Run `linkedin auth login` to re-authenticate."
- All Playwright navigation uses randomized delays (300–1200ms) between actions to avoid detection
- Browser runs headful (visible) by default; `--headless` flag available for scripted/CI use

---

## 9. Error Handling

| Scenario | Behavior |
|---|---|
| Not authenticated | Exit 2, `{ "error": "Not authenticated. Run linkedin auth login.", "code": "AUTH_REQUIRED" }` |
| Token expired | Exit 2, same as above |
| LinkedIn rate limited / blocked | Exit 3, `{ "error": "LinkedIn request blocked or rate limited.", "code": "LINKEDIN_BLOCKED" }` |
| Network offline | Exit 3, `{ "error": "Network unavailable.", "code": "NETWORK_ERROR" }` |
| LinkedIn UI changed (Playwright selector broken) | Exit 3, `{ "error": "LinkedIn page structure changed. Selector failed: ...", "code": "SELECTOR_ERROR" }` |
| Invalid arguments | Exit 1, usage hint printed to stderr |

---

## 10. Security Requirements

- OAuth client secret stored in OS keychain via `keytar`, never in plaintext files
- Access token stored in OS keychain
- Browser session cookies stored in OS keychain (encrypted by OS)
- `~/.linkedin-cli/` cache files contain no credentials — only public profile data and message content
- `config.json` may contain `client_id` (public) but never `client_secret`
- CLI refuses to run as root

---

## 11. Build & Distribution

- Built as a local npm package installable via `npm install -g` or `npm link`
- Entry point: `bin/linkedin` (symlinked after install)
- TypeScript compiled to `dist/` via `tsc`
- Playwright browser downloaded automatically on first run via `playwright install chromium`
- No external service dependencies beyond LinkedIn itself

---

## 12. Implementation Phases

### Phase 1 — Auth + Profile (Foundation)
- [ ] Project scaffold: TypeScript, `commander`, directory structure
- [ ] `linkedin auth login` — OAuth flow via Playwright, token storage via `keytar`
- [ ] `linkedin auth status` / `linkedin auth logout`
- [ ] `linkedin profile` — fetch from API, local cache

### Phase 2 — Messages
- [ ] Playwright session wrapper (reuse context, storage state hydration)
- [ ] `linkedin messages list`
- [ ] `linkedin messages read <id>`
- [ ] `linkedin messages send <id>`
- [ ] `linkedin messages new`

### Phase 3 — Feed & Search
- [ ] `linkedin feed`
- [ ] `linkedin search posts`
- [ ] `linkedin search people`
- [ ] `linkedin search companies`

### Phase 4 — Posting
- [ ] `linkedin post create`
- [ ] `linkedin post comment`

### Phase 5 — Polish
- [ ] `--pretty` output formatting
- [ ] `--debug` mode
- [ ] Selector resilience (fallback strategies when LinkedIn UI changes)
- [ ] README and usage docs

---

## 13. Acceptance Criteria

- `linkedin auth login` completes in under 60 seconds (excluding user browser interaction time)
- All commands return valid JSON on stdout with exit code 0 on success
- All commands return JSON error on stderr with non-zero exit code on failure
- `linkedin messages list` returns at least the 10 most recent threads when authenticated
- `linkedin feed` returns at least 10 posts
- `linkedin search posts "test"` returns at least 5 results
- `linkedin post create --body "test"` successfully creates a visible post on LinkedIn
- No credentials exist in plaintext on disk at any point
- All Playwright interactions include randomized delays (min 300ms between actions)
