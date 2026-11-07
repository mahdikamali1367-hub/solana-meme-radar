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
  let mintDisabled=null,freezeDisabled=null,top5=null,top10=null,largestHolder=null,holderGrade='UNKNOWN',flags=[],score=50,coverage=0,topHolders=[];
  try{
    const d=await rpc('getAccountInfo',[mint,{encoding:'jsonParsed',commitment:'confirmed'}]);
    const info=d?.result?.value?.data?.parsed?.info;
    if(info){
      mintDisabled=info.mintAuthority==null;
      freezeDisabled=info.freezeAuthority==null;
      coverage+=45;
      score+=(mintDisabled?15:-30)+(freezeDisabled?15:-25);
      if(!mintDisabled)flags.push('Mint authority فعال');
      if(!freezeDisabled)flags.push('Freeze authority فعال');
    }
  }catch{}
  try{
    const [la,sp]=await Promise.all([
      rpc('getTokenLargestAccounts',[mint,{commitment:'confirmed'}]),
      rpc('getTokenSupply',[mint,{commitment:'confirmed'}])
    ]);
    const supply=num(sp?.result?.value?.uiAmount);
    const rows=(la?.result?.value||[]).slice(0,10);
    if(supply>0&&rows.length){
      let parsed=[];
      try{
        const ma=await rpc('getMultipleAccounts',[rows.map(x=>x.address),{encoding:'jsonParsed',commitment:'confirmed'}]);
        parsed=ma?.result?.value||[];
      }catch{}
      const owners=new Map();
      rows.forEach((x,i)=>{
        const amount=num(x.uiAmount);
        const owner=parsed?.[i]?.data?.parsed?.info?.owner||x.address;
        owners.set(owner,(owners.get(owner)||0)+amount);
      });
      topHolders=[...owners.entries()]
        .map(([owner,amount])=>({owner,amount,pct:amount/supply*100}))
        .sort((a,b)=>b.pct-a.pct)
        .slice(0,10);
      largestHolder=topHolders[0]?.pct??null;
      top5=topHolders.slice(0,5).reduce((a,b)=>a+b.pct,0);
      top10=topHolders.slice(0,10).reduce((a,b)=>a+b.pct,0);
      coverage+=35;
      if(top10>=10&&top10<=15&&largestHolder<=2.5&&top5<=8){holderGrade='A';score+=20}
      else if(top10>=10&&top10<=20&&largestHolder<=4&&top5<=12){holderGrade='B';score+=12}
      else if(top10>=10&&top10<=20&&largestHolder<=5&&top5<=15){holderGrade='C';score+=2}
      else {holderGrade='F';score-=35}
      if(top10<10)flags.push('Top10 کمتر از بازه هدف 10% است');
      if(top10>20)flags.push('Top10 بیشتر از 20% است');
      if(largestHolder>5)flags.push('یک مالک بیش از 5% عرضه دارد');
      if(top5>15)flags.push('تمرکز Top5 بالاست');
    }
  }catch{}
  const holderPolicyPassed=['A','B','C'].includes(holderGrade);
  const holderStrong=['A','B'].includes(holderGrade);
  if(top10==null){holderGrade='UNKNOWN';flags.push('داده هولدرها نامشخص')}
  return {score:clamp(score),coverage,mintDisabled,freezeDisabled,top5,top10,largestHolder,holderGrade,holderPolicyPassed,holderStrong,topHolders,flags};
}

