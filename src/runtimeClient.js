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

export function createRoom(name) {
  return request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name, memberId: "local-fan" })
  });
}

export function joinRoom(inviteCode) {
  return request("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ inviteCode, memberId: "local-fan" })
  });
}

export function getFanProfile() {
  return request("/api/profile?memberId=local-fan");
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
    body: JSON.stringify({ amount, recipient, memberId: "local-fan" })
  });
}
