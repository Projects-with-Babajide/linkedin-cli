# LinkedIn CLI — Implementation Plan

## How to Resume

When starting a new Claude session to continue this project:

1. Read `CLAUDE.md` for architecture decisions and project overview.
2. Read `PRD.md` for full product requirements and behavior specs.
3. Read this file (`PLAN.md`) and locate the "Current Checkpoint" section.
4. Find the task marked as "In Progress" or the first task after "Last Completed".
5. Read all files listed under "Files to create or modify" for that task.
6. Execute the implementation steps exactly as written.
7. Update "Current Checkpoint" when the task is complete before ending the session.

---

## Current Checkpoint

**Status:** Phase 1 complete
**Last Completed Task:** P1-T6
**In Progress Task:** —
**Next Task:** P2-T1

---

## Phase 1: Auth + Profile

### P1-T1 — Project Scaffold and Tooling

**Files to create or modify:**
- `package.json`
- `tsconfig.json`
- `.gitignore`
- `bin/linkedin.ts`
- `src/types/index.ts`

**Implementation steps:**

1. Run `npm init -y` to create `package.json`.
2. Install runtime dependencies: `npm install commander playwright keytar open chalk`.
3. Install dev dependencies: `npm install -D typescript @types/node ts-node nodemon`.
4. Replace `package.json` `scripts` section with:
   ```json
   "scripts": {
     "build": "tsc",
     "dev": "ts-node bin/linkedin.ts",
     "start": "node dist/bin/linkedin.js"
   },
   "bin": {
     "linkedin": "./dist/bin/linkedin.js"
   }
   ```
5. Create `tsconfig.json` with `target: ES2022`, `module: commonjs`, `outDir: ./dist`, `rootDir: ./`, `strict: true`, `esModuleInterop: true`.
6. Create `.gitignore` with entries: `node_modules/`, `dist/`, `.env`, `*.log`.
7. Create `src/types/index.ts` defining the following exported interfaces:
   - `CliConfig { clientId: string; clientSecret: string; redirectPort: number; }`
   - `AuthTokens { accessToken: string; refreshToken?: string; expiresAt: number; scope: string; }`
   - `StoredSession { tokens: AuthTokens; cookieState?: string; }`
   - `CliError { code: string; message: string; details?: unknown; }`
   - `JsonOutput<T> { success: boolean; data?: T; error?: CliError; }`
8. Create `bin/linkedin.ts` that imports `commander`, creates a top-level `program` with name `linkedin`, version `0.1.0`, and description `LinkedIn CLI`. Add `.hook('preAction')` that checks if running as root (process.getuid?.() === 0) and exits with error. Call `program.parseAsync(process.argv)` at the bottom.
9. Run `npx tsc --noEmit` to verify no type errors.

**Completion criteria:**
- `npm run build` succeeds with no errors.
- `node dist/bin/linkedin.js --help` prints the CLI name, version, and description.
- Running as root (simulated) triggers exit.

**Dependencies:** None

---

### P1-T2 — Output Helpers and Error Handling

**Files to create or modify:**
- `src/utils/output.ts`
- `src/utils/errors.ts`

**Implementation steps:**

1. Create `src/utils/errors.ts`:
   - Export a typed enum or const object `ErrorCode` with values: `AUTH_REQUIRED`, `LINKEDIN_BLOCKED`, `NETWORK_ERROR`, `SELECTOR_ERROR`, `CONFIG_ERROR`, `UNKNOWN`.
   - Export a class `CliException` extending `Error` with properties `code: ErrorCode` and `details?: unknown`. Constructor takes `(message: string, code: ErrorCode, details?: unknown)`.
   - Export a function `toCliError(e: unknown): CliError` that returns a `CliError` object. If `e` is a `CliException`, use its code and message. Otherwise, use `UNKNOWN` and stringify.

2. Create `src/utils/output.ts`:
   - Import `chalk` for color formatting.
   - Export function `outputJson<T>(data: T, pretty: boolean): void` that writes `JSON.stringify({ success: true, data }, null, pretty ? 2 : 0)` to stdout.
   - Export function `outputError(error: CliError, pretty: boolean): void` that writes `JSON.stringify({ success: false, error }, null, pretty ? 2 : 0)` to stderr.
   - Export function `outputPrettyTable(rows: Record<string, string>[], headers: string[]): void` for human-readable output using chalk when `--pretty` is active.
   - Export function `handleCommandError(e: unknown, pretty: boolean): never` that calls `toCliError(e)`, calls `outputError`, then calls `process.exit(1)`.

