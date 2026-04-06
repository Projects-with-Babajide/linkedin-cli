# link-pulse

A personal CLI for managing your LinkedIn, WhatsApp, and Messenger from the terminal — check your feed, search posts, read and send messages, manage connections, and publish updates. Built to work with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as an AI-powered workflow.

## Install

```bash
npm install -g link-pulse
```

Chromium will be installed automatically. If it doesn't, run:

```bash
npx playwright install chromium
```

### Platform Notes

- **macOS**: Works out of the box. `keytar` may prompt for Keychain access — click "Allow".
- **Linux**: Requires `libsecret-1-dev` and build tools (`sudo apt install libsecret-1-dev build-essential`).
- **Windows**: Requires [windows-build-tools](https://github.com/nicedoc/windows-build-tools).

## Setup

### 1. Create the config directory

```bash
mkdir -p ~/.linkedin-cli
```

### 2. Add your config

You should have received a `config.json` file containing your OAuth app credentials. Place it at:

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

> **Do not share this file or commit it to any repo.** It contains OAuth credentials.

### 3. Authenticate

```bash
link-pulse auth login
```

A browser window will open. Log in and authorize the app. Your session is saved securely in your OS keychain.

To verify:

```bash
link-pulse auth status
```

## Usage

All commands output JSON by default. Add `--pretty` for human-readable output.

### Auth

```bash
link-pulse auth login       # Authenticate
link-pulse auth status      # Check current auth state
link-pulse auth logout      # Clear stored session
```

### Feed

```bash
link-pulse feed                  # Read your home feed
link-pulse feed --limit 5        # Limit number of posts
```

### Search

```bash
link-pulse search posts "AI agents"          # Search posts
link-pulse search people "Jane Doe"          # Search people
link-pulse search posts "AI" --limit 10      # With limit
```

### Messages

```bash
link-pulse messages list                                      # List recent conversations
link-pulse messages read <conversation-id>                    # Read a thread
link-pulse messages send <conversation-id> --message "Hello!" # Send a message
```

### Post

```bash
link-pulse post create --text "My post text here"          # Create a post
link-pulse post comment <post-urn> --text "Great post!"    # Comment on a post
```

### Notifications

```bash
link-pulse notifications             # Check your notifications
link-pulse notifications --limit 10  # Limit number of notifications
```

### Connections

```bash
link-pulse connections               # List your connections
link-pulse connections --limit 20    # Limit number of connections
```

### WhatsApp

```bash
link-pulse whatsapp list                                         # List recent chats
link-pulse whatsapp read <chat-id>                               # Read a conversation
link-pulse whatsapp send <chat-id> --message "Hey!"              # Send a message
```

### Messenger

```bash
link-pulse messenger list                                        # List recent chats
link-pulse messenger read <chat-id>                              # Read a conversation
link-pulse messenger send <chat-id> --message "Hey!"             # Send a message
```

### Profile

```bash
link-pulse profile           # Show your cached profile
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

- **Auth** uses OAuth 2.0 to establish a session
- **Posting and commenting** use the official REST API
- **Feed, search, messages, notifications, and connections** use Playwright to interact with LinkedIn on your behalf
- **WhatsApp and Messenger** use Playwright for browser-based messaging
- Credentials are stored in your OS keychain (via `keytar`) — not in plaintext files

## Using with Claude Code

This CLI outputs structured JSON, making it a natural fit for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Once authenticated, you can give Claude instructions like:

- "Check my feed"
- "Search for posts about AI in Waterloo"
- "Read my latest messages"
- "Post an update about [topic]"
- "Find people working on [topic]"

Claude runs `link-pulse` commands behind the scenes, parses the JSON, and presents readable results.

### Tips

- Install the [slash command skills](https://github.com/Projects-with-Babajide/the-skill-vault) for `/linkedin-feed`, `/linkedin-search`, `/linkedin-messages`, `/linkedin-post`
- Add instructions to your `CLAUDE.md` to customize how Claude uses link-pulse
- The `--headless` flag runs browser interactions in the background

## Disclaimer

This tool is intended for personal, interactive use only. Some features use browser automation to access functionality not available through official APIs. It is not designed for bulk automation, scraping, or commercial use. By using this tool, you accept responsibility for compliance with the terms of service of any platforms you interact with.

## Troubleshooting

### "Auth expired" or commands fail after a while

Tokens expire after 60 days. Re-authenticate:

```bash
link-pulse auth login
```

### "No feed posts found"

The platform occasionally changes their page structure. Open an issue or let the maintainer know.

### Browser doesn't open during login

```bash
npx playwright install chromium
```
