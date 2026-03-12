# LinkedIn CLI — Project Context

## Overview
A personal LinkedIn CLI tool that interacts with LinkedIn on behalf of the user. It authenticates as the user, stores credentials securely, and exposes a set of commands for common LinkedIn workflows — designed to be invoked by Claude Code as an AI agent to do LinkedIn work on the user's behalf.

## Architecture Decision: Hybrid Approach

After researching the official LinkedIn API, a **hybrid strategy** was chosen:

- **Auth:** Official LinkedIn OAuth 2.0 / OIDC flow to establish a real, authenticated session. Session cookies are extracted and stored securely.
- **Official REST API:** Used where permitted (post creation, comments via `w_member_social`).
- **Playwright browser automation:** Used for everything else — messages, feed, search, reading post history. Runs a headful Chromium session using stored session cookies.

### Why not official API only?
The LinkedIn self-serve API is severely limited for personal use:
- No messaging API (personal inbox is inaccessible via API)
- No feed/timeline reading endpoint
- No public search API
- `r_member_social` (read own posts) is closed, not accepting applications
- Read-side is almost entirely locked behind closed partner programs

### ToS Consideration
Browser automation for personal, interactive, manually-triggered use is against LinkedIn's ToS. This tool is scoped strictly to personal use with human-like request pacing — not bulk automation or bots. User accepts this risk.

## Tech Stack
- **Language:** TypeScript / Node.js
- **CLI framework:** `commander`
- **Browser automation:** `playwright` (headful Chromium)
- **Auth:** LinkedIn OIDC + session cookie extraction
- **Secure storage:** `keytar` (OS keychain) or AES-encrypted JSON at `~/.linkedin-cli/`
- **Config:** JSON at `~/.linkedin-cli/config.json`
- **Output:** JSON by default (machine-readable for Claude), `--pretty` flag for human-readable

## Core Commands

| Command | Method | Description |
|---|---|---|
| `linkedin auth login` | Official OAuth | Authenticate, cache profile |
| `linkedin auth status` | Local | Show current auth state |
| `linkedin auth logout` | Local | Clear stored session |
| `linkedin profile` | Official API | Show own cached profile |
| `linkedin messages list` | Playwright | List recent conversations |
| `linkedin messages read <id>` | Playwright | Read a conversation thread |
| `linkedin messages send <id>` | Playwright | Send a message |
| `linkedin feed` | Playwright | Read home feed |
| `linkedin search posts <query>` | Playwright | Search posts |
| `linkedin search people <query>` | Playwright | Search people |
| `linkedin post create` | Official API | Create a post |
| `linkedin post comment <urn>` | Official API | Comment on a post |

## Design Principles
- All output is JSON by default — structured for Claude to parse and reason over
- `--pretty` flag on any command for human-readable terminal output
- `--limit N` flag to control result count
- Commands are composable and scriptable
- No background daemons — all actions are explicitly triggered
- Human-like pacing between Playwright requests (randomized delays)
- Offline-capable: cached profile and recent data available without network

## File Structure
```
link-pulse/
  src/
    commands/       # One file per command group
    auth/           # OAuth flow, session management
    browser/        # Playwright session wrapper
    api/            # Official LinkedIn REST API client
    storage/        # Token/session/cache persistence
    types/          # Shared TypeScript types
  bin/
    linkedin.ts     # CLI entry point
  ~/.linkedin-cli/  # Runtime data (outside repo)
    config.json
    session.enc     # Encrypted session/tokens
    cache/          # Cached profile, recent data
```

## Reference Documents
- `PRD.md` — Full product requirements, feature specs, and acceptance criteria

## Project Status
Planning complete. Ready to scaffold and build.
