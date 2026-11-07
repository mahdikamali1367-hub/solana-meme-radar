import {createServer} from 'node:http';

const PORT=Number(process.env.PORT||4173);
const RPC=process.env.SOLANA_RPC_URL||'https://api.mainnet.solana.com';
const CACHE_MS=55_000;
let cache={at:0,data:null};

const headers={
  'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'; object-src 'none'",
  'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer'
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

async function jfetch(url,opt={},timeout=10000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{...opt,signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.json()}finally{clearTimeout(t)}
}
async function rpc(method,params){
  return jfetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
}
async function discovery(){
  const urls=['https://api.dexscreener.com/token-profiles/latest/v1','https://api.dexscreener.com/token-boosts/latest/v1','https://api.dexscreener.com/token-boosts/top/v1'];
  const sets=await Promise.allSettled(urls.map(u=>jfetch(u)));
  const m=new Map();
  for(const s of sets)if(s.status==='fulfilled')for(const x of (Array.isArray(s.value)?s.value:[])){
    if(x.chainId!=='solana'||!x.tokenAddress)continue;
    m.set(x.tokenAddress,{mint:x.tokenAddress,description:x.description||'',image:x.icon||'',links:x.links||[]});
  }
  return [...m.values()].slice(0,30);
}
async function pairFor(mint){
  try{
    const rows=await jfetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    const arr=Array.isArray(rows)?rows:[];
    return arr.sort((a,b)=>num(b?.volume?.m5)-num(a?.volume?.m5))[0]||null;
  }catch{return null}
}
async function security(mint){
  let mintDisabled=null,freezeDisabled=null,top10=null,flags=[],score=50,coverage=0;
  try{
    const d=await rpc('getAccountInfo',[mint,{encoding:'jsonParsed',commitment:'confirmed'}]);
    const info=d?.result?.value?.data?.parsed?.info;
    if(info){
      mintDisabled=info.mintAuthority==null;freezeDisabled=info.freezeAuthority==null;coverage+=45;
      score+=(mintDisabled?15:-25)+(freezeDisabled?15:-25);
      if(!mintDisabled)flags.push('Mint authority فعال');
      if(!freezeDisabled)flags.push('Freeze authority فعال');
    }
  }catch{}
  try{
    const [la,sp]=await Promise.all([rpc('getTokenLargestAccounts',[mint,{commitment:'confirmed'}]),rpc('getTokenSupply',[mint,{commitment:'confirmed'}])]);
    const supply=num(sp?.result?.value?.uiAmount);
    if(supply>0){
      const vals=(la?.result?.value||[]).slice(0,10).map(x=>num(x.uiAmount));
      top10=vals.reduce((a,b)=>a+b,0)/supply*100;coverage+=35;
      if(top10<=25)score+=15;else if(top10>50){score-=25;flags.push('تمرکز Top10 بسیار بالا')}else if(top10>30){score-=12;flags.push('تمرکز Top10 بالا')}
    }
  }catch{}
  return {score:clamp(score),coverage,mintDisabled,freezeDisabled,top10,flags};
}
function verdict(t){
  const bad=t.security.flags.length>0||t.security.score<55||t.liquidity<3000;
  const early=t.ageMinutes<=15&&t.marketCap>=12000&&t.marketCap<=200000&&t.volume5m>=3000&&t.txns5m>=30;
  const strong=early&&!bad&&t.security.score>=75&&t.buys5m>t.sells5m;
  return strong?'STRONG WATCH':bad?'SKIP':'WATCH';
}
async function build(){
  if(cache.data&&Date.now()-cache.at<CACHE_MS)return cache.data;
  const seeds=await discovery();
  const out=[];
  for(const s of seeds.slice(0,18)){
    const p=await pairFor(s.mint); if(!p)continue;
    const created=num(p.pairCreatedAt);
    const ageMinutes=created?Math.max(0,(Date.now()-created)/60000):9999;
    if(ageMinutes>180)continue;
    const sec=await security(s.mint);
    const buys5m=num(p.txns?.m5?.buys),sells5m=num(p.txns?.m5?.sells);
    const t={
      name:p.baseToken?.name||'Unknown',symbol:p.baseToken?.symbol||'?',mint:s.mint,
      dexId:p.dexId||'',dexUrl:p.url||'',image:p.info?.imageUrl||s.image||'',description:s.description,
      ageMinutes:+ageMinutes.toFixed(1),priceUsd:num(p.priceUsd),marketCap:num(p.marketCap||p.fdv),
      liquidity:num(p.liquidity?.usd),volume5m:num(p.volume?.m5),volume1h:num(p.volume?.h1),
      buys5m,sells5m,txns5m:buys5m+sells5m,priceChange5m:num(p.priceChange?.m5),security:sec
    };
    t.verdict=verdict(t); out.push(t); await sleep(70);
  }
  const rank={'STRONG WATCH':3,'WATCH':2,'SKIP':1};
  out.sort((a,b)=>(rank[b.verdict]-rank[a.verdict])||(b.volume5m-a.volume5m));
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:60,count:out.length,tokens:out,
    disclaimer:'این ابزار فقط برای تحقیق است و هیچ توکنی را بدون ریسک یا تضمین‌شده اعلام نمی‌کند.'};
  cache={at:Date.now(),data};return data;
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=()=>`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Solana Meme Radar</title><style>
*{box-sizing:border-box}body{margin:0;background:#07101f;color:#edf4ff;font-family:Tahoma,Arial,sans-serif}.wrap{max-width:1450px;margin:auto;padding:22px}
h1{margin:0;font-size:30px}.sub{color:#91a4c4;margin:8px 0 18px}.bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
button,input,select{background:#101c31;color:#fff;border:1px solid #29415f;border-radius:10px;padding:10px 12px}button{cursor:pointer}
.badge{padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700}.strong{background:#123d2d;color:#63f5ae}.watch{background:#413515;color:#ffd75e}.skip{background:#421b24;color:#ff8496}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}.card{background:#0d1729;border:1px solid #223652;border-radius:16px;padding:15px}
.top{display:flex;justify-content:space-between;gap:10px;align-items:center}.name{font-size:18px;font-weight:800}.mint{font-family:monospace;color:#87a4cb;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px}.stat{background:#091321;border-radius:10px;padding:9px}.k{font-size:11px;color:#8294b0}.v{font-weight:700;margin-top:3px}
.flags{margin-top:10px;color:#ff9bad;font-size:12px}.safe{color:#75efad}.links a{color:#7fc2ff;text-decoration:none;margin-left:10px;font-size:12px}
#status{color:#9db0cc}.warn{background:#271b0d;border:1px solid #5d4120;padding:10px;border-radius:10px;color:#ffd087;margin-bottom:14px}
@media(max-width:600px){.stats{grid-template-columns:1fr 1fr}.wrap{padding:12px}}
</style></head><body><div class="wrap"><h1>🚀 Solana Meme Radar</h1><div class="sub">رادار زنده میم‌کوین‌های تازه Solana — بروزرسانی خودکار هر ۶۰ ثانیه</div>
<div class="warn">هیچ امتیاز امنیتی تضمین نمی‌کند یک توکن کلاه‌برداری نیست. قبل از خرید مستقل بررسی کن.</div>
<div class="bar"><button onclick="load()">↻ بروزرسانی</button><input id="q" placeholder="جستجو نام / ticker / CA" oninput="render()"><select id="vf" onchange="render()"><option value="">همه</option><option>STRONG WATCH</option><option>WATCH</option><option>SKIP</option></select><span id="status">در حال بارگذاری...</span></div>
<div id="grid" class="grid"></div></div><script>
let data=[];
const money=n=>'$'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0});
const pct=n=>n==null?'نامشخص':Number(n).toFixed(1)+'%';
async function load(){status.textContent='در حال دریافت داده زنده...';try{const r=await fetch('/api/v1/tokens');const d=await r.json();data=d.tokens||[];status.textContent='آخرین بروزرسانی: '+new Date(d.generatedAt).toLocaleTimeString('fa-IR')+' | '+data.length+' توکن';render()}catch(e){status.textContent='خطا در دریافت داده';}}
function render(){const q=document.querySelector('#q').value.toLowerCase(),v=document.querySelector('#vf').value;const rows=data.filter(t=>(!v||t.verdict===v)&&(!q||[t.name,t.symbol,t.mint].join(' ').toLowerCase().includes(q)));grid.innerHTML=rows.map(t=>{
 const cls=t.verdict==='STRONG WATCH'?'strong':t.verdict==='SKIP'?'skip':'watch';
 const fl=t.security.flags?.length?t.security.flags.join(' • '):'ریسک authority واضح دیده نشد';
 return '<div class="card"><div class="top"><div><div class="name">'+esc(t.name)+' <small>$'+esc(t.symbol)+'</small></div><div class="mint" title="'+esc(t.mint)+'">'+esc(t.mint)+'</div></div><span class="badge '+cls+'">'+t.verdict+'</span></div>'+
 '<div class="stats"><div class="stat"><div class="k">Age</div><div class="v">'+t.ageMinutes+'m</div></div><div class="stat"><div class="k">Market Cap</div><div class="v">'+money(t.marketCap)+'</div></div><div class="stat"><div class="k">Liquidity</div><div class="v">'+money(t.liquidity)+'</div></div>'+
 '<div class="stat"><div class="k">Volume 5m</div><div class="v">'+money(t.volume5m)+'</div></div><div class="stat"><div class="k">Txns 5m</div><div class="v">'+t.txns5m+' ('+t.buys5m+'B/'+t.sells5m+'S)</div></div><div class="stat"><div class="k">Security</div><div class="v">'+t.security.score+'/100</div></div>'+
 '<div class="stat"><div class="k">Top10</div><div class="v">'+pct(t.security.top10)+'</div></div><div class="stat"><div class="k">Mint</div><div class="v '+(t.security.mintDisabled?'safe':'')+'">'+(t.security.mintDisabled===true?'Disabled':t.security.mintDisabled===false?'ACTIVE':'?')+'</div></div><div class="stat"><div class="k">Freeze</div><div class="v '+(t.security.freezeDisabled?'safe':'')+'">'+(t.security.freezeDisabled===true?'Disabled':t.security.freezeDisabled===false?'ACTIVE':'?')+'</div></div></div>'+
 '<div class="flags">'+esc(fl)+'</div><div class="links" style="margin-top:10px"><a target="_blank" rel="noopener" href="'+esc(t.dexUrl)+'">DEX Screener</a><a target="_blank" rel="noopener" href="https://solscan.io/token/'+esc(t.mint)+'">Solscan</a></div></div>'}).join('')||'<p>موردی با فیلتر فعلی نیست.</p>'}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
load();setInterval(load,60000);
</script></body></html>`;

createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(url.pathname==='/api/health'){res.writeHead(200,{'content-type':'application/json',...headers});return res.end(JSON.stringify({ok:true,time:new Date().toISOString()}))}
    if(url.pathname==='/api/v1/tokens'||url.pathname==='/api/radar'){
      const d=await build();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(d));
    }
    if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',...headers});return res.end(html())}
    res.writeHead(404,headers);res.end('Not found');
  }catch(e){res.writeHead(502,{'content-type':'application/json',...headers});res.end(JSON.stringify({ok:false,error:String(e?.message||e)}))}
}).listen(PORT,'0.0.0.0',()=>console.log('Solana Meme Radar live on '+PORT));
