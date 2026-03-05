import { useState, useEffect, useRef } from "react";
import { getContract, JSONRpcProvider, OP_20_ABI } from "opnet";
import { Address } from "@btc-vision/transaction";
import { networks } from "@btc-vision/bitcoin";

// ── Staking ABI — defined locally since it's contract-specific ─────────────────
const STAKING_ABI = [
  {
    name: "stake",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "success", type: "bool" }],
    type: "function",
  },
  {
    name: "unstake",
    inputs: [],
    outputs: [{ name: "success", type: "bool" }],
    type: "function",
  },
  {
    name: "getStakedAmount",
    inputs: [{ name: "address", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
    type: "function",
  },
  {
    name: "getPendingRewards",
    inputs: [{ name: "address", type: "address" }],
    outputs: [{ name: "rewards", type: "uint256" }],
    type: "function",
  },
  {
    name: "compound",
    inputs: [],
    outputs: [{ name: "success", type: "bool" }],
    type: "function",
  },
];




// Fetch OP-20 token balance via OPNet RPC.
// Official OPNet pattern (btc-vision/opnet): new Address(wallet.keypair.publicKey)
// OPWallet.getPublicKey() returns a hex string — could be 33-byte compressed (02/03 prefix)
// or 32-byte x-only. Address() takes a Buffer of the raw pubkey bytes.
async function fetchOP20Balance(contractAddress, publicKeyHex) {
  try {
    if (!publicKeyHex) throw new Error("No public key");

    // Strip 0x prefix
    const hex = publicKeyHex.replace(/^0x/, "");

    // Convert hex → Buffer. If 33-byte compressed (66 hex chars starting with 02/03), strip prefix byte.
    // If 32-byte x-only (64 hex chars), use directly.
    let pubkeyBuf = Buffer.from(hex, "hex");
    if (pubkeyBuf.length === 33) {
      pubkeyBuf = pubkeyBuf.slice(1); // strip 02/03 prefix → 32-byte x-only
    }
    if (pubkeyBuf.length !== 32) throw new Error(`Unexpected pubkey length: ${pubkeyBuf.length}`);

    const yourAddress = new Address(pubkeyBuf);
    const provider = new JSONRpcProvider("https://testnet.opnet.org", networks.opnetTestnet);
    const contract = getContract(contractAddress, OP_20_ABI, provider, networks.opnetTestnet, yourAddress);
    const result = await contract.balanceOf(yourAddress);
    const raw = result?.properties?.balance;
    if (raw === undefined || raw === null) return null;
    return Number(raw) / 1e8;
  } catch (e) {
    console.warn("fetchOP20Balance error:", e?.message || e);
    return null;
  }
}

// ── OPNet Balance Helpers ──────────────────────────────────────────────────────
// OPNet mainnet launches March 17, 2026 — RPC not yet live
// Balance is read directly from the injected OPWallet provider

async function fetchWalletBalance(provider) {
  try {
    if (typeof provider.getBalance === "function") {
      const b = await provider.getBalance();
      const sats = typeof b === "object"
        ? (b.confirmed ?? b.total ?? b.amount ?? 0)
        : parseFloat(b) * 1e8;
      return parseFloat((sats / 1e8).toFixed(8));
    }
  } catch {}
  return null;
}

// ── Brand Colors ───────────────────────────────────────────────────────────────
const C = {
  bg:        "#0a0800",
  bgCard:    "#110e00",
  bgDeep:    "#0d0b00",
  border:    "#2a2000",
  orange:    "#f7931a",
  orangeGlow:"#f7931a55",
  orangeDim: "#f7931a22",
  orangeHot: "#ff9f2e",
  amber:     "#ffb347",
  white:     "#fff8ee",
  muted:     "#7a6a50",
  faint:     "#2e2510",
  red:       "#ff4136",
  green:     "#00c47a",
};

const TIERS = [
  { name:"BRONZE",  min:0,   max:249,  color:"#cd7f32", glow:"#cd7f3255" },
  { name:"SILVER",  min:250, max:499,  color:"#c8bfa8", glow:"#c8bfa855" },
  { name:"GOLD",    min:500, max:899,  color:"#f7931a", glow:"#f7931a55" },
  { name:"DIAMOND", min:900, max:1000, color:"#ffcc44", glow:"#ffcc4488" },
];
const getTier = s => TIERS.find(t => s >= t.min && s <= t.max) || TIERS[0];

const CATEGORY_COLORS = {
  FEES:"#ffb347", PROTOCOL:"#f7931a", SIGNALS:"#b9f2ff",
  TREASURY:"#00c47a", GOVERNANCE:"#ffcc44",
};

// ── Wallet Hook ────────────────────────────────────────────────────────────────
function useOPWallet() {
  const [wallet, setWallet]               = useState(null);
  const [connecting, setConnecting]       = useState(false);
  const [error, setError]                 = useState(null);
  const [detectedAddress, setDetected]    = useState(null); // found but not yet confirmed

  const getProvider = () => window.opnet || window.OPNet || window.opNet || window.unisat;

  const buildWallet = async (provider, address) => {
    let balance = "—";
    const bal = await fetchWalletBalance(provider);
    if (bal !== null) balance = bal.toFixed(8);
    // Capture public key at connect time — OPWallet exposes it multiple ways
    let publicKey = null;
    try {
      if (typeof provider.getPublicKey === "function") {
        publicKey = await provider.getPublicKey();
      } else if (provider.publicKey) {
        publicKey = provider.publicKey;
      }
      // Strip 0x prefix if present
      if (publicKey) publicKey = publicKey.replace(/^0x/, "");
    } catch { publicKey = null; }
    return { address, shortAddress: address.slice(0,8)+"..."+address.slice(-4), balance, publicKey };
  };

  const refreshBalance = async () => {
    const p = getProvider();
    if (!p) return;
    const bal = await fetchWalletBalance(p);
    if (bal !== null) {
      setWallet(w => w ? { ...w, balance: bal.toFixed(8) } : w);
    }
  };

  // On mount: silently detect if OPWallet already has an account — don't connect yet
  useEffect(()=>{
    const detect = async () => {
      const p = getProvider();
      if (!p) return;
      try {
        const accounts = typeof p.getAccounts === "function" ? await p.getAccounts() : [];
        if (accounts && accounts.length > 0) {
          setDetected(accounts[0]); // show confirmation prompt, don't auto-connect
        }
      } catch { /* wallet locked or not connected */ }
    };
    const t = setTimeout(detect, 500);
    return () => clearTimeout(t);
  }, []);

  // User confirmed from the prompt banner
  const confirmConnect = async () => {
    if (!detectedAddress) return;
    setConnecting(true);
    const p = getProvider();
    try {
      setWallet(await buildWallet(p, detectedAddress));
      setDetected(null);
    } catch(e) {
      setError("Failed to load wallet");
      setTimeout(()=>setError(null), 4000);
    }
    setConnecting(false);
  };

  // User dismissed the prompt
  const dismissDetected = () => setDetected(null);

  // Manual connect button
  const connect = async () => {
    setConnecting(true); setError(null);
    const p = getProvider();
    if (!p) {
      setError("OPWallet not installed");
      setTimeout(()=>setError(null), 4000);
      setConnecting(false);
      return;
    }
    try {
      const accounts = await p.requestAccounts();
      const address = Array.isArray(accounts) ? accounts[0] : accounts;
      if (!address) throw new Error("No address returned");
      setWallet(await buildWallet(p, address));
      setDetected(null);
    } catch(e) {
      const msg = e?.code === 4001 || e?.message?.toLowerCase().includes("reject")
        ? "Request rejected"
        : e?.message || "Connection failed";
      setError(msg);
      setTimeout(()=>setError(null), 4000);
    }
    setConnecting(false);
  };

  return { wallet, connecting, error, connect, disconnect:()=>setWallet(null), detectedAddress, confirmConnect, dismissDetected, refreshBalance };
}

// ── Wallet Detected Banner ─────────────────────────────────────────────────────
function WalletDetectedBanner({ address, onConfirm, onDismiss, connecting }) {
  return (
    <div style={{ position:"fixed", bottom:32, left:"50%", transform:"translateX(-50%)",
      zIndex:300, animation:"slideIn .3s ease", width:"min(480px,90vw)" }}>
      <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
        border:`1px solid ${C.orange}55`, borderRadius:16, padding:"20px 24px",
        boxShadow:`0 0 40px ${C.orangeGlow}, 0 16px 48px #000e` }}>
        <div style={{ position:"absolute",top:0,left:0,right:0,height:2,borderRadius:"16px 16px 0 0",
          background:`linear-gradient(90deg,transparent,${C.orange},transparent)` }}/>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
          <div style={{ width:36,height:36,borderRadius:"50%",background:C.orangeDim,
            border:`1px solid ${C.orange}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>🔐</div>
          <div>
            <div style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".06em" }}>
              OPWallet Detected
            </div>
            <div style={{ fontSize:11,color:C.muted,marginTop:2 }}>
              Connect this wallet to OP_NET Signal?
            </div>
          </div>
        </div>
        <div style={{ background:C.bgDeep,border:`1px solid ${C.faint}`,borderRadius:10,
          padding:"10px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:8 }}>
          <span style={{ fontSize:11,color:C.orange,fontFamily:"'Orbitron',monospace" }}>₿</span>
          <span style={{ fontSize:11,color:"#aa9977",fontFamily:"'Space Mono',monospace",
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{address}</span>
        </div>
        <div style={{ display:"flex",gap:10 }}>
          <button onClick={onDismiss} style={{ flex:1,padding:"10px",border:`1px solid ${C.border}`,
            borderRadius:10,background:"transparent",color:C.muted,fontSize:12,fontWeight:700,
            cursor:"pointer",fontFamily:"'Space Mono',monospace" }}>Not now</button>
          <button onClick={onConfirm} disabled={connecting} style={{ flex:2,padding:"10px",border:"none",
            borderRadius:10,background:`linear-gradient(135deg,#e8820a,${C.orange})`,
            color:"#000",fontSize:12,fontWeight:900,cursor:connecting?"not-allowed":"pointer",
            fontFamily:"'Orbitron',monospace",letterSpacing:".08em",
            boxShadow:`0 4px 16px ${C.orangeGlow}`,display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            {connecting
              ? <><span style={{ width:12,height:12,border:"2px solid #33220088",borderTopColor:"#000",borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite" }}/>Connecting...</>
              : <>⚡ Connect Wallet</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function genTxHash() {
  const h = "0123456789abcdef";
  return "0x"+Array.from({length:64},()=>h[Math.floor(Math.random()*16)]).join("");
}

// ── Logo ───────────────────────────────────────────────────────────────────────
function OpNetLogo({ size=36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <circle cx="18" cy="18" r="17" stroke={C.orange} strokeWidth="1.5" fill={C.bgDeep}/>
      <text x="18" y="23" textAnchor="middle" fill={C.orange} fontSize="12" fontWeight="900" fontFamily="'Orbitron',monospace">OP</text>
    </svg>
  );
}

// ── Bitcoin Icon ───────────────────────────────────────────────────────────────
function BitcoinIcon({ size=24, glow=false, float=false, color="#f7931a" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
      style={{ flexShrink:0, animation: float?"floatBtc 3s ease-in-out infinite":"none",
        filter: glow ? `drop-shadow(0 0 8px ${color})` : "none" }}>
      <circle cx="16" cy="16" r="15" fill={color} opacity=".15" stroke={color} strokeWidth="1.5"/>
      <text x="16" y="21" textAnchor="middle" fill={color} fontSize="14" fontWeight="900"
        fontFamily="Arial,sans-serif">₿</text>
    </svg>
  );
}
function AnimatedNumber({ value, decimals=2, prefix="", suffix="" }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const start=ref.current, end=value, t0=performance.now();
    const tick = now => {
      const t = Math.min((now-t0)/800,1);
      ref.current = start+(end-start)*(1-Math.pow(1-t,3));
      setDisplay(ref.current);
      if (t<1) requestAnimationFrame(tick); else ref.current=end;
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <span>{prefix}{display.toFixed(decimals)}{suffix}</span>;
}

// ── Live Pulse ─────────────────────────────────────────────────────────────────
function LivePulse({ active }) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:6 }}>
      <span style={{ width:7,height:7,borderRadius:"50%",background:active?C.orange:"#333",
        display:"inline-block",boxShadow:active?`0 0 8px ${C.orange}`:"none",
        animation:active?"pulse 1.5s infinite":"none" }}/>
      <span style={{ fontSize:9,letterSpacing:".15em",color:active?C.orange:"#444",fontFamily:"'Orbitron',monospace" }}>
        {active?"LIVE":"IDLE"}
      </span>
    </div>
  );
}

// ── Signal Ring ────────────────────────────────────────────────────────────────
function SignalRing({ score, tier }) {
  const r=54, circ=2*Math.PI*r;
  const pct = score/1000;
  return (
    <div style={{ position:"relative",width:140,height:140,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <svg width="140" height="140" style={{ position:"absolute",top:0,left:0,transform:"rotate(-90deg)" }}>
        <circle cx="70" cy="70" r={r} fill="none" stroke={C.faint} strokeWidth="10"/>
        <circle cx="70" cy="70" r={r} fill="none" stroke={tier.color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
          strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s cubic-bezier(.4,0,.2,1),stroke .5s",
          filter:`drop-shadow(0 0 8px ${tier.color})` }}/>
      </svg>
      <div style={{ textAlign:"center",zIndex:1 }}>
        <div style={{ fontSize:36,fontWeight:900,fontFamily:"'Orbitron',monospace",color:tier.color,
          textShadow:`0 0 20px ${tier.glow}`,lineHeight:1 }}>{score}</div>
        <div style={{ fontSize:10,letterSpacing:".2em",color:tier.color,marginTop:4,opacity:.8 }}>{tier.name}</div>
      </div>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, showBtcIcon=false }) {
  const [pop, setPop] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) { setPop(true); setTimeout(()=>setPop(false), 400); prev.current=value; }
  }, [value]);
  return (
    <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${accent}22`,
      borderRadius:12,padding:"16px 18px",position:"relative",overflow:"hidden",minWidth:0 }}>
      {/* Glow as absolute layer — never affects layout */}
      <div style={{ position:"absolute",inset:0,borderRadius:12,pointerEvents:"none",
        boxShadow:`0 0 30px ${accent}22`,animation:"glowPulse 4s ease-in-out infinite" }}/>
      <div style={{ position:"absolute",top:0,left:0,right:0,height:2,
        background:`linear-gradient(90deg,transparent,${accent},transparent)`,opacity:.8 }}/>
      <div style={{ position:"absolute",top:0,left:"-100%",width:"60%",height:"100%",opacity:.04,
        background:`linear-gradient(90deg,transparent,${accent},transparent)`,
        animation:"shimmerGold 3s linear infinite",pointerEvents:"none" }}/>
      <div style={{ fontSize:9,letterSpacing:".15em",color:C.muted,marginBottom:8,textTransform:"uppercase",position:"relative" }}>{label}</div>
      <div style={{ display:"flex",alignItems:"center",gap:8,position:"relative",minWidth:0,overflow:"hidden" }}>
        {showBtcIcon && <BitcoinIcon size={22} glow color={accent}/>}
        <div style={{ fontSize:16,fontWeight:900,fontFamily:"'Orbitron',monospace",color:accent,
          lineHeight:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,
          transformOrigin:"left center",willChange:"transform",
          transform:pop?"scale(1.06)":"scale(1)",transition:"transform .25s cubic-bezier(.34,1.56,.64,1)" }}>
          {value}
        </div>
      </div>
      {sub && <div style={{ fontSize:10,color:C.muted,marginTop:6,position:"relative",
        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{sub}</div>}
    </div>
  );
}

// ── Wallet Button ──────────────────────────────────────────────────────────────
function WalletButton({ wallet, connecting, error, onConnect, onDisconnect }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const [dropPos, setDropPos] = useState({ top:0, right:0 });

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setOpen(v => !v);
  };

  if (wallet) return (
    <div style={{ position:"relative" }} ref={btnRef}>
      <button onClick={handleOpen} style={{ display:"flex",alignItems:"center",gap:8,
        padding:"8px 16px",borderRadius:10,cursor:"pointer",fontFamily:"'Space Mono',monospace",
        background:`linear-gradient(135deg,#1a1000,#2a1800)`,
        border:`1px solid ${C.orange}66`,boxShadow:`0 0 16px ${C.orange}22`,transition:"all .2s" }}
        onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 0 24px ${C.orange}44`;e.currentTarget.style.borderColor=C.orange;}}
        onMouseLeave={e=>{e.currentTarget.style.boxShadow=`0 0 16px ${C.orange}22`;e.currentTarget.style.borderColor=`${C.orange}66`;}}>
        <span style={{ width:8,height:8,borderRadius:"50%",background:C.green,flexShrink:0,
          boxShadow:`0 0 8px ${C.green}`,animation:"pulse 2s infinite",display:"inline-block" }}/>
        <div style={{ textAlign:"left" }}>
          <div style={{ fontSize:8,color:C.muted,letterSpacing:".15em",lineHeight:1 }}>CONNECTED</div>
          <div style={{ fontSize:12,fontWeight:700,color:C.orange,lineHeight:1.4,whiteSpace:"nowrap" }}>
            {wallet.shortAddress}
          </div>
        </div>
        <span style={{ fontSize:10,color:`${C.orange}88`,marginLeft:2,
          display:"inline-block",transition:"transform .2s",
          transform:open?"rotate(180deg)":"rotate(0deg)" }}>▾</span>
      </button>

      {open && <>
        {/* Full page backdrop */}
        <div style={{ position:"fixed",inset:0,zIndex:9998 }} onClick={()=>setOpen(false)}/>
        {/* Dropdown — fixed so it escapes any overflow/clip context */}
        <div style={{ position:"fixed",top:dropPos.top,right:dropPos.right,
          background:`linear-gradient(160deg,#221400,#150e00)`,
          border:`1px solid ${C.orange}55`,borderRadius:14,padding:10,
          minWidth:270,zIndex:9999,
          boxShadow:`0 24px 80px #000f,0 0 0 1px ${C.orange}22,0 0 60px ${C.orange}14`,
          animation:"slideIn .15s ease" }}>

          {/* Connected via */}
          <div style={{ padding:"12px 16px",borderBottom:`1px solid ${C.faint}`,marginBottom:4 }}>
            <div style={{ fontSize:9,color:C.muted,letterSpacing:".2em",marginBottom:10 }}>CONNECTED VIA</div>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <OpNetLogo size={24}/>
              <div>
                <div style={{ fontSize:14,color:C.white,fontWeight:700,fontFamily:"'Orbitron',monospace",letterSpacing:".05em" }}>OP_WALLET</div>
                <div style={{ display:"flex",alignItems:"center",gap:5,marginTop:3 }}>
                  <span style={{ width:5,height:5,borderRadius:"50%",background:C.green,
                    display:"inline-block",animation:"pulse 1.5s infinite",boxShadow:`0 0 6px ${C.green}` }}/>
                  <span style={{ fontSize:9,color:C.green,letterSpacing:".12em",fontFamily:"'Orbitron',monospace" }}>ACTIVE</span>
                </div>
              </div>
            </div>
          </div>

          {/* Address */}
          <div style={{ padding:"12px 16px",borderBottom:`1px solid ${C.faint}`,marginBottom:4 }}>
            <div style={{ fontSize:9,color:C.muted,letterSpacing:".2em",marginBottom:8 }}>ADDRESS</div>
            <div style={{ fontSize:11,color:C.orange,wordBreak:"break-all",lineHeight:1.8,
              fontFamily:"'Space Mono',monospace",
              background:`${C.orange}08`,borderRadius:6,padding:"6px 8px",
              border:`1px solid ${C.orange}22` }}>
              {wallet.address}
            </div>
          </div>

          {/* Balance */}
          {wallet.balance !== "—" && (
            <div style={{ padding:"12px 16px",borderBottom:`1px solid ${C.faint}`,marginBottom:4 }}>
              <div style={{ fontSize:9,color:C.muted,letterSpacing:".2em",marginBottom:8 }}>BTC BALANCE</div>
              <div style={{ display:"flex",alignItems:"baseline",gap:6 }}>
                <div style={{ fontSize:22,color:C.orange,fontFamily:"'Orbitron',monospace",fontWeight:900,
                  textShadow:`0 0 20px ${C.orange}66` }}>
                  {wallet.balance}
                </div>
                <div style={{ fontSize:12,color:`${C.orange}88`,fontFamily:"'Orbitron',monospace" }}>BTC</div>
              </div>
            </div>
          )}

          {/* Disconnect */}
          <button onClick={()=>{ onDisconnect(); setOpen(false); }}
            style={{ width:"100%",padding:"12px 16px",border:`1px solid ${C.red}33`,
              borderRadius:8,background:`${C.red}0d`,color:C.red,fontSize:11,fontWeight:700,
              cursor:"pointer",fontFamily:"'Orbitron',monospace",letterSpacing:".1em",
              display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .2s",
              boxSizing:"border-box" }}
            onMouseEnter={e=>{ e.currentTarget.style.background=`${C.red}22`; e.currentTarget.style.borderColor=`${C.red}77`; }}
            onMouseLeave={e=>{ e.currentTarget.style.background=`${C.red}0d`; e.currentTarget.style.borderColor=`${C.red}33`; }}>
            ⏏ DISCONNECT WALLET
          </button>
        </div>
      </>}
    </div>
  );
  return (
    <div style={{ position:"relative" }}>
      <button onClick={onConnect} disabled={connecting} style={{ display:"flex",alignItems:"center",gap:10,
        padding:"10px 22px",borderRadius:8,border:"none",
        background:connecting?"#1a1000":`linear-gradient(135deg,#e8820a,${C.orange})`,
        color:connecting?"#554400":"#000",fontSize:13,fontWeight:900,cursor:connecting?"not-allowed":"pointer",
        letterSpacing:".08em",fontFamily:"'Orbitron',monospace",
        boxShadow:connecting?"none":`0 4px 24px ${C.orangeGlow}`,transition:"all .25s" }}>
        {connecting
          ? <><span style={{ width:14,height:14,border:"2px solid #332200",borderTopColor:C.orange,borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite" }}/>CONNECTING...</>
          : <>⚡ CONNECT WALLET</>}
      </button>
      {error && (
        <div style={{ position:"absolute",bottom:"calc(100% + 8px)",right:0,background:"#1a1000",
          border:`1px solid ${C.red}44`,borderRadius:8,padding:"8px 14px",whiteSpace:"nowrap",
          fontSize:12,color:C.red,zIndex:10 }}>
          {error}
          {error==="OPWallet not installed" && (
            <a href="https://opnet.org" target="_blank" rel="noreferrer"
              style={{ display:"block",marginTop:4,color:C.orange,fontSize:11 }}>
              → Install OPWallet
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────────
function Header({ page, onNav, wallet, connecting, error, onConnect, onDisconnect, blockHeight, btcPrice }) {
  return (
    <div style={{ position:"sticky",top:0,zIndex:90,background:C.bgDeep,borderBottom:`1px solid ${C.border}` }}>

      {/* TOP BAR — Logo + Stats + Wallet */}
      <div style={{ position:"relative",padding:"14px 32px",
        background:`linear-gradient(135deg,${C.bg} 0%,#1a0e00 60%,${C.bg} 100%)` }}>
        {/* Subtle bg orbs */}
        <div style={{ position:"absolute",top:"-30px",left:"8%",width:140,height:140,borderRadius:"50%",
          background:`radial-gradient(circle,#f7931a14 0%,transparent 70%)`,pointerEvents:"none" }}/>
        <div style={{ position:"absolute",top:"-10px",right:"12%",width:100,height:100,borderRadius:"50%",
          background:`radial-gradient(circle,#ffb34710 0%,transparent 70%)`,pointerEvents:"none" }}/>
        {/* Hex grid */}
        <div style={{ position:"absolute",inset:0,opacity:.025,pointerEvents:"none",
          backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpolygon points='30,3 57,17 57,43 30,57 3,43 3,17' fill='none' stroke='%23f7931a' stroke-width='1'/%3E%3C/svg%3E")`,
          backgroundSize:"60px 60px" }}/>

        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",gap:16 }}>

          {/* Left — Logo + Title */}
          <div style={{ display:"flex",alignItems:"center",gap:14,flexShrink:0 }}>
            <div style={{ position:"relative",width:44,height:44,flexShrink:0 }}>
              <svg width="44" height="44" viewBox="0 0 64 64" style={{ animation:"floatBtc 4s ease-in-out infinite",filter:`drop-shadow(0 0 10px ${C.orange})` }}>
                <circle cx="32" cy="32" r="30" fill={C.orange} opacity=".15" stroke={C.orange} strokeWidth="1.5"/>
                <circle cx="32" cy="32" r="22" fill="none" stroke={C.orange} strokeWidth=".5" opacity=".4"/>
                <text x="32" y="41" textAnchor="middle" fill={C.orange} fontSize="26" fontWeight="900" fontFamily="Arial,sans-serif">₿</text>
              </svg>
              <div style={{ position:"absolute",inset:-6,borderRadius:"50%",border:`1px solid ${C.orange}22`,animation:"spin 8s linear infinite" }}/>
            </div>
            <div>
              <div style={{ fontSize:18,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,
                letterSpacing:".06em",lineHeight:1,whiteSpace:"nowrap",textShadow:`0 0 30px ${C.orange}44` }}>
                OP_NET <span style={{ color:C.orange }}>BTC</span> STAKING
              </div>
              <div style={{ display:"flex",alignItems:"center",gap:8,marginTop:4 }}>
                <span style={{ fontSize:9,letterSpacing:".15em",color:C.muted }}>Bitcoin Layer 1</span>
                <span style={{ width:1,height:8,background:C.border,display:"inline-block" }}/>
                <span style={{ fontSize:9,color:C.green,display:"flex",alignItems:"center",gap:3 }}>
                  <span style={{ width:4,height:4,borderRadius:"50%",background:C.green,display:"inline-block",animation:"pulse 1.5s infinite" }}/>
                  LIVE
                </span>
                <span style={{ width:1,height:8,background:C.border,display:"inline-block" }}/>
                <span style={{ fontSize:9,color:`${C.orange}88`,letterSpacing:".08em" }}>MAINNET MAR 17</span>
              </div>
            </div>
          </div>

          {/* Right — Stats + Wallet */}
          <div style={{ display:"flex",alignItems:"center",gap:10,flexShrink:0 }}>
            {/* BTC Price */}
            {btcPrice && (
              <div style={{ textAlign:"right",
                background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
                border:`1px solid ${btcPrice.change>=0?C.green:C.red}44`,
                borderRadius:8,padding:"6px 12px",
                boxShadow:`0 0 12px ${btcPrice.change>=0?C.green:C.red}18` }}>
                <div style={{ fontSize:8,color:C.muted,letterSpacing:".15em",marginBottom:2 }}>BTC / USD</div>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  <div style={{ fontSize:14,fontFamily:"'Orbitron',monospace",
                    color:btcPrice.change>=0?C.green:C.red,fontWeight:900 }}>
                    ${btcPrice.price.toLocaleString()}
                  </div>
                  <div style={{ fontSize:9,fontWeight:700,fontFamily:"'Orbitron',monospace",
                    color:btcPrice.change>=0?C.green:C.red,
                    background:btcPrice.change>=0?`${C.green}18`:`${C.red}18`,
                    padding:"1px 5px",borderRadius:4 }}>
                    {btcPrice.change>=0?"▲":"▼"}{Math.abs(btcPrice.change).toFixed(2)}%
                  </div>
                </div>
              </div>
            )}
            {/* Block Height */}
            {blockHeight && (
              <div style={{ textAlign:"right",background:C.bgCard,border:`1px solid ${C.border}`,
                borderRadius:8,padding:"6px 12px" }}>
                <div style={{ fontSize:8,color:C.muted,letterSpacing:".15em",marginBottom:1 }}>BLOCK</div>
                <div style={{ fontSize:13,fontFamily:"'Orbitron',monospace",color:C.orange,fontWeight:700 }}>
                  #{blockHeight.toLocaleString()}
                </div>
              </div>
            )}
            <WalletButton wallet={wallet} connecting={connecting} error={error} onConnect={onConnect} onDisconnect={onDisconnect}/>
          </div>
        </div>
      </div>

      {/* BOTTOM BAR — Nav Tabs */}
      <div style={{ background:C.bgDeep,borderTop:`1px solid ${C.faint}`,padding:"0 32px",
        display:"flex",alignItems:"stretch",gap:0 }}>
        {[
          { label:"Dashboard",    key:"dashboard",      icon:"⬡" },
          { label:"Swap",         key:"swap",           icon:"⇄" },
          { label:"DAO",          key:"dao",            icon:"⬟" },
          { label:"How It Works", key:"how-it-works",   icon:"◈" },
          { label:"Announcements",key:"announcements",  icon:"◉" },
          { label:"Support",      key:"support",        icon:"◎" },
        ].map(item=>(
          <button key={item.key} onClick={()=>onNav(item.key)} className="nav-btn"
            style={{ padding:"11px 22px",border:"none",cursor:"pointer",
              background:"transparent",
              color:page===item.key?C.orange:C.muted,
              fontSize:11,fontWeight:700,fontFamily:"'Orbitron',monospace",letterSpacing:".08em",
              borderBottom:page===item.key?`2px solid ${C.orange}`:"2px solid transparent",
              borderTop:"2px solid transparent",
              display:"flex",alignItems:"center",gap:7,
              transition:"all .2s",whiteSpace:"nowrap",
              boxShadow:page===item.key?`inset 0 -1px 12px ${C.orange}18`:"none" }}>
            <span style={{ fontSize:10,opacity:page===item.key?1:.5 }}>{item.icon}</span>
            {item.label}
            {item.key==="announcements" && (
              <span style={{ fontSize:8,padding:"1px 5px",borderRadius:8,background:C.orange,
                color:"#000",fontWeight:900,marginLeft:2 }}>NEW</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Staking Panel ──────────────────────────────────────────────────────────────
function StakingPanel({ staked, setStaked, pending, setPending, autoCompound, setAutoCompound, walletConnected, addTx, blockRef, setStakeStartBlock, btcBalance, wallet }) {
  const [input, setInput] = useState("");
  const [tab, setTab] = useState("stake");
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [txError, setTxError] = useState(null);

  const btc = parseFloat(btcBalance) || 0;
  const MIN_STAKE = 0.00001;
  const amt = parseFloat(input) || 0;
  // Only block on balance if we have a confirmed non-zero balance loaded
  const overBalance = tab==="stake" && btc > 0 && amt > btc;
  const underMin    = tab==="stake" && amt > 0 && amt < MIN_STAKE;
  const overStaked  = tab==="unstake" && amt > staked;
  // Allow staking even while a previous tx is confirming — don't check submitting here
  const canGo       = walletConnected && amt > 0 && !overBalance && !underMin && !overStaked;

  // OPNet staking contract address on Bitcoin L1
  const STAKING_CONTRACT = "op1pzj5zvvqvx7jaz6gwat2qhdszynl49sh69crea37wsuxkpa0qe0vq57rk0c";
  const RPC_URL = "https://testnet.opnet.org";

  const execute = async () => {
    if (!canGo) return;
    setSubmitting(true);
    setTxError(null);

    let realTxHash = null;
    let txFailed = false;

    try {
      const satoshis = BigInt(Math.round(amt * 1e8));
      const network = networks.opnetTestnet;

      // 1. Build OPNet provider + typed staking contract interface
      const rpcProvider = new JSONRpcProvider({ url: RPC_URL, network });
      const contract = getContract(STAKING_CONTRACT, STAKING_ABI, rpcProvider, network);

      // 2. Simulate the tx — builds calldata + UTXO plan (no signing yet)
      const simulation = tab === "stake"
        ? await contract.stake(satoshis)
        : await contract.unstake();

      // 3. sendTransaction with signer:null — OPWallet pops up and handles ALL signing
      const receipt = await simulation.sendTransaction({
        signer: null,       // ALWAYS null on frontend — OPWallet signs
        mldsaSigner: null,  // ALWAYS null on frontend — OPWallet signs
        refundTo: wallet.address,
        maximumAllowedSatToSpend: satoshis + 10_000n,
        network,
        feeRate: 0,         // 0 = auto fee rate
      });

      // 4. Extract txHash from receipt
      if (receipt) {
        realTxHash = receipt.txid ?? receipt.hash ?? receipt.id ?? null;
      }
    } catch(e) {
      const isRejection = e?.code === 4001
        || e?.message?.toLowerCase().includes("reject")
        || e?.message?.toLowerCase().includes("cancel")
        || e?.message?.toLowerCase().includes("denied");

      if (isRejection) {
        // User explicitly cancelled — don't update state
        setTxError("Transaction rejected by wallet");
        setTimeout(() => setTxError(null), 5000);
        txFailed = true;
      } else {
        // Network/RPC error — still update local state optimistically,
        // just show a warning that on-chain confirmation may be delayed
        setTxError(`On-chain error: ${e?.message || "unknown"} — showing local update`);
        setTimeout(() => setTxError(null), 7000);
      }
    }

    // Always update local state unless user explicitly rejected
    if (!txFailed) {
      if (tab === "stake") {
        if (staked === 0) setStakeStartBlock(blockRef.current);
        setStaked(s => s + amt);
        addTx("STAKE", amt, blockRef.current, realTxHash);
      } else {
        const next = Math.max(0, staked - amt);
        setStaked(() => next);
        addTx("UNSTAKE", amt, blockRef.current, realTxHash);
        if (next === 0) {
          setStakeStartBlock(blockRef.current);
          setPending(0);
        }
      }
    }

    setInput("");
    setConfirm(false);
    setSubmitting(false);
  };

  const balanceLabel = tab==="stake"
    ? btcBalance && btcBalance!=="—" ? `Balance: ${btcBalance} BTC` : "Balance: —"
    : `Staked: ${staked.toFixed(8)} BTC`;

  return (
    <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.border}`,
      borderRadius:16,padding:24,position:"relative" }}>
      {!walletConnected && (
        <div style={{ position:"absolute",inset:0,borderRadius:16,background:"#0a080099",backdropFilter:"blur(6px)",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:10,gap:10 }}>
          <div style={{ fontSize:28 }}>🔒</div>
          <div style={{ fontSize:13,color:C.muted }}>Connect wallet to stake</div>
        </div>
      )}

      {/* ── Confirmation Modal ── */}
      {confirm && (
        <>
          <div onClick={()=>{ if(!submitting) setConfirm(false); }} style={{ position:"fixed",inset:0,background:"#000000bb",backdropFilter:"blur(6px)",zIndex:150 }}/>
          <div style={{ position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
            width:"min(420px,90vw)",background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
            border:`1px solid ${tab==="stake"?C.orange+44:C.red+"44"}`,borderRadius:20,padding:32,zIndex:160,
            boxShadow:`0 0 60px ${tab==="stake"?C.orangeGlow:"#ff413644"},0 20px 60px #000c`,animation:"slideIn .2s ease" }}>
            <div style={{ position:"absolute",top:0,left:0,right:0,height:2,borderRadius:"20px 20px 0 0",
              background:`linear-gradient(90deg,transparent,${tab==="stake"?C.orange:C.red},transparent)` }}/>
            {/* Icon + title */}
            <div style={{ textAlign:"center",marginBottom:24 }}>
              <div style={{ fontSize:40,marginBottom:12 }}>{tab==="stake"?"⚡":"↩"}</div>
              <div style={{ fontSize:18,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,marginBottom:4 }}>
                Confirm {tab==="stake"?"Stake":"Unstake"}
              </div>
              <div style={{ fontSize:11,color:C.muted }}>Review the details before signing</div>
            </div>
            {/* Details */}
            <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:24 }}>
              {[
                { label:"Action",  value: tab==="stake" ? "STAKE BTC" : "UNSTAKE BTC", color: tab==="stake"?C.orange:C.red },
                { label:"Amount",  value: `${amt.toFixed(8)} BTC`, color: C.white },
                { label:tab==="stake"?"Remaining balance":"New staked total",
                  value: tab==="stake"
                    ? `${Math.max(0, btc - amt).toFixed(8)} BTC`
                    : `${Math.max(0, staked - amt).toFixed(8)} BTC`,
                  color: C.amber },
                { label:"Network", value: "Bitcoin L1 · OPNet", color: C.muted },
              ].map(row => (
                <div key={row.label} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"10px 14px",background:C.bgDeep,borderRadius:8,border:`1px solid ${C.faint}` }}>
                  <span style={{ fontSize:11,color:C.muted,letterSpacing:".1em",textTransform:"uppercase" }}>{row.label}</span>
                  <span style={{ fontSize:12,fontWeight:700,fontFamily:"'Orbitron',monospace",color:row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
            {/* Buttons */}
            <div style={{ display:"flex",gap:10 }}>
              <button onClick={()=>setConfirm(false)} disabled={submitting} style={{ flex:1,padding:"12px",
                border:`1px solid ${C.border}`,borderRadius:10,background:"transparent",
                color:C.muted,fontSize:13,fontWeight:700,cursor:submitting?"not-allowed":"pointer",
                fontFamily:"'Space Mono',monospace",opacity:submitting?0.5:1 }}>Cancel</button>
              <button onClick={execute} disabled={submitting} style={{ flex:2,padding:"12px",border:"none",borderRadius:10,
                background:submitting?"#1a1000":tab==="stake"?`linear-gradient(135deg,#e8820a,${C.orange})`:`linear-gradient(135deg,#aa2200,${C.red})`,
                color:submitting?"#443322":"#000",fontSize:13,fontWeight:900,
                cursor:submitting?"not-allowed":"pointer",fontFamily:"'Orbitron',monospace",
                letterSpacing:".08em",display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                boxShadow:submitting?"none":tab==="stake"?`0 4px 20px ${C.orangeGlow}`:`0 4px 20px ${C.red}44`,
                transition:"all .2s" }}>
                {submitting
                  ? <><span style={{ width:13,height:13,border:"2px solid #33220055",borderTopColor:C.orange,borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite" }}/>SIGNING...</>
                  : tab==="stake" ? "⚡ CONFIRM STAKE" : "↩ CONFIRM UNSTAKE"}
              </button>
            </div>
            {txError && (
              <div style={{ marginTop:12,padding:"10px 14px",borderRadius:8,background:"#1a0500",
                border:`1px solid ${C.red}44`,color:C.red,fontSize:12,textAlign:"center" }}>
                ⚠ {txError}
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20 }}>
        <BitcoinIcon size={28} glow float color={C.orange}/>
        <div>
          <div style={{ fontSize:13,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".06em" }}>BTC STAKING</div>
          <div style={{ fontSize:10,color:C.muted,marginTop:2 }}>
            <span className="highlight-stake">Stake</span>
            <span style={{ color:C.muted }}> · </span>
            <span className="highlight-earn">Earn</span>
            <span style={{ color:C.muted }}> · </span>
            <span className="highlight-compound">Compound</span>
          </div>
        </div>
      </div>
      <div style={{ display:"flex",marginBottom:20,background:C.bgDeep,borderRadius:8,padding:4 }}>
        {["stake","unstake"].map(t=>(
          <button key={t} onClick={()=>{ setTab(t); setInput(""); }} style={{ flex:1,padding:"10px",border:"none",borderRadius:6,
            background:tab===t?"#1a1000":"transparent",color:tab===t?C.orange:C.muted,
            fontSize:13,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",cursor:"pointer" }}>{t}</button>
        ))}
      </div>
      <div style={{ marginBottom:16 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
          <div style={{ display:"flex",alignItems:"center",gap:6 }}>
            <BitcoinIcon size={16} glow color={C.orange}/>
            <span style={{ fontSize:11,color:C.muted }}>Amount (BTC)</span>
          </div>
          <span style={{ fontSize:11,color:overBalance||overStaked?C.red:C.muted,
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"55%" }}>{balanceLabel}</span>
        </div>
        {/* Percent quick-select */}
        <div style={{ display:"flex",gap:6,marginBottom:10 }}>
          {[10,25,50,75,100].map(pct=>{
            const base = tab==="stake" ? btc : staked;
            const label = pct===100?"MAX":`${pct}%`;
            return (
              <button key={pct} className="pct-btn" onClick={()=>{ const v=(base*pct/100); setInput(v>0?v.toFixed(8):""); }}
                style={{ flex:1,padding:"6px 0",border:`1px solid ${C.border}`,borderRadius:6,
                  background:C.bgDeep,color:C.muted,fontSize:11,fontWeight:700,
                  cursor:"pointer",fontFamily:"'Orbitron',monospace",letterSpacing:".05em",
                  transition:"all .15s" }}>{label}</button>
            );
          })}
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <div style={{ flex:1,position:"relative" }}>
            {/* Glow border effect */}
            <div style={{ position:"absolute",inset:-1,borderRadius:12,
              background:`linear-gradient(135deg,${overBalance||underMin||overStaked?C.red:C.orange}44,transparent,${overBalance||underMin||overStaked?C.red:C.orange}22)`,
              opacity: input ? 1 : 0, transition:"opacity .3s", pointerEvents:"none", zIndex:0 }}/>
            <div style={{ position:"relative",zIndex:1,
              background:`linear-gradient(135deg,${C.bgDeep},#0d0b00)`,
              border:`1.5px solid ${overBalance||underMin||overStaked?C.red:input?C.orange:C.border}`,
              borderRadius:12, padding:"16px 16px 16px 52px",
              boxShadow: input ? `0 0 24px ${overBalance||underMin||overStaked?C.red+"44":C.orange+"33"}, inset 0 1px 0 ${C.orange}11` : "none",
              transition:"all .3s" }}>
              {/* ₿ icon */}
              <span style={{ position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",
                fontSize:20,color:overBalance||underMin||overStaked?C.red:C.orange,
                fontFamily:"'Orbitron',monospace",pointerEvents:"none",
                textShadow:`0 0 12px ${C.orange}`,lineHeight:1 }}>₿</span>
              <input value={input} onChange={e=>setInput(e.target.value)} placeholder="0.00000000"
                type="number" min="0" step="0.00000001"
                style={{ width:"100%",background:"transparent",border:"none",outline:"none",
                  color:overBalance||underMin||overStaked?C.red:C.white,
                  fontSize:28,fontWeight:900,fontFamily:"'Orbitron',monospace",
                  letterSpacing:"-.01em", padding:0,
                  textShadow: input && !overBalance && !underMin && !overStaked ? `0 0 20px ${C.orange}66` : "none" }}/>
            </div>
          </div>
          <button onClick={()=>setInput(tab==="stake" ? (btc>0?String(btc):"") : String(staked))}
            style={{ padding:"0 18px",background:`linear-gradient(135deg,${C.bgDeep},#0d0b00)`,
              border:`1.5px solid ${C.orange}44`,borderRadius:12,
              color:C.orange,fontSize:11,fontWeight:900,cursor:"pointer",
              fontFamily:"'Orbitron',monospace",letterSpacing:".1em",
              transition:"all .2s",whiteSpace:"nowrap" }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.orange; e.currentTarget.style.boxShadow=`0 0 16px ${C.orange}44`; e.currentTarget.style.background=`${C.orange}18`; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor=`${C.orange}44`; e.currentTarget.style.boxShadow="none"; e.currentTarget.style.background=`linear-gradient(135deg,${C.bgDeep},#0d0b00)`; }}>
            MAX
          </button>
        </div>
        {overBalance && <div style={{ marginTop:6,fontSize:10,color:C.red,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>⚠ Exceeds wallet balance</div>}
        {underMin    && <div style={{ marginTop:6,fontSize:10,color:C.red }}>⚠ Minimum stake is {MIN_STAKE} BTC</div>}
        {overStaked  && <div style={{ marginTop:6,fontSize:10,color:C.red }}>⚠ Exceeds staked amount</div>}
      </div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,
        padding:"12px 16px",background:C.bgDeep,borderRadius:8 }}>
        <div>
          <div style={{ fontSize:13,color:"#aa9977",marginBottom:2 }}>Auto-Compound</div>
          <div style={{ fontSize:11,color:C.muted }}>Reinvest rewards every epoch</div>
        </div>
        <div onClick={()=>setAutoCompound(!autoCompound)} style={{ width:48,height:26,borderRadius:13,
          background:autoCompound?C.orangeDim:C.faint,border:`1px solid ${autoCompound?C.orange+"66":C.border}`,
          cursor:"pointer",position:"relative",transition:"all .3s" }}>
          <div style={{ position:"absolute",top:3,left:autoCompound?24:3,width:18,height:18,borderRadius:"50%",
            background:autoCompound?C.orange:"#444",boxShadow:autoCompound?`0 0 12px ${C.orange}`:"none",
            transition:"all .3s" }}/>
        </div>
      </div>
      <button onClick={()=>canGo&&setConfirm(true)} disabled={!canGo} style={{ width:"100%",padding:"14px",border:"none",borderRadius:10,
        background:!canGo?"#1a1000":tab==="stake"?`linear-gradient(135deg,#e8820a,${C.orange})`:`linear-gradient(135deg,#aa2200,${C.red})`,
        color:!canGo?"#443322":"#000",fontSize:15,fontWeight:900,letterSpacing:".1em",textTransform:"uppercase",
        cursor:canGo?"pointer":"not-allowed",fontFamily:"'Orbitron',monospace",
        boxShadow:!canGo?"none":tab==="stake"?`0 4px 24px ${C.orangeGlow}`:`0 4px 24px ${C.red}44`,
        transition:"all .2s" }}>
        {tab==="stake"?"⚡ Stake BTC":"↩ Unstake BTC"}
      </button>
      <div style={{ overflow:"hidden", transition:"max-height .3s ease, opacity .3s ease",
        maxHeight: pending>=0.00001 && walletConnected && !autoCompound ? 60 : 0,
        opacity: pending>=0.00001 && walletConnected && !autoCompound ? 1 : 0 }}>
        <button onClick={()=>{ addTx("COMPOUND",pending*.995,blockRef.current); setStaked(s=>s+pending*.995); setPending(0); }}
          style={{ width:"100%",marginTop:10,padding:"11px",border:`1px solid ${C.orange}33`,borderRadius:10,
            background:C.orangeDim,color:C.orange,fontSize:12,fontWeight:700,cursor:"pointer",
            fontFamily:"'Orbitron',monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
          🔄 Compound {pending.toFixed(8)} BTC (est.)
        </button>
      </div>
    </div>
  );
}

// ── TX Feed ────────────────────────────────────────────────────────────────────
function TxFeed({ txs, currentBlock }) {
  const [copied, setCopied] = useState(null);
  const copy = hash => { navigator.clipboard?.writeText(hash); setCopied(hash); setTimeout(()=>setCopied(null),1500); };
  if (!txs.length) return (
    <div style={{ textAlign:"center",padding:"32px",color:C.muted,fontSize:13 }}>
      No transactions yet — stake or unstake to see activity
    </div>
  );
  const typeMeta = { STAKE:{color:C.orange,bg:C.orangeDim}, UNSTAKE:{color:C.red,bg:"#1a0500"}, COMPOUND:{color:C.amber,bg:"#1a0e00"} };
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:10,maxHeight:300,overflowY:"auto" }}>
      {txs.map(tx=>{
        const confs = tx.status==="confirming" ? Math.min(6,Math.max(0,currentBlock-tx.submittedBlock)) : tx.status==="confirmed"?6:0;
        const prog = tx.status==="confirmed"?100:tx.status==="confirming"?(confs/6)*100:0;
        const tm = typeMeta[tx.type]||typeMeta.STAKE;
        const statusColor = tx.status==="confirmed"?C.green:tx.status==="confirming"?C.orange:C.amber;
        const displayAmt = parseFloat(tx.amount);
        const fmtAmt = isNaN(displayAmt) ? tx.amount : parseFloat(displayAmt.toFixed(8)).toString();
        return (
          <div key={tx.hash} style={{ background:C.bgDeep,border:`1px solid ${statusColor}22`,borderRadius:10,padding:"14px 16px" }}>
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10 }}>
              <span style={{ padding:"3px 10px",borderRadius:4,fontSize:9,fontWeight:800,letterSpacing:".1em",
                background:tm.bg,color:tm.color,border:`1px solid ${tm.color}44`,fontFamily:"'Orbitron',monospace",flexShrink:0 }}>{tx.type}</span>
              <div style={{ flex:1 }}>
                <span style={{ fontSize:15,fontWeight:900,color:C.white,fontFamily:"'Orbitron',monospace" }}>
                  {isNaN(displayAmt) ? tx.amount : fmtAmt}
                </span>
                <span style={{ fontSize:11,color:C.orange,fontFamily:"'Orbitron',monospace",marginLeft:6 }}>BTC</span>
              </div>
              <span style={{ fontSize:10,color:statusColor,letterSpacing:".1em",fontFamily:"'Orbitron',monospace",flexShrink:0 }}>
                {tx.status==="confirmed"?"✓ CONFIRMED":tx.status==="confirming"?`${confs}/6 CONFS`:"● PENDING"}
              </span>
            </div>
            <div style={{ height:4,borderRadius:2,background:C.faint,overflow:"hidden",marginBottom:10 }}>
              <div style={{ height:"100%",borderRadius:2,width:`${prog}%`,transition:"width .5s ease",
                background:tx.status==="confirmed"?C.green:`linear-gradient(90deg,${C.orange},${C.amber})`,
                backgroundSize:"200% 100%",animation:tx.status==="confirming"?"shimmer 2s infinite linear":"none" }}/>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:6 }}>
              <span style={{ fontSize:10,color:"#554433",fontFamily:"'Space Mono',monospace",flex:1,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{tx.hash}</span>
              {tx.real && <span style={{ fontSize:9,padding:"1px 6px",borderRadius:4,background:`${C.green}18`,
                color:C.green,border:`1px solid ${C.green}33`,fontFamily:"'Orbitron',monospace",
                flexShrink:0,letterSpacing:".08em" }}>ON-CHAIN</span>}
              <button onClick={()=>copy(tx.hash)} style={{ padding:"2px 8px",border:`1px solid ${C.faint}`,
                borderRadius:4,background:"transparent",color:copied===tx.hash?C.green:C.muted,
                fontSize:10,cursor:"pointer",flexShrink:0 }}>{copied===tx.hash?"✓":"⎘"}</button>
              <span style={{ fontSize:10,color:C.muted,flexShrink:0 }}>Block #{tx.submittedBlock.toLocaleString()}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Top Stakers ────────────────────────────────────────────────────────────────
// Scores use formula: min(1000, floor(staked/5) * timeMult)
// BTC staked, timeMult=5 (Diamond holders staked long)
// e.g. 4.82 BTC → floor(4.82/5)*5 = floor(0.964)*5 = 0*5 = 0... 
// Score formula needs BTC scale: min(1000, floor(staked*1000) * timeMult / 5)
// Simplified: score = min(1000, Math.floor(staked * 200 * timeMult))
// Top staker 4.82 BTC * 200 * 5 = 4820 → capped at 1000 ✓
// 0.5 BTC * 200 * 2 = 200 → Bronze ✓
const scoreFromBTC = (btc, mult) => Math.min(1000, Math.floor(btc * 200 * mult));

const BASE_STAKERS = [
  { addr:"op1pzj5...rk0c", staked:4.82140000, mult:5, tier:TIERS[3], change:+0.00012400 },
  { addr:"op1qf8a...x7d2", staked:3.51080000, mult:5, tier:TIERS[3], change:+0.00008800 },
  { addr:"op1qb72...m4r5", staked:2.94430000, mult:5, tier:TIERS[3], change:-0.00003200 },
  { addr:"op1q0d9...z2q8", staked:1.88200000, mult:5, tier:TIERS[3], change:+0.00005500 },
  { addr:"op1q5e3...w1v6", staked:1.24600000, mult:3, tier:TIERS[3], change:+0.00002100 },
  { addr:"op1qa1b...n8f3", staked:0.74800000, mult:3, tier:TIERS[2], change:-0.00007400 },
  { addr:"op1q2d4...e5t7", staked:0.38200000, mult:2, tier:TIERS[2], change:+0.00001800 },
  { addr:"op1qc9f...r3h0", staked:0.18900000, mult:2, tier:TIERS[1], change:+0.00000900 },
  { addr:"op1qd7e...q2s5", staked:0.07600000, mult:1, tier:TIERS[1], change:-0.00001500 },
  { addr:"op1qe6g...p1t4", staked:0.01420000, mult:1, tier:TIERS[0], change:+0.00000420 },
].map(s => ({ ...s, score: scoreFromBTC(s.staked, s.mult) }));

// ── Network Panel ──────────────────────────────────────────────────────────────
function NetworkPanel({ blockHeight, tvl, apy }) {
  const [tick, setTick] = useState(0);
  const [nodes, setNodes] = useState(() =>
    Array.from({ length: 6 }, (_, i) => ({
      id: i, x: 20 + (i % 3) * 80, y: 20 + Math.floor(i / 3) * 60,
      active: Math.random() > 0.3,
    }))
  );
  useEffect(() => {
    const iv = setInterval(() => {
      setTick(t => t + 1);
      setNodes(prev => prev.map(n => ({ ...n, active: Math.random() > 0.25 })));
    }, 1800);
    return () => clearInterval(iv);
  }, []);

  const stats = [
    { label: "BLOCKS TODAY", value: (blockHeight % 144).toString(), color: C.orange },
    { label: "STAKERS", value: "1,247", color: C.amber },
    { label: "AVG STAKE", value: "0.228 BTC", color: C.green },
    { label: "NEXT EPOCH", value: `${144 - (blockHeight % 144)} blk`, color: "#bb88ff" },
  ];

  return (
    <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
      border:`1px solid ${C.border}`,borderRadius:16,padding:20,position:"relative",overflow:"hidden" }}>
      <div style={{ position:"absolute",top:0,left:0,right:0,height:2,
        background:`linear-gradient(90deg,transparent,${C.orange},transparent)` }}/>

      <div style={{ fontSize:11,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,
        letterSpacing:".08em",marginBottom:16,display:"flex",alignItems:"center",gap:8 }}>
        <span style={{ width:6,height:6,borderRadius:"50%",background:C.orange,display:"inline-block",
          animation:"pulse 1.5s infinite",boxShadow:`0 0 8px ${C.orange}` }}/>
        NETWORK STATUS
      </div>

      {/* Animated node graph */}
      <div style={{ position:"relative",height:120,marginBottom:16,
        background:C.bgDeep,borderRadius:10,overflow:"hidden",border:`1px solid ${C.faint}` }}>
        <svg width="100%" height="120" style={{ position:"absolute",inset:0 }}>
          {/* Connection lines */}
          {nodes.map((a, i) => nodes.slice(i+1).map((b, j) => {
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (dist > 110) return null;
            return (
              <line key={`${i}-${j}`} x1={`${a.x}%`} y1={a.y} x2={`${b.x}%`} y2={b.y}
                stroke={C.orange} strokeWidth=".5"
                strokeOpacity={a.active && b.active ? 0.3 : 0.05}
                style={{ transition:"stroke-opacity .8s" }}/>
            );
          }))}
          {/* Nodes */}
          {nodes.map(n => (
            <g key={n.id}>
              <circle cx={`${n.x}%`} cy={n.y} r={n.active ? 6 : 4}
                fill={n.active ? C.orange : C.border}
                style={{ transition:"all .8s",filter:n.active?`drop-shadow(0 0 6px ${C.orange})`:"none" }}/>
              {n.active && (
                <circle cx={`${n.x}%`} cy={n.y} r="10" fill="none"
                  stroke={C.orange} strokeWidth="1" strokeOpacity=".3"
                  style={{ animation:"pulse 2s infinite" }}/>
              )}
            </g>
          ))}
        </svg>
        {/* Pulse line */}
        <div style={{ position:"absolute",bottom:0,left:0,right:0,height:2,
          background:`linear-gradient(90deg,transparent,${C.orange},transparent)`,
          animation:"shimmerGold 2s linear infinite",opacity:.5 }}/>
        <div style={{ position:"absolute",bottom:6,right:10,fontSize:9,
          color:`${C.orange}66`,fontFamily:"'Orbitron',monospace",letterSpacing:".1em" }}>
          {nodes.filter(n=>n.active).length}/6 NODES ACTIVE
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background:C.bgDeep,borderRadius:8,padding:"10px 12px",
            border:`1px solid ${s.color}18` }}>
            <div style={{ fontSize:8,letterSpacing:".15em",color:C.muted,marginBottom:4 }}>{s.label}</div>
            <div style={{ fontSize:13,fontWeight:900,fontFamily:"'Orbitron',monospace",color:s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Mainnet countdown */}
      <div style={{ marginTop:12,padding:"10px 14px",borderRadius:8,
        background:`linear-gradient(90deg,${C.orange}0a,${C.amber}0a)`,
        border:`1px solid ${C.orange}33`,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <span style={{ fontSize:16 }}>🚀</span>
          <div>
            <div style={{ fontSize:10,fontWeight:700,color:C.orange,fontFamily:"'Orbitron',monospace" }}>MAINNET LAUNCH</div>
            <div style={{ fontSize:9,color:C.muted,marginTop:2 }}>March 17, 2026</div>
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:9,color:C.muted }}>STATUS</div>
          <div style={{ fontSize:11,fontWeight:700,color:C.amber,fontFamily:"'Orbitron',monospace" }}>SOON™</div>
        </div>
      </div>
    </div>
  );
}

function TopStakers({ userStaked, userScore, userTier, walletConnected }) {
  const [stakers, setStakers] = useState(BASE_STAKERS);
  const [sortBy, setSortBy] = useState("staked");
  useEffect(()=>{
    const iv = setInterval(()=>{
      setStakers(prev=>prev.map(s=>{
        const newStaked = Math.max(0.001, s.staked + (Math.random()>.5?1:-1) * 0.000001 * Math.random());
        const delta = newStaked - s.staked;
        return {
          ...s,
          staked: parseFloat(newStaked.toFixed(8)),
          score: scoreFromBTC(newStaked, s.mult),
          change: parseFloat((s.change + delta).toFixed(8)),
          tier: getTier(scoreFromBTC(newStaked, s.mult)),
        };
      }));
    },3000);
    return ()=>clearInterval(iv);
  },[]);
  const sorted = [...stakers].sort((a,b)=>sortBy==="staked"?b.staked-a.staked:b.score-a.score);
  const userRank = sorted.filter(s=>s.staked>userStaked).length+1;
  const rankIcon = i => i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}`;
  return (
    <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.border}`,
      borderRadius:16,padding:24,flex:1 }}>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:16 }}>🏆</span>
          <span style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".05em" }}>TOP STAKERS</span>
        </div>
        <div style={{ display:"flex",gap:4,background:C.bgDeep,borderRadius:8,padding:4,
          border:`1px solid ${C.border}` }}>
          {[{key:"staked",label:"BTC"},{key:"score",label:"SCORE"}].map(opt=>(
            <button key={opt.key} onClick={()=>setSortBy(opt.key)} style={{
              padding:"5px 12px",border:"none",borderRadius:6,cursor:"pointer",
              fontFamily:"'Orbitron',monospace",fontSize:9,fontWeight:900,letterSpacing:".12em",
              transition:"all .2s",
              background: sortBy===opt.key ? `linear-gradient(135deg,#e8820a,${C.orange})` : "transparent",
              color: sortBy===opt.key ? "#000" : C.muted,
              boxShadow: sortBy===opt.key ? `0 2px 12px ${C.orangeGlow}` : "none",
            }}>{opt.label}</button>
          ))}
        </div>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"24px 1fr 70px 50px",gap:4,
        padding:"0 4px 8px",borderBottom:`1px solid ${C.faint}`,marginBottom:8 }}>
        {["#","STAKER","STAKED","SCORE"].map(h=>(
          <div key={h} style={{ fontSize:9,letterSpacing:".15em",color:C.muted }}>{h}</div>
        ))}
      </div>
      <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
        {sorted.map((s,i)=>(
          <div key={s.addr} style={{ display:"grid",gridTemplateColumns:"24px 1fr 70px 50px",gap:4,
            padding:"9px 4px",borderRadius:8,alignItems:"center",background:C.bgDeep,
            border:`1px solid ${C.faint}` }}>
            <div style={{ fontSize:i<3?13:10,fontFamily:"'Orbitron',monospace",textAlign:"center",fontWeight:900,
              color:i===0?"#ffd700":i===1?"#c8bfa8":i===2?"#cd7f32":C.muted }}>{rankIcon(i)}</div>
            <div style={{ display:"flex",alignItems:"center",gap:6,minWidth:0 }}>
              <div style={{ width:6,height:6,borderRadius:"50%",flexShrink:0,
                background:s.tier.color,boxShadow:`0 0 6px ${s.tier.glow}` }}/>
              <span style={{ fontSize:10,color:"#aa9977",fontFamily:"'Space Mono',monospace",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0 }}>{s.addr}</span>
            </div>
            <div style={{ textAlign:"right",minWidth:0 }}>
              <div style={{ fontSize:10,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                {s.staked >= 1 ? s.staked.toFixed(3) : s.staked.toFixed(5)}
              </div>
              <div style={{ fontSize:9,color:s.change>0?C.green:C.red }}>
                {s.change>0?"+":""}{s.change >= 0.0001 ? s.change.toFixed(4) : s.change.toFixed(6)}
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <span style={{ fontSize:10,fontWeight:700,fontFamily:"'Orbitron',monospace",color:s.tier.color }}>{s.score}</span>
            </div>
          </div>
        ))}
        {/* YOU row — only when wallet connected */}
        {walletConnected && (
          <div style={{ display:"grid",gridTemplateColumns:"24px 1fr 70px 50px",gap:4,padding:"10px 4px",
            borderRadius:8,alignItems:"center",background:`${C.orange}0d`,
            border:`1px dashed ${C.orange}44`,marginTop:4 }}>
            <div style={{ fontSize:10,fontFamily:"'Orbitron',monospace",color:C.orange,textAlign:"center",fontWeight:900 }}>
              #{userRank}
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:6,minWidth:0 }}>
              <div style={{ width:6,height:6,borderRadius:"50%",background:userTier.color,
                boxShadow:`0 0 6px ${userTier.glow}`,flexShrink:0 }}/>
              <span style={{ fontSize:10,color:C.orange,fontFamily:"'Space Mono',monospace" }}>YOU</span>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:10,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.orange }}>
                {userStaked >= 1 ? userStaked.toFixed(3) : userStaked.toFixed(5)}
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <span style={{ fontSize:10,fontWeight:700,fontFamily:"'Orbitron',monospace",color:userTier.color }}>{userScore}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── DAO Data ───────────────────────────────────────────────────────────────────
const INIT_PROPOSALS = [
  { id:"OIP-007", title:"Increase auto-compound treasury fee from 0.5% to 0.75%", description:"As TVL grows, a slightly higher treasury fee funds protocol development, security audits, and the signal data oracle. The 0.25% increase affects compounders only — manual claimers are unaffected.", status:"active", votesFor:142800, votesAgainst:61200, abstain:12000, quorum:200000, endsBlock:847800, category:"FEES" },
  { id:"OIP-006", title:"Deploy OPNET staking to Bitcoin Testnet v2 (Signet fork)", description:"Expand staking contract deployment to the new OPNet Signet testnet for developer testing and community QA before any mainnet upgrades.", status:"active", votesFor:198400, votesAgainst:22100, abstain:5500, quorum:200000, endsBlock:847650, category:"PROTOCOL" },
  { id:"OIP-005", title:"Add RUNE/BTC signal pair to the live feed", description:"Community demand for Runes-based trading signals is high. This proposal adds RUNE/BTC as a tracked pair in the DeFi Signal feed, increasing signal coverage.", status:"passed", votesFor:231000, votesAgainst:18000, abstain:7000, quorum:200000, endsBlock:845200, category:"SIGNALS" },
  { id:"OIP-004", title:"Allocate 50,000 OPNET from treasury to bug bounty program", description:"Establish a formal bug bounty program funded from protocol treasury reserves. Critical vulnerabilities would earn up to 20,000 OPNET.", status:"passed", votesFor:278000, votesAgainst:9400, abstain:3100, quorum:200000, endsBlock:843100, category:"TREASURY" },
  { id:"OIP-003", title:"Reduce Diamond tier minimum score from 900 to 850", description:"Lower the Diamond threshold to make DAO participation more accessible while still requiring substantial commitment.", status:"rejected", votesFor:88000, votesAgainst:174000, abstain:21000, quorum:200000, endsBlock:841500, category:"GOVERNANCE" },
];

const TREASURY_ITEMS = [
  { label:"Total Reserves", value:"2,840,000", unit:"OPNET", accent:"#ffcc44", icon:"🏦" },
  { label:"BTC Holdings",   value:"14.72",     unit:"BTC",   accent:C.orange,  icon:"₿"  },
  { label:"Monthly Inflow", value:"+128,400",  unit:"OPNET", accent:C.green,   icon:"↑"  },
  { label:"Allocated",      value:"50,000",    unit:"OPNET", accent:C.amber,   icon:"📋" },
];

// ── DAO Page ───────────────────────────────────────────────────────────────────
function DAOPage({ onBack, wallet, connecting, error, onConnect, onDisconnect, score, blockHeight }) {
  const tier = getTier(score);
  const isDiamond = tier.name==="DIAMOND";
  const [proposals, setProposals] = useState(INIT_PROPOSALS);
  const [filter, setFilter] = useState("all");
  const [votingId, setVotingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [form, setForm] = useState({ title:"", description:"", category:"PROTOCOL" });

  const showToast = (msg, color=C.green) => { setToast({msg,color}); setTimeout(()=>setToast(null),3500); };

  const castVote = (proposalId, choice) => {
    if (!isDiamond) return;
    setProposals(prev=>prev.map(p=>{
      if (p.id!==proposalId||p.status!=="active") return p;
      const w = Math.floor(score*10);
      return { ...p,
        votesFor:     choice==="for"     ? p.votesFor+w     : p.votesFor,
        votesAgainst: choice==="against" ? p.votesAgainst+w : p.votesAgainst,
        abstain:      choice==="abstain" ? p.abstain+w      : p.abstain,
        voted: choice,
      };
    }));
    setVotingId(null);
    showToast(`Vote cast: ${choice.toUpperCase()} on ${proposalId}`);
  };

  const submitProposal = () => {
    if (!form.title.trim()||!form.description.trim()) { showToast("Title and description required",C.red); return; }
    const newId = `OIP-${String(proposals.length+1).padStart(3,"0")}`;
    setProposals(prev=>[{
      id:newId, title:form.title.trim(), description:form.description.trim(),
      status:"active", votesFor:0, votesAgainst:0, abstain:0, quorum:200000,
      endsBlock:(blockHeight||847210)+4320, category:form.category,
    },...prev]);
    setForm({title:"",description:"",category:"PROTOCOL"});
    setShowSubmit(false);
    setFilter("active");
    showToast(`${newId} submitted successfully!`);
  };

  const filtered = filter==="all" ? proposals : proposals.filter(p=>p.status===filter);
  const statusMeta = {
    active:   {color:C.orange, label:"ACTIVE"},
    passed:   {color:C.green,  label:"PASSED"},
    rejected: {color:C.red,    label:"REJECTED"},
  };

  return (
    <div style={{ minHeight:"100vh",background:C.bg,fontFamily:"'Space Mono',monospace",
      backgroundImage:`radial-gradient(ellipse at 50% -5%,#ffcc4411 0%,transparent 50%)` }}>
      <Header page="dao" onNav={d=>d==="back"?onBack():onBack(d)}
        wallet={wallet} connecting={connecting} error={error}
        onConnect={onConnect} onDisconnect={onDisconnect} blockHeight={blockHeight}/>

      {toast && (
        <div style={{ position:"fixed",bottom:32,left:"50%",transform:"translateX(-50%)",
          background:C.bgCard,border:`1px solid ${toast.color}55`,borderRadius:10,
          padding:"12px 24px",color:toast.color,fontSize:13,fontWeight:700,zIndex:200,
          boxShadow:"0 8px 32px #000c",animation:"slideIn .3s ease",
          fontFamily:"'Orbitron',monospace",letterSpacing:".08em" }}>✓ {toast.msg}</div>
      )}

      {!isDiamond ? (
        <div style={{ maxWidth:560,margin:"60px auto 0",padding:"0 32px" }}>
          <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
            border:"1px solid #ffcc4444",borderRadius:20,padding:"48px 40px",textAlign:"center",
            boxShadow:"0 0 60px #33220088" }}>
            <div style={{ fontSize:48,marginBottom:20 }}>💎</div>
            <div style={{ fontSize:20,fontWeight:900,fontFamily:"'Orbitron',monospace",color:"#ffcc44",marginBottom:12 }}>DIAMOND ONLY</div>
            <p style={{ fontSize:13,color:C.muted,lineHeight:1.9,marginBottom:24 }}>
              DAO governance is reserved for <span style={{ color:"#ffcc44",fontWeight:700 }}>Diamond tier</span> holders — stakers with a Signal Score of <span style={{ color:C.white,fontWeight:700 }}>900+</span>.
            </p>
            <div style={{ background:C.bgDeep,border:"1px solid #33220088",borderRadius:10,padding:"14px 20px",marginBottom:24,display:"inline-block" }}>
              <div style={{ fontSize:11,color:C.muted,marginBottom:4 }}>YOUR CURRENT SCORE</div>
              <div style={{ fontSize:28,fontWeight:900,fontFamily:"'Orbitron',monospace",color:tier.color }}>{score}</div>
              <div style={{ fontSize:11,color:C.muted,marginTop:4 }}>Need <span style={{ color:"#ffcc44",fontWeight:700 }}>{Math.max(0,900-score)} more</span> to reach Diamond</div>
            </div>
            <div>
              <button onClick={()=>onBack()} style={{ padding:"12px 32px",border:"none",borderRadius:10,
                background:`linear-gradient(135deg,#e8820a,${C.orange})`,color:"#000",fontSize:13,
                fontWeight:900,fontFamily:"'Orbitron',monospace",cursor:"pointer" }}>⚡ STAKE MORE OPNET</button>
            </div>
          </div>
        </div>
      ) : (<>
        {/* Hero */}
        <div style={{ padding:"40px 32px 24px",maxWidth:1200,margin:"0 auto" }}>
          <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:16 }}>
            <div>
              <div style={{ fontSize:11,letterSpacing:".3em",color:"#ffcc44",marginBottom:10 }}>DIAMOND GOVERNANCE</div>
              <h1 style={{ fontSize:"clamp(28px,4vw,46px)",fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,lineHeight:1.1 }}>OP_NET DAO</h1>
              <div style={{ fontSize:13,color:C.muted,marginTop:8 }}>On-chain governance · Bitcoin L1 · {proposals.filter(p=>p.status==="active").length} active proposals</div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:10,background:C.bgCard,border:"1px solid #ffcc4433",borderRadius:10,padding:"10px 18px" }}>
              <span style={{ fontSize:16 }}>💎</span>
              <div>
                <div style={{ fontSize:10,color:C.muted,letterSpacing:".12em" }}>YOUR VOTING POWER</div>
                <div style={{ fontSize:16,fontWeight:900,fontFamily:"'Orbitron',monospace",color:"#ffcc44" }}>{(score*10).toLocaleString()} OPNET</div>
              </div>
            </div>
          </div>
        </div>

        {/* Treasury */}
        <div style={{ padding:"0 32px 24px",maxWidth:1200,margin:"0 auto" }}>
          <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.border}`,borderRadius:16,padding:24,position:"relative",overflow:"hidden" }}>
            <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,#ffcc44,transparent)" }}/>
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20 }}>
              <span style={{ fontSize:18 }}>🏦</span>
              <span style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".05em" }}>PROTOCOL TREASURY</span>
              <span style={{ marginLeft:"auto",fontSize:10,color:C.muted }}>Block #{blockHeight?.toLocaleString()}</span>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14 }}>
              {TREASURY_ITEMS.map(item=>(
                <div key={item.label} style={{ background:C.bgDeep,border:`1px solid ${item.accent}22`,borderRadius:12,padding:"16px 18px",position:"relative",overflow:"hidden" }}>
                  <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${item.accent},transparent)`,opacity:.7 }}/>
                  <div style={{ fontSize:18,marginBottom:8 }}>{item.icon}</div>
                  <div style={{ fontSize:10,color:C.muted,letterSpacing:".12em",marginBottom:6,textTransform:"uppercase" }}>{item.label}</div>
                  <div style={{ fontSize:20,fontWeight:900,fontFamily:"'Orbitron',monospace",color:item.accent }}>{item.value}</div>
                  <div style={{ fontSize:10,color:C.muted,marginTop:2 }}>{item.unit}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Proposals */}
        <div style={{ padding:"0 32px 24px",maxWidth:1200,margin:"0 auto" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <span style={{ fontSize:16 }}>📋</span>
              <span style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".05em" }}>PROPOSALS</span>
            </div>
            <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
              <div style={{ display:"flex",gap:6 }}>
                {["all","active","passed","rejected"].map(f=>(
                  <button key={f} onClick={()=>setFilter(f)} style={{ padding:"6px 14px",borderRadius:6,
                    background:filter===f?"#1a1000":"transparent",color:filter===f?C.orange:C.muted,
                    fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",cursor:"pointer",
                    border:`1px solid ${filter===f?C.orange+"44":C.faint}` }}>{f}</button>
                ))}
              </div>
              <button onClick={()=>setShowSubmit(true)} style={{ display:"flex",alignItems:"center",gap:8,
                padding:"8px 16px",borderRadius:8,border:"none",
                background:"linear-gradient(135deg,#e8820a,#f7931a)",color:"#000",fontSize:12,
                fontWeight:900,cursor:"pointer",fontFamily:"'Orbitron',monospace",letterSpacing:".08em",
                boxShadow:`0 4px 16px ${C.orangeGlow}` }}>+ NEW PROPOSAL</button>
            </div>
          </div>

          {/* Submit Modal */}
          {showSubmit && (<>
            <div onClick={()=>setShowSubmit(false)} style={{ position:"fixed",inset:0,background:"#000000bb",backdropFilter:"blur(6px)",zIndex:150 }}/>
            <div style={{ position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
              width:"min(560px,90vw)",background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
              border:`1px solid ${C.orange}44`,borderRadius:20,padding:32,zIndex:160,
              boxShadow:`0 0 60px ${C.orangeGlow},0 20px 60px #000c`,animation:"slideIn .2s ease" }}>
              <div style={{ position:"absolute",top:0,left:0,right:0,height:2,
                background:`linear-gradient(90deg,transparent,${C.orange},transparent)`,borderRadius:"20px 20px 0 0" }}/>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24 }}>
                <div>
                  <div style={{ fontSize:11,letterSpacing:".2em",color:C.orange,marginBottom:6 }}>DIAMOND GOVERNANCE</div>
                  <div style={{ fontSize:18,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white }}>Submit Proposal</div>
                </div>
                <button onClick={()=>setShowSubmit(false)} style={{ width:32,height:32,borderRadius:"50%",
                  border:`1px solid ${C.border}`,background:C.bgDeep,color:C.muted,fontSize:18,
                  cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1 }}>×</button>
              </div>
              {/* Category */}
              <div style={{ marginBottom:18 }}>
                <div style={{ fontSize:10,letterSpacing:".15em",color:C.muted,marginBottom:8,textTransform:"uppercase" }}>Category</div>
                <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
                  {Object.entries(CATEGORY_COLORS).map(([cat,col])=>(
                    <button key={cat} onClick={()=>setForm(f=>({...f,category:cat}))} style={{ padding:"5px 12px",borderRadius:6,
                      background:form.category===cat?`${col}22`:"transparent",color:form.category===cat?col:C.muted,
                      fontSize:10,fontWeight:800,cursor:"pointer",letterSpacing:".1em",
                      border:`1px solid ${form.category===cat?col+"44":C.faint}`,transition:"all .15s" }}>{cat}</button>
                  ))}
                </div>
              </div>
              {/* Title */}
              <div style={{ marginBottom:16 }}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                  <span style={{ fontSize:10,letterSpacing:".15em",color:C.muted,textTransform:"uppercase" }}>Title</span>
                  <span style={{ fontSize:10,color:form.title.length>100?C.red:C.muted }}>{form.title.length}/120</span>
                </div>
                <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value.slice(0,120)}))}
                  placeholder="e.g. Increase staking rewards for Silver tier"
                  style={{ width:"100%",padding:"12px 16px",background:C.bgDeep,
                    border:`1px solid ${form.title?C.orange+"44":C.border}`,borderRadius:10,
                    color:C.white,fontSize:13,fontFamily:"'Space Mono',monospace",outline:"none",boxSizing:"border-box" }}/>
              </div>
              {/* Description */}
              <div style={{ marginBottom:20 }}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                  <span style={{ fontSize:10,letterSpacing:".15em",color:C.muted,textTransform:"uppercase" }}>Description</span>
                  <span style={{ fontSize:10,color:form.description.length>900?C.red:C.muted }}>{form.description.length}/1000</span>
                </div>
                <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value.slice(0,1000)}))}
                  placeholder="Explain what changes, why it benefits the protocol, and any relevant context..."
                  rows={5} style={{ width:"100%",padding:"12px 16px",resize:"vertical",background:C.bgDeep,
                    border:`1px solid ${form.description?C.orange+"44":C.border}`,borderRadius:10,
                    color:C.white,fontSize:13,fontFamily:"'Space Mono',monospace",outline:"none",
                    lineHeight:1.7,boxSizing:"border-box" }}/>
              </div>
              {/* Info */}
              <div style={{ display:"flex",gap:12,marginBottom:24 }}>
                {[{label:"Voting period",value:"~30 days"},{label:"Quorum needed",value:"200K OPNET"},{label:"Your power",value:`${(score*10).toLocaleString()} OPNET`}].map(item=>(
                  <div key={item.label} style={{ flex:1,background:C.bgDeep,border:`1px solid ${C.faint}`,borderRadius:8,padding:"10px 12px" }}>
                    <div style={{ fontSize:9,color:C.muted,letterSpacing:".1em",marginBottom:4,textTransform:"uppercase" }}>{item.label}</div>
                    <div style={{ fontSize:11,color:C.amber,fontWeight:700,fontFamily:"'Orbitron',monospace" }}>{item.value}</div>
                  </div>
                ))}
              </div>
              {/* Actions */}
              <div style={{ display:"flex",gap:10 }}>
                <button onClick={()=>setShowSubmit(false)} style={{ flex:1,padding:"12px",
                  border:`1px solid ${C.border}`,borderRadius:10,background:"transparent",
                  color:C.muted,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Space Mono',monospace" }}>Cancel</button>
                <button onClick={submitProposal} style={{ flex:2,padding:"12px",border:"none",borderRadius:10,
                  background:form.title&&form.description?"linear-gradient(135deg,#e8820a,#f7931a)":C.faint,
                  color:form.title&&form.description?"#000":"#444",fontSize:13,fontWeight:900,
                  cursor:form.title&&form.description?"pointer":"not-allowed",fontFamily:"'Orbitron',monospace",
                  letterSpacing:".08em",boxShadow:form.title&&form.description?`0 4px 20px ${C.orangeGlow}`:"none",
                  transition:"all .2s" }}>⚡ SUBMIT ON-CHAIN</button>
              </div>
            </div>
          </>)}

          {/* Proposal list */}
          <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
            {filtered.map(p=>{
              const total = p.votesFor+p.votesAgainst+p.abstain;
              const forPct = total?Math.round((p.votesFor/total)*100):0;
              const againstPct = total?Math.round((p.votesAgainst/total)*100):0;
              const abstainPct = 100-forPct-againstPct;
              const quorumPct = Math.min(100,Math.round((total/p.quorum)*100));
              const sm = statusMeta[p.status];
              const catColor = CATEGORY_COLORS[p.category]||C.orange;
              const blocksLeft = Math.max(0,(p.endsBlock||0)-(blockHeight||0));
              const isVoting = votingId===p.id;
              return (
                <div key={p.id} style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
                  border:`1px solid ${p.status==="active"?C.orange+"33":C.border}`,
                  borderRadius:14,padding:22,position:"relative",overflow:"hidden",animation:"fadeUp .4s ease" }}>
                  <div style={{ position:"absolute",top:0,left:0,bottom:0,width:3,
                    background:`linear-gradient(180deg,${sm.color},transparent)`,borderRadius:"14px 0 0 14px" }}/>
                  <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:12,paddingLeft:10 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap" }}>
                        <span style={{ fontSize:10,fontFamily:"'Orbitron',monospace",color:C.muted,letterSpacing:".1em" }}>{p.id}</span>
                        <span style={{ padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:800,
                          background:`${catColor}18`,color:catColor,border:`1px solid ${catColor}33`,letterSpacing:".1em" }}>{p.category}</span>
                        {p.voted && <span style={{ padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:800,
                          background:`${C.green}18`,color:C.green,border:`1px solid ${C.green}33`,letterSpacing:".1em" }}>✓ YOU VOTED {p.voted.toUpperCase()}</span>}
                      </div>
                      <div style={{ fontSize:14,fontWeight:700,color:C.white,lineHeight:1.4 }}>{p.title}</div>
                      <div style={{ fontSize:11,color:C.muted,lineHeight:1.7,marginTop:8 }}>{p.description}</div>
                    </div>
                    <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:6,
                        background:`${sm.color}18`,border:`1px solid ${sm.color}33` }}>
                        <span style={{ width:6,height:6,borderRadius:"50%",background:sm.color,display:"inline-block",
                          animation:p.status==="active"?"pulse 1.5s infinite":"none" }}/>
                        <span style={{ fontSize:10,fontWeight:800,color:sm.color,fontFamily:"'Orbitron',monospace",letterSpacing:".1em" }}>{sm.label}</span>
                      </div>
                      {p.status==="active" && <span style={{ fontSize:10,color:C.muted }}>{blocksLeft.toLocaleString()} blocks left</span>}
                    </div>
                  </div>
                  {/* Vote bars */}
                  <div style={{ paddingLeft:10,marginBottom:14 }}>
                    <div style={{ display:"flex",gap:2,height:10,borderRadius:5,overflow:"hidden",marginBottom:8 }}>
                      <div style={{ width:`${forPct}%`,background:C.green,transition:"width .8s ease" }}/>
                      <div style={{ width:`${againstPct}%`,background:C.red,transition:"width .8s ease" }}/>
                      <div style={{ width:`${abstainPct}%`,background:C.faint }}/>
                    </div>
                    <div style={{ display:"flex",gap:16,fontSize:11 }}>
                      <span style={{ color:C.green }}>FOR {forPct}% <span style={{ color:C.muted,fontSize:10 }}>({(p.votesFor/1000).toFixed(0)}K)</span></span>
                      <span style={{ color:C.red }}>AGAINST {againstPct}% <span style={{ color:C.muted,fontSize:10 }}>({(p.votesAgainst/1000).toFixed(0)}K)</span></span>
                      <span style={{ color:C.muted }}>ABSTAIN {abstainPct}%</span>
                    </div>
                  </div>
                  {/* Quorum */}
                  <div style={{ paddingLeft:10,marginBottom:p.status==="active"?14:0 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}>
                      <span style={{ fontSize:10,color:C.muted,letterSpacing:".1em" }}>QUORUM</span>
                      <span style={{ fontSize:10,color:quorumPct>=100?C.green:C.amber }}>{quorumPct}% of {(p.quorum/1000).toFixed(0)}K required</span>
                    </div>
                    <div style={{ height:4,borderRadius:2,background:C.faint,overflow:"hidden" }}>
                      <div style={{ height:"100%",borderRadius:2,width:`${quorumPct}%`,transition:"width .8s ease",
                        background:quorumPct>=100?`linear-gradient(90deg,${C.green},#00ff88)`:`linear-gradient(90deg,${C.amber},${C.orange})` }}/>
                    </div>
                  </div>
                  {/* Vote buttons */}
                  {p.status==="active" && !p.voted && (
                    <div style={{ paddingLeft:10,marginTop:14 }}>
                      {!isVoting ? (
                        <button onClick={()=>setVotingId(p.id)} style={{ padding:"9px 20px",
                          border:"1px solid #ffcc4455",borderRadius:8,background:"#ffcc4411",
                          color:"#ffcc44",fontSize:12,fontWeight:700,cursor:"pointer",
                          fontFamily:"'Orbitron',monospace",letterSpacing:".08em" }}>💎 CAST VOTE</button>
                      ) : (
                        <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                          {[{c:"for",label:"✓ FOR",col:C.green},{c:"against",label:"✗ AGAINST",col:C.red},{c:"abstain",label:"— ABSTAIN",col:C.muted}].map(opt=>(
                            <button key={opt.c} onClick={()=>castVote(p.id,opt.c)} style={{ padding:"9px 20px",
                              border:`1px solid ${opt.col}55`,borderRadius:8,background:`${opt.col}18`,
                              color:opt.col,fontSize:12,fontWeight:700,cursor:"pointer",
                              fontFamily:"'Orbitron',monospace",letterSpacing:".08em" }}>{opt.label}</button>
                          ))}
                          <button onClick={()=>setVotingId(null)} style={{ padding:"9px 16px",
                            border:`1px solid ${C.faint}`,borderRadius:8,background:"transparent",
                            color:C.muted,fontSize:12,cursor:"pointer" }}>Cancel</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Leaderboard */}
        <div style={{ padding:"0 32px 40px",maxWidth:1200,margin:"0 auto" }}>
          <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.border}`,borderRadius:16,padding:24 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20 }}>
              <span style={{ fontSize:18 }}>🏆</span>
              <span style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".05em" }}>VOTER LEADERBOARD</span>
              <span style={{ marginLeft:"auto",fontSize:10,color:C.muted }}>Diamond holders · ranked by signal score</span>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"40px 1fr 80px 70px 70px 60px",gap:12,padding:"6px 12px",marginBottom:8 }}>
              {["#","ADDRESS","SCORE","VOTES","POWER","TIER"].map(h=>(
                <div key={h} style={{ fontSize:9,letterSpacing:".15em",color:C.muted,textTransform:"uppercase" }}>{h}</div>
              ))}
            </div>
            {[
              {rank:1,addr:"op1qf8a...x7d2",score:998,votes:12,power:"4.2%"},
              {rank:2,addr:"op1q3c1...k9p1",score:994,votes:9, power:"3.8%"},
              {rank:3,addr:"op1qb72...m4r5",score:991,votes:14,power:"3.5%",isMe:true},
              {rank:4,addr:"op1q0d9...z2q8",score:987,votes:7, power:"3.1%"},
              {rank:5,addr:"op1q5e3...w1v6",score:983,votes:11,power:"2.9%"},
            ].map((row,i)=>(
              <div key={row.rank} style={{ display:"grid",gridTemplateColumns:"40px 1fr 80px 70px 70px 60px",gap:12,
                padding:"10px 12px",borderRadius:10,marginBottom:6,
                background:row.isMe?"#ffcc4410":C.bgDeep,border:`1px solid ${row.isMe?"#ffcc4433":C.faint}`,alignItems:"center" }}>
                <div style={{ fontFamily:"'Orbitron',monospace",fontSize:13,fontWeight:900,
                  color:i===0?"#ffd700":i===1?"#c8bfa8":i===2?"#cd7f32":C.muted }}>
                  {i===0?"🥇":i===1?"🥈":i===2?"🥉":row.rank}
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <div style={{ width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#33220088,#1a1000)",
                    border:"1px solid #ffcc4433",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11 }}>💎</div>
                  <span style={{ fontSize:12,color:row.isMe?C.white:"#aa9977",fontFamily:"'Space Mono',monospace" }}>
                    {row.addr}{row.isMe && <span style={{ marginLeft:8,fontSize:9,color:"#ffcc44",fontFamily:"'Orbitron',monospace" }}>YOU</span>}
                  </span>
                </div>
                <div style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:"#ffcc44" }}>{row.score}</div>
                <div style={{ fontSize:12,color:C.muted }}>{row.votes} cast</div>
                <div style={{ fontSize:12,color:C.orange,fontWeight:700 }}>{row.power}</div>
                <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                  <span style={{ width:6,height:6,borderRadius:"50%",background:"#ffcc44",boxShadow:"0 0 6px #ffcc44",display:"inline-block" }}/>
                  <span style={{ fontSize:9,color:"#ffcc44",fontFamily:"'Orbitron',monospace" }}>DIAMOND</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>)}

      <div style={{ margin:"0 32px 24px",padding:"14px 24px",background:C.bgDeep,border:`1px solid ${C.border}`,
        borderRadius:10,display:"flex",gap:32,justifyContent:"center",flexWrap:"wrap" }}>
        {[{label:"GOVERNANCE",value:"DAO"},{label:"ACCESS",value:"Diamond"},{label:"QUORUM",value:"200K OPNET"},
          {label:"PROPOSALS",value:`${proposals.length} total`},{label:"TREASURY",value:"2.84M OPNET"},{label:"CHAIN",value:"Bitcoin L1"}
        ].map(item=>(
          <div key={item.label} style={{ textAlign:"center" }}>
            <div style={{ fontSize:9,letterSpacing:".2em",color:C.muted,marginBottom:4 }}>{item.label}</div>
            <div style={{ fontSize:12,fontFamily:"'Orbitron',monospace",color:`${C.orange}99` }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── How It Works Page ──────────────────────────────────────────────────────────
function HowItWorksPage({ onBack, wallet, connecting, error, onConnect, onDisconnect }) {
  const [activeTab, setActiveTab] = useState("staking");

  const stakingSteps = [
    { n:"01", title:"Install OPWallet",   desc:"Download the OPWallet browser extension from opnet.org. It's a Bitcoin-native wallet built for OPNet smart contracts — no seed phrase bridging, no custodians.", icon:"🔗", color:C.orange },
    { n:"02", title:"Connect on Testnet", desc:"Click Connect Wallet and approve the connection. This dashboard runs on OPNet Testnet — no real BTC required. Get testnet BTC from the faucet at testnet.opnet.org.", icon:"⚡", color:"#60a5fa" },
    { n:"03", title:"Stake BTC",          desc:"Enter an amount in the Stake tab (min 0.00001 BTC) and confirm the OPWallet popup. Your BTC is locked in the audited staking contract on Bitcoin L1.", icon:"🔒", color:"#00c47a" },
    { n:"04", title:"Earn Signal Score",  desc:"Your Signal Score (0–1000) grows with stake amount × time multiplier. The longer you stake, the higher your multiplier (1× → 2× → 3× → 5×).", icon:"📈", color:"#ffcc44" },
    { n:"05", title:"Unlock Tiers",       desc:"Bronze → Silver → Gold → Diamond. Higher tiers unlock reduced fees (down to 0.3%), APY boosts (+2%), and DAO governance voting rights.", icon:"💎", color:"#a855f7" },
    { n:"06", title:"Compound & Claim",   desc:"Auto-compound reinvests rewards every epoch (144 blocks) with a 0.5% fee to treasury. Or manually compound anytime from the dashboard.", icon:"♻️", color:C.amber },
  ];

  const swapSteps = [
    { n:"01", title:"Go to Swap Tab",      desc:"Click the Swap tab in the navigation bar. The swap interface connects to MotoSwap DEX protocol running on OPNet Testnet.", icon:"⇄", color:C.orange },
    { n:"02", title:"Select Token Pair",   desc:"Choose your sell token (BTC, MOTO, or PILL) and your buy token. Click the token button to open the selector dropdown.", icon:"🔄", color:"#d946ef" },
    { n:"03", title:"Enter Amount",        desc:"Type an amount or use the 25% / 50% / 75% / MAX quick buttons to fill from your wallet balance. The estimated receive amount updates in real time.", icon:"💱", color:"#00c47a" },
    { n:"04", title:"Set Slippage",        desc:"Click the ⚙ slippage button to set your tolerance (0.1%–2% recommended). Higher slippage risks a worse rate; lower slippage may cause the swap to fail.", icon:"⚙", color:"#60a5fa" },
    { n:"05", title:"Review & Confirm",    desc:"Click SWAP to open the confirmation modal. Review the rate, minimum received, and fee breakdown. Click CONFIRM & SIGN to trigger OPWallet signing.", icon:"✅", color:"#ffcc44" },
    { n:"06", title:"Track Transaction",   desc:"After signing, your swap appears in the Transaction History below the swap card. Watch it move from PENDING → CONFIRMED on-chain.", icon:"📋", color:"#ff6b35" },
  ];

  const steps = activeTab === "staking" ? stakingSteps : swapSteps;

  return (
    <div style={{ minHeight:"100vh",background:C.bg,fontFamily:"'Space Mono',monospace",
      backgroundImage:`radial-gradient(ellipse at 50% 0%,${C.orangeDim} 0%,transparent 50%)` }}>
      <Header page="how-it-works" onNav={d=>d==="back"||d==="dashboard"?onBack():onBack(d)}
        wallet={wallet} connecting={connecting} error={error}
        onConnect={onConnect} onDisconnect={onDisconnect} blockHeight={null}/>
      <div style={{ maxWidth:860,margin:"0 auto",padding:"60px 32px" }}>

        {/* Hero */}
        <div style={{ textAlign:"center",marginBottom:48 }}>
          <div style={{ fontSize:11,letterSpacing:".3em",color:C.orange,marginBottom:12,fontFamily:"'Orbitron',monospace" }}>GETTING STARTED</div>
          <h1 style={{ fontSize:"clamp(28px,5vw,52px)",fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,lineHeight:1.1,marginBottom:16 }}>How It Works</h1>
          <p style={{ fontSize:13,color:C.muted,lineHeight:1.9,maxWidth:520,margin:"0 auto" }}>
            OPNet Signal is running on <span style={{ color:C.orange,fontWeight:700 }}>OPNet Testnet</span>. Explore staking and token swaps with no real BTC at risk.
          </p>
          {/* Testnet banner */}
          <div style={{ display:"inline-flex",alignItems:"center",gap:10,marginTop:20,
            padding:"8px 20px",borderRadius:20,
            background:"#60a5fa18",border:"1px solid #60a5fa44" }}>
            <span style={{ width:8,height:8,borderRadius:"50%",background:"#60a5fa",
              boxShadow:"0 0 8px #60a5fa",display:"inline-block",animation:"pulse 1.5s infinite" }}/>
            <span style={{ fontSize:10,color:"#60a5fa",fontWeight:700,fontFamily:"'Orbitron',monospace",letterSpacing:".12em" }}>
              TESTNET — testnet.opnet.org
            </span>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display:"flex",gap:8,marginBottom:36,padding:6,
          background:C.bgCard,borderRadius:14,border:`1px solid ${C.border}` }}>
          {[
            { id:"staking", label:"⚡ Staking & Score", color:C.orange },
            { id:"swap",    label:"⇄ Token Swap",       color:"#d946ef" },
          ].map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
              flex:1,padding:"11px",borderRadius:10,border:"none",cursor:"pointer",
              fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:11,letterSpacing:".08em",
              transition:"all .2s",
              background:activeTab===t.id?`linear-gradient(135deg,${t.color}33,${t.color}18)`:
              "transparent",
              color:activeTab===t.id?t.color:C.muted,
              boxShadow:activeTab===t.id?`0 0 20px ${t.color}22`:"none",
              border:activeTab===t.id?`1px solid ${t.color}44`:"1px solid transparent",
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Steps */}
        <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
          {steps.map((s,i)=>(
            <div key={s.n} style={{ display:"flex",gap:20,padding:24,
              background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
              border:`1px solid ${C.border}`,borderRadius:16,
              animation:`fadeUp .4s ease ${i*.07}s both`,
              transition:"border-color .2s" }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=`${s.color}55`}
              onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
              <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:8,flexShrink:0 }}>
                <div style={{ width:44,height:44,borderRadius:12,
                  background:`${s.color}18`,border:`1px solid ${s.color}44`,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>
                  {s.icon}
                </div>
                <div style={{ fontSize:9,color:s.color,fontFamily:"'Orbitron',monospace",
                  fontWeight:900,letterSpacing:".1em" }}>STEP {s.n}</div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15,fontWeight:700,fontFamily:"'Orbitron',monospace",
                  color:C.white,marginBottom:8,letterSpacing:".04em" }}>{s.title}</div>
                <div style={{ fontSize:12,color:C.muted,lineHeight:1.9 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Token info section */}
        <div style={{ marginTop:40,padding:24,background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
          border:`1px solid ${C.border}`,borderRadius:16 }}>
          <div style={{ fontSize:10,color:C.orange,letterSpacing:".2em",fontFamily:"'Orbitron',monospace",marginBottom:16 }}>SUPPORTED TOKENS ON TESTNET</div>
          <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
            {[
              { img:"/btc-icon.webp",  symbol:"BTC",  name:"Bitcoin",        color:"#f7931a", desc:"Native Bitcoin — stake to earn rewards" },
              { img:"/icon-moto.jpg",  symbol:"MOTO", name:"MotoSwap Token", color:"#d946ef", desc:"DEX governance token — swap on MotoSwap" },
              { img:"/icon-pill.png",  symbol:"PILL", name:"Pill Token",     color:"#ff6b35", desc:"Protocol utility token — available on testnet" },
            ].map(t=>(
              <div key={t.symbol} style={{ display:"flex",alignItems:"center",gap:12,flex:1,minWidth:200,
                padding:"12px 16px",borderRadius:12,background:C.bgDeep,border:`1px solid ${t.color}33` }}>
                <img src={t.img} alt={t.symbol} style={{ width:36,height:36,borderRadius:"50%",objectFit:"cover",border:`2px solid ${t.color}44`,flexShrink:0 }}/>
                <div>
                  <div style={{ fontSize:12,fontWeight:900,fontFamily:"'Orbitron',monospace",color:t.color }}>{t.symbol}</div>
                  <div style={{ fontSize:10,color:C.muted,marginTop:2 }}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA buttons */}
        <div style={{ display:"flex",gap:12,justifyContent:"center",marginTop:48,flexWrap:"wrap" }}>
          <button onClick={()=>onBack()} style={{ padding:"14px 36px",border:"none",borderRadius:12,
            background:`linear-gradient(135deg,#e8820a,${C.orange})`,color:"#000",fontSize:13,
            fontWeight:900,fontFamily:"'Orbitron',monospace",cursor:"pointer",letterSpacing:".1em",
            boxShadow:`0 6px 30px ${C.orangeGlow}` }}>⚡ START STAKING</button>
          <button onClick={()=>onBack("swap")} style={{ padding:"14px 36px",borderRadius:12,
            border:`1px solid #d946ef55`,background:"#d946ef18",color:"#d946ef",fontSize:13,
            fontWeight:900,fontFamily:"'Orbitron',monospace",cursor:"pointer",letterSpacing:".1em" }}>⇄ TRY SWAP</button>
        </div>
      </div>
    </div>
  );
}

