const fallbackStatus = {
  pears: { ready: false, mode: "connecting", detail: "Runtime status pending." },
  assistant: { ready: true, mode: "deterministic-local", detail: "Local assistant ready." },
  wdk: { ready: false, mode: "connecting", detail: "Runtime status pending." }
};

async function request(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "Runtime request failed");
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function getMemberId() {
  if (typeof window === "undefined") return "local-fan";
  const override = new URLSearchParams(window.location.search).get("member");
  if (override) {
    window.localStorage.setItem("matchmesh-member-id", override);
    return override;
  }
  const existing = window.localStorage.getItem("matchmesh-member-id");
  if (existing) return existing;
  const generated = `fan-${crypto.randomUUID().slice(0, 8)}`;
  window.localStorage.setItem("matchmesh-member-id", generated);
  return generated;
}

export async function getRuntimeStatus() {
  try {
    return await request("/api/status");
  } catch {
    return fallbackStatus;
  }
}

export function getFixtures() {
  return request("/api/fixtures");
}

export function getMatchState(fixtureId) {
  const suffix = fixtureId ? `?fixtureId=${encodeURIComponent(fixtureId)}` : "";
  return request(`/api/match-state${suffix}`);
}

export function createRoom(name) {
  return request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name, memberId: getMemberId() })
  });
}

export function joinRoom(inviteCode) {
  return request("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ inviteCode, memberId: getMemberId() })
  });
}

export function updateRoom(inviteCode, name) {
  return request(`/api/rooms/${encodeURIComponent(inviteCode)}`, {
    method: "PATCH",
    body: JSON.stringify({ name, memberId: getMemberId() })
  });
}

export function getFanProfile() {
  return request(`/api/profile?memberId=${encodeURIComponent(getMemberId())}`);
}

export function updateFanProfile(profile) {
  return request("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ ...profile, memberId: getMemberId() })
  });
}

export function getLeaderboard() {
  return request("/api/leaderboard");
}

export function getRecentTips() {
  return request("/api/tips");
}

export function getWalletStatus() {
  return request("/api/wallet/status");
}

export function exportWallet() {
  return request("/api/wallet/export");
}

export function importWallet(recoveryPhrase) {
  return request("/api/wallet/import", {
    method: "POST",
    body: JSON.stringify({ recoveryPhrase })
  });
}

export function requestAiCompletion(prompt, context) {
  return request("/api/ai/completion", {
    method: "POST",
    body: JSON.stringify({ prompt, context })
  });
}

export function getRoomMessages(roomCode) {
  return request(`/api/rooms/${encodeURIComponent(roomCode)}/messages`);
}

export function sendChatMessage(roomCode, message) {
  return request(`/api/rooms/${encodeURIComponent(roomCode)}/messages`, {
    method: "POST",
    body: JSON.stringify(message)
  });
}

export function sendWalletTip(amount, recipient) {
  return request("/api/wallet/tip", {
    method: "POST",
    body: JSON.stringify({ amount, recipient, memberId: getMemberId() })
  });
}

export function sendWalletTransfer(amount, recipient, note) {
  return request("/api/wallet/transfer", {
    method: "POST",
    body: JSON.stringify({ amount, recipient, note, memberId: getMemberId() })
  });
}
