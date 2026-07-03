import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import {
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Info,
  KeyRound,
  Lock,
  MessageSquare,
  Network,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Users,
  Wallet,
  WifiOff
} from "lucide-react";
import { integrationModules } from "./sdkAdapters";
import {
  createRoom,
  exportWallet,
  getFanProfile,
  getFixtures,
  getLeaderboard,
  getMemberId,
  getMatchState,
  getRoomMessages,
  getRuntimeStatus,
  getRecentTips,
  getWalletStatus,
  importWallet,
  joinRoom,
  requestAiCompletion,
  sendChatMessage,
  sendWalletTip,
  updateRoom
} from "./runtimeClient";
import "./styles.css";

const logo = "/images/matchmesh-logo.png";
const heroImage = "/images/01-hero-matchday.png";
const useCaseImage = "/images/05-fan-economy.png";

const initialMessages = [
  { name: "Ama", team: "GHA", text: "Pressing trap on the right. Watch the next pass.", tag: "Live" },
  { name: "Noah", team: "ENG", text: "Still synced after the pub Wi-Fi dropped.", tag: "P2P" },
  { name: "Rafa", team: "BRA", text: "Local AI says the fullback is the spare man.", tag: "AI" }
];

const prompts = [
  "Explain this press",
  "Translate chat",
  "Summarize last 15",
  "Draft recap"
];

const features = [
  {
    icon: Network,
    title: "Peer-to-peer rooms",
    text: "Create a room, share one invite code, and keep chat and match events moving without a central chat server."
  },
  {
    icon: Bot,
    title: "On-device match AI",
    text: "Tactical explanations, translations, summaries, and recaps run through a lightweight local assistant."
  },
  {
    icon: Wallet,
    title: "Self-custodial payments",
    text: "Split matchday costs, tip creators, and send small fan rewards from a wallet the user controls."
  }
];

const workflow = [
  "Create a room",
  "Invite nearby fans",
  "Sync chat and timeline",
  "Ask local AI",
  "Tip or split costs"
];

function formatKickoff(value) {
  if (!value) return "Kickoff TBC";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function fixtureProviderLabel(provider) {
  const labels = {
    "api-football": "Live World Cup",
    "football-data.org": "Live World Cup",
    "world-cup-fallback": "World Cup slate",
    "fallback-after-provider-error": "World Cup slate",
    "curated-fallback": "World Cup slate",
    loading: "Loading",
    unavailable: "Offline slate"
  };
  return labels[provider] || "World Cup slate";
}

function extractInviteCode(value) {
  return (value || "").toUpperCase().match(/MESH-[A-F0-9]{4}/u)?.[0] || "";
}

const walletWords = [
  "match", "mesh", "final", "chant", "stand", "pitch", "trust", "local",
  "signal", "block", "keeper", "corner", "switch", "press", "ledger", "vault",
  "route", "tempo", "token", "crowd", "assist", "green", "amber", "rally",
  "north", "south", "ticket", "minute", "attack", "shield", "river", "market"
];

const defaultPockets = [
  { id: "spending", name: "Spending", balance: 250, icon: CircleDollarSign },
  { id: "pool", name: "Watch Party Pool", balance: 450, icon: Users },
  { id: "tips", name: "Creator Tips", balance: 300.75, icon: Star }
];

function generateLocalWallet() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const phrase = Array.from(bytes.slice(0, 12), (value) => walletWords[value % walletWords.length]).join(" ");
  const fingerprint = Array.from(bytes.slice(8), (value) => value.toString(16).padStart(2, "0")).join("");
  return {
    address: `MESH${fingerprint.toUpperCase()}`,
    recoveryPhrase: phrase,
    createdAt: new Date().toISOString()
  };
}