// ── Announcements Page ─────────────────────────────────────────────────────────
const ANNOUNCEMENTS = [
  {
    id: 1,
    type: "MAINNET",
    badge: "🚀",
    title: "OPNet Mainnet Launches March 17, 2026",
    date: "Mar 1, 2026",
    pinned: true,
    content: "OPNet mainnet goes live March 17, 2026. The first true smart contract layer on Bitcoin L1 opens staking, DAO governance, token swaps, and on-chain execution to all BTC holders. No bridges. No sidechains. Pure Bitcoin. The dashboard currently runs on Testnet — switch to mainnet on launch day.",
    tags: ["Mainnet", "Launch", "Bitcoin"],
  },
  {
    id: 2,
    type: "SWAP",
    badge: "⇄",
    title: "Token Swap Now Live on Testnet",
    date: "Mar 4, 2026",
    pinned: true,
    content: "The OPNet Signal dashboard now features a full token swap interface powered by MotoSwap DEX protocol. Swap between BTC, MOTO, and PILL directly on OPNet Testnet. Features include real-time rate calculation, slippage control, 25/50/75/MAX quick-fill buttons, swap confirmation modal, and a full transaction history panel. Connect OPWallet to try it now.",
    tags: ["Swap", "MotoSwap", "DEX", "Testnet"],
  },
  {
    id: 3,
    type: "PARTNERSHIP",
    badge: "🤝",
    title: "OPNet x MotoSwap Strategic Partnership",
    date: "Mar 2, 2026",
    pinned: true,
    content: "OPNet and MotoSwap have announced a strategic partnership to bring native DeFi to Bitcoin L1. MotoSwap's DEX protocol will be the first AMM deployed on OPNet, giving stakers direct access to MOTO and PILL token liquidity. Joint liquidity incentives and staking rewards will be announced before mainnet launch.",
    tags: ["Partnership", "MotoSwap", "DeFi"],
  },
  {
    id: 4,
    type: "NFT",
    badge: "🖼️",
    title: "OPNet Genesis NFT Collection — Coming Soon",
    date: "Mar 3, 2026",
    pinned: false,
    content: "The OPNet Genesis NFT collection is dropping soon. Only 999 quantum-resistant collectibles will ever exist, minted as OP-721 tokens directly on Bitcoin L1 through OPNet smart contracts. Genesis NFT holders receive exclusive protocol benefits including fee waivers, boosted APY, and priority DAO voting weight. Whitelist registration opens this week.",
    tags: ["NFT", "OP-721", "Genesis"],
  },
  {
    id: 5,
    type: "STAKING",
    badge: "⚡",
    title: "Staking APY Set at 34.7% for Genesis Epoch",
    date: "Feb 28, 2026",
    pinned: false,
    content: "The OPNet protocol treasury has voted to set the genesis staking APY at 34.7% for the first epoch on Testnet and Mainnet. Early stakers benefit from the highest reward rate. Signal Score tiers unlock additional APY boosts on top of the base rate. APY is adjustable by DAO governance vote in subsequent epochs.",
    tags: ["Staking", "APY", "Rewards"],
  },
  {
    id: 6,
    type: "SECURITY",
    badge: "🔒",
    title: "Smart Contract Audit Completed by Verichain",
    date: "Feb 20, 2026",
    pinned: false,
    content: "The OPNet staking and swap contracts have passed a comprehensive security audit by Verichain. Zero critical vulnerabilities were found. The full audit report is publicly available at docs.opnet.org. All funds are protected by audited, non-custodial smart contracts — not a single satoshi is held by a third party.",
    tags: ["Security", "Audit", "Verichain"],
  },
  {
    id: 7,
    type: "GOVERNANCE",
    badge: "🗳️",
    title: "DAO Governance Now Live on Testnet",
    date: "Feb 15, 2026",
    pinned: false,
    content: "OPNet DAO governance is active on Testnet. Signal Score holders with Diamond tier (900+) can submit and vote on proposals affecting treasury, swap fees, APY parameters, and protocol upgrades. OIP-007 (compound fee reduction) is currently open for voting. Diamond holders receive 4× voting weight.",
    tags: ["DAO", "Governance", "Testnet"],
  },
  {
    id: 8,
    type: "UPDATE",
    badge: "🔧",
    title: "OPWallet v2.1 — Improved Signing & Swap Support",
    date: "Feb 10, 2026",
    pinned: false,
    content: "OPWallet 2.1 is now available. Key improvements: faster transaction signing, clearer fee breakdowns, native OP-20 token balance display for MOTO and PILL, improved swap transaction support, and full compatibility with the OPNet Testnet RPC. Update your extension before trying the new swap interface.",
    tags: ["OPWallet", "Update", "Swap"],
  },
  {
    id: 9,
    type: "COMMUNITY",
    badge: "🌐",
    title: "OPNet Discord Hits 50,000 Members",
    date: "Feb 5, 2026",
    pinned: false,
    content: "The OPNet community has grown to over 50,000 members on Discord. Thank you to every builder, staker, and Bitcoin believer who joined early. OG member roles and testnet token airdrops are being distributed this week. Join the Discord for real-time contract addresses, testnet faucet links, and swap pair updates.",
    tags: ["Community", "Discord"],
  },
];

