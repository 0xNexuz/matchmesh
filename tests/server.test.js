import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { rm } from "node:fs/promises";

let baseUrl;
let server;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.MATCHMESH_DATA_DIR = ".matchmesh-data-test";
  process.env.MATCHMESH_WALLET_SEED = "";
  await rm(process.env.MATCHMESH_DATA_DIR, { recursive: true, force: true });
  ({ server } = await import("../server/index.js"));
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://${address.address}:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test("health and status endpoints are available", async () => {
  const health = await request("/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);

  const status = await request("/api/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.body.assistant.ready, true);
  assert.equal(status.body.wdk.ready, true);
  assert.equal(status.body.fixtures.ready, true);
});

test("fixtures endpoint returns a room-ready feed", async () => {
  const fixtures = await request("/api/fixtures");
  assert.equal(fixtures.response.status, 200);
  assert.ok(Array.isArray(fixtures.body.fixtures));
  assert.ok(fixtures.body.fixtures.length > 0);
  assert.ok(fixtures.body.fixtures[0].home);
  assert.ok(fixtures.body.fixtures[0].away);

  const matchState = await request("/api/match-state");
  assert.equal(matchState.response.status, 200);
  assert.ok(Array.isArray(matchState.body.players));
  assert.ok(Array.isArray(matchState.body.actions));
  assert.ok(matchState.body.players.length > 0);
});

test("room creation persists chat messages", async () => {
  const roomResult = await request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke Test Room", memberId: "test-fan" })
  });
  assert.equal(roomResult.response.status, 201);
  assert.match(roomResult.body.inviteCode, /^MESH-[A-F0-9]{4}$/u);
  assert.equal(roomResult.body.points.total, 10);

  const messageResult = await request(`/api/rooms/${roomResult.body.inviteCode}/messages`, {
    method: "POST",
    body: JSON.stringify({ memberId: "test-fan", name: "Ada", team: "NGA", text: "That press is working.", tag: "Live" })
  });
  assert.equal(messageResult.response.status, 201);
  assert.equal(messageResult.body.text, "That press is working.");
  assert.equal(messageResult.body.points.total, 12);

  const messages = await request(`/api/rooms/${roomResult.body.inviteCode}/messages`);
  assert.equal(messages.response.status, 200);
  assert.ok(messages.body.messages.some((message) => message.text === "That press is working."));

  const rename = await request(`/api/rooms/${roomResult.body.inviteCode}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Renamed Smoke Room", memberId: "test-fan" })
  });
  assert.equal(rename.response.status, 200);
  assert.equal(rename.body.name, "Renamed Smoke Room");
});

test("fans can join multiple rooms and see points", async () => {
  const first = await request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name: "Argentina Room", memberId: "multi-fan" })
  });
  const second = await request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name: "Ghana Room", memberId: "host-fan" })
  });
  const join = await request("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ inviteCode: second.body.inviteCode, memberId: "multi-fan" })
  });
  assert.equal(join.response.status, 200);
  assert.equal(join.body.points.total, 15);

  const profile = await request("/api/profile?memberId=multi-fan");
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.points, 15);
  assert.deepEqual(profile.body.rooms.map((room) => room.inviteCode).sort(), [
    first.body.inviteCode,
    second.body.inviteCode
  ].sort());

  const leaderboard = await request("/api/leaderboard");
  assert.equal(leaderboard.response.status, 200);
  assert.ok(leaderboard.body.leaderboard.some((fan) => fan.memberId === "multi-fan"));
});

test("assistant and wallet endpoints return operational responses", async () => {
  const ai = await request("/api/ai/completion", {
    method: "POST",
    body: JSON.stringify({ prompt: "Summarize last 15", context: { roomCode: "MESH-ABCD" } })
  });
  assert.equal(ai.response.status, 200);
  assert.equal(ai.body.mode, "deterministic-local");
  assert.match(ai.body.text, /MESH-ABCD/u);

  const wallet = await request("/api/wallet/tip", {
    method: "POST",
    body: JSON.stringify({ amount: "2.50", recipient: "top-commentator", memberId: "tip-fan" })
  });
  assert.equal(wallet.response.status, 202);
  assert.equal(wallet.body.amount, "2.50");
  assert.equal(wallet.body.asset, "USDt");

  const transfer = await request("/api/wallet/transfer", {
    method: "POST",
    body: JSON.stringify({ amount: "1.25", recipient: "room-wallet", memberId: "tip-fan" })
  });
  assert.equal(transfer.response.status, 202);
  assert.equal(transfer.body.intent, "transfer");
  assert.equal(transfer.body.amount, "1.25");

  const tips = await request("/api/tips");
  assert.equal(tips.response.status, 200);
  assert.ok(tips.body.tips.some((tip) => tip.recipient === "top-commentator"));

  const walletExport = await request("/api/wallet/export");
  assert.equal(walletExport.response.status, 200);
  assert.ok("recoveryPhrase" in walletExport.body);

  const walletStatus = await request("/api/wallet/status");
  assert.equal(walletStatus.response.status, 200);
  assert.equal(walletStatus.body.asset, "USDt");
  assert.ok(walletStatus.body.receiveTarget);

  const profile = await request("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ memberId: "tip-fan", displayName: "Tip Fan", walletAddress: "MESH123" })
  });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.displayName, "Tip Fan");
  assert.equal(profile.body.walletAddress, "MESH123");
});

test("invalid payloads are rejected", async () => {
  const message = await request("/api/rooms/not-a-room/messages", {
    method: "POST",
    body: JSON.stringify({ text: "hello" })
  });
  assert.equal(message.response.status, 400);

  const wallet = await request("/api/wallet/tip", {
    method: "POST",
    body: JSON.stringify({ amount: "1000", recipient: "top-commentator" })
  });
  assert.equal(wallet.response.status, 400);
});