3. Verify exit codes: code 0 = success, 1 = general error, 2 = auth required, 3 = blocked. Update `handleCommandError` to use code 2 if `CliException.code === AUTH_REQUIRED`, code 3 if `LINKEDIN_BLOCKED`.

**Completion criteria:**
- `npx tsc --noEmit` passes.
- Manually invoke `outputJson({ foo: 'bar' }, true)` in a test script and confirm pretty-printed JSON appears on stdout.
- Manually invoke `outputError(...)` and confirm JSON appears on stderr.

**Dependencies:** P1-T1

---

### P1-T3 — Storage Layer (keytar wrapper)

**Files to create or modify:**
- `src/storage/keytar.ts`
- `src/storage/config.ts`

**Implementation steps:**

1. Create `src/storage/keytar.ts`:
   - Define constant `SERVICE_NAME = 'linkedin-cli'`.
   - Define constant `ACCOUNT_TOKENS = 'auth-tokens'`.
   - Define constant `ACCOUNT_COOKIES = 'browser-cookies'`.
   - Export async function `saveTokens(tokens: AuthTokens): Promise<void>` that calls `keytar.setPassword(SERVICE_NAME, ACCOUNT_TOKENS, JSON.stringify(tokens))`.
   - Export async function `loadTokens(): Promise<AuthTokens | null>` that calls `keytar.getPassword`, parses JSON, returns null if not found.
   - Export async function `clearTokens(): Promise<void>` that calls `keytar.deletePassword(SERVICE_NAME, ACCOUNT_TOKENS)`.
   - Export async function `saveCookies(state: string): Promise<void>` using `ACCOUNT_COOKIES`.
   - Export async function `loadCookies(): Promise<string | null>`.
   - Export async function `clearCookies(): Promise<void>`.

2. Create `src/storage/config.ts`:
   - Import `path`, `os`, `fs/promises`.
   - Define `CONFIG_DIR = path.join(os.homedir(), '.linkedin-cli')`.
   - Define `CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')`.
   - Define `CACHE_DIR = path.join(CONFIG_DIR, 'cache')`.
   - Export async function `ensureConfigDir(): Promise<void>` that creates `CONFIG_DIR` and `CACHE_DIR` with `fs.mkdir(..., { recursive: true })`.
   - Export async function `readConfig(): Promise<CliConfig | null>` that reads and parses `config.json`. Returns null if file missing.
   - Export async function `writeConfig(config: CliConfig): Promise<void>` that writes JSON to `config.json`.
   - Export async function `requireConfig(): Promise<CliConfig>` that calls `readConfig()` and throws `CliException(CONFIG_ERROR)` if null.

**Completion criteria:**
- `npx tsc --noEmit` passes.
- A manual test script can call `saveTokens(...)`, then `loadTokens()` and get back the same object.

**Dependencies:** P1-T1, P1-T2

---

### P1-T4 — Auth Command: OAuth Flow

**Files to create or modify:**
- `src/auth/oauth.ts`
- `src/commands/auth.ts`

**Implementation steps:**

1. Create `src/auth/oauth.ts`:
   - Import `http`, `url`, `crypto`, `open`, `AuthTokens`, `CliConfig`.
   - Define constant `LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization'`.
   - Define constant `LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'`.
   - Define constant `SCOPES = ['openid', 'profile', 'email', 'w_member_social']`.
   - Export async function `startOAuthFlow(config: CliConfig): Promise<AuthTokens>`:
     a. Generate a random `state` string using `crypto.randomBytes(16).toString('hex')`.
     b. Generate PKCE: `codeVerifier = crypto.randomBytes(32).toString('base64url')`, `codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')`.
     c. Start a local HTTP server on `config.redirectPort` (default 8765).
     d. Build the authorization URL with params: `response_type=code`, `client_id`, `redirect_uri=http://localhost:{port}/callback`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`.
     e. Call `open(authUrl)` to open the browser.
     f. Wait (Promise) for the server to receive GET `/callback?code=...&state=...`.
     g. Validate `state` matches.
     h. Exchange code for tokens via POST to `LINKEDIN_TOKEN_URL` with form body: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret`, `code_verifier`.
     i. Parse response JSON into `AuthTokens` (set `expiresAt = Date.now() + expires_in * 1000`).
     j. Close the local server.
     k. Return the tokens.

