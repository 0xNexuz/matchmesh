# MatchMesh

Production-oriented football fan app that combines:

- Pear-style P2P room creation and joining
- P2P fan chat, match timeline, polls, and prediction cards
- Local assistant surface with four polished prompts
- WDK-style self-custodial wallet and USDt tipping flow
- Country/team identity layer
- Named image assets in `public/images`
- Runtime service in `server/index.js` for Pears Stack, local assistant responses, WDK, chat, wallet policy intents, validation, rate limiting, and security headers

## Run

```bash
npm install
npm run dev
```

The Vite dev server is for frontend iteration. For the production runtime surface, build and start
the app server:

```bash
npm run build
npm start
```

## Runtime Configuration

- `PORT` sets the production server port. Default: `4173`.
- `MATCHMESH_DATA_DIR` sets the Hypercore/Corestore data directory.
- `MATCHMESH_ENABLE_P2P=1` enables Hyperswarm discovery for Pears Stack room sync.
- `MATCHMESH_WALLET_SEED` creates a WDK instance from a self-custody seed phrase.
- `MATCHMESH_WALLET_CHAIN=solana` and `MATCHMESH_SOLANA_RPC_URL=https://api.devnet.solana.com` register the Solana wallet module.
- `APISPORTS_KEY` or `API_FOOTBALL_KEY` enables API-Football World Cup fixtures.
- `FOOTBALL_DATA_TOKEN` enables football-data.org World Cup fixtures when API-Football is not configured.
- `MATCHMESH_FIXTURES_TIMEZONE`, `MATCHMESH_FIXTURES_DATE`, and `MATCHMESH_FIXTURES_CACHE_MS` tune fixture requests.
- `MATCHMESH_API_FOOTBALL_LEAGUE=1` and `MATCHMESH_API_FOOTBALL_SEASON=2026` scope API-Football to the 2026 World Cup.
- `MATCHMESH_FOOTBALL_DATA_COMPETITION=WC` scopes football-data.org to the World Cup competition.

## Fixture Provider Keys

Use one provider key in `.env`:

- API-Football / API-Sports: create an account at `https://dashboard.api-football.com`, copy the API key, and set `APISPORTS_KEY=...` or `API_FOOTBALL_KEY=...`.
- football-data.org: create an account at `https://www.football-data.org/client/register`, copy the token, and set `FOOTBALL_DATA_TOKEN=...`.

API-Football usually has broader live fixture coverage. football-data.org is simpler for schedules and scores when the World Cup competition is available on your plan.

## Free Working Setup

The local `.env` is configured for a free development setup:

- Fixtures: football-data.org token.
- Wallet: Solana devnet public RPC.
- Seed: the standard public WDK development mnemonic. Use it only for devnet/testing; never send real funds to it.
- AI: deterministic local assistant by default.

## Native Runtime Notes

The app degrades gracefully when native/runtime packages cannot load:

- Pears Stack falls back to an in-memory room log.
- Local assistant responses are deterministic and do not require a model worker.
- WDK falls back to wallet policy-intent logging when no seed is configured.

For a full live-stack deployment:

```bash
npm ci
npm run check
```

On Windows, stop any running Vite or MatchMesh node processes before reinstalling native modules, because packages such as `fs-native-extensions` can stay locked by active Node processes.

## Build

```bash
npm run build
```

## Verification

```bash
npm test
npm run check
npm audit --omit=dev
```

## Production Readiness

- Security headers are applied to API and static responses.
- API requests are rate limited and JSON bodies are size capped.
- Room creation, chat messages, assistant requests, and wallet tip intents are server-backed.
- World Cup fixtures are server-backed through `/api/fixtures` with short cache protection.
- Local assistant responses are deterministic, fast, and available without model downloads.
- WDK runs in policy-ledger mode until `MATCHMESH_WALLET_SEED` is configured; the Solana wallet manager is installed and registers when `MATCHMESH_SOLANA_RPC_URL` is set.
- `/api/health` and `/api/status` expose deployment health and runtime readiness.
- Node test coverage verifies the critical API flows.

## Track Coverage

- Pears Stack: the runtime initializes Hypercore/Corestore and can join Hyperswarm when `MATCHMESH_ENABLE_P2P=1`.
- Local AI: deterministic assistant responses cover tactical explanations, summaries, recaps, and translation-style prompts.
- WDK: the runtime imports `@tetherto/wdk`; set `MATCHMESH_WALLET_SEED` and register wallet modules for live accounts.
- Fixtures: set `APISPORTS_KEY`, `API_FOOTBALL_KEY`, or `FOOTBALL_DATA_TOKEN` for real World Cup provider data; otherwise the app serves a curated World Cup fallback slate.

Runtime health is exposed at `/api/health` and `/api/status`.
