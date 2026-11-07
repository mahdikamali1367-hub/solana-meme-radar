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
  sets.forEach((s,idx)=>{
    if(s.status!=='fulfilled')return;
    for(const x of (Array.isArray(s.value)?s.value:[])){
      if(x.chainId!=='solana'||!x.tokenAddress)continue;
      const old=m.get(x.tokenAddress)||{mint:x.tokenAddress,description:'',image:'',links:[],boostAmount:0,boostTotal:0,boostSeen:false,profileSeen:false};
      old.description=x.description||old.description;
      old.image=x.icon||old.image;
      old.links=Array.isArray(x.links)&&x.links.length?x.links:old.links;
      if(idx===0)old.profileSeen=true;
      else {old.boostSeen=true;old.boostAmount=Math.max(old.boostAmount,num(x.amount));old.boostTotal=Math.max(old.boostTotal,num(x.totalAmount));}
      m.set(x.tokenAddress,old);
    }
  });
  return [...m.values()].slice(0,45);
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
function socialMeta(seed,pair){
  const links=[...(seed.links||[]),...(pair?.info?.socials||[]),...(pair?.info?.websites||[])];
  const raw=links.map(x=>({type:String(x?.type||x?.label||'').toLowerCase(),url:String(x?.url||'')})).filter(x=>x.url);
  const seen=new Set();
  const sources=[];
  const add=(name,url)=>{const k=name+'|'+url;if(seen.has(k))return;seen.add(k);sources.push({name,url})};
  for(const x of raw){
    const u=x.url.toLowerCase();
    if(u.includes('x.com')||u.includes('twitter.com')||x.type.includes('twitter'))add('X',x.url);
    else if(u.includes('t.me')||u.includes('telegram'))add('Telegram',x.url);
    else if(u.includes('youtube.com')||u.includes('youtu.be'))add('YouTube',x.url);
    else if(u.includes('instagram.com'))add('Instagram',x.url);
    else if(u.includes('tiktok.com'))add('TikTok',x.url);
    else if(u.includes('reddit.com'))add('Reddit',x.url);
    else if(u.includes('bsky.app')||u.includes('bluesky'))add('Bluesky',x.url);
    else add('Website',x.url);
  }
  return sources;
}
function trendScore(t,seed){
  const sources=t.socialSources||[];
  const socialNames=new Set(sources.map(x=>x.name));
  let score=0; const reasons=[];
  const volumeRatio=t.liquidity>0?t.volume5m/t.liquidity:0;
  if(t.volume5m>=5000){score+=18;reasons.push('حجم 5m قوی')}else if(t.volume5m>=2000)score+=10;
  if(t.txns5m>=80){score+=15;reasons.push('تراکنش 5m بالا')}else if(t.txns5m>=30)score+=8;
  if(t.buys5m>t.sells5m*1.3){score+=12;reasons.push('فشار خرید')}else if(t.buys5m>t.sells5m)score+=6;
  if(t.priceChange5m>=15){score+=10;reasons.push('مومنتوم قیمت')}else if(t.priceChange5m>=5)score+=5;
  if(volumeRatio>=0.7){score+=8;reasons.push('گردش حجم بالا نسبت به نقدینگی')}else if(volumeRatio>=0.3)score+=4;
  if(seed.boostSeen){score+=Math.min(16,4+Math.log10(1+seed.boostTotal)*4);reasons.push('DEX Boost فعال')}
  const socialCount=[...socialNames].filter(x=>x!=='Website').length;
  score+=Math.min(12,socialCount*3);
  if(socialCount>=2)reasons.push(`${socialCount} شبکه اجتماعی لینک‌شده`);
  if(socialNames.has('X'))score+=3;
  if(socialNames.has('Telegram'))score+=2;
  if(socialNames.has('YouTube')||socialNames.has('Instagram')||socialNames.has('TikTok'))score+=2;
  if(seed.profileSeen)score+=3;
  if(t.ageMinutes<=10)score+=6;
  else if(t.ageMinutes<=30)score+=3;
  return {score:clamp(Math.round(score)),reasons,boostAmount:seed.boostAmount,boostTotal:seed.boostTotal,socialCount,sources:[...socialNames]};
}
function verdict(t){
  const bad=t.security.flags.length>0||t.security.score<55||t.liquidity<3000;
  const early=t.ageMinutes<=20&&t.marketCap>=12000&&t.marketCap<=250000&&t.volume5m>=2500&&t.txns5m>=25;
  const strong=early&&!bad&&t.security.score>=70&&t.trend.score>=55&&t.buys5m>t.sells5m;
  return strong?'STRONG WATCH':bad?'SKIP':t.trend.score>=35?'WATCH':'LOW SIGNAL';
}
async function build(){
  if(cache.data&&Date.now()-cache.at<CACHE_MS)return cache.data;
  const seeds=await discovery();
  const out=[];
  for(const s of seeds.slice(0,25)){
    const p=await pairFor(s.mint); if(!p)continue;
    const created=num(p.pairCreatedAt);
    const ageMinutes=created?Math.max(0,(Date.now()-created)/60000):9999;
    if(ageMinutes>240)continue;
    const sec=await security(s.mint);
    const buys5m=num(p.txns?.m5?.buys),sells5m=num(p.txns?.m5?.sells);
    const t={
      name:p.baseToken?.name||'Unknown',symbol:p.baseToken?.symbol||'?',mint:s.mint,
      dexId:p.dexId||'',dexUrl:p.url||'',image:p.info?.imageUrl||s.image||'',description:s.description,
      ageMinutes:+ageMinutes.toFixed(1),priceUsd:num(p.priceUsd),marketCap:num(p.marketCap||p.fdv),
      liquidity:num(p.liquidity?.usd),volume5m:num(p.volume?.m5),volume1h:num(p.volume?.h1),
      buys5m,sells5m,txns5m:buys5m+sells5m,priceChange5m:num(p.priceChange?.m5),security:sec
    };
    t.socialSources=socialMeta(s,p);
    t.trend=trendScore(t,s);
    t.verdict=verdict(t); out.push(t); await sleep(55);
  }
  const rank={'STRONG WATCH':4,'WATCH':3,'LOW SIGNAL':2,'SKIP':1};
  out.sort((a,b)=>(rank[b.verdict]-rank[a.verdict])||(b.trend.score-a.trend.score)||(b.volume5m-a.volume5m));
  const strong=out.filter(x=>x.verdict==='STRONG WATCH').length;
  const trending=out.filter(x=>x.trend.score>=50).length;
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:60,count:out.length,strong,trending,tokens:out,
    sourceStatus:{dexscreener:'live',solanaRpc:'live',x:process.env.X_BEARER_TOKEN?'configured':'needs API key',youtube:process.env.YOUTUBE_API_KEY?'configured':'needs API key',reddit:process.env.REDDIT_CLIENT_ID?'configured':'needs OAuth',instagram:process.env.INSTAGRAM_SOCIAL_TOKEN?'configured':'needs API access',tiktok:process.env.TIKTOK_RESEARCH_TOKEN?'configured':'needs research access'},
    disclaimer:'Social Trend Score فعلاً از سیگنال‌های زنده DEX، Boost، لینک‌های اجتماعی و مومنتوم بازار ساخته می‌شود. نبود API شبکه اجتماعی به معنی نبود ترند نیست. هیچ توکنی بدون ریسک یا تضمین‌شده نیست.'};
  cache={at:Date.now(),data};return data;
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=()=>`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Solana Meme Radar</title><style>
*{box-sizing:border-box}body{margin:0;background:#07101f;color:#edf4ff;font-family:Tahoma,Arial,sans-serif}.wrap{max-width:1500px;margin:auto;padding:22px}
h1{margin:0;font-size:30px}.sub{color:#91a4c4;margin:8px 0 18px}.bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center}
button,input,select{background:#101c31;color:#fff;border:1px solid #29415f;border-radius:10px;padding:10px 12px}button{cursor:pointer}
.badge{padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700}.strong{background:#123d2d;color:#63f5ae}.watch{background:#413515;color:#ffd75e}.low{background:#172c46;color:#9cc8ff}.skip{background:#421b24;color:#ff8496}
.summary{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:10px;margin-bottom:14px}.sum{background:#0d1729;border:1px solid #223652;border-radius:14px;padding:13px}.sum .big{font-size:24px;font-weight:800}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:12px}.card{background:#0d1729;border:1px solid #223652;border-radius:16px;padding:15px}
.top{display:flex;justify-content:space-between;gap:10px;align-items:center}.name{font-size:18px;font-weight:800}.mint{font-family:monospace;color:#87a4cb;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.stat{background:#091321;border-radius:10px;padding:9px}.k{font-size:11px;color:#8294b0}.v{font-weight:700;margin-top:3px}
.score{height:7px;background:#15243a;border-radius:10px;overflow:hidden;margin-top:5px}.fill{height:100%;background:linear-gradient(90deg,#4ea5ff,#70f0ae)}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.chip{font-size:11px;background:#15243a;border:1px solid #2a4568;padding:4px 7px;border-radius:999px;color:#b8d1f4}
.flags{margin-top:10px;color:#ff9bad;font-size:12px}.safe{color:#75efad}.links a{color:#7fc2ff;text-decoration:none;margin-left:10px;font-size:12px}
#status{color:#9db0cc}.warn{background:#271b0d;border:1px solid #5d4120;padding:10px;border-radius:10px;color:#ffd087;margin-bottom:14px}.sources{font-size:11px;color:#8fa3c2;margin-bottom:15px}
@media(max-width:650px){.stats{grid-template-columns:1fr 1fr}.summary{grid-template-columns:1fr 1fr}.wrap{padding:12px}}
</style></head><body><div class="wrap"><h1>🚀 Solana Meme Radar</h1><div class="sub">رادار زنده + Social Trend Score — بروزرسانی خودکار هر ۶۰ ثانیه</div>
<div class="warn">امتیاز ترند یا امنیت تضمین سود یا سالم‌بودن توکن نیست. برای توکن‌های تازه ریسک از دست‌رفتن کل سرمایه وجود دارد.</div>
<div class="summary"><div class="sum"><div class="k">توکن‌های دیده‌شده</div><div class="big" id="sCount">–</div></div><div class="sum"><div class="k">ترند Score≥50</div><div class="big" id="sTrend">–</div></div><div class="sum"><div class="k">Strong Watch</div><div class="big" id="sStrong">–</div></div><div class="sum"><div class="k">Refresh</div><div class="big">60s</div></div></div>
<div id="sources" class="sources"></div>
<div class="bar"><button onclick="load()">↻ بروزرسانی</button><input id="q" placeholder="جستجو نام / ticker / CA" oninput="render()"><select id="vf" onchange="render()"><option value="">همه وضعیت‌ها</option><option>STRONG WATCH</option><option>WATCH</option><option>LOW SIGNAL</option><option>SKIP</option></select><select id="sf" onchange="render()"><option value="0">همه امتیازهای ترند</option><option value="50">Trend ≥ 50</option><option value="70">Trend ≥ 70</option></select><span id="status">در حال بارگذاری...</span></div>
<div id="grid" class="grid"></div></div><script>
let data=[]; const $=s=>document.querySelector(s);
const money=n=>'$'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0});
const pct=n=>n==null?'نامشخص':Number(n).toFixed(1)+'%';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){status.textContent='در حال دریافت داده زنده...';try{const r=await fetch('/api/v1/tokens');const d=await r.json();data=d.tokens||[];status.textContent='آخرین بروزرسانی: '+new Date(d.generatedAt).toLocaleTimeString('fa-IR');sCount.textContent=d.count||0;sTrend.textContent=d.trending||0;sStrong.textContent=d.strong||0;sources.textContent='منابع: '+Object.entries(d.sourceStatus||{}).map(([k,v])=>k+'='+v).join(' | ');render()}catch(e){status.textContent='خطا در دریافت داده';}}
function render(){const q=$('#q').value.toLowerCase(),v=$('#vf').value,min=Number($('#sf').value||0);const rows=data.filter(t=>(!v||t.verdict===v)&&t.trend.score>=min&&(!q||[t.name,t.symbol,t.mint].join(' ').toLowerCase().includes(q)));grid.innerHTML=rows.map(t=>{
 const cls=t.verdict==='STRONG WATCH'?'strong':t.verdict==='SKIP'?'skip':t.verdict==='LOW SIGNAL'?'low':'watch';
 const fl=t.security.flags?.length?t.security.flags.join(' • '):'ریسک authority واضح دیده نشد';
 const chips=(t.trend.sources||[]).map(x=>'<span class="chip">'+esc(x)+'</span>').join('')||'<span class="chip">بدون لینک اجتماعی معتبر</span>';
 const rs=(t.trend.reasons||[]).slice(0,4).map(x=>'<span class="chip">'+esc(x)+'</span>').join('');
 return '<div class="card"><div class="top"><div><div class="name">'+esc(t.name)+' <small>$'+esc(t.symbol)+'</small></div><div class="mint" title="'+esc(t.mint)+'">'+esc(t.mint)+'</div></div><span class="badge '+cls+'">'+t.verdict+'</span></div>'+
 '<div class="stats"><div class="stat"><div class="k">Age</div><div class="v">'+t.ageMinutes+'m</div></div><div class="stat"><div class="k">Market Cap</div><div class="v">'+money(t.marketCap)+'</div></div><div class="stat"><div class="k">Liquidity</div><div class="v">'+money(t.liquidity)+'</div></div>'+
 '<div class="stat"><div class="k">Volume 5m</div><div class="v">'+money(t.volume5m)+'</div></div><div class="stat"><div class="k">Txns 5m</div><div class="v">'+t.txns5m+' ('+t.buys5m+'B/'+t.sells5m+'S)</div></div><div class="stat"><div class="k">Security</div><div class="v">'+t.security.score+'/100</div></div>'+
 '<div class="stat"><div class="k">Social Trend</div><div class="v">'+t.trend.score+'/100</div><div class="score"><div class="fill" style="width:'+t.trend.score+'%"></div></div></div><div class="stat"><div class="k">Top10</div><div class="v">'+pct(t.security.top10)+'</div></div><div class="stat"><div class="k">5m Δ</div><div class="v">'+Number(t.priceChange5m||0).toFixed(1)+'%</div></div></div>'+
 '<div class="chips">'+chips+'</div><div class="chips">'+rs+'</div><div class="flags">'+esc(fl)+'</div><div class="links" style="margin-top:10px"><a target="_blank" rel="noopener" href="'+esc(t.dexUrl)+'">DEX Screener</a><a target="_blank" rel="noopener" href="https://solscan.io/token/'+esc(t.mint)+'">Solscan</a></div></div>'}).join('')||'<p>موردی با فیلتر فعلی نیست.</p>'}
load();setInterval(load,60000);
</script></body></html>`;

createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(url.pathname==='/api/health'){res.writeHead(200,{'content-type':'application/json',...headers});return res.end(JSON.stringify({ok:true,time:new Date().toISOString()}))}
    if(url.pathname==='/api/v1/tokens'||url.pathname==='/api/radar'||url.pathname==='/api/v1/trending'){
      const d=await build(); let body=d;
      if(url.pathname==='/api/v1/trending')body={...d,tokens:[...d.tokens].sort((a,b)=>b.trend.score-a.trend.score)};
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(body));
    }
    if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',...headers});return res.end(html())}
    res.writeHead(404,headers);res.end('Not found');
  }catch(e){res.writeHead(502,{'content-type':'application/json',...headers});res.end(JSON.stringify({ok:false,error:String(e?.message||e)}))}
}).listen(PORT,'0.0.0.0',()=>console.log('Solana Meme Radar v3 live on '+PORT));