2. Create `src/commands/auth.ts`:
   - Import `commander`, `requireConfig`, `startOAuthFlow`, `saveTokens`, `loadTokens`, `clearTokens`, `clearCookies`, `outputJson`, `outputError`, `handleCommandError`.
   - Export function `registerAuthCommands(program: Command): void`.
   - Inside, create a `auth` subcommand group.
   - Add `auth login` command:
     a. Options: `--pretty`.
     b. Action: call `requireConfig()`, call `startOAuthFlow(config)`, call `saveTokens(tokens)`, call `outputJson({ message: 'Authenticated successfully', expiresAt: tokens.expiresAt }, pretty)`.
   - Add `auth status` command:
     a. Action: call `loadTokens()`. If null, output `{ authenticated: false }`. If tokens found, check if `expiresAt > Date.now()`. Output `{ authenticated: true, expiresAt, expired: boolean }`.
   - Add `auth logout` command:
     a. Action: call `clearTokens()`, call `clearCookies()`, output `{ message: 'Logged out' }`.

3. Register auth commands in `bin/linkedin.ts` by importing `registerAuthCommands` and calling it with `program`.

**Completion criteria:**
- `npm run build` succeeds.
- `linkedin auth status` outputs `{ success: true, data: { authenticated: false } }` when no tokens exist.
- `linkedin auth login` opens the browser (requires real LinkedIn app credentials in `~/.linkedin-cli/config.json`).

**Dependencies:** P1-T1, P1-T2, P1-T3

---

### P1-T5 — Global Flags Middleware

**Files to create or modify:**
- `bin/linkedin.ts`
- `src/utils/context.ts`

**Implementation steps:**

1. Create `src/utils/context.ts`:
   - Export interface `CliContext { pretty: boolean; json: boolean; debug: boolean; noCache: boolean; headless: boolean; }`.
   - Export a mutable singleton `let ctx: CliContext = { pretty: false, json: false, debug: false, noCache: false, headless: false }`.
   - Export function `setContext(c: Partial<CliContext>): void` that merges into `ctx`.
   - Export function `getContext(): CliContext` that returns `ctx`.

2. Update `bin/linkedin.ts`:
   - Add global options to `program`: `--pretty`, `--json`, `--debug`, `--no-cache`, `--headless`.
   - In `.hook('preAction', (thisCommand, actionCommand) => { ... })`, after the root check:
     a. Extract option values from `program.opts()`.
     b. Call `setContext({ pretty, json, debug, noCache, headless })`.
     c. If `debug`, print to stderr: `[debug] command: ${actionCommand.name()}`.

**Completion criteria:**
- `linkedin auth status --pretty` outputs pretty-printed JSON.
- `linkedin auth status --debug` prints the debug line to stderr.

**Dependencies:** P1-T1, P1-T4

---

### P1-T6 — Profile Command (Official API)

**Files to create or modify:**
- `src/api/client.ts`
- `src/commands/profile.ts`

**Implementation steps:**

1. Create `src/api/client.ts`:
   - Import `AuthTokens`, `CliException`, `ErrorCode`.
   - Export async function `requireValidTokens(): Promise<AuthTokens>`:
     a. Call `loadTokens()`.
     b. If null, throw `CliException('Not authenticated', AUTH_REQUIRED)`.
     c. If `tokens.expiresAt < Date.now()`, throw `CliException('Token expired, run auth login', AUTH_REQUIRED)`.
     d. Return tokens.
   - Export async function `apiGet<T>(path: string, tokens: AuthTokens): Promise<T>`:
     a. Fetch `https://api.linkedin.com/v2/${path}` with `Authorization: Bearer ${tokens.accessToken}` and `LinkedIn-Version: 202501` header.
     b. If response not ok, throw `CliException` with `NETWORK_ERROR` and include status and body.
     c. Return `response.json()` as `T`.

2. Create `src/commands/profile.ts`:
   - Import relevant utilities.
   - Export function `registerProfileCommand(program: Command): void`.
   - Add `profile` command:
     a. Option `--pretty`.
     b. Action:
        i. Call `requireValidTokens()`.
        ii. Fetch from `https://api.linkedin.com/v2/userinfo` (OIDC userinfo endpoint — use full URL).
        iii. Shape the response into `{ name, email, sub, picture }`.
        iv. Call `outputJson(data, pretty)`.

3. Register in `bin/linkedin.ts`.

**Completion criteria:**
- `linkedin profile --pretty` returns the authenticated user's name and email as pretty JSON.
- If not authenticated, outputs `{ success: false, error: { code: 'AUTH_REQUIRED', message: '...' } }` to stderr and exits with code 2.

**Dependencies:** P1-T3, P1-T4, P1-T5

---

## Phase 2: Messages

### P2-T1 — Browser Session Manager

**Files to create or modify:**
- `src/browser/session.ts`

**Implementation steps:**

