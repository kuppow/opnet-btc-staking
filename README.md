
# ⚡ OP_NET BTC Staking Dashboard

A non-custodial Bitcoin staking dashboard built on [OPNet](https://opnet.org) — the first smart contract layer on Bitcoin L1. Stake BTC, earn rewards, and participate in DAO governance — all without bridges or sidechains.

---

## 🚀 Live Demo

> Coming soon on Vercel

---

## ✨ Features

- **BTC Staking** — Stake real BTC via OPWallet with on-chain contract execution
- **Live Rewards** — Pending rewards accrue every block (~2s) at 34.7% APY
- **Auto-Compound** — Automatically reinvests rewards into your staked position (0.5% fee)
- **Signal Score** — Loyalty metric (0–1000) based on stake amount × time multiplier
- **Tier System** — Bronze → Silver → Gold → Diamond tiers with on-chain perks
- **DAO Governance** — Submit and vote on proposals that control the protocol treasury
- **Top Stakers Leaderboard** — Live leaderboard with real-time BTC fluctuations
- **Transaction History** — Full history with on-chain confirmation tracking via mempool.space
- **OPWallet Integration** — Detect, connect, sign, and confirm real Bitcoin transactions

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 5 |
| Styling | Inline styles + CSS-in-JS |
| Fonts | Orbitron + Space Mono (Google Fonts) |
| Wallet | OPWallet (`window.opnet`) |
| Smart Contracts | `opnet` SDK + `@btc-vision/bitcoin` |
| RPC | `https://testnet.opnet.org` |
| Tx Confirmation | `https://mempool.space` API |
| Deployment | Vercel |

---

## 📦 Getting Started

### Prerequisites

- Node.js 18+
- [OPWallet](https://opnet.org) browser extension installed

### Install & Run

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/opnet-staking.git
cd opnet-staking

# Install dependencies
npm install

# Start dev server (localhost:8080)
npm run dev
```

### Build for Production

```bash
npm run build
# Output in /dist
```

---

## 🔑 Wallet Integration

This app uses OPWallet for all signing. No private keys are ever handled by the frontend.

```js
// Detect wallet
const provider = window.opnet || window.OPNet || window.opNet || window.unisat;

// Connect
const accounts = await provider.requestAccounts();

// Stake via OPNet contract
const contract = getContract(STAKING_CONTRACT, STAKING_ABI, rpcProvider, network);
const simulation = await contract.stake(satoshis);
const receipt = await simulation.sendTransaction({
  signer: null,        // OPWallet handles ALL signing
  mldsaSigner: null,
  refundTo: walletAddress,
  maximumAllowedSatToSpend: satoshis + 10_000n,
  network,
  feeRate: 0           // Auto fee rate
});
```

---

## 📋 Contract Details

| Property | Value |
|----------|-------|
| Staking Contract | `op1pzj5zvvqvx7jaz6gwat2qhdszynl49sh69crea37wsuxkpa0qe0vq57rk0c` |
| Network | OPNet Testnet (Signet fork) |
| RPC | `https://testnet.opnet.org` |
| Min Stake | `0.00001 BTC` |
| APY | `34.7%` |
| Compound Fee | `0.5%` |
| Epoch | `144 blocks (~1 day)` |
| Unstake Lock | None |

---

## 🗂 Project Structure

```
opnet-app/
├── src/
│   ├── App.jsx          # Main app — all components in one file
│   └── main.jsx         # React entry point
├── public/
├── index.html
├── vite.config.js
├── vercel.json          # Vercel SPA routing + CSP headers
└── package.json
```

---

## 🌐 Deployment

This app is pre-configured for Vercel:

1. Push to GitHub
2. Import repo at [vercel.com](https://vercel.com)
3. Vercel auto-detects Vite — no config needed
4. Deploy ✅

The `vercel.json` handles:
- SPA rewrites (no 404 on page refresh)
- Content Security Policy headers
- Security headers (X-Frame-Options, X-Content-Type-Options)

---

## 🔒 Security

- **Non-custodial** — your keys never leave OPWallet
- **No private key handling** — `signer: null` on all transactions
- **CSP enforced** — strict Content Security Policy in production
- **Audited contract** — staking contract independently audited

---

## 📅 Roadmap

- [ ] Mainnet launch (March 17, 2026)
- [ ] Partial unstaking support
- [ ] Multi-wallet support (Unisat, Xverse)
- [ ] Mobile responsive layout
- [ ] Real-time APY from on-chain data
- [ ] Notification system for epoch rewards

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <p>Built on Bitcoin L1 · Powered by OPNet · Non-custodial</p>
  <a href="https://opnet.org">opnet.org</a> ·
  <a href="https://docs.opnet.org">docs</a> ·
  <a href="https://discord.gg/opnet">discord</a>
</div>