function storedJson(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [roomCode, setRoomCode] = useState("MESH-90");
  const [roomName, setRoomName] = useState("Lagos Final Watch");
  const [roomNameDraft, setRoomNameDraft] = useState("Lagos Final Watch");
  const [activePrompt, setActivePrompt] = useState(prompts[0]);
  const [chatInput, setChatInput] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [aiRuntimeAnswer, setAiRuntimeAnswer] = useState("");
  const [walletState, setWalletState] = useState("Ready for wallet policy check");
  const [roomState, setRoomState] = useState("Room log ready");
  const [roomMessages, setRoomMessages] = useState(initialMessages);
  const [walletBalance, setWalletBalance] = useState(128.4);
  const [joinedRooms, setJoinedRooms] = useState([]);
  const [joinCode, setJoinCode] = useState("");
  const [fanPoints, setFanPoints] = useState(0);
  const [pointEvents, setPointEvents] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [recentTips, setRecentTips] = useState([]);
  const [walletInfo, setWalletInfo] = useState(null);
  const [receiveQr, setReceiveQr] = useState("");
  const [walletExport, setWalletExport] = useState(null);
  const [importPhrase, setImportPhrase] = useState("");
  const [walletManageOpen, setWalletManageOpen] = useState(false);
  const [revealKeys, setRevealKeys] = useState(false);
  const [localWallet, setLocalWallet] = useState(null);
  const [walletPockets, setWalletPockets] = useState(defaultPockets);
  const [selectedPocket, setSelectedPocket] = useState("spending");
  const [sendAmount, setSendAmount] = useState("25.00");
  const [tipRecipient, setTipRecipient] = useState("room-top-commentator");
  const [fixturesState, setFixturesState] = useState({
    provider: "loading",
    fixtures: [],
    updatedAt: null
  });
  const [matchState, setMatchState] = useState({
    provider: "loading",
    clock: "68'",
    score: "1 - 1",
    players: [],
    actions: []
  });

  const aiAnswer = useMemo(() => {
    const answers = {
      "Explain this press": "The winger is steering play inside, then the midfield pair closes the return lane.",
      "Translate chat": "Three room messages translated locally. No transcript was sent to a server.",
      "Summarize last 15": "The room saw momentum shift after two overloads on the right side.",
      "Draft recap": "Recap ready with key chances, best fan comment, and payment receipt summary."
    };
    return aiRuntimeAnswer || answers[activePrompt];
  }, [activePrompt, aiRuntimeAnswer]);

  useEffect(() => {
    getRuntimeStatus().then(setRuntimeStatus);
    const savedWallet = storedJson("matchmesh-wallet", null);
    const savedPockets = storedJson("matchmesh-wallet-pockets", defaultPockets.map(({ icon, ...pocket }) => pocket));
    if (savedWallet) setLocalWallet(savedWallet);
    setWalletPockets(savedPockets.map((pocket) => ({
      ...pocket,
      icon: defaultPockets.find((item) => item.id === pocket.id)?.icon || CircleDollarSign
    })));
    getFixtures()
      .then(setFixturesState)
      .catch(() => {
        setFixturesState({
          provider: "unavailable",
          fixtures: [],
          updatedAt: new Date().toISOString()
        });
      });
    getWalletStatus().then(setWalletInfo).catch(() => {});
    getMatchState().then(setMatchState).catch(() => {});
    refreshProfile();
  }, []);

  useEffect(() => {
    const receiveTarget = localWallet?.address
      ? `matchmesh:${localWallet.address}?asset=USDT`
      : walletInfo?.receiveTarget || `matchmesh:room:${roomCode}:USDt`;
    QRCode.toDataURL(receiveTarget, {
      margin: 1,
      width: 144,
      color: {
        dark: "#101613",
        light: "#fffdf7"
      }
    }).then(setReceiveQr).catch(() => setReceiveQr(""));
  }, [roomCode, walletInfo, localWallet]);

  async function refreshProfile() {
    try {
      const profile = await getFanProfile();
      setJoinedRooms(profile.rooms || []);
      setFanPoints(profile.points || 0);
      setPointEvents(profile.pointEvents || []);
      getLeaderboard().then((result) => setLeaderboard(result.leaderboard || [])).catch(() => {});
      getRecentTips().then((result) => setRecentTips(result.tips || [])).catch(() => {});
    } catch {
      setJoinedRooms([]);
    }
  }

  useEffect(() => {
    if (!/^MESH-[A-F0-9]{4}$/u.test(roomCode)) return;
    getRoomMessages(roomCode)
      .then((result) => {
        if (result.messages?.length) setRoomMessages(result.messages);
      })
      .catch(() => {});
  }, [roomCode]);

  async function handleCreateRoom() {
    return createRoomFromName("Lagos Final Watch");
  }

  async function createRoomFromName(name, fixtureId) {
    try {
      const room = await createRoom(name);
      setRoomCode(room.inviteCode);
      setRoomName(room.name);
      setRoomNameDraft(room.name);
      setRoomState(`${room.name} active with ${room.peers} peer${room.peers === 1 ? "" : "s"}`);
      if (room.points) setFanPoints(room.points.total);
      if (fixtureId) {
        getMatchState(fixtureId).then(setMatchState).catch(() => {});
      }
      const result = await getRoomMessages(room.inviteCode);
      setRoomMessages(result.messages || []);
      await refreshProfile();
    } catch (error) {
      setRoomState(error.payload?.error || error.message);
    }
  }

  async function handleJoinRoom() {
    try {
      const inviteCode = extractInviteCode(joinCode);
      const room = await joinRoom(inviteCode);
      setRoomCode(room.inviteCode);
      setRoomName(room.name);
      setRoomNameDraft(room.name);
      setRoomState(`${room.name} joined with ${room.members || 1} member${room.members === 1 ? "" : "s"}`);
      if (room.points) setFanPoints(room.points.total);
      const result = await getRoomMessages(room.inviteCode);
      setRoomMessages(result.messages || []);
      setJoinCode("");
      await refreshProfile();
    } catch (error) {
      setRoomState(error.payload?.error || error.message);
    }
  }

  async function handlePrompt(prompt) {
    setActivePrompt(prompt);
    setAiRuntimeAnswer("");
    try {
      const result = await requestAiCompletion(prompt, { roomCode });
      setAiRuntimeAnswer(result.text || result.error || "");
    } catch (error) {
      setAiRuntimeAnswer(error.payload?.error || error.message);
    }
  }

  async function handleTip(amount = "2.50", recipient = "room-top-commentator") {
    try {
      const result = await sendWalletTip(amount, recipient);
      setWalletBalance((balance) => Math.max(0, Number((balance - Number(result.amount)).toFixed(2))));
      if (result.points) setFanPoints(result.points.total);
      setWalletState(`${result.asset} ${result.amount} ${result.status}`);
      await refreshProfile();
    } catch (error) {
      setWalletState(error.payload?.error || error.message);
    }
  }

  async function handleRenameRoom() {
    try {
      const room = await updateRoom(roomCode, roomNameDraft);
      setRoomName(room.name);
      setRoomNameDraft(room.name);
      setRoomState(`${room.name} renamed`);
      await refreshProfile();
    } catch (error) {
      setRoomState(error.payload?.error || error.message);
    }
  }

  function savePockets(nextPockets) {
    setWalletPockets(nextPockets);
    window.localStorage.setItem("matchmesh-wallet-pockets", JSON.stringify(nextPockets.map(({ icon, ...pocket }) => pocket)));
  }

  function handleGenerateWallet() {
    const wallet = generateLocalWallet();
    window.localStorage.setItem("matchmesh-wallet", JSON.stringify(wallet));
    setLocalWallet(wallet);
    setRevealKeys(false);
    setWalletState("Local wallet generated and saved on this device");
  }

  function handleRotateWallet() {
    const previous = localWallet ? storedJson("matchmesh-wallet-archive", []) : [];
    if (localWallet) {
      window.localStorage.setItem("matchmesh-wallet-archive", JSON.stringify([...previous.slice(-4), localWallet]));
    }
    handleGenerateWallet();
    setWalletState("Wallet rotated; previous key archived on this device");
  }

  function handleRemoveFunds() {
    const amount = Number(sendAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const nextPockets = walletPockets.map((pocket) => (
      pocket.id === selectedPocket
        ? { ...pocket, balance: Math.max(0, Number((pocket.balance - amount).toFixed(2))) }
        : pocket
    ));
    savePockets(nextPockets);
    setWalletBalance((balance) => Math.max(0, Number((balance - amount).toFixed(2))));
    setWalletState(`${amount.toFixed(2)} USDT removed from ${walletPockets.find((pocket) => pocket.id === selectedPocket)?.name || "wallet"}`);
  }

  async function handleSendMessage() {
    const text = chatInput.trim();
    if (!text) return;
    try {
      const message = await sendChatMessage(roomCode, {
        memberId: getMemberId(),
        name: "You",
        team: "ROOM",
        text,
        tag: "Live"
      });
      if (message.points) setFanPoints(message.points.total);
      setRoomMessages((current) => [...current.slice(-49), message]);
      setChatInput("");
      await refreshProfile();
    } catch (error) {
      setRoomState(error.payload?.error || error.message);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#home" aria-label="MatchMesh home">
          <img src={logo} alt="MatchMesh" width="211" height="48" />
        </a>
        <nav aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#features">Features</a>
          <a href="#stack">Stack</a>
          <a href="#workflow">Workflow</a>
        </nav>
        <a className="nav-cta" href="#product">Open room</a>
      </header>

      <section className="hero" id="home">
        <div className="hero-media" aria-hidden="true">
          <img src={heroImage} alt="" />
        </div>
        <div className="hero-inner">
          <p className="eyebrow"><Radio size={16} /> Local-first football rooms</p>
          <h1>Matchday software for fans who are already together.</h1>
          <p className="hero-text">
            MatchMesh combines P2P rooms, private match intelligence, and self-custodial fan
            payments in one clean app experience.
          </p>
          <div className="actions">
            <a className="button primary" href="#product">Start a room <ChevronRight size={18} /></a>
            <a className="button secondary" href="#stack">View stack</a>
          </div>
        </div>
      </section>

      <section className="product-section" id="product">
        <div className="section-copy">
          <p className="eyebrow"><Users size={16} /> Live room</p>
          <h2>One screen for the room, the match, and the money.</h2>
          <p>
            The interface is built around repeated matchday use: fast room entry, readable chat,
            clear AI answers, and payment actions that never feel like a betting product.
          </p>
        </div>

        <div className="rooms-panel" aria-label="Room membership">
          <div className="rooms-summary">
            <div>
              <p className="eyebrow"><Users size={16} /> Your rooms</p>
              <h3>Join multiple rooms and keep your matchday points.</h3>
            </div>
            <strong>{fanPoints} pts</strong>
          </div>
          <div className="room-chips">
            {joinedRooms.map((room) => (
              <button
                key={room.inviteCode}
                className={room.inviteCode === roomCode ? "active" : ""}
                onClick={async () => {
                  setRoomCode(room.inviteCode);
                  setRoomState(`${room.name} selected`);
                  const result = await getRoomMessages(room.inviteCode);
                  setRoomMessages(result.messages || []);
                }}
              >
                {room.name}
              </button>
            ))}
            {!joinedRooms.length && <span>Create or join a room to start earning points.</span>}
          </div>
          <div className="join-room">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text");
                const inviteCode = extractInviteCode(pasted);
                if (inviteCode) {
                  event.preventDefault();
                  setJoinCode(inviteCode);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleJoinRoom();
              }}
              placeholder="MESH-0000"
              aria-label="Join room code"
            />
            <button onClick={handleJoinRoom}>Join</button>
          </div>
        </div>

        <div className="fixtures-panel" aria-label="Live fixtures">
          <div className="fixtures-head">
            <div>
              <p className="eyebrow"><Radio size={16} /> Fixtures</p>
              <h3>World Cup rooms from today&apos;s slate.</h3>
            </div>
            <span>{fixtureProviderLabel(fixturesState.provider)}</span>
          </div>
          <div className="fixtures-list">
            {fixturesState.fixtures.slice(0, 3).map((fixture) => (
              <article key={fixture.id}>
                <div>
                  <small>{fixture.competition}</small>
                  <strong>{fixture.home} vs {fixture.away}</strong>
                  <span>{formatKickoff(fixture.kickoff)} · {fixture.status}</span>
                </div>
                <button onClick={() => createRoomFromName(`${fixture.home} vs ${fixture.away}`, fixture.id)}>
                  {fixture.score || "Open room"}
                </button>
              </article>
            ))}
            {!fixturesState.fixtures.length && (
              <article>
                <div>
                  <small>Fixture feed</small>
                  <strong>No fixtures available</strong>
                  <span>Configure a provider key or try again shortly.</span>
                </div>
                <button onClick={handleCreateRoom}>Open room</button>
              </article>
            )}
          </div>
        </div>

        <div className="app-shell" aria-label="MatchMesh room workspace">
          <div className="app-top">
            <div className="room-title-edit">
              <span className="status-dot" />
              <input
                value={roomNameDraft}
                onChange={(event) => setRoomNameDraft(event.target.value)}
                onBlur={handleRenameRoom}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleRenameRoom();
                }}
                aria-label="Room name"
              />
              <button onClick={handleRenameRoom}>Rename</button>
            </div>
            <button onClick={handleCreateRoom}><Copy size={16} /> {roomCode}</button>
          </div>

          <div className="room-layout">
            <section className="timeline-panel">
              <div className="scoreline">
                <span>{matchState.clock || "Live"}</span>
                <strong>{matchState.score || "0 - 0"}</strong>
              </div>
              <div className="pitch" aria-label="Live tactical field view">
                <div className="ball-trail" aria-hidden="true" />
                {(matchState.players || []).map((player) => (
                  <button
                    key={player.id}
                    className={`player ${player.status || "support"}`}
                    style={{ left: `${player.x}%`, top: `${player.y}%` }}
                    aria-label={`${player.name}, ${player.team}, ${player.action}`}
                  >
                    <span>{player.number}</span>
                    <strong>{player.name}</strong>
                    <em>{player.action}</em>
                  </button>
                ))}
                <div className="field-action-board" aria-label="Current player actions">
                  <div>
                    <strong>Live actions</strong>
                    <span>{matchState.provider || "provider-ready"}</span>
                  </div>
                  {(matchState.actions || []).slice(0, 4).map((action) => (
                    <article key={`${action.minute}-${action.player}`}>
                      <time>{action.minute}</time>
                      <p><b>{action.player}</b> {action.text}</p>
                    </article>
                  ))}
                </div>
              </div>
              <div className="room-stats">
                <span><Network size={15} /> {runtimeStatus?.pears?.mode || "runtime"}</span>
                <span><WifiOff size={15} /> {runtimeStatus?.pears?.ready ? "sync ready" : "local only"}</span>
                <span><ShieldCheck size={15} /> {roomState}</span>
              </div>
            </section>

            <section className="chat-panel">
              <h3>Fan room</h3>
              <div className="message-list" aria-live="polite">
                {roomMessages.map((message) => (
                  <article key={message.id || `${message.name}-${message.tag}-${message.text}`}>
                    <div><b>{message.name}</b><span>{message.team}</span></div>
                    <p>{message.text}</p>
                    <small>{message.tag}</small>
                  </article>
                ))}
              </div>
              <div className="composer">
                <label className="sr-only" htmlFor="chat">Message</label>
                <input
                  id="chat"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleSendMessage();
                  }}
                  aria-label="Write to the room"
                />
                <button aria-label="Send message" onClick={handleSendMessage}><Send size={18} /></button>
              </div>
            </section>

            <section className="assistant-panel">
              <h3>Local AI</h3>
              <div className="prompt-grid">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    className={activePrompt === prompt ? "active" : ""}
                    onClick={() => handlePrompt(prompt)}
                  >
                    <Sparkles size={15} /> {prompt}
                  </button>
                ))}
              </div>
              <div className="answer-card">
                <span><Lock size={14} /> {runtimeStatus?.assistant?.ready ? "Local assistant ready" : "Assistant unavailable"}</span>
                <p>{aiAnswer}</p>
              </div>
            </section>

            <section className="wallet-panel">
              <div className="wallet-dashboard">
                <div className="wallet-stack">
                  <div className="wallet-hero-card">
                    <div>
                      <img src={logo} alt="MatchMesh" />
                      <span>Wallet</span>
                    </div>
                    <small>SELF-CUSTODIAL</small>
                    <strong>{walletBalance.toFixed(2)} <span>USDT</span></strong>
                    <em>approx ${walletBalance.toFixed(2)}</em>
                    <ShieldCheck className="wallet-mark" size={82} aria-hidden="true" />
                  </div>

                  {walletPockets.map((pocket) => {
                    const Icon = pocket.icon;
                    return (
                      <button
                        key={pocket.id}
                        className={`wallet-pocket ${selectedPocket === pocket.id ? "active" : ""}`}
                        onClick={() => setSelectedPocket(pocket.id)}
                      >
                        <div>
                          <span>{pocket.name}</span>
                          <strong>{pocket.balance.toFixed(2)} USDT</strong>
                        </div>
                        <Icon size={18} />
                      </button>
                    );
                  })}
                </div>

                <div className="send-sheet" aria-label="Send USDT">
                  <div className="sheet-head">
                    <h3>Send USDT</h3>
                    <span><Lock size={14} /> {runtimeStatus?.wdk?.mode || "wallet"}</span>
                  </div>

                  <label>
                    From
                    <div className="wallet-field read-only">
                      <span>{walletPockets.find((pocket) => pocket.id === selectedPocket)?.name || "Spending"}</span>
                      <strong>{(walletPockets.find((pocket) => pocket.id === selectedPocket)?.balance || 0).toFixed(2)} USDT</strong>
                    </div>
                  </label>

                  <label>
                    To
                    <div className="wallet-field">
                      <input
                        value={tipRecipient}
                        onChange={(event) => setTipRecipient(event.target.value)}
                        aria-label="Tip recipient"
                      />
                      <Copy size={16} />
                    </div>
                  </label>

                  <label>
                    Amount
                    <div className="amount-field">
                      <input
                        value={sendAmount}
                        onChange={(event) => setSendAmount(event.target.value)}
                        inputMode="decimal"
                        aria-label="USDT amount"
                      />
                      <strong>USDT</strong>
                    </div>
                  </label>

                  <div className="quick-amounts" aria-label="Quick amount">
                    {["5.00", "10.00", "25.00", "50.00"].map((amount) => (
                      <button
                        key={amount}
                        className={sendAmount === amount ? "active" : ""}
                        onClick={() => setSendAmount(amount)}
                      >
                        ${Number(amount).toFixed(0)}
                      </button>
                    ))}
                    <button onClick={() => setSendAmount("100.00")}>Max</button>
                  </div>

                  <label>
                    Note
                    <textarea defaultValue="Great commentary tonight!" maxLength={64} aria-label="Payment note" />
                  </label>

                  <div className="network-pill">
                    <Radio size={16} /> {walletInfo?.network || "solana"} / {walletInfo?.asset || "USDT"}
                  </div>

                  <button className="button primary full" onClick={() => handleTip(sendAmount, tipRecipient)}>
                    <CircleDollarSign size={18} /> Review payment
                  </button>
                  <p><KeyRound size={15} /> {walletState}</p>
                </div>

                <div className="receive-stack">
                  <div className="payment-request">
                    <div className="payment-head">
                      <h3>Payment request</h3>
                      <Info size={16} />
                    </div>
                    <span>Scan to pay</span>
                    <strong>{sendAmount || "25.00"} USDT</strong>
                    <div className="receive-qr">
                      {receiveQr && <img src={receiveQr} alt="Receive USDT QR" />}
                      <CircleDollarSign size={34} />
                    </div>
                    <div className="address-chip">
                      <span>Address</span>
                      <code>{localWallet?.address || walletInfo?.accountAddress || walletInfo?.receiveTarget || "wallet pending"}</code>
                      <Copy size={15} />
                    </div>
                  </div>

                  <div className="recent-wallet-tips">
                    <div>
                      <h3>Recent fan tips</h3>
                      <a href="#product">View all</a>
                    </div>
                    {recentTips.slice(0, 4).map((tip) => (
                      <article key={tip.id}>
                        <span>{tip.recipient.slice(0, 16)}</span>
                        <strong>{tip.amount} {tip.asset}</strong>
                        <small>{tip.status}</small>
                      </article>
                    ))}
                    {!recentTips.length && <p>No tips yet.</p>}
                  </div>

                  <button
                    className="wallet-manage-toggle"
                    type="button"
                    onClick={() => setWalletManageOpen((open) => !open)}
                    aria-expanded={walletManageOpen}
                  >
                    <KeyRound size={16} /> Wallet management
                  </button>
                  {walletManageOpen && (
                    <div className="wallet-management-panel">
                      <div className="wallet-actions">
                        <button onClick={handleGenerateWallet}>Generate wallet</button>
                        <button onClick={() => setRevealKeys((value) => !value)}>Show keys</button>
                        <button onClick={handleRemoveFunds}>Remove funds</button>
                        <button onClick={handleRotateWallet}>Rotate wallet</button>
                      </div>
                      <div className="wallet-key-card">
                        <span>Saved wallet</span>
                        <code>{localWallet?.address || "No local wallet generated yet"}</code>
                        {revealKeys && localWallet?.recoveryPhrase && <p>{localWallet.recoveryPhrase}</p>}
                      </div>
                      <input
                        value={importPhrase}
                        onChange={(event) => setImportPhrase(event.target.value)}
                        placeholder="Paste recovery phrase"
                        aria-label="Recovery phrase"
                      />
                      <div className="wallet-actions compact">
                        <button onClick={async () => setWalletExport(await exportWallet())}>Server export</button>
                        <button onClick={async () => setWalletState((await importWallet(importPhrase)).status)}>Import phrase</button>
                      </div>
                      {walletExport?.recoveryPhrase && <small>Recovery phrase ready. Keep it private.</small>}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="activity-grid" aria-label="Activity and points">
          <section>
            <h3>Recent creators tipped</h3>
            {recentTips.slice(0, 5).map((tip) => (
              <article key={tip.id}>
                <strong>{tip.recipient}</strong>
                <span>{tip.amount} {tip.asset} · {tip.status}</span>
              </article>
            ))}
            {!recentTips.length && <p>No tips yet.</p>}
          </section>
          <section>
            <h3>Points activity</h3>
            {pointEvents.slice(-5).reverse().map((event) => (
              <article key={event.id}>
                <strong>+{event.amount}</strong>
                <span>{event.reason}</span>
              </article>
            ))}
            {!pointEvents.length && <p>Create, join, chat, or tip to earn points.</p>}
          </section>
          <section>
            <h3>Leaderboard</h3>
            {leaderboard.slice(0, 5).map((fan, index) => (
              <article key={fan.memberId}>
                <strong>{index + 1}. {fan.memberId}</strong>
                <span>{fan.points} pts</span>
              </article>
            ))}
            {!leaderboard.length && <p>No ranked fans yet.</p>}
          </section>
        </div>
      </section>

      <section className="features" id="features">
        <div className="section-copy centered">
          <p className="eyebrow"><Check size={16} /> What matters</p>
          <h2>Useful before, during, and after the final whistle.</h2>
        </div>
        <div className="feature-grid">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.title}>
                <Icon size={24} />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="stack-section" id="stack">
        <div className="section-copy">
          <p className="eyebrow"><ShieldCheck size={16} /> Production path</p>
          <h2>Clear handoff points for the Tether stack.</h2>
          <p>
            MatchMesh runs product screens against a runtime service for Pears Stack room sync,
            local assistant responses, and WDK wallet actions.
          </p>
        </div>
        <div className="stack-grid">
          {integrationModules.map((module) => (
            <article key={module.name}>
              <span>{module.status}</span>
              <h3>{module.name}</h3>
              <p>{module.detail}</p>
              <div>
                {module.calls.slice(0, 3).map((call) => <code key={call}>{call}</code>)}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="workflow" id="workflow">
        <div className="workflow-image" aria-hidden="true">
          <img src={useCaseImage} alt="" />
        </div>
        <div>
          <p className="eyebrow"><Trophy size={16} /> Matchday flow</p>
          <h2>From room code to post-match recap.</h2>
          <ol>
            {workflow.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      </section>

      <section className="final-cta">
        <img src={logo} alt="MatchMesh" width="211" height="48" />
        <h2>Bring the room online, locally.</h2>
        <p>
          A clean production-ready frontend for a football app built around real-world fan behavior.
        </p>
        <a className="button primary" href="#product">Open the room <ChevronRight size={18} /></a>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