const TYPE_COLORS = {
  MAINNET:     { color:"#00c47a", bg:"#00c47a18" },
  SWAP:        { color:"#d946ef", bg:"#d946ef18" },
  PARTNERSHIP: { color:"#00c47a", bg:"#00c47a18" },
  NFT:         { color:"#a855f7", bg:"#a855f718" },
  STAKING:     { color:"#f7931a", bg:"#f7931a18" },
  SECURITY:    { color:"#60a5fa", bg:"#60a5fa18" },
  GOVERNANCE:  { color:"#ffcc44", bg:"#ffcc4418" },
  UPDATE:      { color:"#a855f7", bg:"#a855f718" },
  COMMUNITY:   { color:"#ff9f2e", bg:"#ff9f2e18" },
};

function AnnouncementsPage({ onBack, wallet, connecting, error, onConnect, onDisconnect, blockHeight, btcPrice }) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const filters = ["ALL", "MAINNET", "SWAP", "PARTNERSHIP", "NFT", "STAKING", "SECURITY", "GOVERNANCE", "UPDATE", "COMMUNITY"];
  const filtered = filter === "ALL" ? ANNOUNCEMENTS : ANNOUNCEMENTS.filter(a => a.type === filter);

  return (
    <>
      <Header page="announcements" onNav={onBack} wallet={wallet} connecting={connecting}
        error={error} onConnect={onConnect} onDisconnect={onDisconnect} blockHeight={blockHeight} btcPrice={btcPrice}/>
      <div style={{ maxWidth:1000,margin:"0 auto",padding:"32px 32px 60px" }}>

        {/* Page title */}
        <div style={{ marginBottom:32,position:"relative" }}>
          <div style={{ fontSize:11,letterSpacing:".25em",color:C.orange,marginBottom:8,fontFamily:"'Orbitron',monospace" }}>LATEST UPDATES</div>
          <div style={{ fontSize:32,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,lineHeight:1,marginBottom:12 }}>
            ANNOUNCEMENTS
          </div>
          <div style={{ fontSize:13,color:C.muted,maxWidth:500 }}>
            Official updates, protocol changes, and community news from the OPNet team.
          </div>
          <div style={{ position:"absolute",top:0,right:0,display:"flex",alignItems:"center",gap:6,
            background:C.bgCard,border:`1px solid ${C.green}44`,borderRadius:8,padding:"8px 14px" }}>
            <span style={{ width:6,height:6,borderRadius:"50%",background:C.green,animation:"pulse 1.5s infinite",display:"inline-block" }}/>
            <span style={{ fontSize:10,color:C.green,fontFamily:"'Orbitron',monospace",letterSpacing:".1em" }}>ALL SYSTEMS LIVE</span>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display:"flex",gap:6,marginBottom:24,flexWrap:"wrap" }}>
          {filters.map(f => (
            <button key={f} onClick={()=>setFilter(f)} className="nav-btn" style={{
              padding:"6px 14px",borderRadius:20,border:`1px solid ${filter===f?C.orange:C.border}`,
              background:filter===f?`${C.orange}18`:C.bgCard,
              color:filter===f?C.orange:C.muted,fontSize:10,fontWeight:700,cursor:"pointer",
              fontFamily:"'Orbitron',monospace",letterSpacing:".1em" }}>{f}</button>
          ))}
        </div>

        {/* Announcements list */}
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          {filtered.map(a => {
            const tc = TYPE_COLORS[a.type] || TYPE_COLORS.UPDATE;
            const isOpen = selected === a.id;
            return (
              <div key={a.id} onClick={()=>setSelected(isOpen?null:a.id)}
                style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
                  border:`1px solid ${isOpen?C.orange:C.border}`,borderRadius:14,
                  padding:"20px 24px",cursor:"pointer",transition:"all .2s",
                  boxShadow:isOpen?`0 0 30px ${C.orangeGlow}`:"none",position:"relative",overflow:"hidden" }}>
                {/* Top accent line */}
                <div style={{ position:"absolute",top:0,left:0,right:0,height:2,
                  background:`linear-gradient(90deg,${tc.color},transparent)`,opacity:isOpen?1:.5 }}/>

                {/* Header row */}
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:14,flex:1,minWidth:0 }}>
                    <div style={{ fontSize:28,flexShrink:0 }}>{a.badge}</div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap" }}>
                        {a.pinned && (
                          <span style={{ fontSize:9,padding:"2px 8px",borderRadius:4,
                            background:`${C.orange}22`,color:C.orange,fontFamily:"'Orbitron',monospace",
                            letterSpacing:".1em",fontWeight:700 }}>📌 PINNED</span>
                        )}
                        <span style={{ fontSize:9,padding:"2px 8px",borderRadius:4,
                          background:tc.bg,color:tc.color,fontFamily:"'Orbitron',monospace",
                          letterSpacing:".1em",fontWeight:700 }}>{a.type}</span>
                        <span style={{ fontSize:10,color:C.muted }}>{a.date}</span>
                      </div>
                      <div style={{ fontSize:15,fontWeight:700,fontFamily:"'Orbitron',monospace",
                        color:isOpen?C.white:`${C.white}cc`,letterSpacing:".03em",lineHeight:1.3 }}>{a.title}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:16,color:C.muted,flexShrink:0,transition:"transform .2s",
                    transform:isOpen?"rotate(180deg)":"rotate(0deg)" }}>▾</div>
                </div>

                {/* Expanded content */}
                {isOpen && (
                  <div style={{ marginTop:18,paddingTop:18,borderTop:`1px solid ${C.faint}` }}>
                    <p style={{ fontSize:13,color:C.muted,lineHeight:1.9,marginBottom:16 }}>{a.content}</p>
                    <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
                      {a.tags.map(tag=>(
                        <span key={tag} style={{ fontSize:10,padding:"3px 10px",borderRadius:12,
                          background:C.bgDeep,border:`1px solid ${C.border}`,color:C.muted }}># {tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Subscribe box */}
        <div style={{ marginTop:40,background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
          border:`1px solid ${C.orange}33`,borderRadius:16,padding:"28px 32px",
          display:"flex",alignItems:"center",justifyContent:"space-between",gap:20,flexWrap:"wrap" }}>
          <div>
            <div style={{ fontSize:14,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,marginBottom:6 }}>
              Stay Updated
            </div>
            <div style={{ fontSize:12,color:C.muted }}>Join the OPNet Discord for real-time announcements and community discussion.</div>
          </div>
          <a href="https://discord.gg/opnet" target="_blank" rel="noreferrer"
            style={{ padding:"12px 28px",borderRadius:10,border:"none",
              background:`linear-gradient(135deg,#e8820a,${C.orange})`,color:"#000",
              fontSize:13,fontWeight:900,fontFamily:"'Orbitron',monospace",cursor:"pointer",
              textDecoration:"none",letterSpacing:".08em",boxShadow:`0 4px 20px ${C.orangeGlow}`,
              whiteSpace:"nowrap" }}>💬 JOIN DISCORD</a>
        </div>
      </div>
    </>
  );
}

// ── Carousel ───────────────────────────────────────────────────────────────────
const SLIDES = [
  {
    id: 1,
    title: "Stake Bitcoin. Earn Natively.",
    sub: "34.7% APY · Non-custodial · No bridges",
    tag: "GET STARTED",
    bg: ["#1a0800","#2d1200"],
    accent: "#f7931a",
    svg: (
      <svg width="100%" height="100%" viewBox="0 0 600 220" style={{ position:"absolute",inset:0,opacity:.18,pointerEvents:"none" }}>
        <defs>
          <radialGradient id="g1" cx="70%" cy="50%">
            <stop offset="0%" stopColor="#f7931a" stopOpacity=".9"/>
            <stop offset="100%" stopColor="#f7931a" stopOpacity="0"/>
          </radialGradient>
          <filter id="glow1"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <ellipse cx="430" cy="110" rx="160" ry="160" fill="url(#g1)"/>
        {[0,1,2,3,4,5].map(i=>(
          <polygon key={i} points="300,10 550,145 550,220 300,220 50,220 50,145"
            fill="none" stroke="#f7931a" strokeWidth=".4"
            transform={`translate(${i*18-50},${i*8}) scale(${1-i*.08})`} opacity={.6-i*.1}/>
        ))}
        <text x="440" y="125" textAnchor="middle" fill="#f7931a" fontSize="80" fontWeight="900" fontFamily="Arial" filter="url(#glow1)" opacity=".8">₿</text>
        {[[80,40],[120,80],[60,130],[160,160],[100,190]].map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r={2+i} fill="#f7931a" opacity={.3+i*.1}/>
        ))}
      </svg>
    ),
  },
  {
    id: 2,
    title: "Auto-Compound Your Rewards",
    sub: "Rewards reinvest every epoch · 0.5% fee · Set and forget",
    tag: "AUTO-COMPOUND",
    bg: ["#0a0d00","#141f00"],
    accent: "#a3e635",
    svg: (
      <svg width="100%" height="100%" viewBox="0 0 600 220" style={{ position:"absolute",inset:0,opacity:.18,pointerEvents:"none" }}>
        <defs>
          <radialGradient id="g2" cx="65%" cy="50%">
            <stop offset="0%" stopColor="#a3e635" stopOpacity=".9"/>
            <stop offset="100%" stopColor="#a3e635" stopOpacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="400" cy="110" rx="150" ry="120" fill="url(#g2)"/>
        {[40,70,100,130,160,190].map((y,i)=>(
          <line key={i} x1="30" y1={y} x2="300" y2={y} stroke="#a3e635" strokeWidth=".5" opacity={.4-i*.04}/>
        ))}
        {[0,1,2,3,4,5,6,7].map(i=>{
          const x = 30+i*40; const h = [80,120,60,140,100,160,90,130][i];
          return <rect key={i} x={x} y={220-h} width="24" height={h} rx="4" fill="#a3e635" opacity={.15+i*.04}/>;
        })}
        <path d="M 380 60 Q 420 30 460 60 Q 500 90 460 140 Q 420 180 380 140 Q 340 100 380 60" fill="none" stroke="#a3e635" strokeWidth="2" opacity=".6"/>
        <text x="420" y="120" textAnchor="middle" fill="#a3e635" fontSize="36" fontFamily="Arial" opacity=".7">↺</text>
      </svg>
    ),
  },
  {
    id: 3,
    title: "DAO Governance on Bitcoin",
    sub: "Vote with Signal Score · Shape the protocol · Diamond tier = 4× weight",
    tag: "GOVERNANCE",
    bg: ["#0d0818","#160d2a"],
    accent: "#a855f7",
    svg: (
      <svg width="100%" height="100%" viewBox="0 0 600 220" style={{ position:"absolute",inset:0,opacity:.18,pointerEvents:"none" }}>
        <defs>
          <radialGradient id="g3" cx="68%" cy="50%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity=".9"/>
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="420" cy="110" rx="160" ry="130" fill="url(#g3)"/>
        {[0,1,2,3,4,5].map(i=>{
          const angle = i*(Math.PI*2/6); const cx=420, cy=110, r=70;
          const x=cx+r*Math.cos(angle), y=cy+r*Math.sin(angle);
          return <g key={i}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#a855f7" strokeWidth=".8" opacity=".4"/>
            <circle cx={x} cy={y} r="8" fill="#a855f7" opacity=".3"/>
          </g>;
        })}
        <circle cx="420" cy="110" r="20" fill="#a855f7" opacity=".2" stroke="#a855f7" strokeWidth="1.5"/>
        <text x="420" y="116" textAnchor="middle" fill="#a855f7" fontSize="16" fontFamily="Arial" opacity=".8">⬡</text>
        {[[100,50,80],[150,80,50],[80,140,70],[180,160,40],[120,190,60]].map(([x,y,w],i)=>(
          <rect key={i} x={x} y={y} width={w} height="8" rx="4" fill="#a855f7" opacity=".15"/>
        ))}
      </svg>
    ),
  },
];

function BannerCarousel() {
  const [cur, setCur] = useState(0);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => goTo((c) => (c + 1) % SLIDES.length), 5000);
    return () => clearInterval(iv);
  }, []);

  const goTo = (next) => {
    const idx = typeof next === "function" ? next(cur) : next;
    if (idx === cur) return;
    setAnimating(true);
    setTimeout(() => { setCur(idx); setAnimating(false); }, 300);
  };

  const slide = SLIDES[cur];

  return (
    <div style={{ position:"relative",borderRadius:14,overflow:"hidden",
      background:`linear-gradient(135deg,${slide.bg[0]},${slide.bg[1]})`,
      border:`1px solid ${slide.accent}33`,minHeight:160,
      transition:"background .5s ease",boxShadow:`0 0 40px ${slide.accent}22` }}>
      {/* SVG art */}
      {slide.svg}
      {/* Content */}
      <div style={{ position:"relative",padding:"28px 32px",zIndex:1,
        opacity:animating?0:1,transition:"opacity .3s ease" }}>
        <div style={{ display:"inline-block",fontSize:9,fontFamily:"'Orbitron',monospace",
          letterSpacing:".2em",color:slide.accent,background:`${slide.accent}18`,
          border:`1px solid ${slide.accent}44`,borderRadius:4,padding:"3px 10px",marginBottom:12,fontWeight:700 }}>
          {slide.tag}
        </div>
        <div style={{ fontSize:20,fontWeight:900,fontFamily:"'Orbitron',monospace",
          color:C.white,letterSpacing:".04em",lineHeight:1.2,marginBottom:8,
          textShadow:`0 0 30px ${slide.accent}66` }}>
          {slide.title}
        </div>
        <div style={{ fontSize:11,color:`${C.white}88`,lineHeight:1.7 }}>{slide.sub}</div>
      </div>
      {/* Dots */}
      <div style={{ position:"absolute",bottom:14,left:"50%",transform:"translateX(-50%)",
        display:"flex",gap:6,zIndex:2 }}>
        {SLIDES.map((s,i)=>(
          <button key={i} onClick={()=>goTo(i)} style={{ width:i===cur?22:6,height:6,borderRadius:3,border:"none",
            cursor:"pointer",background:i===cur?slide.accent:`${slide.accent}44`,
            transition:"all .3s ease",padding:0 }}/>
        ))}
      </div>
      {/* Arrows */}
      <button onClick={()=>goTo((cur-1+SLIDES.length)%SLIDES.length)}
        style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",
          width:30,height:30,borderRadius:"50%",border:`1px solid ${slide.accent}44`,
          background:`${slide.accent}18`,color:slide.accent,fontSize:14,cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,transition:"all .2s" }}>‹</button>
      <button onClick={()=>goTo((cur+1)%SLIDES.length)}
        style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",
          width:30,height:30,borderRadius:"50%",border:`1px solid ${slide.accent}44`,
          background:`${slide.accent}18`,color:slide.accent,fontSize:14,cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",zIndex:2,transition:"all .2s" }}>›</button>
    </div>
  );
}