async function blueskySignal(t){
  const queries=[t.mint];
  if(t.symbol && String(t.symbol).length>=3)queries.push(`${t.symbol} solana`);
  let posts=[];
  for(const q of queries){
    try{
      const d=await jfetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=20&sort=latest`,{},8000);
      posts=Array.isArray(d?.posts)?d.posts:[];
      if(posts.length)break;
    }catch{}
  }
  const cutoff=Date.now()-2*60*60*1000;
  const recent=posts.filter(p=>{
    const ts=Date.parse(p?.record?.createdAt||p?.indexedAt||'');
    return Number.isFinite(ts)&&ts>=cutoff;
  });
  let engagement=0;
  for(const p of recent)engagement+=num(p.likeCount)+num(p.repostCount)*2+num(p.replyCount)+num(p.quoteCount)*2;
  return {mentions2h:recent.length,engagement2h:engagement};
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
function activityScore(t){
  const tx=t.txns5m||0;
  const buys=t.buys5m||0, sells=t.sells5m||0;
  const avgTrade=tx>0?t.volume5m/tx:0;
  const txPerMin=tx/5;
  const volumeLiquidity=t.liquidity>0?t.volume5m/t.liquidity:0;
  const small=Math.max(1,Math.min(buys||1,sells||1));
  const large=Math.max(buys,sells);
  const sideRatio=large/small;
  let score=70;
  const flags=[];
  let confidence=tx>=80?'MEDIUM':tx>=30?'LOW-MEDIUM':'LOW';

  if(tx<20){score-=20;flags.push('نمونه تراکنش کم')}
  if(txPerMin>80){score-=28;flags.push('نرخ تراکنش بسیار بالا')}
  else if(txPerMin>45){score-=14;flags.push('نرخ تراکنش غیرعادی')}

  if(avgTrade>0&&avgTrade<8&&tx>=60){score-=25;flags.push('تراکنش‌های بسیار ریز و پرتکرار')}
  else if(avgTrade>0&&avgTrade<20&&tx>=100){score-=12;flags.push('میانگین معامله خیلی کوچک')}

  if(sideRatio>10&&tx>=30){score-=18;flags.push('عدم تعادل شدید Buy/Sell')}
  else if(sideRatio>5&&tx>=40){score-=10;flags.push('عدم تعادل Buy/Sell')}

  if(volumeLiquidity>3){score-=20;flags.push('گردش حجم بسیار بالا نسبت به نقدینگی')}
  else if(volumeLiquidity>1.5){score-=10;flags.push('گردش حجم غیرعادی')}

  if(Math.abs(t.priceChange5m||0)<2&&volumeLiquidity>1.2&&tx>=70){
    score-=18;flags.push('حجم/تراکنش بالا با تغییر قیمت ناچیز؛ الگوی wash محتمل');
  }

  if(tx>=30&&sideRatio<=2.2&&avgTrade>=20&&avgTrade<=5000&&volumeLiquidity<=1.5){
    score+=12;
  }
  if(tx>=60&&sideRatio<=1.8)score+=6;

  score=clamp(Math.round(score));
  const label=score>=72?'PROBABLE ORGANIC':score>=50?'MIXED':'BOT RISK';
  return {score,label,confidence,flags,avgTrade,txPerMin,sideRatio,volumeLiquidity};
}

function assessSecurity(t){
  const s=t.security;
  const coreOk=s.mintDisabled===true&&s.freezeDisabled===true&&s.holderPolicyPassed;
  const organicOk=t.activity&&t.activity.score>=72&&t.activity.label==='PROBABLE ORGANIC';
  const organicHigh=t.activity&&t.activity.score>=58&&t.activity.label!=='BOT RISK';
  const maxOk=coreOk&&organicOk&&s.holderStrong&&s.score>=85&&t.liquidity>=10000&&s.largestHolder<=4&&s.top5<=12&&s.top10<=20;
  const highOk=coreOk&&organicHigh&&s.score>=75&&t.liquidity>=5000;
  const tier=maxOk?'MAX SECURITY':highOk?'HIGH':coreOk&&s.score>=60?'REVIEW':'REJECT';
  return {tier,maxOk,highOk};
}
function verdict(t){
  const sec=assessSecurity(t);
  t.security.tier=sec.tier;
  const early=t.ageMinutes<=20&&t.marketCap>=12000&&t.marketCap<=250000&&t.volume5m>=5000&&t.txns5m>=50;
  const strong=early&&sec.maxOk&&t.trend.score>=55&&t.buys5m>t.sells5m;
  if(strong)return 'STRONG WATCH';
  if(sec.tier==='REJECT')return 'SKIP';
  if(sec.tier==='MAX SECURITY'||sec.tier==='HIGH')return t.trend.score>=35?'WATCH':'LOW SIGNAL';
  return 'REVIEW';
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
    t.bluesky={mentions2h:0,engagement2h:0};
    t.activity=activityScore(t);
    t.trend=trendScore(t,s);
    t.verdict=verdict(t); out.push(t); await sleep(55);
  }
  const pre=[...out].sort((a,b)=>b.trend.score-a.trend.score).slice(0,10);
  for(const t of pre){
    const b=await blueskySignal(t); t.bluesky=b;
    if(b.mentions2h>0){
      t.trend.score=clamp(t.trend.score+Math.min(18,b.mentions2h*3)+Math.min(10,Math.log10(1+b.engagement2h)*4));
      t.trend.reasons.push(`Bluesky: ${b.mentions2h} mention / 2h`);
      if(!t.trend.sources.includes('Bluesky'))t.trend.sources.push('Bluesky');
    }
    t.verdict=verdict(t);
  }
  const rank={'STRONG WATCH':4,'WATCH':3,'LOW SIGNAL':2,'SKIP':1};
  out.sort((a,b)=>(rank[b.verdict]-rank[a.verdict])||(b.trend.score-a.trend.score)||(b.volume5m-a.volume5m));
  const strong=out.filter(x=>x.verdict==='STRONG WATCH').length;
  const trending=out.filter(x=>x.trend.score>=50).length;
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:60,count:out.length,strong,trending,tokens:out,
    sourceStatus:{dexscreener:'live',solanaRpc:'live',bluesky:'live-public',x:process.env.X_BEARER_TOKEN?'configured':'needs API key',youtube:process.env.YOUTUBE_API_KEY?'configured':'needs API key',reddit:process.env.REDDIT_CLIENT_ID?'configured':'needs OAuth',instagram:process.env.INSTAGRAM_SOCIAL_TOKEN?'configured':'needs API access',tiktok:process.env.TIKTOK_RESEARCH_TOKEN?'configured':'needs research access'},
    holderPolicy:{top10TargetPct:{min:10,max:20},gradeA:{largestMaxPct:2.5,top5MaxPct:8,top10RangePct:[10,15]},gradeB:{largestMaxPct:4,top5MaxPct:12,top10RangePct:[10,20]},gradeC:{largestMaxPct:5,top5MaxPct:15,top10RangePct:[10,20]},hardFail:{largestAbovePct:5,top5AbovePct:15,top10OutsidePct:[10,20]},unknownFailsStrong:true},
    activityPolicy:{probableOrganicMin:72,highSecurityMin:58,method:'aggregate heuristics; not proof of human identity'},
    disclaimer:'فیلتر هولدر هدف می‌گیرد که مجموع Top10 بین 10% تا 20% باشد؛ خارج این بازه رد می‌شود. Organic Activity یک تخمین ضدربات/ضدواش است و انسان‌بودن واقعی را اثبات نمی‌کند. MAX SECURITY نیازمند PROBABLE ORGANIC، Mint/Freeze غیرفعال، Holder Grade A/B، Security>=85 و Liquidity>=10K است. هیچ فیلتر آن‌چین کلاهبرداری را 100% رد نمی‌کند.'};
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
.flags{margin-top:10px;color:#ff9bad;font-size:12px}.safe{color:#75efad}.links a{color:#7fc2ff;text-decoration:none;margin-left:10px;font-size:12px}.holders{margin-top:10px;background:#091321;border-radius:10px;padding:9px}.holder{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #16253a;font-size:11px}.holder:last-child{border-bottom:0}.holder a{color:#8ec7ff;text-decoration:none;font-family:monospace}.secmax{color:#72f5b1}.sechigh{color:#9bd3ff}.secreview{color:#ffd675}.secreject{color:#ff8a9d}details{margin-top:10px}summary{cursor:pointer;color:#a8bad4}
#status{color:#9db0cc}.warn{background:#271b0d;border:1px solid #5d4120;padding:10px;border-radius:10px;color:#ffd087;margin-bottom:14px}.sources{font-size:11px;color:#8fa3c2;margin-bottom:15px}
@media(max-width:650px){.stats{grid-template-columns:1fr 1fr}.summary{grid-template-columns:1fr 1fr}.wrap{padding:12px}}
</style></head><body><div class="wrap"><h1>🚀 Solana Meme Radar</h1><div class="sub">رادار زنده + Social Trend Score — بروزرسانی خودکار هر ۶۰ ثانیه</div>
<div class="warn">فیلتر امنیت + ضدربات فعال است. مجموع Top10 باید بین ۱۰٪ تا ۲۰٪ باشد؛ بزرگ‌ترین هولدر و Top5 هم سقف جداگانه دارند. MAX SECURITY فقط با فعالیت PROBABLE ORGANIC و شرایط امنیتی کامل داده می‌شود.</div>
<div class="summary"><div class="sum"><div class="k">توکن‌های دیده‌شده</div><div class="big" id="sCount">–</div></div><div class="sum"><div class="k">ترند Score≥50</div><div class="big" id="sTrend">–</div></div><div class="sum"><div class="k">Strong Watch</div><div class="big" id="sStrong">–</div></div><div class="sum"><div class="k">Refresh</div><div class="big">60s</div></div></div>
<div id="sources" class="sources"></div>
<div class="bar"><button onclick="load()">↻ بروزرسانی</button><input id="q" placeholder="جستجو نام / ticker / CA" oninput="render()"><select id="vf" onchange="render()"><option value="">همه وضعیت‌ها</option><option>STRONG WATCH</option><option>WATCH</option><option>LOW SIGNAL</option><option>SKIP</option></select><select id="sf" onchange="render()"><option value="0">همه امتیازهای ترند</option><option value="50">Trend ≥ 50</option><option value="70">Trend ≥ 70</option></select><select id="secf" onchange="render()"><option value="">همه امنیت‌ها</option><option>MAX SECURITY</option><option>HIGH</option><option>REVIEW</option><option>REJECT</option></select><select id="actf" onchange="render()"><option value="">همه فعالیت‌ها</option><option>PROBABLE ORGANIC</option><option>MIXED</option><option>BOT RISK</option></select><span id="status">در حال بارگذاری...</span></div>
<div id="grid" class="grid"></div></div><script>
let data=[]; const $=s=>document.querySelector(s);
const money=n=>'$'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0});
const pct=n=>n==null?'نامشخص':Number(n).toFixed(1)+'%';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){status.textContent='در حال دریافت داده زنده...';try{const r=await fetch('/api/v1/tokens');const d=await r.json();data=d.tokens||[];status.textContent='آخرین بروزرسانی: '+new Date(d.generatedAt).toLocaleTimeString('fa-IR');sCount.textContent=d.count||0;sTrend.textContent=d.trending||0;sStrong.textContent=d.strong||0;sources.textContent='منابع: '+Object.entries(d.sourceStatus||{}).map(([k,v])=>k+'='+v).join(' | ');render()}catch(e){status.textContent='خطا در دریافت داده';}}
function render(){
 const q=$('#q').value.toLowerCase(),v=$('#vf').value,min=Number($('#sf').value||0),secf=$('#secf').value,actf=$('#actf').value;
 const rows=data.filter(t=>(!v||t.verdict===v)&&(!secf||t.security.tier===secf)&&(!actf||t.activity?.label===actf)&&t.trend.score>=min&&(!q||[t.name,t.symbol,t.mint].join(' ').toLowerCase().includes(q)));
 grid.innerHTML=rows.map(t=>{
  const cls=t.verdict==='STRONG WATCH'?'strong':t.verdict==='SKIP'?'skip':t.verdict==='LOW SIGNAL'?'low':'watch';
  const fl=t.security.flags?.length?t.security.flags.join(' • '):'هشدار on-chain واضح دیده نشد';
  const chips=(t.trend.sources||[]).map(x=>'<span class="chip">'+esc(x)+'</span>').join('')||'<span class="chip">بدون لینک اجتماعی معتبر</span>';
  const rs=(t.trend.reasons||[]).slice(0,4).map(x=>'<span class="chip">'+esc(x)+'</span>').join('');
  const x=t.socialSources?.find(x=>x.name==='X')?.url||'';
  const holders=(t.security.topHolders||[]).map((h,i)=>'<div class="holder"><span>#'+(i+1)+' '+Number(h.pct||0).toFixed(2)+'%</span><a target="_blank" rel="noopener" href="https://solscan.io/account/'+esc(h.owner)+'">'+esc(String(h.owner).slice(0,6))+'…'+esc(String(h.owner).slice(-6))+'</a></div>').join('');
  const st=t.security.tier||'REVIEW';
  const sc=st==='MAX SECURITY'?'secmax':st==='HIGH'?'sechigh':st==='REJECT'?'secreject':'secreview';
  const al=t.activity?.label||'UNKNOWN';
  const ac=al==='PROBABLE ORGANIC'?'secmax':al==='BOT RISK'?'secreject':'secreview';
  return '<div class="card"><div class="top"><div><div class="name">'+esc(t.name)+' <small>$'+esc(t.symbol)+'</small></div><div class="mint" title="'+esc(t.mint)+'">'+esc(t.mint)+'</div></div><span class="badge '+cls+'">'+t.verdict+'</span></div>'+
  '<div class="'+sc+'" style="margin-top:8px;font-weight:800">🛡 '+esc(st)+'</div><div class="'+ac+'" style="margin-top:4px;font-weight:800">👤 Activity: '+esc(al)+' '+(t.activity?('('+t.activity.score+'/100)'):'')+'</div>'+
  '<div class="stats"><div class="stat"><div class="k">Age</div><div class="v">'+t.ageMinutes+'m</div></div><div class="stat"><div class="k">Market Cap</div><div class="v">'+money(t.marketCap)+'</div></div><div class="stat"><div class="k">Liquidity</div><div class="v">'+money(t.liquidity)+'</div></div>'+
  '<div class="stat"><div class="k">Volume 5m</div><div class="v">'+money(t.volume5m)+'</div></div><div class="stat"><div class="k">Txns 5m</div><div class="v">'+t.txns5m+' ('+t.buys5m+'B/'+t.sells5m+'S)</div></div><div class="stat"><div class="k">Security</div><div class="v">'+t.security.score+'/100</div></div>'+
  '<div class="stat"><div class="k">Organic Activity</div><div class="v">'+(t.activity?.score??'?')+'/100</div></div><div class="stat"><div class="k">Avg Trade</div><div class="v">'+money(t.activity?.avgTrade||0)+'</div></div><div class="stat"><div class="k">Tx/min</div><div class="v">'+Number(t.activity?.txPerMin||0).toFixed(1)+'</div></div><div class="stat"><div class="k">Social Trend</div><div class="v">'+t.trend.score+'/100</div><div class="score"><div class="fill" style="width:'+t.trend.score+'%"></div></div></div><div class="stat"><div class="k">Holder Grade</div><div class="v '+(['A','B'].includes(t.security.holderGrade)?'safe':'')+'">'+esc(t.security.holderGrade||'?')+'</div></div><div class="stat"><div class="k">بزرگ‌ترین هولدر</div><div class="v '+(t.security.largestHolder!=null&&t.security.largestHolder<=4?'safe':'')+'">'+pct(t.security.largestHolder)+'</div></div><div class="stat"><div class="k">Top5</div><div class="v '+(t.security.top5!=null&&t.security.top5<=12?'safe':'')+'">'+pct(t.security.top5)+'</div></div><div class="stat"><div class="k">Top10</div><div class="v '+(t.security.top10!=null&&t.security.top10<=20?'safe':'')+'">'+pct(t.security.top10)+'</div></div><div class="stat"><div class="k">Mint / Freeze</div><div class="v '+(t.security.mintDisabled&&t.security.freezeDisabled?'safe':'')+'">'+(t.security.mintDisabled?'✓':'✕')+' / '+(t.security.freezeDisabled?'✓':'✕')+'</div></div></div>'+
  '<details><summary>نمایش هولدرهای بزرگ</summary><div class="holders">'+(holders||'داده هولدر موجود نیست')+'</div></details>'+
  '<div class="chips">'+chips+'</div><div class="chips">'+rs+'</div><div class="flags">'+esc(fl)+'</div><div class="flags">'+esc((t.activity?.flags||[]).join(' • '))+'</div><div class="links" style="margin-top:10px"><a target="_blank" rel="noopener" href="'+esc(t.dexUrl)+'">DEX Screener</a><a target="_blank" rel="noopener" href="https://solscan.io/token/'+esc(t.mint)+'">Solscan</a>'+(x?'<a target="_blank" rel="noopener" href="'+esc(x)+'">X / Twitter</a>':'')+'</div></div>'
 }).join('')||'<p>موردی با فیلتر فعلی نیست.</p>'
}
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
