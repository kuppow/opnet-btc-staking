# ⚡ OP_NET BTC Staking Dashboard

A non-custodial Bitcoin staking & swap dashboard built on [OPNet](https://opnet.org) — the first smart contract layer on Bitcoin L1. Stake BTC, earn rewards, swap OP-20 tokens, and participate in DAO governance — all without bridges or sidechains.

> 🔵 **Currently running on OPNet Testnet** — Mainnet launches March 17, 2026

---

## 🚀 Live Demo

> Coming soon on Vercel

---

## ✨ Features

- **BTC Staking** — Stake BTC via OPWallet with on-chain contract execution on Testnet
- **Token Swap** — Swap BTC, MOTO & PILL via MotoSwap DEX protocol on OPNet Testnet
- **Live Rewards** — Pending rewards accrue every block at 34.7% APY base rate
- **Auto-Compound** — Automatically reinvests rewards every epoch (0.5% fee)
- **Signal Score** — Loyalty metric (0–1000) based on stake amount × time multiplier
- **Tier System** — Bronze → Silver → Gold → Diamond with fee reductions & APY boosts
- **DAO Governance** — Submit and vote on proposals controlling the protocol treasury
- **Top Stakers Leaderboard** — Live leaderboard with BTC price fluctuations
- **Transaction History** — Full history with on-chain confirmation tracking
- **OPWallet Integration** — Detect, connect, sign, and confirm real Bitcoin transactions
- **Live BTC Price Ticker** — Real-time price from CoinGecko API
- **News Marquee** — Live protocol announcements scrolling ticker

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 5 |
| Styling | Inline styles + CSS-in-JS |
| Fonts | Orbitron + Space Mono (Google Fonts) |
| Wallet | OPWallet (`window.opnet`) |
| Smart Contracts | `opnet` SDK + `@btc-vision/transaction` + `@btc-vision/bitcoin` |
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
git clone https://github.com/kuppow/opnet-btc-staking.git
cd opnet-btc-staking

# Install dependencies
npm install

# Start dev server
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
const provider = window.opnet || window.OPNet || window.opNet;

// Connect
const accounts = await provider.requestAccounts();
const publicKey = await provider.getPublicKey(); // hex string

// Fetch OP-20 token balance (official OPNet pattern)
import { Address } from "@btc-vision/transaction";
let buf = Buffer.from(publicKey.replace(/^0x/, ""), "hex");
if (buf.length === 33) buf = buf.slice(1); // strip 02/03 prefix → 32-byte x-only
const yourAddress = new Address(buf);
const contract = getContract(TOKEN_ADDRESS, OP_20_ABI, provider, network, yourAddress);
const result = await contract.balanceOf(yourAddress);
const balance = Number(result.properties.balance) / 1e8;
```

---

## 📋 Contract Details

| Property | Value |
|----------|-------|
| Network | OPNet Testnet (Signet fork) |
| RPC | `https://testnet.opnet.org` |
| MOTO Token | `opt1sqzkx6wm5acawl9m6nay2mjsm6wagv7gazcgtczds` |
| PILL Token | `opt1sqp5gx9k0nrqph3sy3aeyzt673dz7ygtqxcfdqfle` |
| Min Stake | `0.00001 BTC` |
| APY | `34.7%` base rate |
| Compound Fee | `0.5%` |
| Epoch | `144 blocks (~1 day)` |
| Unstake Lock | None |

---

## 🗂 Project Structure

```
opnet-btc-staking/
├── src/
│   ├── App.jsx          # Main app — all components in one file
│   └── main.jsx         # React entry point
├── public/
│   ├── btc-icon.webp
│   ├── icon-moto.jpg
│   └── icon-pill.png
├── index.html
├── vite.config.js
├── vercel.json          # Vercel SPA routing + CSP headers
└── package.json
```

---

## 🌐 Deployment (Vercel)

1. Push to GitHub
2. Import repo at [vercel.com](https://vercel.com)
3. Vercel auto-detects Vite — no config needed
4. Deploy ✅

The `vercel.json` handles SPA rewrites, CSP headers, and security headers.

---

## 🔒 Security

- **Non-custodial** — your keys never leave OPWallet
- **No private key handling** — `signer: null` on all transactions
- **CSP enforced** — strict Content Security Policy in production
- **Audited contracts** — staking & swap contracts audited by Verichain

---

## 📅 Roadmap

- [ ] Mainnet launch (March 17, 2026)
- [ ] Real swap execution via MotoSwap router contract
- [ ] Partial unstaking support
- [ ] Multi-wallet support (Unisat, Xverse)
- [ ] Mobile responsive layout
- [ ] Real-time APY from on-chain data
- [ ] More swap token pairs

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
  <a href="https://discord.gg/opnet">discord</a> ·
  <a href="https://github.com/kuppow/opnet-btc-staking">github</a>
</div>

