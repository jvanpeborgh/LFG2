# Setting up LFG2 on your own machine (a guide for a local Claude Code agent)

This is a guide for an agent (or a person) setting up LFG2 on a local machine. Follow the steps
in order: each one says how to check it worked before moving on. Everything else about the game
is in [README.md](../README.md), and the code layout is in [ARCHITECTURE.md](ARCHITECTURE.md).

## What it is

LFG2 is a shared voxel world in the browser, written in TypeScript. Players describe things and
the game makes them: creatures, vehicles, races, hunts, raids, buildings, powers, and changes to
the world's rules. It is a monorepo with three packages:

| Package | What it is |
| --- | --- |
| `packages/shared` | Game logic used by both sides: blocks, physics, creature generation, the rules, planners |
| `packages/server` | Node server: the world, the modules (gameplay), WebSocket, the MCP server at `/mcp`, and Claude |
| `packages/client` | Browser client (Three.js, built with Vite) |

One process serves both the game and the client, on one port (8080 by default).

## Rules for the agent

- **Secrets.**
  - Never commit API keys and never write them into tracked files.
  - Keys go only in `.env` at the repository root, which git ignores.
  - Ask the user for any key you need, rather than looking for one or making one up.
  - Before committing, check `git diff --cached` contains no API keys (long strings starting with `sk-`).
- **Branch.** The work is on `claude/browser-minecraft-game-architecture-ifxylu` (not `main`).
- **Don't change the game to fix setup problems.** If something fails, check the troubleshooting
  section first. If the code really is broken, tell the user what failed and the exact output.

## 1. Prerequisites

| Need | Check | Notes |
| --- | --- | --- |
| Node.js 22 or newer | `node --version` → `v22.x` or higher | Use nvm, fnm, Volta or the installer from nodejs.org |
| npm 10+ | `npm --version` | Comes with Node |
| git | `git --version` | |
| (optional) Chromium | see step 6 | Only for the browser end-to-end tests and design renders |

It runs on macOS, Linux and Windows. On Windows, `npm run dev` uses `&` to start two processes,
so run its two halves in two terminals instead (step 5).

## 2. Get the code

```sh
git clone https://github.com/jvanpeborgh/LFG2.git
cd LFG2
git checkout claude/browser-minecraft-game-architecture-ifxylu
```

**Check:** `git log --oneline -1` shows a recent commit, and `ls packages` lists
`client server shared`.

To update later: `git pull origin claude/browser-minecraft-game-architecture-ifxylu`, then run
`npm install` and `npm run build` again.

## 3. Install and build

```sh
npm install
npm run build        # builds the browser client into packages/client/dist
```

**Check:**
- `npm install` ends without errors.
- `npm run build` ends with `✓ built in …`.
- Optionally, `npm run typecheck` prints nothing, and `npm test` ends with every test file passing
  (about 275 tests, a few minutes). Neither needs an API key or a browser.

## 4. Configure (`.env`)

```sh
cp .env.example .env
```

Then edit `.env`. Everything in it is optional: with an empty `.env` the whole game works offline
and reads requests with its built-in keyword rules.

### Claude (recommended): reading requests and designing creatures

Set `ANTHROPIC_API_KEY`. Ask the user for it; it comes from console.anthropic.com. With a key:

- **Every request is read by Claude.** This covers `/summon`, `/event`, `/race`, `/hunt`,
  `/happen` and `/arc`. Claude turns what the player typed into a plan the game builds and checks:
  - which kind of thing it is;
  - a creature's body, features, colours and temperament;
  - the rules a "happening" changes.
  It takes about 3 seconds per request. The same words are remembered and answered at once.
- **`/imagine <anything>`** has Claude design a creature in a few passes, 20–90 seconds.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | *(off)* | Turns Claude on (both the reader and the designer) |
| `INTERPRETER` | on | `off` keeps the keyword reading even with a key |
| `INTERPRETER_MODEL` | `claude-opus-5-5` | Model that reads requests |
| `INTERPRETER_EFFORT` | `low` | `low`, `medium` or `high` (higher is slower) |
| `INTERPRETER_TIMEOUT_MS` | 25000 | After this, the request falls back to the keyword reading |
| `INTERPRETER_DEBUG` | *(off)* | `1` logs each reading, with its kind and time |
| `DESIGNER_DRAFT_MODEL` | `claude-sonnet-5-5` | `/imagine`'s fast first pass |
| `DESIGNER_POLISH_MODEL` | `claude-opus-5-5` | `/imagine`'s second pass (set it empty to skip that pass) |
| `IMAGINE_DAILY`, `IMAGINE_WORLD_DAILY` | 10, 200 | Daily `/imagine` caps per player and per world |

### Server

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 8080 | HTTP and WebSocket port |
| `PUBLIC_URL` | `http://localhost:<PORT>` | The address players use. Set it to `http://<your-LAN-ip>:8080` for friends on your network |
| `ADMINS` | *(everyone)* | Comma-separated admin names. Leaving it empty makes everyone an admin: fine locally, not for a public server |
| `WORLD` | `world` | The default world's name |
| `SEED` | random | Seed for a new world (`12` is a good test world) |
| `VIEW_DISTANCE` | 4 | Chunks streamed around each player |
| `DATA_DIR` | `./data` | Where worlds are saved. Delete a world's folder to start it fresh |
| `MAX_WORLDS` | 10 | How many worlds the server holds |

### Voice (optional)