1. Create `src/browser/session.ts`:
   - Import `playwright`, `keytar storage functions`, `CliException`, `getContext`.
   - Export interface `BrowserSession { browser: Browser; context: BrowserContext; page: Page; }`.
   - Export async function `createBrowserSession(): Promise<BrowserSession>`:
     a. Call `getContext()` to read `headless`.
     b. Launch Chromium: `playwright.chromium.launch({ headless, args: ['--no-sandbox'] })`.
     c. Load stored cookies: call `loadCookies()`.
     d. If cookies string exists, write to a temp file and use as `storageState`. Otherwise create context with no storage state.
     e. Create `context = await browser.newContext({ storageState: ... })`.
     f. Create `page = await context.newPage()`.
     g. Return `{ browser, context, page }`.
   - Export async function `saveBrowserSession(context: BrowserContext): Promise<void>`:
     a. Call `context.storageState()` to get state object.
     b. Serialize to JSON string.
     c. Call `saveCookies(stateJson)`.
   - Export async function `closeBrowserSession(session: BrowserSession): Promise<void>`:
     a. Call `saveBrowserSession(session.context)`.
     b. Call `session.browser.close()`.

**Completion criteria:**
- `npx tsc --noEmit` passes.
- A manual test script can call `createBrowserSession()`, navigate to `https://www.linkedin.com`, confirm the page loads, then close.

**Dependencies:** P1-T3, P1-T5

---

### P2-T2 — Browser Helpers and Delay Utilities

**Files to create or modify:**
- `src/browser/helpers.ts`

**Implementation steps:**

1. Create `src/browser/helpers.ts`:
   - Import `Page`, `CliException`, `ErrorCode`.
   - Export function `randomDelay(min = 300, max = 1200): Promise<void>` that returns `new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)))`.
   - Export async function `safeClick(page: Page, selector: string): Promise<void>`:
     a. Wait for selector with `page.waitForSelector(selector, { timeout: 10000 })`.
     b. If timeout, throw `CliException('Selector not found: ' + selector, SELECTOR_ERROR)`.
     c. Call `randomDelay()`.
     d. Click the element.
   - Export async function `safeType(page: Page, selector: string, text: string): Promise<void>`:
     a. Call `safeClick(page, selector)`.
     b. Type character by character with random delay 50-150ms per char using `page.keyboard.type`.
   - Export async function `waitForNavigation(page: Page, urlPattern: RegExp): Promise<void>`:
     a. Await `page.waitForURL(urlPattern, { timeout: 15000 })`.
     b. Throw `NETWORK_ERROR` if timeout.
   - Export async function `checkForBlock(page: Page): Promise<void>`:
     a. Check if current URL includes `checkpoint` or `challenge`.
     b. If so, throw `CliException('LinkedIn is requesting verification. Open LinkedIn in your browser to resolve.', LINKEDIN_BLOCKED)`.

**Completion criteria:**
- `npx tsc --noEmit` passes.
- `randomDelay()` called 10 times produces values visibly between 300 and 1200ms.

**Dependencies:** P2-T1

---

### P2-T3 — Messages: List Threads

**Files to create or modify:**
- `src/browser/linkedin.ts`
- `src/commands/messages.ts`

**Implementation steps:**

1. Create `src/browser/linkedin.ts`:
   - Import `createBrowserSession`, `closeBrowserSession`, `checkForBlock`, `randomDelay`.
   - Export interface `MessageThread { id: string; participantName: string; snippet: string; timestamp: string; unread: boolean; }`.
   - Export async function `ensureLoggedIn(page: Page): Promise<void>`:
     a. Navigate to `https://www.linkedin.com/feed`.
     b. If URL contains `/login` or `/authwall`, throw `CliException('Not logged in', AUTH_REQUIRED)`.
     c. Call `checkForBlock(page)`.
   - Export async function `scrapeMessageThreads(limit: number): Promise<MessageThread[]>`:
     a. Call `createBrowserSession()`.
     b. Call `ensureLoggedIn(session.page)`.
     c. Navigate to `https://www.linkedin.com/messaging/`.
     d. Call `randomDelay()`.
     e. Wait for `.msg-conversation-listitem__link` or `.msg-conversations-container` selector (timeout 15s).
     f. Call `checkForBlock(session.page)`.
     g. Evaluate in page context: extract each thread item's `{ id (from href), participantName, snippet, timestamp, unread }`.
     h. Slice to `limit`.
     i. Call `closeBrowserSession(session)`.
     j. Return threads.

2. Create `src/commands/messages.ts`:
   - Export function `registerMessagesCommands(program: Command): void`.
   - Add `messages` subcommand group.
   - Add `messages list` command:
     a. Options: `--limit <n>` (default 20), `--unread` (boolean flag), `--pretty`.
     b. Action: call `scrapeMessageThreads(limit)`, filter by `unread` if flag set, call `outputJson(threads, pretty)`.
     c. Wrap in try/catch calling `handleCommandError`.

