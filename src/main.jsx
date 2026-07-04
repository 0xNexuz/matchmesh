import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import {
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  ExternalLink,
  Info,
  KeyRound,
  Lock,
  MessageSquare,
  Network,
  Pencil,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Trash2,
  User,
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
  restoreAccount,
  sendChatMessage,
  sendWalletTransfer,
  sendWalletTip,
  signInAccount,
  signOutAccount,
  updateFanProfile,
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

const appFlowSteps = [
  { title: "Create", text: "Open a named room and copy the invite code." },
  { title: "Join", text: "Paste the invite in another browser as a second fan." },
  { title: "Sync", text: "Send chat while the pitch and fixture feed stay readable." },
  { title: "Ask", text: "Run the local assistant for tactical summary or recap." },
  { title: "Pay", text: "Generate wallet, move funds, tip, and scan the receive QR." }
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

function explorerTxUrl(txHash, network = "solana") {
  if (!txHash) return "";
  const cluster = /mainnet/i.test(network) ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/tx/${encodeURIComponent(txHash)}${cluster}`;
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
  { id: "spending", name: "Spending", balance: 128.4, icon: CircleDollarSign }
];

function pocketIcon(id) {
  return CircleDollarSign;
}

function normalizeSavedPockets(savedPockets) {
  const cleaned = (savedPockets || [])
    .filter((pocket) => !["pool", "tips"].includes(pocket.id))
    .map((pocket) => ({
      ...pocket,
      name: pocket.id === "spending" ? "Spending" : pocket.name,
      icon: pocketIcon(pocket.id)
    }));
  const hasSpending = cleaned.some((pocket) => pocket.id === "spending");
  return hasSpending ? cleaned : defaultPockets;
}

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
  const [joinedRooms, setJoinedRooms] = useState([]);
  const [joinCode, setJoinCode] = useState("");
  const [fanPoints, setFanPoints] = useState(0);
  const [pointEvents, setPointEvents] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [userProfile, setUserProfile] = useState({ memberId: getMemberId(), displayName: "Local fan" });
  const [accountNameDraft, setAccountNameDraft] = useState("Local fan");
  const [recentTips, setRecentTips] = useState([]);
  const [walletInfo, setWalletInfo] = useState(null);
  const [receiveQr, setReceiveQr] = useState("");
  const [walletExport, setWalletExport] = useState(null);
  const [importPhrase, setImportPhrase] = useState("");
  const [walletManageOpen, setWalletManageOpen] = useState(false);
  const [walletManageMode, setWalletManageMode] = useState("");
  const [revealKeys, setRevealKeys] = useState(false);
  const [localWallet, setLocalWallet] = useState(null);
  const [walletPockets, setWalletPockets] = useState(defaultPockets);
  const [selectedPocket, setSelectedPocket] = useState("spending");
  const [transferTarget, setTransferTarget] = useState("spending");
  const [newPocketName, setNewPocketName] = useState("");
  const [editingPocketId, setEditingPocketId] = useState("");
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

  const walletTotal = useMemo(() => (
    walletPockets.reduce((total, pocket) => total + Number(pocket.balance || 0), 0)
  ), [walletPockets]);

  const topCommentator = useMemo(() => leaderboard[0]?.memberId || "room-top-commentator", [leaderboard]);

  useEffect(() => {
    const roomFromUrl = extractInviteCode(new URLSearchParams(window.location.search).get("room"));
    if (roomFromUrl) setJoinCode(roomFromUrl);
    async function bootAccount() {
      try {
        const profile = await restoreAccount();
        setUserProfile(profile);
        setAccountNameDraft(profile.displayName || profile.memberId);
      } catch {
        const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
        const profile = await signInAccount(`Fan ${suffix}`);
        setUserProfile(profile);
        setAccountNameDraft(profile.displayName || profile.memberId);
      }
      await refreshProfile();
    }
    bootAccount().catch(() => {});
    getRuntimeStatus().then(setRuntimeStatus);
    const savedWallet = storedJson("matchmesh-wallet", null);
    const savedPockets = storedJson("matchmesh-wallet-pockets", defaultPockets.map(({ icon, ...pocket }) => pocket));
    if (savedWallet) setLocalWallet(savedWallet);
    const normalizedPockets = normalizeSavedPockets(savedPockets);
    setWalletPockets(normalizedPockets);
    window.localStorage.setItem("matchmesh-wallet-pockets", JSON.stringify(normalizedPockets.map(({ icon, ...pocket }) => pocket)));
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
  }, []);

  useEffect(() => {
    const receiveTarget = walletInfo?.receiveTarget
      || (localWallet?.address ? `matchmesh:${localWallet.address}?asset=USDT` : `matchmesh:room:${roomCode}:USDt`);
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
      setUserProfile(profile);
      setAccountNameDraft(profile.displayName || profile.memberId);
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
    let active = true;
    async function refreshMessages() {
      try {
        const result = await getRoomMessages(roomCode);
        if (active) setRoomMessages(result.messages || []);
      } catch {}
    }
    refreshMessages();
    const timer = window.setInterval(refreshMessages, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [roomCode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshProfile();
      getMatchState().then(setMatchState).catch(() => {});
      getWalletStatus().then(setWalletInfo).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const availableTarget = walletPockets.find((pocket) => pocket.id !== selectedPocket);
    if (!availableTarget) {
      setTransferTarget("");
    } else if (selectedPocket === transferTarget || !walletPockets.some((pocket) => pocket.id === transferTarget)) {
      setTransferTarget(availableTarget.id);
    }
  }, [selectedPocket, transferTarget, walletPockets]);

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
      const debit = Number(result.amount);
      if (Number.isFinite(debit)) {
        savePockets(walletPockets.map((pocket) => (
          pocket.id === selectedPocket
            ? { ...pocket, balance: Math.max(0, Number((pocket.balance - debit).toFixed(2))) }
            : pocket
        )));
      }
      if (result.points) setFanPoints(result.points.total);
      setWalletState(`${result.amount} ${result.asset} ${result.status}`);
      await refreshProfile();
    } catch (error) {
      setWalletState(error.payload?.error || error.message);
    }
  }

  async function handleWalletTransfer() {
    try {
      const result = await sendWalletTransfer(sendAmount, tipRecipient, "MatchMesh wallet payment");
      const debit = Number(result.amount);
      if (Number.isFinite(debit)) {
        savePockets(walletPockets.map((pocket) => (
          pocket.id === selectedPocket
            ? { ...pocket, balance: Math.max(0, Number((pocket.balance - debit).toFixed(2))) }
            : pocket
        )));
      }
      if (result.points) setFanPoints(result.points.total);
      setWalletState(result.txHash ? `On-chain receipt: ${result.txHash.slice(0, 10)}...` : `${result.amount} ${result.asset} ${result.status}`);
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

  async function handleSaveAccount() {
    try {
      const name = accountNameDraft.trim() || userProfile.displayName || "MatchMesh fan";
      const profile = await updateFanProfile({ displayName: name });
      setUserProfile(profile);
      setAccountNameDraft(profile.displayName || profile.memberId);
      setRoomState(`${profile.displayName} account saved`);
    } catch (error) {
      setRoomState(error.payload?.error || error.message);
    }
  }

  async function handleSwitchAccount() {
    try {
      await signOutAccount();
      const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
      const profile = await signInAccount(`Fan ${suffix}`);
      setUserProfile(profile);
      setAccountNameDraft(profile.displayName || profile.memberId);
      await refreshProfile();
      setRoomState(`${profile.displayName} signed in`);
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
    updateFanProfile({ walletAddress: wallet.address }).then(setUserProfile).catch(() => {});
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
    setWalletState(`${amount.toFixed(2)} USDT removed from ${walletPockets.find((pocket) => pocket.id === selectedPocket)?.name || "wallet"}`);
  }

  function handleMoveFunds() {
    const amount = Number(sendAmount);
    if (!Number.isFinite(amount) || amount <= 0 || selectedPocket === transferTarget || !transferTarget) return;
    const fromPocket = walletPockets.find((pocket) => pocket.id === selectedPocket);
    if (!fromPocket || fromPocket.balance < amount) {
      setWalletState("Not enough funds in selected pocket");
      return;
    }
    const nextPockets = walletPockets.map((pocket) => {
      if (pocket.id === selectedPocket) return { ...pocket, balance: Number((pocket.balance - amount).toFixed(2)) };
      if (pocket.id === transferTarget) return { ...pocket, balance: Number((pocket.balance + amount).toFixed(2)) };
      return pocket;
    });
    savePockets(nextPockets);
    const targetName = nextPockets.find((pocket) => pocket.id === transferTarget)?.name || "target pocket";
    setWalletState(`${amount.toFixed(2)} USDT moved to ${targetName}`);
  }

  function handleAddPocket() {
    const name = newPocketName.trim();
    if (!name) return;
    const id = `pocket-${crypto.randomUUID().slice(0, 6)}`;
    const nextPockets = [...walletPockets, { id, name: name.slice(0, 28), balance: 0, icon: CircleDollarSign }];
    savePockets(nextPockets);
    setSelectedPocket(id);
    setNewPocketName("");
    setWalletState(`${name.slice(0, 28)} pocket added`);
  }

  function handleRenamePocket(pocketId, name) {
    if (pocketId === "spending") return;
    const cleanName = name.trim().slice(0, 28);
    if (!cleanName) return;
    const nextPockets = walletPockets.map((pocket) => (
      pocket.id === pocketId ? { ...pocket, name: cleanName } : pocket
    ));
    savePockets(nextPockets);
    setWalletState(`${cleanName} pocket updated`);
  }

  function handleDeletePocket(pocketId) {
    if (pocketId === "spending") return;
    const pocket = walletPockets.find((item) => item.id === pocketId);
    if (!pocket) return;
    const nextPockets = walletPockets
      .filter((item) => item.id !== pocketId)
      .map((item) => (
        item.id === "spending"
          ? { ...item, balance: Number((item.balance + pocket.balance).toFixed(2)) }
          : item
      ));
    savePockets(nextPockets);
    setSelectedPocket("spending");
    setEditingPocketId("");
    setWalletState(`${pocket.name} removed; balance returned to Spending`);
  }

  function copyInvite() {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard?.writeText(`${roomCode} ${url}`).catch(() => {});
    setRoomState(`${roomCode} invite copied`);
  }

  async function handleSendMessage() {
    const text = chatInput.trim();
    if (!text) return;
    try {
      const message = await sendChatMessage(roomCode, {
        memberId: getMemberId(),
        name: userProfile.displayName || userProfile.memberId || getMemberId(),
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
          <a href="#app-flow">App flow</a>
          <a href="#features">Features</a>
          <a href="#stack">Stack</a>
          <a href="/build.html">Build doc</a>
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
          <div className="profile-strip">
            <div>
              <User size={18} />
              <input
                value={accountNameDraft}
                onChange={(event) => setAccountNameDraft(event.target.value)}
                onBlur={handleSaveAccount}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSaveAccount();
                }}
                aria-label="Account display name"
              />
              <small>{userProfile.memberId}</small>
            </div>
            <button onClick={handleSwitchAccount}><User size={16} /> Switch account</button>
            <button onClick={copyInvite}><Copy size={16} /> Copy invite link</button>
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
            <button onClick={copyInvite}><Copy size={16} /> {roomCode}</button>
          </div>

          <div className="room-layout">
            <section className="timeline-panel">
              <div className="scoreline">
                <span>{matchState.clock || "Live"}</span>
                <strong>{matchState.score || "0 - 0"}</strong>
              </div>
              <div className="match-strip">
                <strong>{matchState.teams?.home || "Home"}</strong>
                <span>{matchState.provider || "match-state"}</span>
                <strong>{matchState.teams?.away || "Away"}</strong>
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
                    <span>{matchState.provider === "curated-fallback" ? "provider fallback" : matchState.provider || "provider-ready"}</span>
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
                      <span className="wallet-brand-mark" aria-hidden="true">M</span>
                      <b>MatchMesh</b>
                      <span>Wallet</span>
                    </div>
                    <small>SELF-CUSTODIAL</small>
                    <strong>{walletTotal.toFixed(2)} <span>USDT</span></strong>
                    <em>approx ${walletTotal.toFixed(2)}</em>
                    <ShieldCheck className="wallet-mark" size={82} aria-hidden="true" />
                  </div>

                  {walletPockets.map((pocket) => {
                    const Icon = pocket.icon;
                    const isBasePocket = pocket.id === "spending";
                    const isEditing = editingPocketId === pocket.id;
                    return (
                      <article
                        key={pocket.id}
                        className={`wallet-pocket ${selectedPocket === pocket.id ? "active" : ""}`}
                      >
                        {isEditing ? (
                          <div className="wallet-pocket-main editing">
                            <div>
                              <input
                                defaultValue={pocket.name}
                                autoFocus
                                onBlur={(event) => {
                                  handleRenamePocket(pocket.id, event.target.value);
                                  setEditingPocketId("");
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    handleRenamePocket(pocket.id, event.currentTarget.value);
                                    setEditingPocketId("");
                                  }
                                  if (event.key === "Escape") setEditingPocketId("");
                                }}
                                aria-label="Pocket name"
                              />
                              <strong>{pocket.balance.toFixed(2)} USDT</strong>
                            </div>
                            <Icon size={18} />
                          </div>
                        ) : (
                          <button className="wallet-pocket-main" onClick={() => setSelectedPocket(pocket.id)}>
                            <div>
                              <span>{pocket.name}</span>
                              <strong>{pocket.balance.toFixed(2)} USDT</strong>
                            </div>
                            <Icon size={18} />
                          </button>
                        )}
                        {!isBasePocket && (
                          <div className="wallet-pocket-tools">
                            <button onClick={() => setEditingPocketId(pocket.id)} aria-label={`Edit ${pocket.name}`}>
                              <Pencil size={15} />
                            </button>
                            <button onClick={() => handleDeletePocket(pocket.id)} aria-label={`Remove ${pocket.name}`}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                  <div className="add-pocket">
                    <input
                      value={newPocketName}
                      onChange={(event) => setNewPocketName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleAddPocket();
                      }}
                      placeholder="Add purpose pocket"
                      aria-label="New wallet pocket name"
                    />
                    <button onClick={handleAddPocket} aria-label="Add wallet pocket"><Plus size={18} /></button>
                  </div>
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
                  <button className="recipient-shortcut" onClick={() => setTipRecipient(`${topCommentator}-wallet`)}>
                    <Star size={15} /> Top room commentator
                  </button>

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
                    <Radio size={16} /> {walletInfo?.network || "solana"} / {walletInfo?.tokenMint ? walletInfo.asset : "devnet SOL proof"}
                  </div>

                  {walletPockets.length > 1 && (
                    <label>
                      Move to
                      <div className="wallet-field">
                        <select value={transferTarget} onChange={(event) => setTransferTarget(event.target.value)}>
                          {walletPockets.filter((pocket) => pocket.id !== selectedPocket).map((pocket) => (
                            <option key={pocket.id} value={pocket.id}>{pocket.name}</option>
                          ))}
                        </select>
                        <ChevronRight size={16} />
                      </div>
                    </label>
                  )}

                  <button className="button primary full" onClick={handleWalletTransfer}>
                    <CircleDollarSign size={18} /> Send payment
                  </button>
                  {walletPockets.length > 1 && (
                    <button className="button secondary full" onClick={handleMoveFunds}>
                      <Wallet size={18} /> Move between pockets
                    </button>
                  )}
                  <button className="button secondary full" onClick={() => handleTip(sendAmount, `${topCommentator}-wallet`)}>
                    <Star size={18} /> Tip top commentator
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
                      <code>{walletInfo?.accountAddress || localWallet?.address || walletInfo?.receiveTarget || "wallet pending"}</code>
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
                        {tip.txHash && (
                          <a
                            className="tx-link"
                            href={explorerTxUrl(tip.txHash, walletInfo?.network)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View tx <ExternalLink size={12} />
                          </a>
                        )}
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
                    <KeyRound size={16} /> Recovery & keys
                  </button>
                  {walletManageOpen && (
                    <div className="wallet-management-panel">
                      <div className="wallet-actions compact">
                        <button onClick={handleGenerateWallet}>Create wallet</button>
                        <button onClick={() => setWalletManageMode(walletManageMode === "backup" ? "" : "backup")}>Backup</button>
                        <button onClick={() => setWalletManageMode(walletManageMode === "import" ? "" : "import")}>Import</button>
                        <button onClick={() => setWalletManageMode(walletManageMode === "advanced" ? "" : "advanced")}>Advanced</button>
                      </div>
                      <div className="wallet-key-card">
                        <span>Saved wallet</span>
                        <code>{localWallet?.address || "No local wallet generated yet"}</code>
                        {walletInfo?.accountAddress && <small>Native account: {walletInfo.accountAddress}</small>}
                      </div>
                      {walletManageMode === "backup" && (
                        <div className="wallet-key-card sensitive">
                          <button onClick={() => setRevealKeys((value) => !value)}>
                            {revealKeys ? "Hide phrase" : "Reveal phrase"}
                          </button>
                          {revealKeys && localWallet?.recoveryPhrase && <p>{localWallet.recoveryPhrase}</p>}
                          {!localWallet?.recoveryPhrase && <small>Create a wallet first to back it up.</small>}
                        </div>
                      )}
                      {walletManageMode === "import" && (
                        <div className="wallet-import">
                          <input
                            value={importPhrase}
                            onChange={(event) => setImportPhrase(event.target.value)}
                            placeholder="Paste recovery phrase"
                            aria-label="Recovery phrase"
                          />
                          <button onClick={async () => setWalletState((await importWallet(importPhrase)).status)}>Import phrase</button>
                        </div>
                      )}
                      {walletManageMode === "advanced" && (
                        <div className="wallet-actions compact">
                          <button onClick={handleRemoveFunds}>Remove funds</button>
                          <button onClick={handleRotateWallet}>Rotate wallet</button>
                          <button onClick={async () => setWalletExport(await exportWallet())}>Server export</button>
                          <button onClick={() => getWalletStatus().then(setWalletInfo).catch(() => {})}>Refresh wallet</button>
                        </div>
                      )}
                      {walletExport?.recoveryPhrase && <small>Server export returned a phrase. Keep it private and clear it after backup.</small>}
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
                <span>{tip.amount} {tip.asset} - {tip.status}</span>
                {tip.txHash && (
                  <a
                    className="tx-link"
                    href={explorerTxUrl(tip.txHash, walletInfo?.network)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View tx <ExternalLink size={12} />
                  </a>
                )}
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

      <section className="demo-section" id="app-flow">
        <div className="section-copy">
          <p className="eyebrow"><Trophy size={16} /> App flow iteration</p>
          <h2>A clean path through the whole matchday loop.</h2>
          <p>
            Create a room, bring another fan in, read the live match, earn points,
            send a payment, and receive funds from the same wallet surface.
          </p>
          <a className="button secondary" href="/build.html">
            Open build doc <ExternalLink size={16} />
          </a>
        </div>
        <div className="demo-grid">
          {appFlowSteps.map((step, index) => (
            <article key={step.title}>
              <span>{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
        <div className="connectivity-demo">
          <div>
            <p className="eyebrow"><WifiOff size={16} /> Low connectivity mode</p>
            <h3>Rooms keep working when the network gets rough.</h3>
          </div>
          <div className="connectivity-rail">
            <span className={runtimeStatus?.pears?.ready ? "active" : ""}>Room log</span>
            <span className={runtimeStatus?.pears?.mode === "hyperswarm" ? "active" : ""}>P2P discovery</span>
            <span className="active">Local assistant</span>
            <span className="active">Wallet receipts</span>
          </div>
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