// ── Support Page ────────────────────────────────────────────────────────────────
const FAQS = [
  { q:"Is this running on mainnet or testnet?", a:"This dashboard runs on OPNet Testnet. No real BTC is at risk. You can get testnet BTC from the faucet at testnet.opnet.org. OPNet Mainnet launches March 17, 2026 — the dashboard will switch automatically on launch day." },
  { q:"How do I start staking BTC?", a:"Install OPWallet, click Connect Wallet, then go to the Dashboard tab. Enter your BTC amount in the Stake tab (min 0.00001 BTC) and confirm the OPWallet popup. Your stake is recorded on OPNet Testnet immediately." },
  { q:"How do I swap tokens?", a:"Go to the Swap tab in the navigation bar. Select your sell token (BTC, MOTO, or PILL) and your buy token, enter an amount or use the 25/50/75/MAX quick buttons, adjust slippage if needed, then click SWAP. A confirmation modal shows the full breakdown before you sign." },
  { q:"What tokens can I swap?", a:"Currently supported on Testnet: BTC (Bitcoin), MOTO (MotoSwap governance token), and PILL (protocol utility token). Swap rates come from MotoSwap DEX liquidity pools running on OPNet Testnet. More pairs will be added at mainnet." },
  { q:"What is the minimum stake amount?", a:"The minimum stake is 0.00001 BTC. This threshold is enforced by the staking smart contract to prevent dust transactions. On Testnet, use the faucet at testnet.opnet.org to get test BTC." },
  { q:"How are staking rewards calculated?", a:"Rewards accrue every Bitcoin block (~10 min) at 34.7% APY base rate. Formula: staked × (34.7% ÷ 365 ÷ 144) per block. Signal Score tiers unlock additional APY boosts on top." },
  { q:"What is Auto-Compound?", a:"Auto-Compound automatically reinvests your pending rewards back into your stake every epoch (144 blocks ≈ 1 day). A 0.5% fee is deducted to the protocol treasury. Toggle it on/off anytime or manually compound from the dashboard." },
  { q:"How do I unstake my BTC?", a:"Go to the Unstake tab on the Dashboard, enter the amount, and confirm in OPWallet. There is no lock-up period — you can unstake anytime. Unstaking resets your time multiplier." },
  { q:"What is the Signal Score?", a:"Signal Score (0–1000) is your on-chain loyalty metric. It grows with stake amount × time multiplier. Multiplier steps: 1× default → 2× after 144 blocks → 3× after 1,008 blocks → 5× after 4,320 blocks." },
  { q:"What are the tier benefits?", a:"Bronze (0–249): 0.5% fee. Silver (250–499): 0.3% reduced fee. Gold (500–899): 0.3% fee + 2% APY boost. Diamond (900–1000): all Gold perks + 4× DAO governance voting weight." },
  { q:"Why does my MOTO or PILL balance show unavailable?", a:"OP-20 token balances require your wallet's 32-byte public key via OPWallet's getPublicKey() API. Make sure OPWallet v2.1+ is installed and fully connected. If the issue persists, disconnect and reconnect your wallet." },
  { q:"What wallet do I need?", a:"OPWallet — a Bitcoin browser extension wallet built for OPNet smart contracts. Download from opnet.org. Ensure you are on v2.1+ for full swap and OP-20 balance support." },
];

