import { useState, useEffect, useRef } from "react";
import { getContract, JSONRpcProvider, STAKING_ABI } from "opnet";
import { networks } from "@btc-vision/bitcoin";

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
    return { address, shortAddress: address.slice(0,8)+"..."+address.slice(-4), balance };
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
  if (wallet) return (
    <div style={{ position:"relative" }}>
      <button onClick={()=>setOpen(v=>!v)} style={{ display:"flex",alignItems:"center",gap:10,padding:"9px 18px",
        borderRadius:8,background:"#1a1000",border:`1px solid ${C.orange}55`,color:C.orange,
        cursor:"pointer",fontFamily:"'Space Mono',monospace" }}>
        <span style={{ width:8,height:8,borderRadius:"50%",background:C.orange,
          boxShadow:`0 0 8px ${C.orange}`,animation:"pulse 2s infinite",display:"inline-block" }}/>
        <span style={{ fontSize:13,fontWeight:700 }}>{wallet.shortAddress}</span>
        <span style={{ fontSize:10,opacity:.6 }}>▾</span>
      </button>
      {open && <>
        <div style={{ position:"fixed",inset:0,zIndex:199 }} onClick={()=>setOpen(false)}/>
        <div style={{ position:"absolute",top:"calc(100% + 8px)",right:0,background:C.bgCard,
          border:`1px solid ${C.border}`,borderRadius:12,padding:8,minWidth:230,zIndex:200,
          boxShadow:"0 12px 40px #000e,0 0 0 1px #2a200055",animation:"slideIn .15s ease" }}>
          <div style={{ padding:"10px 14px",borderBottom:`1px solid ${C.faint}`,marginBottom:4 }}>
            <div style={{ fontSize:10,color:C.muted,letterSpacing:".15em",marginBottom:6 }}>CONNECTED VIA</div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <OpNetLogo size={20}/>
              <span style={{ fontSize:14,color:C.white,fontWeight:700,fontFamily:"'Orbitron',monospace" }}>OP_WALLET</span>
            </div>
          </div>
          <div style={{ padding:"10px 14px",borderBottom:`1px solid ${C.faint}`,marginBottom:4 }}>
            <div style={{ fontSize:10,color:C.muted,letterSpacing:".15em",marginBottom:4 }}>ADDRESS</div>
            <div style={{ fontSize:11,color:"#aa9977",wordBreak:"break-all",lineHeight:1.6 }}>
              {wallet.address.slice(0,24)}...{wallet.address.slice(-6)}
            </div>
          </div>
          {wallet.balance!=="—" && (
            <div style={{ padding:"10px 14px",borderBottom:`1px solid ${C.faint}`,marginBottom:4 }}>
              <div style={{ fontSize:10,color:C.muted,letterSpacing:".15em",marginBottom:4 }}>BALANCE</div>
              <div style={{ fontSize:16,color:C.orange,fontFamily:"'Orbitron',monospace",fontWeight:700 }}>
                {wallet.balance} BTC
              </div>
            </div>
          )}
          <button onClick={()=>{onDisconnect();setOpen(false)}} style={{ width:"100%",padding:"10px 14px",
            border:"none",borderRadius:8,background:"#1a1000",color:C.red,fontSize:12,fontWeight:700,
            cursor:"pointer",fontFamily:"'Space Mono',monospace",textAlign:"left" }}>⏏  Disconnect</button>
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
function Header({ page, onNav, wallet, connecting, error, onConnect, onDisconnect, blockHeight }) {
  return (
    <div style={{ position:"sticky",top:0,zIndex:90,background:C.bgDeep,
      borderBottom:`1px solid ${C.border}` }}>
      {/* Hero Banner */}
      <div style={{ position:"relative",padding:"28px 40px 22px",
        background:`linear-gradient(135deg,${C.bg} 0%,#1a0e00 50%,${C.bg} 100%)` }}>
        {/* Animated background orbs */}
        <div style={{ position:"absolute",top:"-40px",left:"10%",width:200,height:200,borderRadius:"50%",
          background:`radial-gradient(circle,#f7931a18 0%,transparent 70%)`,
          animation:"floatBtc 6s ease-in-out infinite",pointerEvents:"none" }}/>
        <div style={{ position:"absolute",top:"-20px",right:"15%",width:150,height:150,borderRadius:"50%",
          background:`radial-gradient(circle,#ffb34712 0%,transparent 70%)`,
          animation:"floatBtc 8s ease-in-out infinite reverse",pointerEvents:"none" }}/>
        {/* Hex grid background */}
        <div style={{ position:"absolute",inset:0,opacity:.03,
          backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpolygon points='30,3 57,17 57,43 30,57 3,43 3,17' fill='none' stroke='%2300d4ff' stroke-width='1'/%3E%3C/svg%3E")`,
          backgroundSize:"60px 60px",pointerEvents:"none" }}/>

        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative" }}>
          {/* Left — Logo + Title */}
          <div style={{ display:"flex",alignItems:"center",gap:20 }}>
            {/* Animated BTC coin */}
            <div style={{ position:"relative",width:64,height:64,flexShrink:0 }}>
              <svg width="64" height="64" viewBox="0 0 64 64" style={{ animation:"floatBtc 4s ease-in-out infinite",filter:`drop-shadow(0 0 16px ${C.orange})` }}>
                <circle cx="32" cy="32" r="30" fill={C.orange} opacity=".15" stroke={C.orange} strokeWidth="1.5"/>
                <circle cx="32" cy="32" r="22" fill="none" stroke={C.orange} strokeWidth=".5" opacity=".4"/>
                <text x="32" y="41" textAnchor="middle" fill={C.orange} fontSize="26" fontWeight="900" fontFamily="Arial,sans-serif">₿</text>
              </svg>
              {/* Orbit ring */}
              <div style={{ position:"absolute",inset:-8,borderRadius:"50%",border:`1px solid ${C.orange}22`,
                animation:"spin 8s linear infinite" }}/>
            </div>
            <div>
              <div style={{ fontSize:28,fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,
                letterSpacing:".08em",lineHeight:1,textShadow:`0 0 40px ${C.orange}66` }}>
                OP_NET <span style={{ color:C.orange }}>BTC</span> STAKING
              </div>
              <div style={{ display:"flex",alignItems:"center",gap:12,marginTop:6 }}>
                <span style={{ fontSize:10,letterSpacing:".2em",color:C.muted }}>DeFi · Bitcoin Layer 1</span>
                <span style={{ width:1,height:10,background:C.border,display:"inline-block" }}/>
                <span style={{ fontSize:10,color:C.green,letterSpacing:".15em",display:"flex",alignItems:"center",gap:4 }}>
                  <span style={{ width:5,height:5,borderRadius:"50%",background:C.green,display:"inline-block",
                    animation:"pulse 1.5s infinite" }}/>
                  LIVE ON BITCOIN
                </span>
                <span style={{ width:1,height:10,background:C.border,display:"inline-block" }}/>
                <span style={{ fontSize:10,color:`${C.orange}99`,letterSpacing:".1em" }}>MAINNET MARCH 17</span>
              </div>
            </div>
          </div>

          {/* Center — Nav */}
          <nav style={{ display:"flex",gap:4 }}>
            {[{label:"Dashboard",key:"dashboard"},{label:"How It Works",key:"how-it-works"},{label:"DAO",key:"dao"}].map(item=>(
              <button key={item.key} onClick={()=>onNav(item.key)} className="nav-btn" style={{ padding:"9px 18px",borderRadius:8,border:"none",
                background:page===item.key?`${C.orange}15`:"transparent",
                color:page===item.key?C.orange:C.muted,fontSize:12,fontWeight:700,cursor:"pointer",
                fontFamily:"'Orbitron',monospace",letterSpacing:".06em",
                borderBottom:page===item.key?`2px solid ${C.orange}`:"2px solid transparent" }}>{item.label}</button>
            ))}
          </nav>

          {/* Right — Block + Wallet */}
          <div style={{ display:"flex",alignItems:"center",gap:20 }}>
            {blockHeight && (
              <div style={{ textAlign:"right",background:C.bgDeep,border:`1px solid ${C.border}`,
                borderRadius:8,padding:"8px 14px" }}>
                <div style={{ fontSize:9,color:C.muted,letterSpacing:".15em" }}>BLOCK HEIGHT</div>
                <div style={{ fontSize:14,fontFamily:"'Orbitron',monospace",color:C.orange,fontWeight:700 }}>
                  #{blockHeight.toLocaleString()}
                </div>
              </div>
            )}
            <WalletButton wallet={wallet} connecting={connecting} error={error} onConnect={onConnect} onDisconnect={onDisconnect}/>
          </div>
        </div>
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
            <span style={{ position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",
              fontSize:14,color:C.orange,fontFamily:"'Orbitron',monospace",pointerEvents:"none" }}>₿</span>
            <input value={input} onChange={e=>setInput(e.target.value)} placeholder="0.00000000"
              type="number" min="0" step="0.00000001"
              style={{ width:"100%",padding:"12px 16px 12px 30px",background:C.bgDeep,
                border:`1px solid ${overBalance||underMin||overStaked?C.red:C.border}`,
                borderRadius:8,color:C.white,fontSize:13,fontFamily:"'Orbitron',monospace",outline:"none" }}/>
          </div>
          <button onClick={()=>setInput(tab==="stake" ? (btc>0?String(btc):"") : String(staked))}
            style={{ padding:"12px 14px",background:C.bgDeep,border:`1px solid ${C.border}`,
              borderRadius:8,color:C.orange,fontSize:12,cursor:"pointer" }}>MAX</button>
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
        <div style={{ display:"flex",gap:4,background:C.bgDeep,borderRadius:6,padding:3 }}>
          {[{key:"staked",label:"BTC"},{key:"score",label:"SCORE"}].map(opt=>(
            <button key={opt.key} onClick={()=>setSortBy(opt.key)} style={{ padding:"4px 10px",border:"none",
              borderRadius:4,background:sortBy===opt.key?"#1a1000":"transparent",
              color:sortBy===opt.key?C.orange:C.muted,fontSize:9,fontWeight:700,
              letterSpacing:".1em",cursor:"pointer",fontFamily:"'Orbitron',monospace" }}>{opt.label}</button>
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
  const steps = [
    { n:"01", title:"Connect Wallet", desc:"Link your OPWallet or compatible Bitcoin wallet to get started.", icon:"🔗" },
    { n:"02", title:"Stake OPNET",    desc:"Deposit OPNET tokens into the staking contract on Bitcoin L1.",  icon:"⚡" },
    { n:"03", title:"Earn Score",     desc:"Your Signal Score grows with stake amount × time multiplier.",    icon:"📈" },
    { n:"04", title:"Unlock Perks",   desc:"Reach higher tiers for reduced fees, APY boosts, and DAO access.", icon:"💎" },
  ];
  return (
    <div style={{ minHeight:"100vh",background:C.bg,fontFamily:"'Space Mono',monospace",
      backgroundImage:`radial-gradient(ellipse at 50% 0%,${C.orangeDim} 0%,transparent 50%)` }}>
      <Header page="how-it-works" onNav={d=>d==="back"||d==="dashboard"?onBack():onBack(d)}
        wallet={wallet} connecting={connecting} error={error}
        onConnect={onConnect} onDisconnect={onDisconnect} blockHeight={null}/>
      <div style={{ maxWidth:800,margin:"0 auto",padding:"60px 32px" }}>
        <div style={{ textAlign:"center",marginBottom:60 }}>
          <div style={{ fontSize:11,letterSpacing:".3em",color:C.orange,marginBottom:16 }}>GETTING STARTED</div>
          <h1 style={{ fontSize:"clamp(32px,5vw,56px)",fontWeight:900,fontFamily:"'Orbitron',monospace",color:C.white,lineHeight:1.1 }}>How It Works</h1>
          <p style={{ fontSize:14,color:C.muted,marginTop:16,lineHeight:1.8 }}>The OPNet Signal Protocol rewards committed, long-term Bitcoin DeFi participants.</p>
        </div>
        <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
          {steps.map((s,i)=>(
            <div key={s.n} style={{ display:"flex",gap:24,padding:28,background:`linear-gradient(135deg,${C.bgCard},${C.bgDeep})`,
              border:`1px solid ${C.border}`,borderRadius:16,animation:`fadeUp .5s ease ${i*.1}s both` }}>
              <div style={{ fontSize:36,flexShrink:0 }}>{s.icon}</div>
              <div>
                <div style={{ fontSize:11,letterSpacing:".2em",color:C.orange,marginBottom:6 }}>STEP {s.n}</div>
                <div style={{ fontSize:18,fontWeight:700,fontFamily:"'Orbitron',monospace",color:C.white,marginBottom:8 }}>{s.title}</div>
                <div style={{ fontSize:13,color:C.muted,lineHeight:1.8 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign:"center",marginTop:48 }}>
          <button onClick={()=>onBack()} style={{ padding:"16px 40px",border:"none",borderRadius:12,
            background:`linear-gradient(135deg,#e8820a,${C.orange})`,color:"#000",fontSize:14,
            fontWeight:900,fontFamily:"'Orbitron',monospace",cursor:"pointer",letterSpacing:".1em",
            boxShadow:`0 6px 30px ${C.orangeGlow}` }}>⚡ START STAKING</button>
        </div>
      </div>
    </div>
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
  const [stakeStartBlock, setSSB]   = useState(847_210);  // same as blockHeight → score = 0
  const [scoreDelta, setScoreDelta] = useState(null);
  const blockRef = useRef(847_210);

  const addTx = (type, amount, block, realHash) => {
    const hash = realHash || genTxHash();
    const tx = { hash, type, amount: parseFloat(amount), status: realHash ? "confirming" : "pending", submittedBlock: block, confirmedAt: null, real: !!realHash };
    setTxs(prev => [tx, ...prev.slice(0, 19)]);

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
        onConnect={connect} onDisconnect={disconnect} blockHeight={blockHeight}/>

      {wallet && (
        <div style={{ background:`linear-gradient(90deg,${C.bgDeep},#1a1000,${C.bgDeep})`,borderBottom:`1px solid ${C.orange}22`,
          padding:"8px 32px",display:"flex",alignItems:"center",gap:12,animation:"fadeUp .4s ease" }}>
          <span style={{ width:6,height:6,borderRadius:"50%",background:C.orange,boxShadow:`0 0 8px ${C.orange}`,display:"inline-block" }}/>
          <span style={{ fontSize:11,color:`${C.orange}99`,letterSpacing:".1em" }}>OP_WALLET CONNECTED — {wallet.address}</span>
          {wallet.balance!=="—" && <span style={{ fontSize:11,color:`${C.amber}88` }}>· {wallet.balance} BTC</span>}
        </div>
      )}

      {/* 3-col grid */}
      <div style={{ padding:"24px 32px",display:"grid",gridTemplateColumns:"1fr 1.6fr 1fr",gap:20,maxWidth:1400,margin:"0 auto" }}>

        {/* LEFT */}
        <div style={{ display:"flex",flexDirection:"column",gap:16,minWidth:0 }}>
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

          <StatCard label="Your Staked" value={<AnimatedNumber value={staked} decimals={8} suffix=" BTC"/>} sub={wallet?"Auto-compound ON":"Connect wallet to start"} accent={C.orange} showBtcIcon/>
          {wallet && <StatCard label="Pending Rewards" value={<AnimatedNumber value={pending} decimals={8} suffix=" BTC"/>} sub={staked>0?"Accruing every block":"Stake BTC to start earning"} accent={C.amber} showBtcIcon/>}
        </div>

        {/* CENTER */}
        <div style={{ display:"flex",flexDirection:"column",gap:16,minWidth:0 }}>
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
          <TopStakers userStaked={staked} userScore={score} userTier={tier} walletConnected={!!wallet}/>
          {/* Animated Network Panel */}
          <NetworkPanel blockHeight={blockHeight} tvl={tvl} apy={apy}/>
        </div>
      </div>

      {/* TX History */}
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
                  { label:"Explorer", href:"https://explorer.opnet.org" },
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