3. Register in `bin/linkedin.ts`.

**Completion criteria:**
- `linkedin messages list --limit 5 --pretty` returns up to 5 thread objects as JSON.
- If not logged in, exits with code 2 and AUTH_REQUIRED error.

**Dependencies:** P2-T1, P2-T2, P1-T2

---

### P2-T4 — Messages: Read Thread

**Files to create or modify:**
- `src/browser/linkedin.ts`
- `src/commands/messages.ts`

**Implementation steps:**

1. Add to `src/browser/linkedin.ts`:
   - Export interface `Message { sender: string; body: string; timestamp: string; isMe: boolean; }`.
   - Export async function `scrapeThread(threadId: string): Promise<Message[]>`:
     a. Create session, ensure logged in.
     b. Navigate to `https://www.linkedin.com/messaging/thread/${threadId}/`.
     c. Call `randomDelay()`.
     d. Wait for `.msg-s-message-list` or `.msg-s-message-list-content` selector.
     e. Call `checkForBlock(session.page)`.
     f. Evaluate in page: for each `.msg-s-event-listitem`, extract sender name from `.msg-s-message-group__name`, body from `.msg-s-event-listitem__body`, timestamp from `time` element, and `isMe` from presence of `.msg-s-message-group--outgoing` class on parent.
     g. Call `closeBrowserSession(session)`.
     h. Return messages.

2. Add to `src/commands/messages.ts`:
   - Add `messages read <threadId>` command:
     a. Argument: `threadId` (required).
     b. Options: `--limit <n>` (default 50), `--pretty`.
     c. Action: call `scrapeThread(threadId)`, slice to limit (most recent), call `outputJson(messages, pretty)`.

**Completion criteria:**
- `linkedin messages read <id> --pretty` returns JSON array of messages with sender, body, timestamp, isMe.

**Dependencies:** P2-T3

---

### P2-T5 — Messages: Send and New Thread

**Files to create or modify:**
- `src/browser/linkedin.ts`
- `src/commands/messages.ts`

**Implementation steps:**

1. Add to `src/browser/linkedin.ts`:
   - Export async function `sendMessage(threadId: string, body: string): Promise<void>`:
     a. Create session, ensure logged in.
     b. Navigate to `https://www.linkedin.com/messaging/thread/${threadId}/`.
     c. Wait for message compose area: `.msg-form__contenteditable`.
     d. Call `safeClick(page, '.msg-form__contenteditable')`.
     e. Call `safeType(page, '.msg-form__contenteditable', body)`.
     f. Call `randomDelay(500, 1000)`.
     g. Click send button: `.msg-form__send-button`.
     h. Wait 1500ms for message to appear.
     i. Call `closeBrowserSession(session)`.
   - Export async function `startNewThread(recipientName: string, body: string): Promise<string>`:
     a. Create session, ensure logged in.
     b. Navigate to `https://www.linkedin.com/messaging/compose/`.
     c. Wait for recipient input, type recipient name.
     d. Wait for dropdown results, click first result.
     e. Click message body, type body.
     f. Click send.
     g. Extract new thread ID from `page.url()` after navigation.
     h. Close session.
     i. Return thread ID.

2. Add to `src/commands/messages.ts`:
   - Add `messages send <threadId>` command:
     a. Options: `--message <text>`, `--pretty`.
     b. If `--message` not provided, read from stdin.
     c. Action: call `sendMessage(threadId, body)`, output `{ sent: true, threadId }`.
   - Add `messages new` command:
     a. Options: `--to <name>` (required), `--message <text>`, `--pretty`.
     b. Action: call `startNewThread(to, message)`, output `{ sent: true, threadId }`.

**Completion criteria:**
- `linkedin messages send <id> --message "Hello"` sends and returns `{ success: true }`.
- `linkedin messages new --to "Name" --message "Hi"` starts a thread and returns `{ threadId }`.

**Dependencies:** P2-T4, P2-T2

---

## Phase 3: Feed and Search

### P3-T1 — Feed: List Posts

**Files to create or modify:**
- `src/browser/linkedin.ts`
- `src/commands/feed.ts`

**Implementation steps:**