Hold **B** in game to speak commands. Either:
- leave this unset, and the browser's own speech recognition is used (Chrome, Edge, Safari); or
- set `OPENAI_API_KEY`, or `TRANSCRIBE_URL` plus `TRANSCRIBE_API_KEY` plus `TRANSCRIBE_MODEL`,
  for any Whisper-compatible endpoint. A local whisper.cpp or faster-whisper server works too.

## 5. Run

```sh
npm start            # game server and client on http://localhost:8080
```

**Check:** the log says `listening on http://localhost:8080`. With a key it also says
`Claude designs /imagine requests; Claude reads requests`. Then:

1. Open http://localhost:8080, pick a name and press play.
2. Press **T** to chat, and type `/summon a sleepy dragon I can ride`. A dragon arrives within a few
   seconds, and right-clicking it lets you ride it.
3. Try `/event make everyone tiny and fast` (a made-up rule change) and `/race a mario kart course`.
4. **H** shows the controls, and `/help` lists every command.

To play together, open a second browser window, or have a friend on your network open `PUBLIC_URL`.

For development with hot reload:

```sh
npm run dev          # macOS/Linux: server on :8080 (restarts on change) + Vite on :5173
# Windows: run these in two terminals instead
npm run dev -w @lfg/server
npm run dev -w @lfg/client
```

During development, open http://localhost:5173. Vite forwards the game connection to :8080.

## 6. (Optional) Browser tests and design renders

The `scripts/e2e-*.mjs` scripts drive real headless Chromium with `playwright-core`, which brings no
browser of its own. Install one, then point the scripts at it:

```sh
npx playwright@1.55 install chromium
# find the binary it installed:
#   macOS:   ls ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium
#   Linux:   ls ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome
#   Windows: dir %LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win\chrome.exe
export CHROMIUM=<that path>          # Windows: set CHROMIUM=<that path>
npm run build && npm run e2e         # two players in a browser; screenshots in test-results/
```

Other scripts:
- `node scripts/e2e-race.mjs`, `e2e-hunt.mjs`, `e2e-arcs.mjs`, `e2e-gear.mjs`,
  `e2e-happenings.mjs` and `e2e-finishes.mjs` each test one feature.
- `scripts/e2e-imagine.mjs` needs `ANTHROPIC_API_KEY`.
- With `CHROMIUM` set, the server can also render designs. Claude's `/imagine` passes use those
  renders to look at their work; without a browser it works blind (still fine).

The interpretation eval calls Claude about 30 times, for well under a dollar:

```sh
npx tsx scripts/interpret-eval.ts    # reads a fixed set of requests; writes test-results/interpret/eval.md
```

## 7. (Optional) Connect a chat to the game (MCP)

The server has an MCP server at `/mcp`. A chat (Claude, Claude Code, ChatGPT…) linked to a player
can do these things for them:
- see what the world can make;
- estimate costs;
- write scrolls (saved requests);
- design creatures and raids.

1. In game, type `/link` to get a one-time code. It works once, for 10 minutes.
2. In Claude Code: `claude mcp add --transport http lfg2 http://localhost:8080/mcp`.
   Cloud chat apps need a public HTTPS address, so use a tunnel such as `cloudflared` or `ngrok`.
3. Ask the chat: "link my player with code K7Q-M3P".

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Syntax errors, or `ERR_UNKNOWN_FILE_EXTENSION`, when installing or starting | Node is older than 22: upgrade it (`node --version`) |
| Blank page at :8080 | The client isn't built: `npm run build`. During development, open :5173 |
| `EADDRINUSE :8080` | Something already uses the port. Set `PORT=8090` in `.env`, or stop the other process |
| No `Claude reads requests` in the log | `ANTHROPIC_API_KEY` is missing or wrong in `.env`, or `INTERPRETER=off` |
| A request answers slowly, or reads like the keyword version | Claude didn't answer in time or there was an API error, so the keyword reading took over. Set `INTERPRETER_DEBUG=1` to see why |
| `401` / `authentication_error` in the log | The key is invalid. Ask the user for a working one |
| e2e scripts fail with `Executable doesn't exist` | Set `CHROMIUM` (step 6) |
| A friend can't connect | Use your LAN IP (not localhost) and set `PUBLIC_URL` to it. Allow port 8080 through the firewall |
| Want a fresh world | Stop the server and delete `data/<world name>/` |
| A flaky test (`rides a summon…`) fails once under load | Known to be timing-sensitive. Re-run that file alone: `npx vitest run packages/server/test/summons.test.ts` |

## 9. Where the work stands (for an agent continuing it)

Requests are being moved from keyword rules to Claude's reading:
- **Done:** creatures, vehicles, races, hunts, happenings and arcs.
- **The rest of this step:** powers, builds and scenarios need structured readings; rituals,
  `/cost`, scrolls and voice still need to go through the reader.
- **After that:**
  - gear names and lore from Claude;
  - a pets system (bonding, levels, battles between players' pets, non-combat abilities in the
    world);
  - the rest of the roadmap in [IMAGINE-BEYOND.md](IMAGINE-BEYOND.md) and
    [REALISM-ROADMAP.md](REALISM-ROADMAP.md).

The design of the reader:
- `packages/server/src/interpreter.ts` is the model call: one structured reading per request,
  cached.
- `packages/shared/src/intent.ts` defines what a reading is, and the allowlist of rules a happening
  may change.
- `packages/server/src/intent.ts` sends each reading to the module that makes it.
- The game still checks, prices and limits everything. The model decides what was meant, never
  what's allowed.

Before pushing any change, run `npm run typecheck` and `npm test`.
