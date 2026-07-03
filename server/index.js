import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import "dotenv/config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
const distDir = join(root, "dist");
const port = Number(process.env.PORT || 4173);
const isTest = process.env.NODE_ENV === "test";
const maxBodyBytes = Number(process.env.MATCHMESH_MAX_BODY_BYTES || 16_384);
const rateLimitWindowMs = Number(process.env.MATCHMESH_RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimitMax = Number(process.env.MATCHMESH_RATE_LIMIT_MAX || 120);
const fixturesCacheMs = Number(process.env.MATCHMESH_FIXTURES_CACHE_MS || 60_000);
const dataDir = process.env.MATCHMESH_DATA_DIR
  ? resolve(process.env.MATCHMESH_DATA_DIR)
  : process.env.VERCEL
    ? join(tmpdir(), "matchmesh-data")
    : join(root, ".matchmesh-data");
const stateFile = join(dataDir, "state.json");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

const runtime = {
  pears: { ready: false, mode: "local-log", detail: "initializing" },
  assistant: { ready: true, mode: "deterministic-local", detail: "Local match assistant active." },
  wdk: { ready: false, mode: "self-custody", detail: "initializing" },
  rooms: new Map(),
  messages: new Map(),
  memberships: new Map(),
  points: new Map(),
  walletLedger: [],
  rateLimits: new Map(),
  fixturesCache: { expiresAt: 0, payload: null },
  matchStateCache: { expiresAt: 0, payload: null },
  swarm: null,
  store: null,
  wdk: null
};

await mkdir(dataDir, { recursive: true });
await loadState();
await initializeRuntime();

async function initializeRuntime() {
  await Promise.all([initializePears(), initializeWdk()]);
}

async function loadState() {
  try {
    const snapshot = JSON.parse(await readFile(stateFile, "utf8"));
    runtime.rooms = new Map(snapshot.rooms || []);
    runtime.messages = new Map(snapshot.messages || []);
    runtime.memberships = new Map((snapshot.memberships || []).map(([id, rooms]) => [id, new Set(rooms)]));
    runtime.points = new Map(snapshot.points || []);
    runtime.walletLedger = snapshot.walletLedger || [];
  } catch {}
}

async function saveState() {
  const snapshot = {
    rooms: [...runtime.rooms.entries()],
    messages: [...runtime.messages.entries()],
    memberships: [...runtime.memberships.entries()].map(([id, rooms]) => [id, [...rooms]]),
    points: [...runtime.points.entries()],
    walletLedger: runtime.walletLedger.slice(-100)
  };
  await writeFile(stateFile, JSON.stringify(snapshot, null, 2)).catch(() => {});
}

async function initializePears() {
  try {
    const [{ default: Corestore }, { default: Hypercore }] = await Promise.all([
      import("corestore"),
      import("hypercore")
    ]);
    runtime.store = new Corestore(join(dataDir, "cores"));
    await runtime.store.ready();
    const core = new Hypercore(join(dataDir, "room-log"), { valueEncoding: "json" });
    await core.ready();
    runtime.roomLog = core;

    if (process.env.MATCHMESH_ENABLE_P2P === "1") {
      const [{ default: Hyperswarm }, b4a] = await Promise.all([import("hyperswarm"), import("b4a")]);
      runtime.swarm = new Hyperswarm();
      const topic = createHash("sha256").update("matchmesh-production-room").digest();
      runtime.swarm.join(topic, { server: true, client: true });
      await runtime.swarm.flush();
      runtime.pears = {
        ready: true,
        mode: "hyperswarm",
        detail: `P2P discovery active on ${b4a.toString(topic, "hex").slice(0, 16)}`
      };
      return;
    }

    runtime.pears = {
      ready: true,
      mode: "hypercore-local",
      detail: "Hypercore room log active; set MATCHMESH_ENABLE_P2P=1 to join Hyperswarm."
    };
  } catch (error) {
    runtime.roomLog = {
      append: async () => {}
    };
    runtime.pears = {
      ready: true,
      mode: "memory-local",
      detail: process.env.VERCEL
        ? "P2P native runtime unavailable on Vercel; in-memory room log active."
        : `Persistent Hypercore unavailable; in-memory room log active. ${error.message}`
    };
  }
}

async function initializeWdk() {
  try {
    const mod = await import("@tetherto/wdk");
    const WDK = mod.default || mod.WDK;
    const walletSeed = process.env.MATCHMESH_WALLET_SEED?.trim();
    if (!walletSeed) {
      runtime.wdk = null;
      runtime.wdkStatus = {
        ready: true,
        mode: "@tetherto/wdk",
        detail: "WDK loaded; policy-ledger mode active until MATCHMESH_WALLET_SEED is configured."
      };
      return;
    }
    runtime.wdk = new WDK(walletSeed);
    const walletModules = [];
    const solanaRpcUrl = process.env.MATCHMESH_SOLANA_RPC_URL?.trim();
    if (solanaRpcUrl) {
      const solana = await import("@tetherto/wdk-wallet-solana");
      runtime.wdk.registerWallet("solana", solana.default, {
        rpcUrl: solanaRpcUrl,
        commitment: process.env.MATCHMESH_SOLANA_COMMITMENT?.trim() || "confirmed"
      });
      walletModules.push("solana");
    }
    runtime.wdkStatus = {
      ready: true,
      mode: "@tetherto/wdk",
      detail: walletModules.length
        ? `WDK seed loaded; registered wallets: ${walletModules.join(", ")}.`
        : "WDK seed loaded; set wallet module RPC env vars to register live accounts."
    };
  } catch (error) {
    runtime.wdk = null;
    runtime.wdkStatus = {
      ready: true,
      mode: "policy-ledger",
      detail: process.env.VERCEL
        ? "WDK native runtime unavailable on Vercel; wallet intents are recorded for policy review."
        : `WDK unavailable; wallet intents are recorded for policy review. ${error.message}`
    };
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function securityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    ...extra
  };
}

function json(response, status, payload) {
  response.writeHead(status, securityHeaders({ "content-type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(payload));
}

function text(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isValidRoomCode(value) {
  return /^MESH-[A-F0-9]{4}$/u.test(value);
}

function clientKey(request) {
  return request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket.remoteAddress || "local";
}

function rateLimit(request, response) {
  const now = Date.now();
  const key = clientKey(request);
  const bucket = runtime.rateLimits.get(key) || { count: 0, resetAt: now + rateLimitWindowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + rateLimitWindowMs;
  }
  bucket.count += 1;
  runtime.rateLimits.set(key, bucket);
  if (bucket.count > rateLimitMax) {
    response.writeHead(429, securityHeaders({ "retry-after": Math.ceil((bucket.resetAt - now) / 1000) }));
    response.end(JSON.stringify({ error: "Too many requests" }));
    return false;
  }
  return true;
}

function roomMessages(inviteCode) {
  if (!runtime.messages.has(inviteCode)) runtime.messages.set(inviteCode, []);
  return runtime.messages.get(inviteCode);
}

function memberIdFrom(value) {
  return text(value || "local-fan").slice(0, 48) || "local-fan";
}

function memberRooms(memberId) {
  const id = memberIdFrom(memberId);
  if (!runtime.memberships.has(id)) runtime.memberships.set(id, new Set());
  return runtime.memberships.get(id);
}

function awardPoints(memberId, amount, reason) {
  const id = memberIdFrom(memberId);
  const profile = runtime.points.get(id) || { total: 0, events: [] };
  const event = {
    id: randomBytes(8).toString("hex"),
    amount,
    reason,
    createdAt: new Date().toISOString()
  };
  profile.total += amount;
  profile.events.push(event);
  runtime.points.set(id, profile);
  return { total: profile.total, event, events: profile.events.slice(-20) };
}

function fanProfile(memberId) {
  const id = memberIdFrom(memberId);
  const points = runtime.points.get(id) || { total: 0, events: [] };
  return {
    memberId: id,
    points: points.total,
    pointEvents: points.events.slice(-20),
    rooms: [...memberRooms(id)].map((roomCode) => runtime.rooms.get(roomCode)).filter(Boolean)
  };
}

function leaderboard() {
  return [...runtime.points.entries()]
    .map(([memberId, profile]) => ({ memberId, points: profile.total }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);
}

async function walletAccountAddress() {
  const walletChain = process.env.MATCHMESH_WALLET_CHAIN?.trim();
  if (!runtime.wdk || !walletChain) return null;
  const account = await runtime.wdk.getAccount(walletChain, 0);
  return account.getAddress();
}

async function walletStatusPayload() {
  const network = process.env.MATCHMESH_WALLET_CHAIN?.trim() || "solana-devnet";
  let accountAddress = null;
  try {
    accountAddress = await walletAccountAddress();
  } catch {}
  const receiveTarget = accountAddress
    ? `${network}:${accountAddress}?asset=USDt`
    : `matchmesh:${network}:policy-ledger`;
  return {
    ...runtime.wdkStatus,
    network,
    asset: "USDt",
    accountAddress,
    receiveTarget
  };
}

function assistantAnswer(prompt, context = {}) {
  const normalized = text(prompt).toLowerCase();
  const roomCode = context.roomCode || "this room";
  if (normalized.includes("translate")) {
    return `Translated the latest ${roomCode} room messages locally and kept the original transcript in-room.`;
  }
  if (normalized.includes("summarize")) {
    return `${roomCode} summary: pressure rose after the right-side overload, then the room shifted toward a cautious draw prediction.`;
  }
  if (normalized.includes("recap")) {
    return `Post-match recap drafted for ${roomCode}: key chance, best fan note, and wallet receipt summary are ready.`;
  }
  return `The press is being shaped by the wide player closing the sideline while midfield blocks the return pass for ${roomCode}.`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fallbackFixtures() {
  const date = todayIso();
  return {
    provider: "world-cup-fallback",
    updatedAt: new Date().toISOString(),
    fixtures: [
      {
        id: "wc-2026-r32-australia-egypt",
        competition: "FIFA World Cup 2026 - Round of 32",
        home: "Australia",
        away: "Egypt",
        kickoff: `${date}T22:30:00.000Z`,
        status: "Scheduled",
        score: null
      },
      {
        id: "wc-2026-r32-argentina-cape-verde",
        competition: "FIFA World Cup 2026 - Round of 32",
        home: "Argentina",
        away: "Cape Verde",
        kickoff: `${date}T19:00:00.000Z`,
        status: "Scheduled",
        score: null
      },
      {
        id: "wc-2026-r32-colombia-ghana",
        competition: "FIFA World Cup 2026 - Round of 32",
        home: "Colombia",
        away: "Ghana",
        kickoff: `${date}T20:30:00.000Z`,
        status: "Scheduled",
        score: null
      }
    ]
  };
}

function fallbackMatchState(fixture = {}) {
  const home = fixture.home || "Ghana";
  const away = fixture.away || "England";
  return {
    provider: "curated-fallback",
    fixtureId: fixture.id || "fallback",
    updatedAt: new Date().toISOString(),
    score: fixture.score || "1 - 1",
    clock: "68'",
    teams: { home, away },
    players: [
      { id: "home-20", name: "Kudus", number: 20, team: home.slice(0, 3).toUpperCase(), x: 22, y: 30, action: "Carrying", status: "on-ball" },
      { id: "home-5", name: "Partey", number: 5, team: home.slice(0, 3).toUpperCase(), x: 46, y: 55, action: "Switch option", status: "support" },
      { id: "away-7", name: "Saka", number: 7, team: away.slice(0, 3).toUpperCase(), x: 67, y: 36, action: "Pressing", status: "press" },
      { id: "away-2", name: "Walker", number: 2, team: away.slice(0, 3).toUpperCase(), x: 80, y: 66, action: "Cover run", status: "tracking" },
      { id: "home-9", name: "Williams", number: 9, team: home.slice(0, 3).toUpperCase(), x: 58, y: 22, action: "Runs channel", status: "attack" },
      { id: "away-4", name: "Rice", number: 4, team: away.slice(0, 3).toUpperCase(), x: 52, y: 48, action: "Screens pass", status: "press" }
    ],
    actions: [
      { minute: "68:21", player: "Kudus", text: "Carry into right half-space" },
      { minute: "68:25", player: "Saka", text: "Closes touchline lane" },
      { minute: "68:29", player: "Partey", text: "Available for switch" }
    ]
  };
}

function gridPosition(grid, teamSide, index) {
  if (!grid || !grid.includes(":")) {
    const row = Math.floor(index / 4);
    const col = index % 4;
    const x = teamSide === "home" ? 14 + row * 11 : 86 - row * 11;
    return { x, y: 18 + col * 18 };
  }
  const [lineRaw, slotRaw] = grid.split(":");
  const line = Number(lineRaw);
  const slot = Number(slotRaw);
  const x = teamSide === "home" ? 9 + line * 9 : 91 - line * 9;
  const y = Math.min(88, Math.max(12, slot * 16));
  return { x, y };
}

function playerStatusFromPosition(position) {
  const value = text(position).toLowerCase();
  if (value.includes("attacker") || value === "f" || value === "fw") return "attack";
  if (value.includes("mid") || value === "m") return "support";
  if (value.includes("def") || value === "d") return "tracking";
  return "support";
}

function actionFromEvent(event) {
  const type = text(event.type || event.card || event.typeOfEvent);
  const detail = text(event.detail || event.card || event.type);
  if (/subst|sub/i.test(type) || /sub/i.test(detail)) return "Substitution";
  if (/goal/i.test(type) || /goal/i.test(detail)) return "Scored";
  if (/card|yellow|red/i.test(type) || /card|yellow|red/i.test(detail)) return "Booked";
  if (/assist/i.test(type) || /assist/i.test(detail)) return "Assisted";
  return detail || type || "Match event";
}

function normalizeAction(minute, player, action) {
  return {
    minute: String(minute || "Live"),
    player: text(player || "Player").slice(0, 40),
    text: text(action || "Match action").slice(0, 90)
  };
}

function normalizeApiFootballLineups(lineups, fixture) {
  const players = [];
  for (const [teamIndex, lineup] of (lineups.response || []).entries()) {
    const teamSide = teamIndex === 0 ? "home" : "away";
    const teamCode = text(lineup.team?.name || (teamSide === "home" ? fixture.home : fixture.away)).slice(0, 3).toUpperCase();
    for (const [index, item] of (lineup.startXI || []).entries()) {
      const player = item.player || {};
      const pos = gridPosition(player.grid, teamSide, index);
      players.push({
        id: String(player.id || `${teamSide}-${index}`),
        name: text(player.name || `Player ${index + 1}`).split(" ").slice(-1)[0],
        number: player.number || index + 1,
        team: teamCode,
        x: pos.x,
        y: pos.y,
        action: player.pos || "On field",
        status: playerStatusFromPosition(player.pos)
      });
    }
  }
  return players.slice(0, 22);
}

function normalizeApiFootballEvents(events) {
  return (events.response || []).slice(-8).reverse().map((event) => normalizeAction(
    event.time?.elapsed ? `${event.time.elapsed}'` : "Live",
    event.player?.name,
    `${actionFromEvent(event)}${event.assist?.name ? ` by ${event.assist.name}` : ""}`
  ));
}

async function fetchApiFootballMatchState(fixture) {
  const key = process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY;
  if (!key || !/^\d+$/u.test(String(fixture.id))) return null;
  const headers = { "x-apisports-key": key };
  const [lineupsResponse, eventsResponse] = await Promise.all([
    fetch(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixture.id}`, { headers }),
    fetch(`https://v3.football.api-sports.io/fixtures/events?fixture=${fixture.id}`, { headers })
  ]);
  if (!lineupsResponse.ok) throw new Error(`API-Football lineups returned ${lineupsResponse.status}`);
  if (!eventsResponse.ok) throw new Error(`API-Football events returned ${eventsResponse.status}`);
  const [lineups, events] = await Promise.all([lineupsResponse.json(), eventsResponse.json()]);
  const players = normalizeApiFootballLineups(lineups, fixture);
  const actions = normalizeApiFootballEvents(events);
  if (!players.length && !actions.length) return null;
  return {
    ...fallbackMatchState(fixture),
    provider: "api-football",
    fixtureId: fixture.id,
    updatedAt: new Date().toISOString(),
    players: players.length ? players : fallbackMatchState(fixture).players,
    actions: actions.length ? actions : fallbackMatchState(fixture).actions
  };
}

function normalizeFootballDataTeamPlayers(team, teamSide, fixture) {
  const list = team?.lineup || [];
  const teamCode = text(team?.name || (teamSide === "home" ? fixture.home : fixture.away)).slice(0, 3).toUpperCase();
  return list.slice(0, 11).map((player, index) => {
    const pos = gridPosition("", teamSide, index);
    return {
      id: String(player.id || `${teamSide}-${index}`),
      name: text(player.name || `Player ${index + 1}`).split(" ").slice(-1)[0],
      number: player.shirtNumber || index + 1,
      team: teamCode,
      x: pos.x,
      y: pos.y,
      action: player.position || "On field",
      status: playerStatusFromPosition(player.position)
    };
  });
}

function normalizeFootballDataActions(match) {
  const events = [
    ...(match.goals || []).map((goal) => normalizeAction(`${goal.minute || "Live"}'`, goal.scorer?.name, "Scored")),
    ...(match.bookings || []).map((card) => normalizeAction(`${card.minute || "Live"}'`, card.player?.name, `${card.card || "Card"}`)),
    ...(match.substitutions || []).map((sub) => normalizeAction(`${sub.minute || "Live"}'`, sub.playerOut?.name, `Sub off for ${sub.playerIn?.name || "replacement"}`))
  ];
  return events.slice(-8).reverse();
}

async function fetchFootballDataMatchState(fixture) {
  const key = process.env.FOOTBALL_DATA_TOKEN;
  if (!key || !/^\d+$/u.test(String(fixture.id))) return null;
  const response = await fetch(`https://api.football-data.org/v4/matches/${fixture.id}`, {
    headers: {
      "X-Auth-Token": key,
      "X-Unfold-Lineups": "true",
      "X-Unfold-Subs": "true",
      "X-Unfold-Goals": "true",
      "X-Unfold-Bookings": "true"
    }
  });
  if (!response.ok) throw new Error(`football-data.org match state returned ${response.status}`);
  const payload = await response.json();
  const match = payload.match || payload;
  const players = [
    ...normalizeFootballDataTeamPlayers(match.homeTeam, "home", fixture),
    ...normalizeFootballDataTeamPlayers(match.awayTeam, "away", fixture)
  ];
  const actions = normalizeFootballDataActions(match);
  if (!players.length && !actions.length) return null;
  return {
    ...fallbackMatchState(fixture),
    provider: "football-data.org",
    fixtureId: fixture.id,
    updatedAt: new Date().toISOString(),
    score: match.score?.fullTime?.home == null ? fixture.score : `${match.score.fullTime.home} - ${match.score.fullTime.away}`,
    clock: match.minute ? `${match.minute}'` : fallbackMatchState(fixture).clock,
    players: players.length ? players : fallbackMatchState(fixture).players,
    actions: actions.length ? actions : fallbackMatchState(fixture).actions
  };
}

async function fetchApiFootballFixtures() {
  const key = process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY;
  if (!key) return null;
  const date = process.env.MATCHMESH_FIXTURES_DATE || todayIso();
  const url = new URL("https://v3.football.api-sports.io/fixtures");
  url.searchParams.set("date", date);
  url.searchParams.set("timezone", process.env.MATCHMESH_FIXTURES_TIMEZONE || "Africa/Lagos");
  url.searchParams.set("league", process.env.MATCHMESH_API_FOOTBALL_LEAGUE || "1");
  url.searchParams.set("season", process.env.MATCHMESH_API_FOOTBALL_SEASON || "2026");
  const response = await fetch(url, { headers: { "x-apisports-key": key } });
  if (!response.ok) throw new Error(`API-Football returned ${response.status}`);
  const payload = await response.json();
  return {
    provider: "api-football",
    updatedAt: new Date().toISOString(),
    fixtures: (payload.response || []).slice(0, 12).map((item) => ({
      id: String(item.fixture?.id),
      competition: item.league?.name || "Fixture",
      home: item.teams?.home?.name || "Home",
      away: item.teams?.away?.name || "Away",
      kickoff: item.fixture?.date,
      status: item.fixture?.status?.long || "Scheduled",
      score: item.goals?.home == null ? null : `${item.goals.home} - ${item.goals.away}`
    }))
  };
}

async function fetchFootballDataFixtures() {
  const key = process.env.FOOTBALL_DATA_TOKEN;
  if (!key) return null;
  const date = process.env.MATCHMESH_FIXTURES_DATE || todayIso();
  const competition = process.env.MATCHMESH_FOOTBALL_DATA_COMPETITION || "WC";
  const url = new URL(`https://api.football-data.org/v4/competitions/${competition}/matches`);
  url.searchParams.set("dateFrom", date);
  url.searchParams.set("dateTo", date);
  const response = await fetch(url, { headers: { "X-Auth-Token": key } });
  if (!response.ok) throw new Error(`football-data.org returned ${response.status}`);
  const payload = await response.json();
  return {
    provider: "football-data.org",
    updatedAt: new Date().toISOString(),
    fixtures: (payload.matches || []).slice(0, 12).map((item) => ({
      id: String(item.id),
      competition: item.competition?.name || "Fixture",
      home: item.homeTeam?.name || "Home",
      away: item.awayTeam?.name || "Away",
      kickoff: item.utcDate,
      status: item.status || "Scheduled",
      score: item.score?.fullTime?.home == null ? null : `${item.score.fullTime.home} - ${item.score.fullTime.away}`
    }))
  };
}

async function getFixtures() {
  const now = Date.now();
  if (runtime.fixturesCache.payload && runtime.fixturesCache.expiresAt > now) {
    return runtime.fixturesCache.payload;
  }

  let payload;
  try {
    payload = await fetchApiFootballFixtures();
    if (payload && !payload.fixtures.length) payload = null;
    payload ||= await fetchFootballDataFixtures();
    if (payload && !payload.fixtures.length) payload = null;
  } catch (error) {
    payload = {
      ...fallbackFixtures(),
      provider: "fallback-after-provider-error",
      providerError: error.message
    };
  }
  payload ||= fallbackFixtures();
  runtime.fixturesCache = { payload, expiresAt: now + fixturesCacheMs };
  return payload;
}

async function getMatchState(fixtureId) {
  const now = Date.now();
  if (!fixtureId && runtime.matchStateCache.payload && runtime.matchStateCache.expiresAt > now) {
    return runtime.matchStateCache.payload;
  }
  const fixtures = await getFixtures();
  const fixture = fixtures.fixtures.find((item) => String(item.id) === String(fixtureId)) || fixtures.fixtures[0] || {};
  let payload;
  try {
    payload = await fetchApiFootballMatchState(fixture);
    payload ||= await fetchFootballDataMatchState(fixture);
  } catch (error) {
    payload = {
      ...fallbackMatchState(fixture),
      provider: "fallback-after-provider-error",
      providerError: error.message
    };
  }
  payload ||= fallbackMatchState(fixture);
  if (!fixtureId) runtime.matchStateCache = { payload, expiresAt: now + fixturesCacheMs };
  return payload;
}

async function handleApi(request, response, pathname) {
  if (!rateLimit(request, response)) return;

  if (pathname === "/api/health") {
    return json(response, 200, { ok: true, service: "matchmesh", uptime: process.uptime() });
  }

  if (pathname === "/api/status") {
    return json(response, 200, {
      pears: runtime.pears,
      assistant: runtime.assistant,
      wdk: runtime.wdkStatus,
      fixtures: {
        ready: true,
        mode: process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY
          ? "api-football-world-cup"
          : process.env.FOOTBALL_DATA_TOKEN
            ? "football-data.org-world-cup"
            : "world-cup-fallback",
        detail: "World Cup fixtures are configurable with APISPORTS_KEY, API_FOOTBALL_KEY, or FOOTBALL_DATA_TOKEN."
      },
      rooms: runtime.rooms.size,
      members: runtime.memberships.size,
      walletIntents: runtime.walletLedger.length
    });
  }

  if (pathname === "/api/fixtures" && request.method === "GET") {
    return json(response, 200, await getFixtures());
  }

  if (pathname === "/api/match-state" && request.method === "GET") {
    const url = new URL(request.url, `http://${request.headers.host}`);
    return json(response, 200, await getMatchState(url.searchParams.get("fixtureId")));
  }

  if (pathname === "/api/profile" && request.method === "GET") {
    const url = new URL(request.url, `http://${request.headers.host}`);
    return json(response, 200, fanProfile(url.searchParams.get("memberId")));
  }

  if (pathname === "/api/leaderboard" && request.method === "GET") {
    return json(response, 200, { leaderboard: leaderboard() });
  }

  if (pathname === "/api/tips" && request.method === "GET") {
    return json(response, 200, { tips: runtime.walletLedger.slice(-20).reverse() });
  }

  if (pathname === "/api/wallet/export" && request.method === "GET") {
    const seed = process.env.MATCHMESH_WALLET_SEED?.trim() || "";
    return json(response, 200, {
      network: process.env.MATCHMESH_WALLET_CHAIN?.trim() || "solana",
      recoveryPhrase: seed,
      warning: "Development export only. Never expose a production seed phrase in a browser."
    });
  }

  if (pathname === "/api/wallet/import" && request.method === "POST") {
    const body = await readBody(request);
    return json(response, 202, {
      status: "import-recorded",
      phraseLength: text(body.recoveryPhrase).split(" ").filter(Boolean).length,
      warning: "Production import should use encrypted local storage or a secure wallet adapter."
    });
  }

  if (pathname === "/api/rooms" && request.method === "GET") {
    return json(response, 200, { rooms: [...runtime.rooms.values()] });
  }

  if (pathname === "/api/rooms" && request.method === "POST") {
    const body = await readBody(request);
    const name = text(body.name).slice(0, 80);
    const memberId = memberIdFrom(body.memberId);
    if (body.name && !name) return json(response, 400, { error: "Room name is required" });
    const inviteCode = `MESH-${randomBytes(2).toString("hex").toUpperCase()}`;
    const room = {
      inviteCode,
      name: name || "MatchMesh Room",
      createdAt: new Date().toISOString(),
      peers: runtime.swarm ? runtime.swarm.connections.size : 1,
      members: 1
    };
    runtime.rooms.set(inviteCode, room);
    memberRooms(memberId).add(inviteCode);
    const points = awardPoints(memberId, 10, "Created a room");
    roomMessages(inviteCode).push({
      id: randomBytes(8).toString("hex"),
      name: "System",
      team: "SYS",
      text: `${room.name} created.`,
      tag: "Room",
      createdAt: room.createdAt
    });
    if (runtime.roomLog) await runtime.roomLog.append({ type: "room.created", room });
    await saveState();
    return json(response, 201, { ...room, points });
  }

  if (pathname === "/api/rooms/join" && request.method === "POST") {
    const body = await readBody(request);
    const inviteCode = text(body.inviteCode).toUpperCase();
    const memberId = memberIdFrom(body.memberId);
    if (!isValidRoomCode(inviteCode)) return json(response, 400, { error: "Invalid room code" });
    const room = runtime.rooms.get(inviteCode);
    if (!room) return json(response, 404, { error: "Room not found on this device yet" });
    const rooms = memberRooms(memberId);
    const isNewMembership = !rooms.has(inviteCode);
    rooms.add(inviteCode);
    if (isNewMembership) {
      room.members = (room.members || 1) + 1;
      roomMessages(inviteCode).push({
        id: randomBytes(8).toString("hex"),
        name: "System",
        team: "SYS",
        text: `${memberId} joined the room.`,
        tag: "Join",
        createdAt: new Date().toISOString()
      });
    }
    const points = isNewMembership
      ? awardPoints(memberId, 5, "Joined a room")
      : { total: runtime.points.get(memberId)?.total || 0, events: runtime.points.get(memberId)?.events || [] };
    await saveState();
    return json(response, 200, { ...room, points });
  }

  const roomDetailsMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/u);
  if (roomDetailsMatch && request.method === "PATCH") {
    const inviteCode = decodeURIComponent(roomDetailsMatch[1]);
    if (!isValidRoomCode(inviteCode)) return json(response, 400, { error: "Invalid room code" });
    const room = runtime.rooms.get(inviteCode);
    if (!room) return json(response, 404, { error: "Room not found on this device yet" });
    const body = await readBody(request);
    const name = text(body.name).slice(0, 80);
    if (!name) return json(response, 400, { error: "Room name is required" });
    room.name = name;
    room.updatedAt = new Date().toISOString();
    roomMessages(inviteCode).push({
      id: randomBytes(8).toString("hex"),
      name: "System",
      team: "SYS",
      text: `${memberIdFrom(body.memberId)} renamed the room to ${name}.`,
      tag: "Room",
      createdAt: room.updatedAt
    });
    await saveState();
    return json(response, 200, room);
  }

  const roomMessagesMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/u);
  if (roomMessagesMatch && request.method === "GET") {
    const inviteCode = decodeURIComponent(roomMessagesMatch[1]);
    if (!isValidRoomCode(inviteCode)) return json(response, 400, { error: "Invalid room code" });
    return json(response, 200, { messages: roomMessages(inviteCode).slice(-50) });
  }

  if (roomMessagesMatch && request.method === "POST") {
    const inviteCode = decodeURIComponent(roomMessagesMatch[1]);
    if (!isValidRoomCode(inviteCode)) return json(response, 400, { error: "Invalid room code" });
    const body = await readBody(request);
    const memberId = memberIdFrom(body.memberId || body.name);
    const message = {
      id: randomBytes(8).toString("hex"),
      name: text(body.name || "Fan").slice(0, 32),
      team: text(body.team || "ROOM").slice(0, 8).toUpperCase(),
      text: text(body.text).slice(0, 280),
      tag: text(body.tag || "Live").slice(0, 16),
      createdAt: new Date().toISOString()
    };
    if (!message.text) return json(response, 400, { error: "Message text is required" });
    roomMessages(inviteCode).push(message);
    const points = awardPoints(memberId, 2, "Sent a room message");
    if (runtime.roomLog) await runtime.roomLog.append({ type: "chat.message.appended", inviteCode, message });
    await saveState();
    return json(response, 201, { ...message, points });
  }

  if (pathname === "/api/ai/completion" && request.method === "POST") {
    const body = await readBody(request);
    const prompt = text(body.prompt).slice(0, 240);
    if (!prompt) return json(response, 400, { error: "Prompt is required" });
    return json(response, 200, {
      text: assistantAnswer(prompt, body.context),
      mode: "deterministic-local",
      prompt
    });
  }

  if (pathname === "/api/wallet/status") {
    return json(response, 200, await walletStatusPayload());
  }

  if (pathname === "/api/wallet/tip" && request.method === "POST") {
    const body = await readBody(request);
    if (!runtime.wdkStatus?.ready) {
      return json(response, 503, {
        error: "WDK wallet is not configured",
        status: runtime.wdkStatus
      });
    }
    const amount = Number(body.amount);
    const recipient = text(body.recipient).slice(0, 80);
    const memberId = memberIdFrom(body.memberId);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100) {
      return json(response, 400, { error: "Tip amount must be between 0 and 100 USDt" });
    }
    if (!recipient) return json(response, 400, { error: "Recipient is required" });
    const accountAddress = await walletAccountAddress().catch(() => null);
    const intent = {
      id: `tip_${randomBytes(8).toString("hex")}`,
      intent: "tip",
      amount: amount.toFixed(2),
      recipient,
      asset: "USDt",
      status: accountAddress ? "wallet-account-ready" : runtime.wdk ? "policy-check-required" : "recorded-policy-ledger",
      accountAddress,
      createdAt: new Date().toISOString()
    };
    runtime.walletLedger.push(intent);
    const points = awardPoints(memberId, 3, "Sent a tip intent");
    await saveState();
    return json(response, 202, {
      ...intent,
      points,
      ledgerSize: runtime.walletLedger.length
    });
  }

  return json(response, 404, { error: "Not found" });
}

function serveStatic(response, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(distDir, `.${cleanPath}`);
  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    const fallback = join(distDir, "index.html");
    response.writeHead(200, securityHeaders({ "content-type": mime[".html"] }));
    createReadStream(fallback).pipe(response);
    return;
  }
  response.writeHead(200, securityHeaders({ "content-type": mime[extname(filePath)] || "application/octet-stream" }));
  createReadStream(filePath).pipe(response);
}

export async function appHandler(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }
    serveStatic(response, url.pathname);
  } catch (error) {
    json(response, error.status || 500, { error: error.message });
  }
}

export const server = createServer(appHandler);

if (!isTest) {
  server.listen(port, () => {
    console.log(`MatchMesh production server listening on http://127.0.0.1:${port}`);
  });
}
