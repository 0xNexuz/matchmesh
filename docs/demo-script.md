# MatchMesh Demo Script

## 60-90 Second Version

MatchMesh brings four integrations into one football product.

First, the room layer uses a native Node runtime with Pears Stack-ready storage for local-first watch rooms. Second, the live match layer uses API-Sports for World Cup fixtures, score state, events, and player activity. Third, the wallet layer uses Tether WDK on a Render backend, with a funded devnet wallet and mock USDT SPL mint. Fourth, the public app runs on Vercel while stateful room and wallet calls are proxied to the native backend.

The app itself is built for fans watching together in low-connectivity environments. A user signs in with a lightweight account, creates a room, copies the invite link, and another fan joins from a second browser or device. Messages sync through the backend, points update as fans create, join, chat, and tip, and the leaderboard shows the most active fans.

The match screen gives the room context: current fixture, score, player markers, and live actions when the provider exposes them. The local assistant can explain pressure, translate chat, summarize the last phase, or draft a recap for the room.

The wallet is self-custodial in the product flow. Users start with a Spending pocket, can add their own purpose pockets, receive through a QR code, send mock USDT, tip the top commentator, and open the transaction on Solana Explorer. The transfer is not just a UI event: the backend submits a real devnet SPL token transaction and stores the receipt.

The full flow is simple: sign in, create a room, invite a second fan, chat, earn points, read the live match, send a wallet transfer, and click View tx to verify it on-chain.

## Live Demo Checklist

1. Open `https://matchmesh.vercel.app` in two browsers or one normal window plus one incognito window.
2. Rename the account in each window so the messages show two different users.
3. Create a room in the first window and copy the invite link.
4. Join from the second window.
5. Send a message from both windows and show distinct names.
6. Show points and leaderboard updates.
7. Open the wallet, send a small mock USDT transfer, then click `View tx`.
8. Open the build doc only if you need to explain architecture.