1. Add to `src/browser/linkedin.ts`:
   - Export interface `FeedPost { urn: string; author: string; body: string; reactions: number; comments: number; url: string; timestamp: string; }`.
   - Export async function `scrapeFeed(limit: number): Promise<FeedPost[]>`:
     a. Create session, ensure logged in.
     b. Navigate to `https://www.linkedin.com/feed/`.
     c. Call `randomDelay()`.
     d. Wait for `.feed-shared-update-v2` or `.occludable-update` post container.
     e. Call `checkForBlock(session.page)`.
     f. Scroll and evaluate in page context: for each post container extract `urn` (from `data-urn`), `author` (`.update-components-actor__name`), `body` (`.feed-shared-update-v2__description`), `reactions` (reaction count), `comments` (comment count), `url` (timestamp link href), `timestamp`.
     g. Scroll to load more if limit not reached; repeat up to 3 scroll cycles.
     h. Close session.
     i. Return sliced to `limit`.

2. Create `src/commands/feed.ts`:
   - Export function `registerFeedCommand(program: Command): void`.
   - Add `feed` command:
     a. Options: `--limit <n>` (default 20), `--pretty`.
     b. Action: call `scrapeFeed(limit)`, call `outputJson(posts, pretty)`.
   - Register in `bin/linkedin.ts`.

**Completion criteria:**
- `linkedin feed --limit 5 --pretty` returns 5 posts with all required fields.

**Dependencies:** P2-T1, P2-T2

---

### P3-T2 — Search: Posts

**Files to create or modify:**
- `src/browser/linkedin.ts`
- `src/commands/search.ts`

**Implementation steps:**

1. Add to `src/browser/linkedin.ts`:
   - Export interface `SearchPost { urn: string; author: string; body: string; url: string; }`.
   - Export async function `searchPosts(query: string, limit: number): Promise<SearchPost[]>`:
     a. Create session, ensure logged in.
     b. Navigate to `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`.
     c. Call `randomDelay()`.
     d. Wait for `.search-results__list` or `.reusable-search__result-container`.
     e. Call `checkForBlock(session.page)`.
     f. Evaluate: extract `urn`, `author`, `body` snippet, `url` for each result.
     g. Close session.
     h. Return sliced to `limit`.

2. Create `src/commands/search.ts`:
   - Export function `registerSearchCommands(program: Command): void`.
   - Add `search` subcommand group.
   - Add `search posts <query>` command:
     a. Argument: `query`.
     b. Options: `--limit <n>` (default 10), `--pretty`.
     c. Action: call `searchPosts(query, limit)`, call `outputJson(results, pretty)`.
   - Register in `bin/linkedin.ts`.

**Completion criteria:**
- `linkedin search posts "typescript" --pretty` returns a list of matching posts.

**Dependencies:** P2-T1, P2-T2

---

### P3-T3 — Search: People

**Files to create or modify:**
- `src/browser/linkedin.ts`
- `src/commands/search.ts`

**Implementation steps:**

1. Add to `src/browser/linkedin.ts`:
   - Export interface `PersonResult { name: string; headline: string; profileUrl: string; connectionDegree: string; }`.
   - Export async function `searchPeople(query: string, limit: number): Promise<PersonResult[]>`:
     a. Create session, ensure logged in.
     b. Navigate to `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`.
     c. Call `randomDelay()`.
     d. Wait for results container.
     e. Call `checkForBlock(session.page)`.
     f. Evaluate: extract `name` (entity title), `headline` (entity subtitle), `profileUrl` (link href), `connectionDegree` (degree badge text).
     g. Close session.
     h. Return sliced to `limit`.

2. Add to `src/commands/search.ts`:
   - Add `search people <query>` command (same pattern as `search posts`).

**Completion criteria:**
- `linkedin search people "John Smith" --pretty` returns person profiles.

**Dependencies:** P3-T2

---

### P3-T4 — Search: Companies

**Files to create or modify:**
- `src/browser/linkedin.ts`
- `src/commands/search.ts`

**Implementation steps:**

1. Add to `src/browser/linkedin.ts`:
   - Export interface `CompanyResult { name: string; industry: string; followerCount: string; profileUrl: string; }`.
   - Export async function `searchCompanies(query: string, limit: number): Promise<CompanyResult[]>`:
     a. Create session, ensure logged in.
     b. Navigate to `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(query)}`.
     c. Call `randomDelay()`.
     d. Wait for results container.
     e. Call `checkForBlock(session.page)`.
     f. Evaluate: extract `name`, `industry`, `followerCount`, `profileUrl`.
     g. Close session.
     h. Return sliced to `limit`.

2. Add to `src/commands/search.ts`:
   - Add `search companies <query>` command.

**Completion criteria:**
- `linkedin search companies "Anthropic" --pretty` returns company info.

**Dependencies:** P3-T3

---

## Phase 4: Posting

### P4-T1 — Post: Create Text Post

**Files to create or modify:**
- `src/api/posts.ts`
- `src/commands/post.ts`