function SupportPage({ onBack, wallet, connecting, error, onConnect, onDisconnect, blockHeight, btcPrice }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [ticket, setTicket] = useState({ email:"", subject:"", message:"" });
  const [errors, setErrors] = useState({});
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  // Auto-fill wallet address if connected
  const walletAddr = wallet?.address || "";

  const validate = () => {
    const e = {};
    if (!ticket.email.trim()) {
      e.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ticket.email.trim())) {
      e.email = "Enter a valid email address";
    }
    if (!ticket.subject.trim()) e.subject = "Subject is required";
    if (!ticket.message.trim()) {
      e.message = "Message is required";
    } else if (ticket.message.trim().length < 20) {
      e.message = "Please describe your issue in more detail (min 20 chars)";
    }
    return e;
  };

  const handleSend = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setSent(true);
      setTicket({ email:"", subject:"", message:"" });
      setErrors({});
    }, 1500);
  };

  const Field = ({ fieldKey, label, type="text", placeholder, rows }) => {
    const hasError = !!errors[fieldKey];
    const Tag = rows ? "textarea" : "input";
    return (
      <div>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5 }}>
          <div style={{ fontSize:9,letterSpacing:".15em",color:C.muted,textTransform:"uppercase" }}>{label}</div>
          {hasError && <div style={{ fontSize:9,color:C.red,fontStyle:"italic" }}>{errors[fieldKey]}</div>}
        </div>
        <Tag
          type={type}
          placeholder={placeholder}
          value={ticket[fieldKey]}
          rows={rows}
          onChange={e => {
            setTicket(p => ({...p, [fieldKey]: e.target.value}));
            if (errors[fieldKey]) setErrors(p => ({...p, [fieldKey]: null}));
          }}
          style={{ width:"100%", background:C.bgDeep,
            border:`1px solid ${hasError ? C.red : C.border}`,
            borderRadius:8, padding:"10px 14px", color:C.white, fontSize:12,
            fontFamily:"'Space Mono',monospace", outline:"none",
            boxSizing:"border-box", transition:"border-color .2s",
            resize:rows ? "vertical" : undefined }}
          onFocus={e => e.target.style.borderColor = hasError ? C.red : C.orange}
          onBlur={e => e.target.style.borderColor = hasError ? C.red : C.border}
        />
      </div>
    );
  };

  return (
    <>
      <Header page="support" onNav={onBack} wallet={wallet} connecting={connecting}
        error={error} onConnect={onConnect} onDisconnect={onDisconnect} blockHeight={blockHeight} btcPrice={btcPrice}/>
      <div style={{ maxWidth:1000,margin:"0 auto",padding:"32px 32px 60px" }}>

        {/* Title */}
        <div style={{ marginBottom:36 }}>
          <div style={{ fontSize:11,letterSpacing:".25em",color:C.orange,marginBottom:8,fontFamily:"'Orbitron',monospace" }}>HELP CENTER</div>
          <div style={{ fontSize:32,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,marginBottom:10 }}>SUPPORT</div>
          <div style={{ fontSize:13,color:C.muted,marginBottom:12 }}>Got a question? We've got answers. Or reach out directly and we'll get back to you.</div>
          <div style={{ display:"inline-flex",alignItems:"center",gap:8,
            padding:"6px 16px",borderRadius:20,background:"#60a5fa18",border:"1px solid #60a5fa44" }}>
            <span style={{ width:7,height:7,borderRadius:"50%",background:"#60a5fa",
              boxShadow:"0 0 8px #60a5fa",display:"inline-block",animation:"pulse 1.5s infinite" }}/>
            <span style={{ fontSize:9,color:"#60a5fa",fontWeight:700,fontFamily:"'Orbitron',monospace",letterSpacing:".12em" }}>
              RUNNING ON TESTNET — testnet.opnet.org
            </span>
          </div>
        </div>

        {/* Quick links — 3 only, no Explorer */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:36 }}>
          {[
            { icon:"📖", label:"Documentation", href:"https://docs.opnet.org",    color:C.orange },
            { icon:"💬", label:"Discord",        href:"https://discord.gg/opnet",  color:"#5865f2" },
            { icon:"🐦", label:"Twitter / X",    href:"https://x.com/opnetbtc",    color:"#1da1f2" },
          ].map(l=>(
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
              style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
                border:`1px solid ${l.color}33`,borderRadius:12,padding:"18px 16px",
                textDecoration:"none",display:"flex",flexDirection:"column",alignItems:"center",
                gap:8,transition:"all .2s",textAlign:"center" }}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=l.color;e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 24px ${l.color}22`;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=`${l.color}33`;e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}>
              <span style={{ fontSize:28 }}>{l.icon}</span>
              <span style={{ fontSize:11,fontWeight:700,fontFamily:"'Orbitron',monospace",color:l.color,letterSpacing:".06em" }}>{l.label}</span>
            </a>
          ))}
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:24 }}>
          {/* FAQ */}
          <div>
            <div style={{ fontSize:12,letterSpacing:".2em",color:C.orange,fontFamily:"'Orbitron',monospace",marginBottom:16 }}>FREQUENTLY ASKED</div>
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {FAQS.map((f,i)=>(
                <div key={i} onClick={()=>setOpenFaq(openFaq===i?null:i)}
                  style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
                    border:`1px solid ${openFaq===i?C.orange:C.border}`,borderRadius:10,
                    overflow:"hidden",cursor:"pointer",transition:"border-color .2s",
                    boxShadow:openFaq===i?`0 0 20px ${C.orange}18`:"none" }}>
                  <div style={{ padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12 }}>
                    <span style={{ fontSize:12,color:openFaq===i?C.white:C.muted,fontWeight:openFaq===i?700:400,lineHeight:1.4 }}>{f.q}</span>
                    <span style={{ color:C.orange,fontSize:16,flexShrink:0,display:"inline-block",
                      transform:openFaq===i?"rotate(45deg)":"rotate(0deg)",transition:"transform .25s" }}>+</span>
                  </div>
                  {openFaq===i && (
                    <div style={{ padding:"0 16px 14px",fontSize:12,color:C.muted,lineHeight:1.9,
                      borderTop:`1px solid ${C.faint}` }}>
                      <div style={{ paddingTop:12 }}>{f.a}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Contact form */}
          <div>
            <div style={{ fontSize:12,letterSpacing:".2em",color:C.orange,fontFamily:"'Orbitron',monospace",marginBottom:16 }}>CONTACT SUPPORT</div>
            <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
              border:`1px solid ${C.border}`,borderRadius:14,padding:24 }}>
              {sent ? (
                <div style={{ textAlign:"center",padding:"40px 0" }}>
                  <div style={{ fontSize:52,marginBottom:16 }}>✅</div>
                  <div style={{ fontSize:14,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.green,marginBottom:8 }}>Message Sent!</div>
                  <div style={{ fontSize:12,color:C.muted,marginBottom:20,lineHeight:1.7 }}>
                    We'll get back to you within 24 hours via email.
                  </div>
                  <button onClick={()=>setSent(false)} style={{ padding:"10px 24px",borderRadius:8,
                    border:`1px solid ${C.orange}`,background:"transparent",color:C.orange,
                    fontSize:11,fontFamily:"'Orbitron',monospace",cursor:"pointer",letterSpacing:".1em" }}>
                    SEND ANOTHER
                  </button>
                </div>
              ) : (
                <div style={{ display:"flex",flexDirection:"column",gap:14 }}>

                  {/* Wallet address — auto-filled, read only */}
                  <div>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5 }}>
                      <div style={{ fontSize:9,letterSpacing:".15em",color:C.muted,textTransform:"uppercase" }}>Wallet Address</div>
                      {!walletAddr && (
                        <div style={{ fontSize:9,color:`${C.orange}88`,fontStyle:"italic" }}>Connect wallet to auto-fill</div>
                      )}
                    </div>
                    <div style={{ width:"100%",background:walletAddr?`${C.orange}08`:C.bgDeep,
                      border:`1px solid ${walletAddr?C.orange+"33":C.faint}`,
                      borderRadius:8,padding:"10px 14px",
                      fontSize:11,fontFamily:"'Space Mono',monospace",
                      color:walletAddr?C.orange:C.muted,
                      boxSizing:"border-box",wordBreak:"break-all",lineHeight:1.6 }}>
                      {walletAddr || "—  Not connected"}
                    </div>
                  </div>

                  <Field fieldKey="email"   label="Email Address" type="email" placeholder="you@bitcoin.org"/>
                  <Field fieldKey="subject" label="Subject"        type="text"  placeholder="Issue with staking..."/>
                  <Field fieldKey="message" label="Message"        rows={5}     placeholder="Describe your issue in detail (min 20 characters)..."/>

                  {/* Error summary if any */}
                  {Object.values(errors).some(Boolean) && (
                    <div style={{ background:`${C.red}0d`,border:`1px solid ${C.red}33`,borderRadius:8,
                      padding:"10px 14px",fontSize:11,color:C.red,lineHeight:1.7 }}>
                      ⚠ Please fix the errors above before submitting.
                    </div>
                  )}

                  <button onClick={handleSend} disabled={sending}
                    style={{ padding:"13px",borderRadius:10,border:"none",
                      cursor:sending?"not-allowed":"pointer",
                      background:`linear-gradient(135deg,#e8820a,${C.orange})`,
                      color:"#000",fontSize:12,fontWeight:900,
                      fontFamily:"'Orbitron',monospace",letterSpacing:".1em",
                      transition:"all .2s",opacity:sending?.7:1,
                      boxShadow:`0 4px 20px ${C.orangeGlow}` }}>
                    {sending
                      ? <span style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                          <span style={{ width:12,height:12,border:"2px solid #33220088",borderTopColor:"#000",
                            borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite" }}/>
                          SENDING...
                        </span>
                      : "⚡ SEND MESSAGE"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Swap Page ──────────────────────────────────────────────────────────────────
const TOKENS = [
  { symbol:"BTC",  name:"Bitcoin",        img:"/btc-icon.webp",  color:"#f7931a", decimals:8 },
  { symbol:"MOTO", name:"MotoSwap Token", img:"/icon-moto.jpg",  color:"#d946ef", decimals:8 },
  { symbol:"PILL", name:"Pill Token",     img:"/icon-pill.png",  color:"#ff6b35", decimals:8 },
];

const MOCK_RATES = {
  "BTC-MOTO":  142000,
  "MOTO-BTC":  1/142000,
  "BTC-PILL":  890000,
  "PILL-BTC":  1/890000,
  "MOTO-PILL": 6.27,
  "PILL-MOTO": 1/6.27,
};

function SwapPage({ onBack, wallet, connecting, error, onConnect, onDisconnect, blockHeight, btcPrice }) {
  const [sellToken, setSellToken] = useState(TOKENS[1]); // MOTO
  const [buyToken,  setBuyToken]  = useState(TOKENS[0]); // BTC
  const [sellAmt,   setSellAmt]   = useState("");
  const [slippage,  setSlippage]  = useState(0.5);
  const [showSlip,  setShowSlip]  = useState(false);
  const [showSellDD, setShowSellDD] = useState(false);
  const [showBuyDD,  setShowBuyDD]  = useState(false);
  const [sellDDPos,  setSellDDPos]  = useState({ top:0, right:0 });
  const [buyDDPos,   setBuyDDPos]   = useState({ top:0, right:0 });
  const [swapping,  setSwapping]  = useState(false);
  const [tokenBalance, setTokenBalance] = useState(null);    // sell token balance
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceErr, setBalanceErr] = useState(null);
  const [swapHistory, setSwapHistory] = useState([]);
  const sellBtnRef = useRef(null);
  const buyBtnRef  = useRef(null);

  // ⚠️ Replace with real deployed contract addresses from OPNet Discord/docs
  const TOKEN_CONTRACTS = {
    MOTO: "opt1sqzkx6wm5acawl9m6nay2mjsm6wagv7gazcgtczds",
    PILL: "opt1sqp5gx9k0nrqph3sy3aeyzt673dz7ygtqxcfdqfle",
  };

  // Fetch SELL token balance
  useEffect(() => {
    setBalanceErr(null);
    if (!wallet?.address) { setTokenBalance(null); return; }
    setBalanceLoading(true);
    setTokenBalance(null);
    (async () => {
      try {
        let bal = null;
        if (sellToken.symbol === "BTC") {
          bal = parseFloat(wallet.balance) || null;
        } else {
          if (!wallet.publicKey) {
            setBalanceErr("Public key unavailable — reconnect OPWallet");
            setBalanceLoading(false);
            return;
          }
          const addr = TOKEN_CONTRACTS[sellToken.symbol];
          if (addr) bal = await fetchOP20Balance(addr, wallet.publicKey);
        }
        setTokenBalance(bal);
        if (bal === null && sellToken.symbol !== "BTC") setBalanceErr("RPC unavailable — check testnet connection");
      } catch(e) {
        console.error("Balance fetch error:", e);
        setBalanceErr(e?.message || "RPC error fetching balance");
      } finally {
        setBalanceLoading(false);
      }
    })();
  }, [wallet?.address, wallet?.publicKey, sellToken.symbol]);

  const rateKey = `${sellToken.symbol}-${buyToken.symbol}`;
  const rate    = MOCK_RATES[rateKey] || 0;
  const sellNum = parseFloat(sellAmt) || 0;
  const buyAmt  = sellNum > 0 ? (sellNum * rate).toFixed(8) : "";
  const priceImpact  = sellNum > 0 ? Math.min(5, sellNum * 0.003).toFixed(2) : "0.00";
  const minReceived  = buyAmt ? (parseFloat(buyAmt) * (1 - slippage/100)).toFixed(8) : "—";

  const [showConfirm, setShowConfirm] = useState(false);

  const hasBalance   = tokenBalance !== null && tokenBalance > 0;
  const isInsufficient = tokenBalance !== null && sellNum > 0 && sellNum > tokenBalance;
  const canSwap = wallet && sellNum > 0 && sellToken.symbol !== buyToken.symbol && !isInsufficient;

  const openSellDD = () => {
    if (sellBtnRef.current) {
      const r = sellBtnRef.current.getBoundingClientRect();
      setSellDDPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setShowSellDD(v => !v);
    setShowBuyDD(false);
  };
  const openBuyDD = () => {
    if (buyBtnRef.current) {
      const r = buyBtnRef.current.getBoundingClientRect();
      setBuyDDPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setShowBuyDD(v => !v);
    setShowSellDD(false);
  };

  const flipTokens = () => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
    setSellAmt(buyAmt || "");
  };

  // Step 1: user clicks SWAP → show confirm modal
  const requestSwap = () => { if (canSwap) setShowConfirm(true); };

  // Step 2: user confirms in modal → actually sign + broadcast
  const confirmSwap = () => {
    setShowConfirm(false);
    setSwapping(true);
    const entry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      from: `${sellNum} ${sellToken.symbol}`,
      to: `${parseFloat(buyAmt).toFixed(6)} ${buyToken.symbol}`,
      fromImg: sellToken.img,
      toImg: buyToken.img,
      fromColor: sellToken.color,
      toColor: buyToken.color,
      status: "pending",
      txHash: null,
    };
    setSwapHistory(h => [entry, ...h]);

    // Simulate OPWallet signing + tx broadcast
    setTimeout(() => {
      const success = Math.random() > 0.15; // 85% success rate simulation
      const txHash = success ? `0x${[...Array(12)].map(()=>Math.floor(Math.random()*16).toString(16)).join("")}...` : null;
      setSwapHistory(h => h.map(x => x.id === entry.id
        ? { ...x, status: success ? "success" : "failed", txHash }
        : x
      ));
      setSwapping(false);
      if (success) setSellAmt("");
    }, 2200);
  };

  const TokenBtn = ({ token, btnRef, onClick }) => (
    <button ref={btnRef} onClick={onClick}
      style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderRadius:10,
        border:`1px solid ${token.color}55`,background:`${token.color}18`,
        cursor:"pointer",transition:"all .2s",whiteSpace:"nowrap",flexShrink:0 }}
      onMouseEnter={e=>e.currentTarget.style.borderColor=token.color}
      onMouseLeave={e=>e.currentTarget.style.borderColor=`${token.color}55`}>
      <img src={token.img} alt={token.symbol}
        style={{ width:24,height:24,borderRadius:"50%",objectFit:"cover",flexShrink:0 }}/>
      <span style={{ fontSize:13,fontWeight:900,fontFamily:"'Orbitron',monospace",color:token.color }}>{token.symbol}</span>
      <span style={{ fontSize:9,color:`${token.color}88` }}>▾</span>
    </button>
  );

  // ── Confirmation Modal ─────────────────────────────────────────────────────
  const ConfirmModal = () => (
    <>
      {/* Backdrop + centering wrapper — backdrop handles click-outside */}
      <div onClick={()=>setShowConfirm(false)} style={{
        position:"fixed",inset:0,zIndex:10000,
        background:"rgba(0,0,0,.8)",backdropFilter:"blur(6px)",
        display:"flex",alignItems:"center",justifyContent:"center",
        padding:"20px",
      }}>
        {/* Modal card — stopPropagation so clicks inside don't close */}
        <div onClick={e=>e.stopPropagation()} style={{
          width:"100%",maxWidth:440,
          background:`linear-gradient(160deg,#1a1000,#0d0b00)`,
          border:`1px solid ${C.orange}55`,borderRadius:20,padding:28,
          boxShadow:`0 0 80px ${C.orange}22,0 32px 80px #000c`,
          opacity:1,
        }}>
          {/* Header */}
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
            <div style={{ fontSize:13,fontWeight:900,fontFamily:"'Orbitron',monospace",
              color:C.white,letterSpacing:".08em" }}>CONFIRM SWAP</div>
            <button onClick={()=>setShowConfirm(false)} style={{
              background:"none",border:`1px solid ${C.border}`,borderRadius:6,
              color:C.muted,cursor:"pointer",width:28,height:28,fontSize:14,
              display:"flex",alignItems:"center",justifyContent:"center" }}>✕</button>
          </div>

          {/* YOU SELL */}
          <div style={{ background:C.bgDeep,borderRadius:14,padding:"16px 18px",marginBottom:8 }}>
            <div style={{ fontSize:9,color:C.muted,letterSpacing:".15em",marginBottom:10 }}>YOU SELL</div>
            <div style={{ display:"flex",alignItems:"center",gap:12 }}>
              <img src={sellToken.img} alt={sellToken.symbol}
                style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",
                  border:`2px solid ${sellToken.color}55`,flexShrink:0 }}/>
              <div>
                <div style={{ fontSize:22,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white }}>
                  {sellNum.toFixed(8)}
                </div>
                <div style={{ fontSize:11,color:sellToken.color,fontWeight:700 }}>{sellToken.symbol}</div>
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div style={{ textAlign:"center",fontSize:20,color:C.orange,margin:"6px 0",lineHeight:1 }}>↓</div>

          {/* YOU RECEIVE */}
          <div style={{ background:C.bgDeep,borderRadius:14,padding:"16px 18px",marginBottom:16 }}>
            <div style={{ fontSize:9,color:C.muted,letterSpacing:".15em",marginBottom:10 }}>YOU RECEIVE (EST.)</div>
            <div style={{ display:"flex",alignItems:"center",gap:12 }}>
              <img src={buyToken.img} alt={buyToken.symbol}
                style={{ width:40,height:40,borderRadius:"50%",objectFit:"cover",
                  border:`2px solid ${buyToken.color}55`,flexShrink:0 }}/>
              <div>
                <div style={{ fontSize:22,fontWeight:900,fontFamily:"'Orbitron',monospace",color:buyToken.color }}>
                  {parseFloat(buyAmt).toFixed(8)}
                </div>
                <div style={{ fontSize:11,color:buyToken.color,fontWeight:700 }}>{buyToken.symbol}</div>
              </div>
            </div>
          </div>

          {/* Swap details */}
          <div style={{ borderRadius:10,border:`1px solid ${C.faint}`,padding:"10px 14px",
            marginBottom:20,display:"flex",flexDirection:"column",gap:8 }}>
            {[
              { label:"Rate",         value:`1 ${sellToken.symbol} = ${rate>=1?rate.toLocaleString(undefined,{maximumFractionDigits:4}):rate.toFixed(8)} ${buyToken.symbol}` },
              { label:"Min Received", value:`${minReceived} ${buyToken.symbol}` },
              { label:"Slippage",     value:`${slippage}%`, color:slippage>2?C.red:C.muted },
              { label:"Network Fee",  value:"~0.00003 BTC" },
            ].map(r=>(
              <div key={r.label} style={{ display:"flex",justifyContent:"space-between",fontSize:11 }}>
                <span style={{ color:C.muted }}>{r.label}</span>
                <span style={{ color:r.color||C.white,fontFamily:"'Space Mono',monospace",fontWeight:700 }}>{r.value}</span>
              </div>
            ))}
          </div>

          {/* OPWallet hint */}
          <div style={{ fontSize:10,color:`${C.orange}88`,textAlign:"center",marginBottom:16,
            fontFamily:"'Space Mono',monospace" }}>
            ⚡ OPWallet will prompt you to sign this transaction
          </div>

          {/* CANCEL / CONFIRM buttons */}
          <div style={{ display:"flex",gap:10 }}>
            <button onClick={()=>setShowConfirm(false)} style={{
              flex:1,padding:"13px",borderRadius:10,
              border:`1px solid ${C.border}`,background:"transparent",
              color:C.muted,fontSize:12,fontWeight:700,
              fontFamily:"'Orbitron',monospace",cursor:"pointer",transition:"all .2s" }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.orange; e.currentTarget.style.color=C.orange; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.muted; }}>
              CANCEL
            </button>
            <button onClick={confirmSwap} style={{
              flex:2,padding:"13px",borderRadius:10,border:"none",
              background:`linear-gradient(135deg,#e8820a,${C.orange})`,
              color:"#000",fontSize:13,fontWeight:900,
              fontFamily:"'Orbitron',monospace",letterSpacing:".08em",
              cursor:"pointer",boxShadow:`0 4px 20px ${C.orangeGlow}`,
              transition:"opacity .2s" }}
              onMouseEnter={e=>e.currentTarget.style.opacity=".85"}
              onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              ⇄ CONFIRM & SIGN
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const TokenDropdown = ({ pos, exclude, onSelect, onClose }) => (
    <>
      <div style={{ position:"fixed",inset:0,zIndex:9998 }} onClick={onClose}/>
      <div style={{ position:"fixed",top:pos.top,right:pos.right,
        background:`linear-gradient(160deg,#221400,#150e00)`,
        border:`1px solid ${C.orange}44`,borderRadius:14,padding:8,minWidth:200,
        zIndex:9999,boxShadow:`0 20px 60px #000e,0 0 40px ${C.orange}10`,
        animation:"slideIn .15s ease" }}>
        {TOKENS.filter(t => t.symbol !== exclude).map(t => (
          <button key={t.symbol} onClick={() => { onSelect(t); onClose(); }}
            style={{ width:"100%",display:"flex",alignItems:"center",gap:12,padding:"11px 14px",
              border:"none",borderRadius:10,background:"transparent",cursor:"pointer",
              transition:"background .15s",boxSizing:"border-box" }}
            onMouseEnter={e=>e.currentTarget.style.background=`${t.color}18`}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <img src={t.img} alt={t.symbol}
              style={{ width:36,height:36,borderRadius:"50%",objectFit:"cover",flexShrink:0,
                border:`1px solid ${t.color}44` }}/>
            <div style={{ textAlign:"left" }}>
              <div style={{ fontSize:13,fontWeight:900,fontFamily:"'Orbitron',monospace",color:t.color }}>{t.symbol}</div>
              <div style={{ fontSize:10,color:C.muted }}>{t.name}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <Header page="swap" onNav={onBack} wallet={wallet} connecting={connecting}
        error={error} onConnect={onConnect} onDisconnect={onDisconnect} blockHeight={blockHeight} btcPrice={btcPrice}/>

      {/* Portaled dropdowns */}
      {showConfirm && <ConfirmModal />}
      {showSellDD && <TokenDropdown pos={sellDDPos} exclude={buyToken.symbol}
        onSelect={t=>{ setSellToken(t); if(t.symbol===buyToken.symbol) setBuyToken(TOKENS.find(x=>x.symbol!==t.symbol)); }}
        onClose={()=>setShowSellDD(false)}/>}
      {showBuyDD && <TokenDropdown pos={buyDDPos} exclude={sellToken.symbol}
        onSelect={t=>{ setBuyToken(t); if(t.symbol===sellToken.symbol) setSellToken(TOKENS.find(x=>x.symbol!==t.symbol)); }}
        onClose={()=>setShowBuyDD(false)}/>}

      <div style={{ maxWidth:520,margin:"36px auto",padding:"0 20px 60px" }}>

        {/* Title */}
        <div style={{ marginBottom:24,textAlign:"center" }}>
          <div style={{ fontSize:11,letterSpacing:".25em",color:C.orange,marginBottom:6,fontFamily:"'Orbitron',monospace" }}>OPNET DEX</div>
          <div style={{ fontSize:28,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".05em" }}>TOKEN SWAP</div>
        </div>

        {/* Main card */}
        <div style={{ background:`linear-gradient(160deg,${C.bgCard},${C.bgDeep})`,
          border:`1px solid ${C.border}`,borderRadius:20,padding:22,
          boxShadow:`0 0 80px ${C.orange}08` }}>

          {/* Slippage row */}
          <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:16,position:"relative" }}>
            <button onClick={()=>setShowSlip(v=>!v)} style={{ display:"flex",alignItems:"center",gap:6,
              background:C.bgDeep,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"6px 12px",cursor:"pointer",transition:"border-color .2s" }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=C.orange}
              onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
              <span style={{ color:slippage>2?C.red:C.orange,fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:11 }}>
                {slippage}% Slippage
              </span>
              <span style={{ fontSize:13,color:C.muted }}>⚙</span>
            </button>
            {showSlip && <>
              <div style={{ position:"fixed",inset:0,zIndex:98 }} onClick={()=>setShowSlip(false)}/>
              <div style={{ position:"absolute",top:"calc(100% + 8px)",right:0,
                background:`linear-gradient(160deg,#221400,#150e00)`,
                border:`1px solid ${C.orange}44`,borderRadius:12,padding:14,minWidth:220,
                zIndex:99,boxShadow:`0 16px 40px #000c` }}>
                <div style={{ fontSize:9,color:C.muted,letterSpacing:".15em",marginBottom:10 }}>SLIPPAGE TOLERANCE</div>
                <div style={{ display:"flex",gap:6,marginBottom:10 }}>
                  {[0.1,0.5,1.0,2.0].map(v=>(
                    <button key={v} onClick={()=>setSlippage(v)}
                      style={{ flex:1,padding:"7px 0",border:`1px solid ${slippage===v?C.orange:C.border}`,
                        borderRadius:6,background:slippage===v?`${C.orange}22`:C.bgDeep,
                        color:slippage===v?C.orange:C.muted,fontSize:10,fontWeight:700,
                        cursor:"pointer",fontFamily:"'Orbitron',monospace" }}>{v}%</button>
                  ))}
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  <input type="number" min="0.01" max="50" step="0.1" value={slippage}
                    onChange={e=>setSlippage(parseFloat(e.target.value)||0.5)}
                    style={{ flex:1,background:C.bgDeep,border:`1px solid ${C.border}`,borderRadius:6,
                      padding:"7px 10px",color:C.white,fontSize:11,outline:"none",
                      fontFamily:"'Orbitron',monospace" }}/>
                  <span style={{ fontSize:11,color:C.muted }}>%</span>
                </div>
                {slippage>5 && <div style={{ marginTop:8,fontSize:10,color:C.red }}>⚠ High slippage — you may get a bad rate</div>}
              </div>
            </>}
          </div>

          {/* SELL box */}
          <div style={{ background:C.bgDeep,
            border:`1px solid ${isInsufficient?C.red:C.border}`,
            borderRadius:14,padding:"14px 16px",marginBottom:4,transition:"border-color .2s" }}>
            {/* Balance row */}
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
              <span style={{ fontSize:9,color:C.muted,letterSpacing:".18em",fontFamily:"'Orbitron',monospace" }}>SELL</span>
              {wallet && (
                <span style={{ fontSize:10,fontFamily:"'Space Mono',monospace",color:C.muted }}>
                  {"Balance: "}
                  {balanceLoading
                    ? <span style={{ color:`${C.orange}88` }}>fetching...</span>
                    : balanceErr
                    ? <span style={{ color:C.red }} title={balanceErr}>⚠ unavailable</span>
                    : tokenBalance !== null
                    ? <span style={{ color:C.orange,fontWeight:700,fontSize:11 }}>
                        {tokenBalance.toLocaleString(undefined,{maximumFractionDigits:8})} {sellToken.symbol}
                      </span>
                    : <span style={{ color:C.muted }}>—</span>
                  }
                </span>
              )}
            </div>

            {/* Amount input + token btn */}
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10 }}>
              <input type="number" min="0" placeholder="0" value={sellAmt}
                onChange={e=>setSellAmt(e.target.value)}
                style={{ flex:1,background:"transparent",border:"none",outline:"none",
                  fontSize:34,fontWeight:900,fontFamily:"'Orbitron',monospace",
                  color:sellNum>0?C.white:`${C.white}33`,padding:0,minWidth:0 }}/>
              <TokenBtn token={sellToken} btnRef={sellBtnRef} onClick={openSellDD}/>
            </div>

            {/* 25 / 50 / 75 / MAX percent buttons — show whenever wallet connected */}
            {wallet && (
              <div style={{ display:"flex",gap:6,marginTop: tokenBalance !== null ? 10 : 6 }}>
                {[25,50,75,100].map(pct => {
                  const bal = tokenBalance ?? 0;
                  const disabled = bal <= 0;
                  return (
                    <button key={pct}
                      disabled={disabled}
                      onClick={()=>{ if(bal>0) setSellAmt((bal*(pct/100)).toFixed(8)); }}
                      style={{ flex:1,padding:"5px 0",borderRadius:6,
                        border:`1px solid ${disabled?C.border:`${C.orange}44`}`,
                        background:C.bgCard,
                        color:disabled?`${C.muted}55`:C.orange,
                        fontSize:10,fontWeight:700,
                        fontFamily:"'Orbitron',monospace",
                        cursor:disabled?"not-allowed":"pointer",
                        transition:"all .15s" }}
                      onMouseEnter={e=>{ if(!disabled){ e.currentTarget.style.background=`${C.orange}22`; e.currentTarget.style.borderColor=C.orange; }}}
                      onMouseLeave={e=>{ e.currentTarget.style.background=C.bgCard; e.currentTarget.style.borderColor=disabled?C.border:`${C.orange}44`; }}>
                      {pct===100?"MAX":`${pct}%`}
                    </button>
                  );
                })}
              </div>
            )}

            {sellNum>0 && rate>0 && (
              <div style={{ fontSize:9,color:C.muted,marginTop:8,fontFamily:"'Space Mono',monospace" }}>
                1 {sellToken.symbol} = {rate>=1?rate.toLocaleString(undefined,{maximumFractionDigits:2}):rate.toFixed(8)} {buyToken.symbol}
              </div>
            )}
          </div>

          {/* Flip button */}
          <div style={{ display:"flex",justifyContent:"center",margin:"4px 0",position:"relative",zIndex:1 }}>
            <button onClick={flipTokens}
              style={{ width:38,height:38,borderRadius:10,border:`1px solid ${C.border}`,
                background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
                color:C.orange,fontSize:18,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center",
                transition:"all .25s",boxShadow:`0 4px 16px #0008` }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.orange; e.currentTarget.style.background=`${C.orange}18`; e.currentTarget.style.transform="rotate(180deg)"; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.background=`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`; e.currentTarget.style.transform="rotate(0)"; }}>
              ↕
            </button>
          </div>

          {/* BUY box */}
          <div style={{ background:C.bgDeep,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:16 }}>
            <div style={{ marginBottom:8 }}>
              <span style={{ fontSize:9,color:C.muted,letterSpacing:".18em",fontFamily:"'Orbitron',monospace" }}>BUY</span>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <div style={{ flex:1,fontSize:34,fontWeight:900,fontFamily:"'Orbitron',monospace",
                color:buyAmt?buyToken.color:`${C.white}33`,minWidth:0,overflow:"hidden",textOverflow:"ellipsis" }}>
                {buyAmt || "0"}
              </div>
              <TokenBtn token={buyToken} btnRef={buyBtnRef} onClick={openBuyDD}/>
            </div>
          </div>

          {/* Swap details */}
          {sellNum>0 && buyAmt && !isInsufficient && (
            <div style={{ background:C.bgDeep,border:`1px solid ${C.faint}`,borderRadius:10,
              padding:"12px 14px",marginBottom:16,display:"flex",flexDirection:"column",gap:8 }}>
              {[
                { label:"Price Impact",  value:`${priceImpact}%`, color:parseFloat(priceImpact)>2?C.red:C.green },
                { label:"Min Received",  value:`${minReceived} ${buyToken.symbol}`, color:C.white },
                { label:"Slippage",      value:`${slippage}%`, color:C.white },
                { label:"Network Fee",   value:"~0.00003 BTC", color:C.white },
              ].map(r=>(
                <div key={r.label} style={{ display:"flex",justifyContent:"space-between",fontSize:11 }}>
                  <span style={{ color:C.muted }}>{r.label}</span>
                  <span style={{ color:r.color,fontFamily:"'Space Mono',monospace",fontWeight:700 }}>{r.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action button — all states */}
          {!wallet ? (
            <button onClick={onConnect} style={{ width:"100%",padding:"15px",borderRadius:12,border:"none",
              background:`linear-gradient(135deg,#e8820a,${C.orange})`,color:"#000",
              fontSize:13,fontWeight:900,fontFamily:"'Orbitron',monospace",letterSpacing:".1em",
              cursor:"pointer",boxShadow:`0 6px 30px ${C.orangeGlow}` }}>
              ⚡ CONNECT WALLET
            </button>
          ) : sellToken.symbol===buyToken.symbol ? (
            <button disabled style={{ width:"100%",padding:"15px",borderRadius:12,border:"none",
              background:C.faint,color:`${C.muted}66`,fontSize:12,fontWeight:900,
              fontFamily:"'Orbitron',monospace",letterSpacing:".1em",cursor:"not-allowed" }}>
              SELECT DIFFERENT TOKENS
            </button>
          ) : !sellNum ? (
            <button disabled style={{ width:"100%",padding:"15px",borderRadius:12,border:"none",
              background:C.faint,color:`${C.muted}66`,fontSize:12,fontWeight:900,
              fontFamily:"'Orbitron',monospace",letterSpacing:".1em",cursor:"not-allowed" }}>
              ENTER AN AMOUNT
            </button>
          ) : tokenBalance !== null && tokenBalance === 0 ? (
            <button disabled style={{ width:"100%",padding:"15px",borderRadius:12,
              border:`1px solid ${C.red}44`,background:`${C.red}0d`,color:C.red,
              fontSize:12,fontWeight:900,fontFamily:"'Orbitron',monospace",
              letterSpacing:".1em",cursor:"not-allowed" }}>
              ⚠ NO {sellToken.symbol} BALANCE
            </button>
          ) : isInsufficient ? (
            <button disabled style={{ width:"100%",padding:"15px",borderRadius:12,
              border:`1px solid ${C.red}44`,background:`${C.red}0d`,color:C.red,
              fontSize:12,fontWeight:900,fontFamily:"'Orbitron',monospace",
              letterSpacing:".1em",cursor:"not-allowed" }}>
              ⚠ INSUFFICIENT {sellToken.symbol} — MAX {tokenBalance?.toFixed(6)}
            </button>
          ) : (
            <button onClick={requestSwap} disabled={swapping}
              style={{ width:"100%",padding:"15px",borderRadius:12,border:"none",
                background:`linear-gradient(135deg,#e8820a,${C.orange})`,color:"#000",
                fontSize:13,fontWeight:900,fontFamily:"'Orbitron',monospace",letterSpacing:".1em",
                cursor:swapping?"not-allowed":"pointer",
                boxShadow:`0 6px 30px ${C.orangeGlow}`,transition:"opacity .2s",opacity:swapping?.7:1 }}>
              {swapping
                ? <span style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                    <span style={{ width:14,height:14,border:"2px solid #33220066",borderTopColor:"#000",
                      borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite" }}/>
                    SWAPPING...
                  </span>
                : `⇄ SWAP ${sellToken.symbol} → ${buyToken.symbol}`}
            </button>
          )}
        </div>

        {/* ── Transaction History ─────────────────────────────── */}
        {swapHistory.length > 0 && (
          <div style={{ marginTop:24 }}>
            <div style={{ fontSize:11,letterSpacing:".2em",color:C.orange,
              fontFamily:"'Orbitron',monospace",marginBottom:12 }}>TRANSACTION HISTORY</div>
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {swapHistory.map(tx=>(
                <div key={tx.id} style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
                  border:`1px solid ${tx.status==="success"?C.green:tx.status==="failed"?C.red:C.border}`,
                  borderRadius:12,padding:"12px 16px",
                  boxShadow:tx.status==="success"?`0 0 16px ${C.green}18`:tx.status==="failed"?`0 0 16px ${C.red}18`:"none",
                  transition:"all .3s" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:12 }}>
                    {/* Token pair */}
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <div style={{ display:"flex",alignItems:"center" }}>
                        <img src={tx.fromImg} alt="" style={{ width:28,height:28,borderRadius:"50%",objectFit:"cover",border:`2px solid ${tx.fromColor}44` }}/>
                        <img src={tx.toImg}   alt="" style={{ width:28,height:28,borderRadius:"50%",objectFit:"cover",border:`2px solid ${tx.toColor}44`,marginLeft:-8 }}/>
                      </div>
                      <div>
                        <div style={{ fontSize:12,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white }}>
                          {tx.from} <span style={{ color:C.muted }}>→</span> {tx.to}
                        </div>
                        <div style={{ fontSize:9,color:C.muted,marginTop:2 }}>{tx.time}</div>
                      </div>
                    </div>
                    {/* Status badge */}
                    <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0 }}>
                      {tx.status==="pending" && (
                        <div style={{ display:"flex",alignItems:"center",gap:5,
                          background:`${C.orange}18`,border:`1px solid ${C.orange}44`,
                          borderRadius:6,padding:"3px 8px" }}>
                          <span style={{ width:6,height:6,borderRadius:"50%",
                            border:`2px solid ${C.orange}88`,borderTopColor:C.orange,
                            display:"inline-block",animation:"spin .7s linear infinite" }}/>
                          <span style={{ fontSize:9,color:C.orange,fontFamily:"'Orbitron',monospace",fontWeight:700 }}>PENDING</span>
                        </div>
                      )}
                      {tx.status==="success" && (
                        <div style={{ display:"flex",alignItems:"center",gap:5,
                          background:`${C.green}18`,border:`1px solid ${C.green}44`,
                          borderRadius:6,padding:"3px 8px" }}>
                          <span style={{ fontSize:10,color:C.green }}>✓</span>
                          <span style={{ fontSize:9,color:C.green,fontFamily:"'Orbitron',monospace",fontWeight:700 }}>SUCCESS</span>
                        </div>
                      )}
                      {tx.status==="failed" && (
                        <div style={{ display:"flex",alignItems:"center",gap:5,
                          background:`${C.red}18`,border:`1px solid ${C.red}44`,
                          borderRadius:6,padding:"3px 8px" }}>
                          <span style={{ fontSize:10,color:C.red }}>✕</span>
                          <span style={{ fontSize:9,color:C.red,fontFamily:"'Orbitron',monospace",fontWeight:700 }}>FAILED</span>
                        </div>
                      )}
                      {tx.txHash && (
                        <div style={{ fontSize:8,color:C.muted,fontFamily:"'Space Mono',monospace" }}>{tx.txHash}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info strip */}
        <div style={{ marginTop:20,display:"flex",justifyContent:"center",gap:24,flexWrap:"wrap" }}>
          {[
            { label:"Powered by",  value:"OPNet DEX" },
            { label:"Liquidity",   value:"MotoSwap Protocol" },
            { label:"Network",     value:"Bitcoin L1" },
          ].map(i=>(
            <div key={i.label} style={{ textAlign:"center" }}>
              <div style={{ fontSize:9,color:C.muted,letterSpacing:".1em" }}>{i.label}</div>
              <div style={{ fontSize:10,color:`${C.orange}99`,fontFamily:"'Orbitron',monospace",fontWeight:700 }}>{i.value}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const { wallet, connecting, error, connect, disconnect, detectedAddress, confirmConnect, dismissDetected, refreshBalance } = useOPWallet();

  // Poll tx confirmation via mempool.space (works for real Bitcoin txs)
  const pollTx = (txHash, onConfirmed) => {
    if (!txHash) return;
    let attempts = 0;
    const MAX = 72; // ~12 minutes at 10s intervals
    const iv = setInterval(async () => {
      attempts++;
      try {
        // mempool.space is a public Bitcoin explorer API
        const res = await fetch(`https://mempool.space/api/tx/${txHash}/status`);
        if (res.ok) {
          const data = await res.json();
          if (data?.confirmed) {
            clearInterval(iv);
            onConfirmed?.();
            return;
          }
        }
      } catch {}
      if (attempts >= MAX) clearInterval(iv);
    }, 10000);
    return () => clearInterval(iv);
  };
  const [staked, setStaked]         = useState(0);
  const [pending, setPending]       = useState(0);
  const [autoCompound, setAC]       = useState(true);
  const [blockHeight, setBlock]     = useState(847_210);
  const [tvl, setTvl]               = useState(284_500);
  const [apy]                       = useState(34.7);
  const [txs, setTxs]               = useState([]);
  const [stakeStartBlock, setSSB]   = useState(847_210);
  const [scoreDelta, setScoreDelta] = useState(null);
  const [btcPrice, setBtcPrice]     = useState(null);
  const [stakeAnim, setStakeAnim]   = useState(null); // { type:"STAKE"|"UNSTAKE"|"COMPOUND", amount }
  const blockRef = useRef(847_210);

  // Fetch live BTC price from CoinGecko
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true");
        const data = await res.json();
        if (data?.bitcoin) {
          setBtcPrice({ price: Math.round(data.bitcoin.usd), change: parseFloat(data.bitcoin.usd_24h_change?.toFixed(2) || 0) });
        }
      } catch {}
    };
    fetchPrice();
    const iv = setInterval(fetchPrice, 60000); // refresh every 60s
    return () => clearInterval(iv);
  }, []);

  const addTx = (type, amount, block, realHash) => {
    const hash = realHash || genTxHash();
    const tx = { hash, type, amount: parseFloat(amount), status: realHash ? "confirming" : "pending", submittedBlock: block, confirmedAt: null, real: !!realHash };
    setTxs(prev => [tx, ...prev.slice(0, 19)]);
    // Trigger the coin burst animation in the left column
    setStakeAnim({ type, amount: parseFloat(amount) });
    setTimeout(() => setStakeAnim(null), 2800);

    if (realHash) {
      // Poll OPNet RPC until tx confirms on-chain
      pollTx(realHash, () => {
        setTxs(prev => prev.map(t => t.hash === realHash ? { ...t, status: "confirmed", confirmedAt: block + 6 } : t));
        // Refresh real wallet balance from chain
        refreshBalance();
      });
    } else {
      setTimeout(() => setTxs(prev => prev.map(t => t.hash === hash ? { ...t, status: "confirming" } : t)), 2200);
      setTimeout(() => setTxs(prev => prev.map(t => t.hash === hash ? { ...t, status: "confirmed", confirmedAt: block + 6 } : t)), 13000);
    }
  };

  // Score formula: min(1000, floor(staked * 200 * timeMultiplier))
  const blocksStaked = blockHeight - stakeStartBlock;
  const timeMult = blocksStaked>=4320?5:blocksStaked>=1008?3:blocksStaked>=144?2:1;
  const score = Math.min(1000, Math.floor(staked * 200 * timeMult));
  const tier  = getTier(score);

  const prevScoreRef = useRef(score);
  useEffect(()=>{
    const prev = prevScoreRef.current;
    if (prev!==score) {
      const delta = score-prev;
      setScoreDelta({value:Math.abs(delta),dir:delta>0?"up":"down"});
      setTimeout(()=>setScoreDelta(null),2000);
      prevScoreRef.current = score;
    }
  },[score]);

  useEffect(()=>{
    const iv = setInterval(()=>{
      setBlock(b=>{ blockRef.current=b+1; return b+1; });
      // Only accrue rewards when wallet connected and actively staked
      if (staked > 0 && wallet) {
        const perBlock = staked * (34.7/100) / (365*24*1800);
        setPending(p => p + perBlock);
      }
      setTvl(t=>t+Math.random()*200-80);
    },2000);
    return ()=>clearInterval(iv);
  },[wallet, staked]);

  useEffect(()=>{
    if (autoCompound && pending>0.00001 && staked>0 && wallet) {
      setStaked(s=>s+pending*0.995);
      setPending(0);
    }
  },[blockHeight, autoCompound, pending, wallet, staked]);

  // Refresh real on-chain balance every 30s while wallet connected
  useEffect(()=>{
    if (!wallet) return;
    refreshBalance(); // immediate refresh on connect
    const iv = setInterval(()=>refreshBalance(), 30000);
    return ()=>clearInterval(iv);
  },[wallet?.address]);

  const handleNav = d => { if(d==="back"||d==="dashboard") setPage("dashboard"); else setPage(d); };

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#0a0800;}
    ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#0d0b00;}::-webkit-scrollbar-thumb{background:#2e2510;border-radius:2px;}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}
    @keyframes slideIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
    @keyframes scoreFlash{0%{opacity:1;transform:translateY(0)}70%{opacity:1;transform:translateY(-4px)}100%{opacity:0;transform:translateY(-8px)}}
    @keyframes floatBtc{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
    @keyframes glowPulse{0%,100%{box-shadow:0 0 20px #f7931a44,0 0 40px #f7931a22}50%{box-shadow:0 0 40px #f7931a99,0 0 80px #f7931a44}}
    @keyframes numberPop{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}
    @keyframes shimmerGold{0%{background-position:-200% 0}100%{background-position:200% 0}}
    @keyframes apyGlow{0%,100%{filter:drop-shadow(0 0 4px #f7931a55)}50%{filter:drop-shadow(0 0 14px #f7931acc)}}
    @keyframes countUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .nav-btn{transition:all .2s;}
    .nav-btn:hover{background:rgba(247,147,26,.12) !important;color:#f7931a !important;transform:translateY(-1px);}
    .nav-btn:active{transform:translateY(0);}
    .highlight-stake{color:#f7931a;font-weight:900;text-shadow:0 0 8px #f7931a88;}
    .highlight-earn{color:#ffb347;font-weight:900;text-shadow:0 0 8px #ffb34788;}
    .highlight-compound{color:#ff9f2e;font-weight:900;text-shadow:0 0 8px #ff9f2e88;}
    .pct-btn:hover{background:#2a1800 !important;border-color:#f7931a88 !important;color:#f7931a !important;transform:scale(1.05);}
    .pct-btn:active{transform:scale(.97);}
    input::placeholder,textarea::placeholder{color:#7a6a50;}
    textarea{color:#fff8ee;}
  `;

  if (page==="swap") return (
    <><style>{css}</style>
    <SwapPage onBack={d=>setPage(d||"dashboard")} wallet={wallet} connecting={connecting} error={error} onConnect={connect} onDisconnect={disconnect} blockHeight={blockHeight} btcPrice={btcPrice}/></> );
  if (page==="support") return (
    <><style>{css}</style>
    <SupportPage onBack={d=>setPage(d||"dashboard")} wallet={wallet} connecting={connecting} error={error} onConnect={connect} onDisconnect={disconnect} blockHeight={blockHeight} btcPrice={btcPrice}/></> );
  if (page==="announcements") return (
    <><style>{css}</style>
    <AnnouncementsPage onBack={d=>setPage(d||"dashboard")} wallet={wallet} connecting={connecting} error={error} onConnect={connect} onDisconnect={disconnect} blockHeight={blockHeight} btcPrice={btcPrice}/></> );
  if (page==="how-it-works") return (
    <><style>{css}</style>
    <HowItWorksPage onBack={d=>setPage(d||"dashboard")} wallet={wallet} connecting={connecting} error={error} onConnect={connect} onDisconnect={disconnect}/></>
  );
  if (page==="dao") return (
    <><style>{css}</style>
    <DAOPage onBack={d=>setPage(d||"dashboard")} wallet={wallet} connecting={connecting} error={error} onConnect={connect} onDisconnect={disconnect} score={score} blockHeight={blockHeight}/></>
  );

  return (
    <><style>{css}</style>
    <div style={{ minHeight:"100vh",background:C.bg,fontFamily:"'Space Mono',monospace",color:C.muted,
      backgroundImage:`radial-gradient(ellipse at 15% 0%,#f7931a12 0%,transparent 50%),radial-gradient(ellipse at 85% 10%,#ffb34712 0%,transparent 50%)`,position:"relative" }}>
      <div style={{ position:"fixed",inset:0,pointerEvents:"none",zIndex:50,
        background:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.03) 3px,rgba(0,0,0,.03) 4px)" }}/>

      <Header page={page} onNav={handleNav} wallet={wallet} connecting={connecting} error={error}
        onConnect={connect} onDisconnect={disconnect} blockHeight={blockHeight} btcPrice={btcPrice}/>

      {/* ── News Marquee ─────────────────────────────────────────────────────── */}
      <div style={{ position:"relative",overflow:"hidden",
        background:`linear-gradient(90deg,#0a0800,#1a0e00,#0a0800)`,
        borderBottom:`1px solid ${C.orange}33`,
        borderTop:`1px solid ${C.orange}11`,
        padding:"0",height:36,display:"flex",alignItems:"center" }}>

        {/* Left fade */}
        <div style={{ position:"absolute",left:0,top:0,bottom:0,width:80,zIndex:2,
          background:`linear-gradient(90deg,#0a0800,transparent)`,pointerEvents:"none" }}/>
        {/* Right fade */}
        <div style={{ position:"absolute",right:0,top:0,bottom:0,width:80,zIndex:2,
          background:`linear-gradient(270deg,#0a0800,transparent)`,pointerEvents:"none" }}/>

        {/* Left label */}
        <div style={{ position:"absolute",left:0,top:0,bottom:0,zIndex:3,
          display:"flex",alignItems:"center",paddingLeft:14,paddingRight:20,
          background:`linear-gradient(90deg,#110e00 70%,transparent)`,gap:8 }}>
          <span style={{ width:7,height:7,borderRadius:"50%",background:C.orange,flexShrink:0,
            boxShadow:`0 0 10px ${C.orange},0 0 20px ${C.orange}88`,
            display:"inline-block",animation:"pulse 1.5s infinite" }}/>
          <span style={{ fontSize:9,fontWeight:900,fontFamily:"'Orbitron',monospace",
            color:C.orange,letterSpacing:".2em",whiteSpace:"nowrap" }}>LIVE NEWS</span>
        </div>

        {/* Scrolling ticker — items duplicated for seamless loop */}
        {[0,1].map(copy => (
          <span key={copy} style={{ display:"inline-flex",alignItems:"center",
            animation:"marquee 55s linear infinite",whiteSpace:"nowrap",
            paddingLeft: copy===0 ? "100%" : 0, flexShrink:0 }}>
            {[
              { icon:"🤝", tag:"PARTNERSHIP", color:"#00c47a",  text:"OPNet x MotoSwap Strategic Partnership — Native DeFi Coming to Bitcoin L1" },
              { icon:"🖼️", tag:"NFT LAUNCH",  color:"#a855f7",  text:"OPNet Genesis NFT Collection Dropping Soon — Only 999 Quantum-Resistant OP-721 Collectibles" },
              { icon:"⇄",  tag:"SWAP LIVE",   color:"#d946ef",  text:"Token Swap Now Live on Testnet — Swap BTC, MOTO & PILL via MotoSwap DEX" },
              { icon:"🚀", tag:"MAINNET",     color:C.orange,   text:"OPNet Mainnet Launches March 17, 2026 — The First True Bitcoin Smart Contract Protocol" },
              { icon:"⚡", tag:"STAKING",     color:"#ffcc44",  text:"Genesis Epoch Staking APY Set at 34.7% — Stake BTC and Earn Natively on Bitcoin Testnet" },
              { icon:"🔒", tag:"SECURITY",    color:"#60a5fa",  text:"Smart Contract Audit Completed by Verichain — Zero Critical Vulnerabilities Found" },
              { icon:"🗳️", tag:"GOVERNANCE",  color:"#f472b6",  text:"DAO Governance Live on Testnet — Vote on OIP-007 Compound Fee Proposal" },
              { icon:"🌐", tag:"COMMUNITY",   color:"#34d399",  text:"OPNet Discord Hits 50,000 Members — Join the Fastest Growing Bitcoin DeFi Community" },
            ].map((item, i) => (
              <span key={i} style={{ display:"inline-flex",alignItems:"center",gap:10,marginRight:56 }}>
                <span style={{ display:"inline-flex",alignItems:"center",gap:5,
                  padding:"2px 8px",borderRadius:4,
                  background:`${item.color}22`,border:`1px solid ${item.color}55` }}>
                  <span style={{ fontSize:11 }}>{item.icon}</span>
                  <span style={{ fontSize:8,fontWeight:900,fontFamily:"'Orbitron',monospace",
                    color:item.color,letterSpacing:".15em" }}>{item.tag}</span>
                </span>
                <span style={{ fontSize:11,color:`${C.white}cc`,letterSpacing:".03em" }}>
                  {item.text}
                </span>
                <span style={{ color:`${C.orange}44`,fontSize:14,marginLeft:8 }}>◆</span>
              </span>
            ))}
          </span>
        ))}

        <style>{`
          @keyframes marquee {
            0%   { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
      </div>

      {/* 3-col grid */}
      <div style={{ padding:"24px 32px",display:"grid",gridTemplateColumns:"1fr 1.6fr 1fr",gap:20,maxWidth:1400,margin:"0 auto" }}>

        {/* LEFT */}
        <div style={{ display:"flex",flexDirection:"column",gap:16,minWidth:0 }}>
          {wallet ? (<>
          {/* Score card */}
          <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${tier.color}44`,
            borderRadius:16,padding:28,display:"flex",flexDirection:"column",alignItems:"center",gap:16,
            boxShadow:`0 0 50px ${tier.glow}`,position:"relative",overflow:"hidden" }}>
            <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${tier.color},transparent)` }}/>
            <div style={{ position:"absolute",inset:0,opacity:.04,
              backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpolygon points='20,2 38,11 38,29 20,38 2,29 2,11' fill='none' stroke='%2300d4ff' stroke-width='1'/%3E%3C/svg%3E")`,
              backgroundSize:"40px 40px" }}/>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",zIndex:1 }}>
              <div style={{ fontSize:11,letterSpacing:".2em",color:C.muted,textTransform:"uppercase" }}>Signal Score</div>
              {scoreDelta && (
                <div style={{ display:"flex",alignItems:"center",gap:4,padding:"3px 10px",borderRadius:20,
                  background:scoreDelta.dir==="up"?`${C.green}22`:`${C.red}22`,
                  border:`1px solid ${scoreDelta.dir==="up"?C.green:C.red}44`,animation:"scoreFlash 2s ease forwards" }}>
                  <span style={{ fontSize:12 }}>{scoreDelta.dir==="up"?"▲":"▼"}</span>
                  <span style={{ fontSize:11,fontWeight:900,fontFamily:"'Orbitron',monospace",
                    color:scoreDelta.dir==="up"?C.green:C.red }}>{scoreDelta.dir==="up"?"+":"-"}{scoreDelta.value}</span>
                </div>
              )}
            </div>
            <SignalRing score={score} tier={tier}/>
            {/* Time multiplier pill */}
            <div style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 14px",borderRadius:20,background:C.bgDeep,border:`1px solid ${C.faint}` }}>
              <span style={{ fontSize:10,color:C.muted }}>Time multiplier</span>
              <span style={{ fontSize:12,fontWeight:900,fontFamily:"'Orbitron',monospace",
                color:timeMult>=5?"#ffcc44":timeMult>=3?C.orange:timeMult>=2?C.amber:C.muted }}>{timeMult}×</span>
              <span style={{ fontSize:10,color:C.muted }}>· {blocksStaked.toLocaleString()} blocks</span>
            </div>
            <div style={{ width:"100%",display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
              {TIERS.map(t=>(
                <div key={t.name} style={{ padding:"6px 10px",borderRadius:6,background:tier.name===t.name?`${t.color}15`:C.bgDeep,
                  border:`1px solid ${tier.name===t.name?t.color+"55":C.border}`,display:"flex",alignItems:"center",gap:8 }}>
                  <div style={{ width:6,height:6,borderRadius:"50%",background:t.color,boxShadow:tier.name===t.name?`0 0 8px ${t.color}`:"none" }}/>
                  <span style={{ fontSize:10,color:tier.name===t.name?t.color:C.muted,fontWeight:700,letterSpacing:".1em" }}>{t.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Signal Score explanation */}
          <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.border}`,borderRadius:16,padding:20,position:"relative",overflow:"hidden" }}>
            <div style={{ position:"absolute",top:0,left:0,width:"40%",height:2,background:`linear-gradient(90deg,${C.orange},transparent)` }}/>
            <div style={{ fontSize:11,letterSpacing:".15em",color:C.orange,textTransform:"uppercase",marginBottom:12,fontFamily:"'Orbitron',monospace" }}>What is Signal Score?</div>
            <p style={{ fontSize:12,color:C.muted,lineHeight:1.8,marginBottom:14 }}>A loyalty metric from <span style={{ color:C.white,fontWeight:700 }}>0 → 1000</span>. Rises with stake amount <em>and</em> hold duration — rewarding committed participants over mercenary capital.</p>
            <div style={{ background:C.bgDeep,border:`1px solid ${C.faint}`,borderRadius:8,padding:"10px 14px",marginBottom:14 }}>
              <div style={{ fontSize:9,color:C.muted,letterSpacing:".15em",marginBottom:6 }}>SCORE FORMULA</div>
              <div style={{ fontSize:10,color:C.amber,fontFamily:"'Space Mono',monospace",wordBreak:"break-all",lineHeight:1.6 }}>score = min(1000, btc × 200 × time_mult)</div>
              <div style={{ fontSize:10,color:C.muted,marginTop:4 }}>multiplier steps at 144 · 1008 · 4320 blocks</div>
            </div>
            <div style={{ fontSize:10,color:C.muted,letterSpacing:".12em",marginBottom:8,textTransform:"uppercase" }}>Tier Unlocks</div>
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {[{t:TIERS[0],perks:"0.5% fee"},{t:TIERS[1],perks:"Reduced fee 0.3%"},{t:TIERS[2],perks:"APY boost +2%"},{t:TIERS[3],perks:"DAO governance vote"}].map(({t,perks})=>(
                <div key={t.name} style={{ display:"flex",alignItems:"center",gap:10,padding:"7px 10px",borderRadius:7,
                  background:tier.name===t.name?`${t.color}12`:C.bgDeep,border:`1px solid ${tier.name===t.name?t.color+"44":C.faint}` }}>
                  <div style={{ width:7,height:7,borderRadius:"50%",background:t.color,flexShrink:0,boxShadow:tier.name===t.name?`0 0 8px ${t.color}`:"none" }}/>
                  <span style={{ fontSize:10,fontWeight:700,color:tier.name===t.name?t.color:C.muted,minWidth:58 }}>{t.name} <span style={{ opacity:.6 }}>{t.min}+</span></span>
                  <span style={{ fontSize:10,color:tier.name===t.name?"#aa8860":C.muted,flex:1 }}>{perks}</span>
                  {tier.name===t.name && <span style={{ fontSize:9,color:t.color,fontFamily:"'Orbitron',monospace" }}>YOU</span>}
                </div>
              ))}
            </div>
          </div>

          <StatCard label="Your Staked" value={<AnimatedNumber value={staked} decimals={8} suffix=" BTC"/>} sub="Auto-compound ON" accent={C.orange} showBtcIcon/>

          {/* Pending Rewards + coin burst overlay */}
          <div style={{ position:"relative" }}>
            <StatCard label="Pending Rewards" value={<AnimatedNumber value={pending} decimals={8} suffix=" BTC"/>} sub={staked>0?"Accruing every block":"Stake BTC to start earning"} accent={C.amber} showBtcIcon/>

            {/* Coin burst animation — overlays the card on stake/unstake/compound */}
            {stakeAnim && <>
              <style>{`
                @keyframes coinBurst {
                  0%   { transform:translate(-50%,-50%) scale(0) rotate(0deg); opacity:1; }
                  60%  { transform:translate(-50%,-50%) scale(1.4) rotate(15deg); opacity:1; }
                  100% { transform:translate(-50%,-50%) scale(1) rotate(-5deg); opacity:0; }
                }
                @keyframes coinFly0 { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(-60px,-55px) scale(.3);opacity:0} }
                @keyframes coinFly1 { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(60px,-55px) scale(.3);opacity:0} }
                @keyframes coinFly2 { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(-75px,5px) scale(.3);opacity:0} }
                @keyframes coinFly3 { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(75px,5px) scale(.3);opacity:0} }
                @keyframes coinFly4 { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(-20px,-80px) scale(.3);opacity:0} }
                @keyframes coinFly5 { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(20px,-80px) scale(.3);opacity:0} }
                @keyframes coinFly6 { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(-35px,65px) scale(.3);opacity:0} }
                @keyframes coinFly7 { 0%{transform:translate(0,0);opacity:1} 100%{transform:translate(35px,65px) scale(.3);opacity:0} }
                @keyframes flashRing { 0%{transform:translate(-50%,-50%) scale(.4);opacity:.9} 100%{transform:translate(-50%,-50%) scale(2.8);opacity:0} }
                @keyframes flashRing2 { 0%{transform:translate(-50%,-50%) scale(.4);opacity:.5} 100%{transform:translate(-50%,-50%) scale(2);opacity:0} }
                @keyframes overlayFadeIn { 0%{opacity:0} 10%{opacity:1} 80%{opacity:1} 100%{opacity:0} }
                @keyframes labelSlideUp { 0%{transform:translateY(12px);opacity:0} 25%{transform:translateY(0);opacity:1} 75%{opacity:1} 100%{opacity:0} }
              `}</style>

              {/* Dark overlay on the card */}
              <div style={{ position:"absolute",inset:0,borderRadius:16,zIndex:10,
                background:"rgba(5,3,0,.82)",backdropFilter:"blur(2px)",
                animation:"overlayFadeIn 2.8s ease forwards",pointerEvents:"none" }}/>

              {/* Expanding rings */}
              <div style={{ position:"absolute",top:"50%",left:"50%",zIndex:11,
                width:70,height:70,borderRadius:"50%",
                border:`2px solid ${stakeAnim.type==="UNSTAKE"?C.red:C.orange}`,
                animation:"flashRing .7s ease-out forwards",pointerEvents:"none" }}/>
              <div style={{ position:"absolute",top:"50%",left:"50%",zIndex:11,
                width:70,height:70,borderRadius:"50%",
                border:`2px solid ${stakeAnim.type==="UNSTAKE"?C.red:C.orange}88`,
                animation:"flashRing2 .9s .1s ease-out forwards",pointerEvents:"none" }}/>

              {/* Center BTC coin */}
              <div style={{ position:"absolute",top:"50%",left:"50%",zIndex:12,
                animation:"coinBurst .9s cubic-bezier(.34,1.56,.64,1) forwards",
                pointerEvents:"none" }}>
                <svg width="56" height="56" viewBox="0 0 64 64" style={{marginLeft:-28,marginTop:-28}}>
                  <circle cx="32" cy="32" r="30"
                    fill={stakeAnim.type==="UNSTAKE"?"#ff413628":"#f7931a28"}
                    stroke={stakeAnim.type==="UNSTAKE"?C.red:C.orange} strokeWidth="3"/>
                  <circle cx="32" cy="32" r="22"
                    fill={stakeAnim.type==="UNSTAKE"?"#ff413618":"#f7931a18"}/>
                  <text x="32" y="41" textAnchor="middle" fontSize="28"
                    fill={stakeAnim.type==="UNSTAKE"?C.red:stakeAnim.type==="COMPOUND"?"#ffcc44":C.orange}
                    fontWeight="bold">₿</text>
                </svg>
              </div>

              {/* Flying mini coins */}
              {[0,1,2,3,4,5,6,7].map(i => (
                <div key={i} style={{
                  position:"absolute",top:"50%",left:"50%",
                  marginTop:-9,marginLeft:-9,zIndex:12,
                  animation:`coinFly${i} ${.55+i*.06}s ${i*.03}s ease-out forwards`,
                  pointerEvents:"none" }}>
                  <svg width="18" height="18" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="28"
                      fill={stakeAnim.type==="UNSTAKE"?"#ff413655":"#f7931a55"}
                      stroke={stakeAnim.type==="UNSTAKE"?C.red:C.orange} strokeWidth="5"/>
                    <text x="32" y="41" textAnchor="middle" fontSize="26"
                      fill={stakeAnim.type==="UNSTAKE"?C.red:C.orange} fontWeight="bold">₿</text>
                  </svg>
                </div>
              ))}

              {/* Action label */}
              <div style={{ position:"absolute",bottom:18,left:0,right:0,zIndex:13,
                textAlign:"center",animation:"labelSlideUp 2.5s ease forwards",pointerEvents:"none" }}>
                <div style={{ display:"inline-flex",alignItems:"center",gap:8,
                  padding:"5px 14px",borderRadius:20,
                  background:`${stakeAnim.type==="UNSTAKE"?C.red:stakeAnim.type==="COMPOUND"?"#ffcc44":C.orange}22`,
                  border:`1px solid ${stakeAnim.type==="UNSTAKE"?C.red:stakeAnim.type==="COMPOUND"?"#ffcc44":C.orange}66` }}>
                  <span style={{ fontSize:10,fontWeight:900,fontFamily:"'Orbitron',monospace",
                    letterSpacing:".12em",
                    color:stakeAnim.type==="UNSTAKE"?C.red:stakeAnim.type==="COMPOUND"?"#ffcc44":C.orange }}>
                    {stakeAnim.type==="STAKE"    && `⬆ +${stakeAnim.amount.toFixed(8)} BTC STAKED`}
                    {stakeAnim.type==="UNSTAKE"  && `⬇ -${stakeAnim.amount.toFixed(8)} BTC UNSTAKED`}
                    {stakeAnim.type==="COMPOUND" && `⟳ ${stakeAnim.amount.toFixed(8)} BTC COMPOUNDED`}
                  </span>
                </div>
              </div>
            </>}
          </div>
          </>) : (
            /* No wallet — connect prompt for left col */
            <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.border}`,
              borderRadius:16,padding:32,display:"flex",flexDirection:"column",alignItems:"center",
              justifyContent:"center",gap:16,textAlign:"center",flex:1 }}>
              <div style={{ fontSize:48 }}>📊</div>
              <div style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white }}>Signal Score</div>
              <div style={{ fontSize:11,color:C.muted,lineHeight:1.8,maxWidth:200 }}>
                Connect your OPWallet to view your Signal Score, tier, and staking stats.
              </div>
              <div style={{ width:60,height:1,background:`linear-gradient(90deg,transparent,${C.orange},transparent)` }}/>
              <div style={{ fontSize:10,color:`${C.orange}88`,letterSpacing:".15em",fontFamily:"'Orbitron',monospace" }}>
                WALLET REQUIRED
              </div>
            </div>
          )}
        </div>

        {/* CENTER */}
        <div style={{ display:"flex",flexDirection:"column",gap:16,minWidth:0 }}>
          {/* Banner Carousel */}
          <BannerCarousel/>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
            <StatCard label="TVL" value={tvl>=1_000_000?`$${(tvl/1_000_000).toFixed(2)}M`:tvl>=1000?`$${(tvl/1000).toFixed(1)}K`:`$${tvl.toFixed(0)}`} sub="Total Value Locked" accent="#ffb347"/>
            <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.orangeHot}22`,
              borderRadius:12,padding:"16px 18px",position:"relative",overflow:"hidden",minWidth:0 }}>
              <div style={{ position:"absolute",inset:0,borderRadius:12,pointerEvents:"none",
                boxShadow:`0 0 30px ${C.orangeHot}22`,animation:"glowPulse 3s ease-in-out infinite" }}/>
              <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${C.orangeHot},transparent)`,opacity:.8 }}/>
              <div style={{ fontSize:9,letterSpacing:".15em",color:C.muted,marginBottom:8,textTransform:"uppercase",position:"relative" }}>APY</div>
              <div style={{ display:"flex",alignItems:"baseline",gap:4,position:"relative" }}>
                <div style={{ fontSize:28,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.orangeHot,
                  lineHeight:1,animation:"apyGlow 2s ease-in-out infinite" }}>
                  <AnimatedNumber value={apy} decimals={1}/>
                </div>
                <div style={{ fontSize:16,fontWeight:900,fontFamily:"'Orbitron',monospace",color:`${C.orangeHot}99` }}>%</div>
              </div>
              <div style={{ fontSize:10,color:C.muted,marginTop:6,position:"relative" }}>Annual yield</div>
            </div>
          </div>
          <StakingPanel staked={staked} setStaked={setStaked} pending={pending} setPending={setPending}
            autoCompound={autoCompound} setAutoCompound={setAC} walletConnected={!!wallet}
            addTx={addTx} blockRef={blockRef} setStakeStartBlock={setSSB}
            btcBalance={wallet?.balance} wallet={wallet}/>
          <div style={{ background:C.bgDeep,border:`1px solid ${C.orange}22`,borderRadius:10,padding:"14px 18px",display:"flex",gap:12,alignItems:"flex-start",
            opacity:autoCompound && staked>0 ? 1 : 0, pointerEvents:autoCompound && staked>0 ? "auto":"none",
            transition:"opacity .3s ease", minHeight:68 }}>
            <div style={{ fontSize:20 }}>🔄</div>
            <div>
              <div style={{ fontSize:12,color:C.orange,fontWeight:700,marginBottom:4 }}>Auto-Compound Active</div>
              <div style={{ fontSize:11,color:C.muted,lineHeight:1.7 }}>Rewards auto-reinvest every epoch. 0.5% fee sent to treasury. Position grows block by block without manual claims.</div>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display:"flex",flexDirection:"column",gap:16,minWidth:0 }}>
          {wallet ? (<>
            <TopStakers userStaked={staked} userScore={score} userTier={tier} walletConnected={!!wallet}/>
            {/* Animated Network Panel */}
            <NetworkPanel blockHeight={blockHeight} tvl={tvl} apy={apy}/>
          </>) : (
            <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.border}`,
              borderRadius:16,padding:32,display:"flex",flexDirection:"column",alignItems:"center",
              justifyContent:"center",gap:16,textAlign:"center",flex:1 }}>
              <div style={{ fontSize:48 }}>🏆</div>
              <div style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white }}>Top Stakers</div>
              <div style={{ fontSize:11,color:C.muted,lineHeight:1.8,maxWidth:200 }}>
                Connect your OPWallet to see the leaderboard and your ranking.
              </div>
              <div style={{ width:60,height:1,background:`linear-gradient(90deg,transparent,${C.orange},transparent)` }}/>
              <div style={{ fontSize:10,color:`${C.orange}88`,letterSpacing:".15em",fontFamily:"'Orbitron',monospace" }}>
                WALLET REQUIRED
              </div>
            </div>
          )}
        </div>
      </div>

      {/* TX History — only when wallet connected */}
      {wallet && (
      <div style={{ padding:"0 32px 8px",maxWidth:1400,margin:"0 auto" }}>
        <div style={{ background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,border:`1px solid ${C.border}`,borderRadius:16,padding:24 }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <span style={{ fontSize:16 }}>🔗</span>
              <span style={{ fontSize:13,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".05em" }}>TRANSACTION HISTORY</span>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:16 }}>
              {txs.length>0 && (
                <div style={{ display:"flex",gap:12 }}>
                  {[{label:"Pending",color:C.amber,count:txs.filter(t=>t.status==="pending").length},
                    {label:"Confirming",color:C.orange,count:txs.filter(t=>t.status==="confirming").length},
                    {label:"Confirmed",color:C.green,count:txs.filter(t=>t.status==="confirmed").length}
                  ].map(s=>(
                    <div key={s.label} style={{ display:"flex",alignItems:"center",gap:5 }}>
                      <span style={{ width:6,height:6,borderRadius:"50%",background:s.color,display:"inline-block" }}/>
                      <span style={{ fontSize:11,color:C.muted }}>{s.label} <span style={{ color:s.color,fontWeight:700 }}>{s.count}</span></span>
                    </div>
                  ))}
                </div>
              )}
              <LivePulse active={txs.some(t=>t.status!=="confirmed")}/>
            </div>
          </div>
          <TxFeed txs={txs} currentBlock={blockHeight}/>
        </div>
      </div>
      )} {/* end wallet TX history */}

      {/* Footer */}
      <div style={{ margin:"0 0 0",padding:"40px 40px 24px",background:C.bgDeep,borderTop:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:1400,margin:"0 auto" }}>
          {/* Top row — brand + columns */}
          <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:40,marginBottom:36 }}>
            {/* Brand */}
            <div>
              <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:14 }}>
                <OpNetLogo size={32}/>
                <div style={{ fontSize:16,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,letterSpacing:".08em" }}>
                  OP_NET <span style={{ color:C.orange }}>BTC</span>
                </div>
              </div>
              <p style={{ fontSize:11,color:C.muted,lineHeight:1.9,maxWidth:280,marginBottom:18 }}>
                Non-custodial Bitcoin staking powered by OPNet — the first smart contract layer on Bitcoin L1. Your keys, your BTC, your rewards.
              </p>
              {/* Social links */}
              <div style={{ display:"flex",gap:10 }}>
                {[
                  { label:"X", href:"https://x.com/opnetbtc", icon:"𝕏" },
                  { label:"Discord", href:"https://discord.gg/opnet", icon:"💬" },
                  { label:"Telegram", href:"https://t.me/opnetbtc", icon:"✈" },
                  { label:"GitHub", href:"https://github.com/btc-vision", icon:"⌥" },
                ].map(s=>(
                  <a key={s.label} href={s.href} target="_blank" rel="noreferrer"
                    style={{ width:34,height:34,borderRadius:8,background:C.bgCard,border:`1px solid ${C.border}`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:13,color:C.muted,textDecoration:"none",transition:"all .2s" }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=C.orange;e.currentTarget.style.color=C.orange;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.muted;}}>
                    {s.icon}
                  </a>
                ))}
              </div>
            </div>

            {/* Protocol */}
            <div>
              <div style={{ fontSize:10,letterSpacing:".2em",color:C.orange,marginBottom:14,fontFamily:"'Orbitron',monospace" }}>PROTOCOL</div>
              <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                {[
                  { label:"Chain", value:"Bitcoin L1" },
                  { label:"Network", value:"OPNet Mainnet" },
                  { label:"Token", value:"OPNET" },
                  { label:"Mainnet Launch", value:"Mar 17, 2026" },
                  { label:"Epoch", value:"144 blocks (~1 day)" },
                ].map(r=>(
                  <div key={r.label} style={{ display:"flex",justifyContent:"space-between",gap:8 }}>
                    <span style={{ fontSize:10,color:C.muted }}>{r.label}</span>
                    <span style={{ fontSize:10,fontFamily:"'Orbitron',monospace",color:`${C.orange}cc` }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Staking */}
            <div>
              <div style={{ fontSize:10,letterSpacing:".2em",color:C.orange,marginBottom:14,fontFamily:"'Orbitron',monospace" }}>STAKING</div>
              <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                {[
                  { label:"APY", value:"34.7%" },
                  { label:"Min Stake", value:"0.00001 BTC" },
                  { label:"Compound Fee", value:"0.5%" },
                  { label:"Unstake Lock", value:"None" },
                  { label:"Custody", value:"Non-custodial" },
                ].map(r=>(
                  <div key={r.label} style={{ display:"flex",justifyContent:"space-between",gap:8 }}>
                    <span style={{ fontSize:10,color:C.muted }}>{r.label}</span>
                    <span style={{ fontSize:10,fontFamily:"'Orbitron',monospace",color:`${C.orange}cc` }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Links */}
            <div>
              <div style={{ fontSize:10,letterSpacing:".2em",color:C.orange,marginBottom:14,fontFamily:"'Orbitron',monospace" }}>RESOURCES</div>
              <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                {[
                  { label:"Documentation", href:"https://docs.opnet.org" },
                  { label:"OPWallet", href:"https://opnet.org" },
                  { label:"GitHub", href:"https://github.com/btc-vision" },
                  { label:"Audit Report", href:"https://opnet.org/audit" },
                ].map(r=>(
                  <a key={r.label} href={r.href} target="_blank" rel="noreferrer"
                    style={{ fontSize:10,color:C.muted,textDecoration:"none",transition:"color .15s" }}
                    onMouseEnter={e=>e.currentTarget.style.color=C.orange}
                    onMouseLeave={e=>e.currentTarget.style.color=C.muted}>
                    → {r.label}
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height:1,background:`linear-gradient(90deg,transparent,${C.border},transparent)`,marginBottom:20 }}/>

          {/* Bottom row */}
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12 }}>
            <div style={{ fontSize:10,color:`${C.muted}88` }}>
              © 2026 OPNet Protocol. All rights reserved.
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:6 }}>
              <span style={{ width:6,height:6,borderRadius:"50%",background:C.green,
                boxShadow:`0 0 6px ${C.green}`,display:"inline-block",animation:"pulse 2s infinite" }}/>
              <span style={{ fontSize:10,color:`${C.muted}88`,fontFamily:"'Orbitron',monospace",letterSpacing:".1em" }}>
                ALL SYSTEMS OPERATIONAL
              </span>
            </div>
            <div style={{ fontSize:10,color:`${C.muted}55` }}>
              Smart contracts audited · Non-custodial · Open source
            </div>
          </div>
        </div>
      </div>
    </div>
      {/* Wallet detected confirmation banner */}
      {detectedAddress && !wallet && (
        <WalletDetectedBanner
          address={detectedAddress}
          onConfirm={confirmConnect}
          onDismiss={dismissDetected}
          connecting={connecting}
        />
      )}
    </>
  );
}
