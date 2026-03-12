# LinkedIn CLI

A personal LinkedIn CLI tool that authenticates as you and exposes commands for common LinkedIn workflows — reading your feed, searching posts/people, messaging, and posting. Designed to be invoked by Claude Code as an AI agent.

## Prerequisites

- **Node.js** v18+
- **npm**
- A config file provided to you (see [Setup](#setup))

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd linkedin-cli
npm install
npx playwright install chromium
```

### 2. Create the config directory

```bash
mkdir -p ~/.linkedin-cli
```

### 3. Add your config

You should have received a `config.json` file. Place it at:

```
~/.linkedin-cli/config.json
```

The file looks like this:

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectPort": 8765,
  "headless": true
}
```

> **Do not share this file or commit it to any repo.** It contains OAuth credentials for the LinkedIn app.

### 4. Authenticate

```bash
npx ts-node bin/linkedin.ts auth login
```

A browser window will open. Log in with your LinkedIn account and authorize the app. Once complete, your session is saved locally in your OS keychain.

To verify:

```bash
npx ts-node bin/linkedin.ts auth status
```

## Usage

All commands output JSON by default. Add `--pretty` for human-readable output.

### Auth

```bash
linkedin auth login       # Authenticate with LinkedIn
linkedin auth status      # Check current auth state
linkedin auth logout      # Clear stored session
```

### Feed

```bash
linkedin feed                  # Read your home feed
linkedin feed --limit 5        # Limit number of posts
```

### Search

```bash
linkedin search posts "AI agents"          # Search posts
linkedin search people "Jane Doe"          # Search people
linkedin search posts "AI" --limit 10      # With limit
```

### Messages

```bash
linkedin messages list                     # List recent conversations
linkedin messages read <conversation-id>   # Read a thread
linkedin messages send <conversation-id> "Hello!"  # Send a message
```

### Post

```bash
linkedin post create "My post text here"          # Create a post
linkedin post comment <post-urn> "Great post!"    # Comment on a post
```

### Profile

```bash
linkedin profile           # Show your cached profile
```

### Global Options

| Flag | Description |
|---|---|
| `--pretty` | Human-readable output |
| `--json` | Force JSON output (default) |
| `--limit N` | Control result count |
| `--headless` | Run browser in headless mode |
| `--no-cache` | Skip local cache |
| `--debug` | Verbose logging |

## How It Works

- **Auth** uses LinkedIn's official OAuth 2.0 flow to establish a session
- **Posting and commenting** use the official LinkedIn REST API
- **Feed, search, and messages** use Playwright browser automation with your stored session cookies
- Session tokens and cookies are stored in your OS keychain (via `keytar`) — not in plaintext files

## Using with Claude Code

This CLI is designed to be used as a tool by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). All commands output structured JSON by default, making it easy for Claude to parse and act on the results.

### Setup

1. Complete the [Setup](#setup) steps above and make sure `auth login` works
2. Open Claude Code in the `linkedin-cli` directory (or any project that has access to it)
3. Claude can now run CLI commands on your behalf

### What you can ask Claude to do

Once authenticated, you can give Claude natural language instructions like:

- "Check my LinkedIn feed"
- "Search for posts about AI in Waterloo"
- "Read my latest messages"
- "Post an update about [topic]"
- "Find people working on [topic]"
- "What are people saying about [topic] on LinkedIn?"

Claude will invoke the appropriate CLI commands, parse the JSON output, and present the results in a readable format.

### How it works with Claude

Claude runs commands like `npx ts-node bin/linkedin.ts feed --limit 10` behind the scenes. The JSON output lets Claude:

- Summarize your feed or search results
- Extract key themes from conversations
- Draft posts or comments based on context
- Follow up on specific threads or messages

### Tips

- Add the project path to your Claude Code workspace so it can access the CLI
- You can add instructions to your `CLAUDE.md` to tell Claude how you want it to use LinkedIn (e.g., "always summarize my feed in bullet points", "check messages every morning")
- The `--headless` flag is set by default in the config so browser automation runs in the background without interrupting you

## Troubleshooting

### "Auth expired" or commands fail after a while

LinkedIn tokens expire after 60 days. Re-authenticate:

```bash
npx ts-node bin/linkedin.ts auth login
```

### "No feed posts found — LinkedIn DOM may have changed"

LinkedIn occasionally changes their page structure. Open an issue or let the maintainer know.

### Browser doesn't open during login

Make sure Playwright's Chromium is installed:

```bash
npx playwright install chromium
```

### Permission errors on macOS

`keytar` needs access to the macOS keychain. You may see a system prompt asking to allow access — click "Allow".