**Implementation steps:**

1. Create `src/api/posts.ts`:
   - Import `requireValidTokens`, `AuthTokens`, `CliException`.
   - Export async function `getAuthorUrn(tokens: AuthTokens): Promise<string>`:
     a. Fetch `https://api.linkedin.com/v2/userinfo` with Bearer token.
     b. Return `urn:li:person:${response.sub}`.
   - Export async function `createTextPost(text: string, tokens: AuthTokens): Promise<{ id: string }>`:
     a. Call `getAuthorUrn(tokens)`.
     b. POST to `https://api.linkedin.com/v2/ugcPosts` with body:
        ```json
        {
          "author": "<urn>",
          "lifecycleState": "PUBLISHED",
          "specificContent": {
            "com.linkedin.ugc.ShareContent": {
              "shareCommentary": { "text": "<text>" },
              "shareMediaCategory": "NONE"
            }
          },
          "visibility": { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
        }
        ```
     c. Headers: `Authorization: Bearer`, `Content-Type: application/json`, `X-Restli-Protocol-Version: 2.0.0`.
     d. Return `{ id: response.id }`.

2. Create `src/commands/post.ts`:
   - Export function `registerPostCommands(program: Command): void`.
   - Add `post create` command:
     a. Options: `--text <string>`, `--pretty`.
     b. If `--text` not provided, read from stdin.
     c. Action: call `requireValidTokens()`, call `createTextPost(text, tokens)`, call `outputJson({ id }, pretty)`.
   - Register in `bin/linkedin.ts`.

**Completion criteria:**
- `linkedin post create --text "Hello from CLI"` posts to LinkedIn and returns `{ success: true, data: { id: 'urn:li:...' } }`.

**Dependencies:** P1-T6

---

### P4-T2 — Post: Comment on Post

**Files to create or modify:**
- `src/api/posts.ts`
- `src/commands/post.ts`

**Implementation steps:**

1. Add to `src/api/posts.ts`:
   - Export async function `commentOnPost(postUrn: string, text: string, tokens: AuthTokens): Promise<{ id: string }>`:
     a. URL-encode the postUrn: `encodeURIComponent(postUrn)`.
     b. POST to `https://api.linkedin.com/v2/socialActions/${encodedUrn}/comments`.
     c. Body: `{ "actor": "<authorUrn>", "message": { "text": "<text>" } }`.
     d. Return `{ id: response.id }`.

2. Add to `src/commands/post.ts`:
   - Add `post comment <urn>` command:
     a. Argument: `urn`.
     b. Options: `--text <string>`, `--pretty`.
     c. If `--text` not provided, read from stdin.
     d. Action: call `requireValidTokens()`, call `commentOnPost(urn, text, tokens)`, output `{ id }`.

**Completion criteria:**
- `linkedin post comment "urn:li:activity:..." --text "Great post!"` returns the comment ID.

**Dependencies:** P4-T1

---

## Phase 5: Polish and Hardening

### P5-T1 — Caching Layer

**Files to create or modify:**
- `src/storage/cache.ts`

**Implementation steps:**

1. Create `src/storage/cache.ts`:
   - Import `fs/promises`, `path`, `CACHE_DIR`, `ensureConfigDir`, `getContext`.
   - Export async function `getCached<T>(key: string, ttlMs: number): Promise<T | null>`:
     a. If `getContext().noCache`, return null immediately.
     b. Read `path.join(CACHE_DIR, key + '.json')`, parse `{ data, cachedAt }`.
     c. If `Date.now() - cachedAt > ttlMs`, return null (stale).
     d. Return `data as T`.
   - Export async function `setCached<T>(key: string, data: T): Promise<void>`:
     a. Call `ensureConfigDir()`.
     b. Write `{ data, cachedAt: Date.now() }` to `path.join(CACHE_DIR, key + '.json')`.
   - Wrap `scrapeFeed` with cache (TTL 5 min), `searchPosts/People/Companies` (TTL 10 min).

**Completion criteria:**
- Second call to `linkedin feed` within 5 minutes returns without opening browser.
- `linkedin feed --no-cache` always opens the browser.

**Dependencies:** P3-T1, P3-T2, P3-T3, P3-T4

---

### P5-T2 — Security Hardening

**Files to create or modify:**
- `src/utils/security.ts`
- `bin/linkedin.ts`

**Implementation steps:**

1. Create `src/utils/security.ts`:
   - Export function `checkNotRoot(): void`: if non-Windows and `process.getuid?.() === 0`, print error JSON to stderr and `process.exit(1)`.
   - Export function `validateConfigFile(config: unknown): void`: if config object contains `accessToken`, `refreshToken`, or `cookieState` fields, log a warning to stderr.

