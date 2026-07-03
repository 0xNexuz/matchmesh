export const integrationModules = [
  {
    name: "Pears Stack",
    status: "Room sync runtime",
    calls: ["createRoom()", "joinRoom()", "appendEvent()", "replicatePeers()"],
    detail: "Hyperswarm discovery, Hypercore event logs, and persistent room state run in the MatchMesh runtime service."
  },
  {
    name: "Local AI",
    status: "Local AI runtime",
    calls: ["loadModel()", "runPrompt()", "summarizeMatch()", "translateChat()"],
    detail: "The assistant calls the runtime service for deterministic match summaries, translations, and tactical prompts."
  },
  {
    name: "WDK",
    status: "Wallet action runtime",
    calls: ["connectWallet()", "signTip()", "sendUSDT()", "getBalance()"],
    detail: "The wallet action flow is routed through WDK and a local policy check before any write action."
  }
];

export const sdkEvents = [
  "chat.message.appended",
  "assistant.prompt.completed",
  "wallet.tip.signed",
  "room.snapshot.replicated"
];