2. Move root check from preAction hook to top of `bin/linkedin.ts` (called at module load time).

**Completion criteria:**
- `sudo linkedin auth status` (or simulated) exits immediately with error.
- `config.json` that accidentally contains token fields triggers a warning.

**Dependencies:** P1-T5

---

### P5-T3 — Stdin Utility

**Files to create or modify:**
- `src/utils/stdin.ts`
- `src/commands/post.ts`
- `src/commands/messages.ts`

**Implementation steps:**

1. Create `src/utils/stdin.ts`:
   - Export async function `readStdin(): Promise<string>`:
     a. If `process.stdin.isTTY`, return `''`.
     b. Otherwise collect all stdin chunks and return trimmed string.

2. Update `post create`, `post comment`, `messages send`, `messages new` to fall back to `readStdin()` when `--text`/`--message` not provided. If stdin also empty, throw `CliException('Text is required', CONFIG_ERROR)`.

**Completion criteria:**
- `echo "Hello world" | linkedin post create` creates a post with body "Hello world".

**Dependencies:** P4-T1, P4-T2, P2-T5

---

### P5-T4 — Debug Logging

**Files to create or modify:**
- `src/utils/logger.ts`
- `src/browser/helpers.ts`
- `src/api/client.ts`

**Implementation steps:**

1. Create `src/utils/logger.ts`:
   - Export `debug(...args: unknown[]): void` — writes `[debug] ...` to stderr if `getContext().debug`.
   - Export `warn(...args: unknown[]): void` — always writes `[warn] ...` to stderr.

2. Add `debug(...)` calls in `helpers.ts` before each `safeClick`, `safeType`, and `randomDelay`.
3. Add `debug(...)` calls in `api/client.ts` before fetch and after response.

**Completion criteria:**
- `linkedin feed --debug` shows debug lines for each Playwright action.
- `linkedin profile --debug` shows API request/response info.

**Dependencies:** P1-T5, P2-T2, P1-T6

---

### P5-T5 — Smoke Test Script

**Files to create or modify:**
- `scripts/smoke-test.sh`

**Implementation steps:**

1. Create `scripts/smoke-test.sh` (bash, `set -euo pipefail`):
   - Build: `npm run build`
   - Test 1: `auth status` returns valid JSON with `authenticated` key.
   - Test 2: `auth status --pretty` returns formatted JSON.
   - Test 3: `profile` returns success or AUTH_REQUIRED error (both valid JSON).
   - Test 4: `--help` exits 0.
   - Test 5: `messages list` returns valid JSON regardless of auth state.
   - Use `jq` to validate JSON structure on each test output.
   - Print PASS/FAIL per test.

2. `chmod +x scripts/smoke-test.sh`.

**Completion criteria:**
- `bash scripts/smoke-test.sh` prints PASS for all 5 tests.

**Dependencies:** All Phase 1-4 tasks

---

## Summary: Task Dependency Graph

```
P1-T1 (scaffold)
  └── P1-T2 (output/errors)
        └── P1-T3 (storage)
              └── P1-T4 (auth command)
                    └── P1-T5 (global flags)
                          └── P1-T6 (profile)
                                └── P4-T1 (post create)
                                      └── P4-T2 (post comment)

P1-T3 + P1-T5 → P2-T1 (browser session)
  └── P2-T2 (browser helpers)
        └── P2-T3 (messages list)
              └── P2-T4 (messages read)
                    └── P2-T5 (messages send/new)

P2-T1 + P2-T2 → P3-T1 (feed)
P3-T1 → P3-T2 (search posts)
  └── P3-T3 (search people)
        └── P3-T4 (search companies)

P3-T1 + P3-T2 + P3-T3 + P3-T4 → P5-T1 (caching)
P1-T5 → P5-T2 (security)
P4-T1 + P4-T2 + P2-T5 → P5-T3 (stdin)
P1-T5 + P2-T2 + P1-T6 → P5-T4 (debug logging)
All → P5-T5 (smoke tests)
```

## Critical Files Reference

| File | Purpose |
|---|---|
| `src/types/index.ts` | Core type definitions — created first, depended on by all modules |
| `src/utils/output.ts` | JSON output and error formatting — used by every command |
| `src/auth/oauth.ts` | OAuth 2.0 + PKCE flow — all authenticated commands depend on this |
| `src/browser/linkedin.ts` | All Playwright scraping functions — largest file in the project |
| `bin/linkedin.ts` | CLI entry point — updated as each phase adds new commands |
| `PLAN.md` | This file — update "Current Checkpoint" at the end of every session |
