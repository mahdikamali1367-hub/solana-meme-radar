import {createServer} from 'node:http';

const PORT=Number(process.env.PORT||4173);
const RPC=process.env.SOLANA_RPC_URL||'https://api.mainnet.solana.com';
const CACHE_MS=55_000;
let cache={at:0,data:null};
let smartMoneyCache={at:0,data:null};
const SMART_MONEY_CACHE_MS=6*60*60*1000;
let smartTraderHandles=new Set();
let liveFomoState={connected:false,realtime:false,delaySeconds:null,updatedAt:null,events:[],lastError:null};
let liveFomoSocket=null;

const SPL_TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHn4m9bqN6Arh';
const WSOL_MINT='So11111111111111111111111111111111111111112';
const STABLE_MINTS=new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD6PGVgN7k9Yg1iQeSxGZ7'
]);
const TRACKED_WALLETS=[
  {name:'Cented',address:'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/cented',seedPnl30d:476703,seedWinRate:58.1,medianHoldSec:13,priority:true},
  {name:'Decu',address:'4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/decu',seedPnl30d:384534,seedWinRate:72.0,medianHoldSec:16,priority:true},
  {name:'Theo',address:'Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/theo',seedPnl30d:217389,seedWinRate:53.5,medianHoldSec:23},
  {name:'Trunoest',address:'ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/trunoest',seedPnl30d:186357,seedWinRate:66.1,medianHoldSec:22,priority:true},
  {name:'Nyhrox',address:'6S8GezkxYUfZy9JPtYnanbcZTMB87Wjt1qx3c6ELajKC',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/nyhrox',seedPnl30d:102339,seedWinRate:64.7,medianHoldSec:17},
  {name:'Limfork',address:'BQVz7fQ1WsQmSTMY3umdPEPPTm1sdcBcX9sP7o6kPRmB',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/limfork',seedPnl30d:91407,seedWinRate:62.3,medianHoldSec:22},
  {name:'Kadenox',address:'B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/kadenox',seedPnl30d:82622,seedWinRate:63.8,medianHoldSec:15,priority:true},
  {name:'Casino',address:'8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/casino',seedPnl30d:79709,seedWinRate:48.7,medianHoldSec:60},
  {name:'Jijo',address:'4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/jijo',seedPnl30d:67699,seedWinRate:71.8,medianHoldSec:53},
  {name:'Johnson',address:'J9TYAsWWidbrcZybmLSfrLzryANf4CgJBLdvwdGuC8MB',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/johnson',seedPnl30d:63178,seedWinRate:65.7,medianHoldSec:180,priority:true},
  {name:'Whale #1',address:'6ug4s5uoG2dxycww9wBxo7kQq9NPzEf1ZSmGMT6M76Ni',source:'Solana Tracker',sourceUrl:'https://www.solanatracker.io/wallet/6ug4s5uoG2dxycww9wBxo7kQq9NPzEf1ZSmGMT6M76Ni',seedPnl30d:53930000,seedWinRate:36.4,medianHoldSec:null,highFrequencyRisk:true},
  {name:'moonlobsterdisc',address:'CFzVktB6sfK8rpewZeJ5VRPcvG5BBtK6pSbZ7FHVze4V',source:'Solana Tracker',sourceUrl:'https://www.solanatracker.io/wallet/CFzVktB6sfK8rpewZeJ5VRPcvG5BBtK6pSbZ7FHVze4V',seedPnl30d:9530000,seedWinRate:37.3,medianHoldSec:null}
];
let trackedWalletCache={at:0,data:null};
const TRACKED_WALLET_CACHE_MS=5*60*1000;


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
  let mintDisabled=null,freezeDisabled=null,top5=null,top10=null,largestHolder=null,maxOtherHolder=null,holderGrade='UNKNOWN',flags=[],score=50,coverage=0,topHolders=[];
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
    const rows=(la?.result?.value||[]).slice(0,20);
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
      maxOtherHolder=topHolders.slice(1,10).reduce((m,h)=>Math.max(m,h.pct),0);
      top5=topHolders.slice(0,5).reduce((a,b)=>a+b.pct,0);
      top10=topHolders.slice(0,10).reduce((a,b)=>a+b.pct,0);
      coverage+=35;
      if(largestHolder<=5&&maxOtherHolder<=2.5){holderGrade='A';score+=20}
      else if(largestHolder<=7.5&&maxOtherHolder<=4){holderGrade='B';score+=12}
      else if(largestHolder<=10&&maxOtherHolder<=5){holderGrade='C';score+=2}
      else {holderGrade='F';score-=35}
      if(largestHolder>10)flags.push('هولدر شماره 1 بیش از 10% عرضه دارد');
      if(maxOtherHolder>5)flags.push('یکی از هولدرهای شماره 2 تا 10 بیش از 5% عرضه دارد');
    }
  }catch{}
  const holderPolicyPassed=['A','B','C'].includes(holderGrade);
  const holderStrong=['A','B'].includes(holderGrade);
  if(top10==null){holderGrade='UNKNOWN';flags.push('داده هولدرها نامشخص')}
  return {score:clamp(score),coverage,mintDisabled,freezeDisabled,top5,top10,largestHolder,maxOtherHolder,holderGrade,holderPolicyPassed,holderStrong,topHolders,flags};
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


function marketQualityScore(t){
  let score=0; const reasons=[],warnings=[];
  if(t.dexUrl){score+=15;reasons.push('شفافیت و قابلیت رهگیری در DEX')}else warnings.push('لینک DEX نامشخص');
  const cov=num(t.security?.coverage);
  score+=Math.min(20,Math.round(cov/80*20));
  if(cov>=70)reasons.push('پوشش داده آن‌چین خوب'); else warnings.push('پوشش داده آن‌چین ناقص');
  if((t.security?.topHolders||[]).length>=5){score+=15;reasons.push('داده هولدرها موجود')}else warnings.push('داده هولدر کافی نیست');
  if(t.priceUsd>0&&t.marketCap>0){score+=10}else warnings.push('قیمت/ارزش بازار ناقص');
  const liqRatio=t.marketCap>0?t.liquidity/t.marketCap:0;
  if(liqRatio>=0.10){score+=20;reasons.push('عمق نقدینگی قوی')}
  else if(liqRatio>=0.05){score+=14;reasons.push('عمق نقدینگی قابل‌قبول')}
  else if(liqRatio>=0.02){score+=6;warnings.push('نقدینگی نسبت به مارکت‌کپ کم')}
  else warnings.push('نقدینگی بسیار کم نسبت به مارکت‌کپ');
  if(t.txns5m>=50){score+=10;reasons.push('مشارکت معاملاتی مناسب')}else if(t.txns5m>=20)score+=5;else warnings.push('نمونه معامله کم');
  if(t.volume5m>=5000)score+=5;
  if((t.socialSources||[]).length>=1)score+=5;
  score=clamp(Math.round(score));
  const label=score>=80?'HIGH':score>=60?'MEDIUM':'LOW';
  return {score,label,liqRatio,reasons,warnings,method:'approximate transparency/liquidity/data-coverage score'};
}

function chartDiscipline(t){
  const pc=num(t.priceChange5m);
  const buyRatio=(num(t.buys5m)+1)/(num(t.sells5m)+1);
  const volumePace=t.volume1h>0?(t.volume5m*12)/t.volume1h:null;
  let trend='SIDEWAYS';
  if(pc>=3&&buyRatio>=1.15)trend='UP';
  else if(pc<=-3||buyRatio<=0.80)trend='DOWN';
  let fomoRisk='LOW';
  if(pc>20)fomoRisk='HIGH'; else if(pc>12)fomoRisk='MEDIUM';
  let pumpDumpRisk='LOW'; const warnings=[];
  if(t.activity?.label==='BOT RISK'){pumpDumpRisk='HIGH';warnings.push('الگوی ربات/واش')}
  if(pc>25&&num(t.activity?.volumeLiquidity)>1.5){pumpDumpRisk='HIGH';warnings.push('جهش قیمت + گردش حجم غیرعادی')}
  else if(pumpDumpRisk!=='HIGH'&&pc>15&&volumePace!=null&&volumePace>1.8){pumpDumpRisk='MEDIUM';warnings.push('شتاب کوتاه‌مدت بسیار بالا')}
  const volumeTrend=volumePace==null?'UNKNOWN':volumePace>=1.10?'RISING':volumePace<0.60?'FADING':'STEADY';
  if(fomoRisk==='HIGH')warnings.push('ریسک FOMO / تعقیب قیمت');
  return {trend,fomoRisk,pumpDumpRisk,volumePace,volumeTrend,buyRatio,warnings,note:'تشخیص حمایت/مقاومت و الگوی کندل نیازمند مشاهده چارت DexScreener است'};
}

function academyGuard(t){
  const checks=[]; const sec=t.security||{},chart=t.chart||{},mq=t.marketQuality||{};
  const state=(ok,bad)=>ok?'pass':bad?'fail':'manual';
  checks.push({name:'Mint authority لغو شده',state:state(sec.mintDisabled===true,sec.mintDisabled===false)});
  checks.push({name:'Freeze authority غیرفعال',state:state(sec.freezeDisabled===true,sec.freezeDisabled===false)});
  checks.push({name:'توزیع هولدر طبق قانون رادار',state:state(sec.holderPolicyPassed===true,sec.holderPolicyPassed===false)});
  checks.push({name:'نقدینگی سالم نسبت به Market Cap',state:mq.liqRatio>=0.05?'pass':mq.liqRatio>0&&mq.liqRatio<0.02?'fail':'manual'});
  checks.push({name:'حجم در حال رشد، نه محو شدن',state:chart.volumeTrend==='RISING'?'pass':chart.volumeTrend==='FADING'?'fail':'manual'});
  checks.push({name:'فعالیت غیررباتی',state:t.activity?.label==='PROBABLE ORGANIC'?'pass':t.activity?.label==='BOT RISK'?'fail':'manual'});
  checks.push({name:'شبکه اجتماعی/جامعه قابل مشاهده',state:(t.socialSources||[]).length>=2&&t.trend?.score>=40?'pass':'manual'});
  checks.push({name:'Liquidity Lock/Burn تأیید شده',state:'manual'});
  checks.push({name:'Dev holding پایین تأیید شده',state:'manual'});
  checks.push({name:'Bundle/Sniper/Insider پایین',state:'manual'});
  checks.push({name:'تست فروش کوچک برای Honeypot',state:'manual'});
  const pass=checks.filter(x=>x.state==='pass').length;
  const fail=checks.filter(x=>x.state==='fail').length;
  const manual=checks.length-pass-fail;
  const criticalFail=
    sec.mintDisabled===false||sec.freezeDisabled===false||sec.holderPolicyPassed===false||
    t.activity?.label==='BOT RISK'||chart.pumpDumpRisk==='HIGH'||(mq.liqRatio>0&&mq.liqRatio<0.02);
  const blocked=criticalFail||fail>=2;
  const score=Math.round(pass/checks.length*100);
  const label=blocked?'BLOCK':fail===0&&pass>=6?'BASIC PASS':fail===0?'NEEDS REVIEW':'CAUTION';
  return {score,label,pass,fail,manual,blocked,checks,source:'memecoin-academy-derived rules; manual checks remain manual'};
}


function securityGate(t){
  const sec=t.security||{},mq=t.marketQuality||{},act=t.activity||{},chart=t.chart||{},academy=t.academy||{};
  const hard=[];
  if(sec.mintDisabled!==true)hard.push('Mint authority امن نیست/نامشخص');
  if(sec.freezeDisabled!==true)hard.push('Freeze authority امن نیست/نامشخص');
  if(sec.holderPolicyPassed!==true)hard.push('توزیع هولدرها رد/نامشخص');
  if(act.label==='BOT RISK')hard.push('ریسک ربات/Wash');
  if(chart.pumpDumpRisk==='HIGH')hard.push('ریسک Pump/Dump بالا');
  if(academy.blocked)hard.push('Academy Guard مسدود');
  if(num(t.liquidity)<3000)hard.push('نقدینگی خیلی کم');
  const cautions=[];
  if(num(mq.score)<65)cautions.push('کیفیت بازار/داده متوسط یا پایین');
  if(sec.tier==='REVIEW')cautions.push('امنیت نیازمند بررسی');
  if(chart.fomoRisk==='HIGH')cautions.push('ریسک FOMO بالا');
  const blocked=hard.length>0;
  const level=blocked?'BLOCK':cautions.length?'CAUTION':'PASS';
  return {level,blocked,hard,cautions,automaticChecks:6,manualChecks:num(academy.manual)};
}
function signalLabel(score,gate,confidence){
  if(gate.blocked)return 'BLOCKED';
  if(confidence==='LOW'&&score>=70)return 'WAIT_DATA';
  if(score>=80)return 'STRONG';
  if(score>=65)return 'POSITIVE';
  if(score>=48)return 'NEUTRAL';
  return 'AVOID';
}
function horizonScore(t,h){
  const gate=t.securityGate||securityGate(t);
  let score=50; const reasons=[];
  const pc5=num(t.priceChange5m),pc1=num(t.priceChange1h),pc6=num(t.priceChange6h),pc24=num(t.priceChange24h);
  const br5=(num(t.buys5m)+1)/(num(t.sells5m)+1);
  const br1=(num(t.buys1h)+1)/(num(t.sells1h)+1);
  const br6=(num(t.buys6h)+1)/(num(t.sells6h)+1);
  const br24=(num(t.buys24h)+1)/(num(t.sells24h)+1);
  const mq=num(t.marketQuality?.score),sec=num(t.security?.score),act=num(t.activity?.score),trend=num(t.trend?.score);
  const add=(v,msg)=>{score+=v;if(msg)reasons.push(msg)};
  if(sec>=85)add(8,'امنیت قوی'); else if(sec<60)add(-12,'امنیت ضعیف');
  if(mq>=80)add(7,'کیفیت بازار بالا'); else if(mq<60)add(-8,'کیفیت بازار پایین');
  if(act>=72)add(6,'فعالیت طبیعی');
  if(t.security?.holderStrong)add(5,'توزیع هولدر مناسب');
  if(gate.blocked)score-=45;

  if(h==='short'){
    if(pc5>=2&&pc5<=12)add(10,'مومنتوم 5m مثبت'); else if(pc5>20)add(-18,'پامپ 5m کشیده'); else if(pc5<-10)add(-15,'افت 5m شدید');
    if(pc1>0&&pc1<=25)add(7,'روند 1h مثبت'); else if(pc1<-12)add(-10,'روند 1h ضعیف');
    if(br5>=1.35)add(10,'خرید 5m غالب'); else if(br5<0.75)add(-10,'فروش 5m غالب');
    if(num(t.volume5m)>=5000)add(8,'حجم 5m مناسب');
    if(num(t.txns5m)>=50)add(6,'تراکنش کافی');
    if(trend>=55)add(5,'ترند اجتماعی');
  }else if(h==='medium'){
    if(pc1>=3&&pc1<=30)add(10,'روند 1h مثبت'); else if(pc1>45)add(-15,'1h بیش‌ازحد کشیده'); else if(pc1<-15)add(-14,'1h نزولی');
    if(pc6>=0&&pc6<=60)add(9,'ساختار 6h مثبت'); else if(pc6<-25)add(-14,'6h ضعیف');
    if(br1>=1.15)add(8,'خریدار 1h بیشتر'); else if(br1<0.8)add(-8,'فروشنده 1h بیشتر');
    if(br6>=1.05)add(5,'تعادل 6h مثبت');
    if(num(t.volume1h)>=10000)add(7,'حجم 1h مناسب');
    if(num(t.txns1h)>=100)add(5,'مشارکت 1h خوب');
  }else{
    if(pc6>=5&&pc6<=80)add(10,'روند 6h مثبت'); else if(pc6<-25)add(-15,'6h نزولی');
    if(pc24>=0&&pc24<=150)add(8,'ساختار 24h مثبت'); else if(pc24<-35)add(-15,'24h ضعیف');
    if(br6>=1.05)add(6,'خرید 6h متعادل'); else if(br6<0.8)add(-8,'فروش 6h غالب');
    if(br24>=1.0)add(5,'جریان 24h مثبت');
    if(num(t.volume6h)>=25000)add(6,'حجم 6h مناسب');
    if(num(t.volume24h)>=50000)add(5,'حجم 24h مناسب');
    if(trend>=45)add(4,'حضور اجتماعی');
  }
  if(t.chart?.fomoRisk==='HIGH')score-=12;
  if(t.chart?.pumpDumpRisk==='HIGH')score-=25;
  score=clamp(Math.round(score));
  let confidence='HIGH';
  if(h==='short'&&t.ageMinutes<15)confidence='LOW';
  if(h==='medium'&&t.ageMinutes<60)confidence='LOW';
  if(h==='long'&&t.ageMinutes<360)confidence='LOW';
  const label=signalLabel(score,gate,confidence);
  return {score,label,confidence,reasons:reasons.slice(0,5)};
}
function multiHorizonSignals(t){
  t.securityGate=securityGate(t);
  return {
    short:{...horizonScore(t,'short'),window:'5m-1h'},
    medium:{...horizonScore(t,'medium'),window:'1h-6h'},
    long:{...horizonScore(t,'long'),window:'6h-24h'}
  };
}

function assessSecurity(t){
  const s=t.security;
  const coreOk=s.mintDisabled===true&&s.freezeDisabled===true&&s.holderPolicyPassed;
  const organicOk=t.activity&&t.activity.score>=72&&t.activity.label==='PROBABLE ORGANIC';
  const organicHigh=t.activity&&t.activity.score>=58&&t.activity.label!=='BOT RISK';
  const knowledgeOk=(!t.academy||!t.academy.blocked)&&(t.marketQuality?.score??0)>=65&&t.chart?.pumpDumpRisk!=='HIGH';
  const maxOk=coreOk&&organicOk&&knowledgeOk&&s.holderStrong&&s.score>=85&&t.liquidity>=10000;
  const highOk=coreOk&&organicHigh&&(!t.academy||!t.academy.blocked)&&s.score>=75&&t.liquidity>=5000;
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
  for(const s of seeds.slice(0,35)){
    const p=await pairFor(s.mint); if(!p)continue;
    const created=num(p.pairCreatedAt);
    const ageMinutes=created?Math.max(0,(Date.now()-created)/60000):9999;
    if(ageMinutes>1440)continue;
    const sec=await security(s.mint);
    const buys5m=num(p.txns?.m5?.buys),sells5m=num(p.txns?.m5?.sells);
    const t={
      name:p.baseToken?.name||'Unknown',symbol:p.baseToken?.symbol||'?',mint:s.mint,
      dexId:p.dexId||'',dexUrl:p.url||'',image:p.info?.imageUrl||s.image||'',description:s.description,
      ageMinutes:+ageMinutes.toFixed(1),priceUsd:num(p.priceUsd),marketCap:num(p.marketCap||p.fdv),
      liquidity:num(p.liquidity?.usd),volume5m:num(p.volume?.m5),volume1h:num(p.volume?.h1),volume6h:num(p.volume?.h6),volume24h:num(p.volume?.h24),
      buys5m,sells5m,txns5m:buys5m+sells5m,
      buys1h:num(p.txns?.h1?.buys),sells1h:num(p.txns?.h1?.sells),txns1h:num(p.txns?.h1?.buys)+num(p.txns?.h1?.sells),
      buys6h:num(p.txns?.h6?.buys),sells6h:num(p.txns?.h6?.sells),txns6h:num(p.txns?.h6?.buys)+num(p.txns?.h6?.sells),
      buys24h:num(p.txns?.h24?.buys),sells24h:num(p.txns?.h24?.sells),txns24h:num(p.txns?.h24?.buys)+num(p.txns?.h24?.sells),
      priceChange5m:num(p.priceChange?.m5),priceChange1h:num(p.priceChange?.h1),priceChange6h:num(p.priceChange?.h6),priceChange24h:num(p.priceChange?.h24),security:sec
    };
    t.socialSources=socialMeta(s,p);
    t.bluesky={mentions2h:0,engagement2h:0};
    t.activity=activityScore(t);
    t.trend=trendScore(t,s);
    t.marketQuality=marketQualityScore(t);
    t.chart=chartDiscipline(t);
    t.academy=academyGuard(t);
    t.signals=multiHorizonSignals(t);
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
    t.marketQuality=marketQualityScore(t);
    t.chart=chartDiscipline(t);
    t.academy=academyGuard(t);
    t.signals=multiHorizonSignals(t);
    t.verdict=verdict(t);
  }
  const rank={'STRONG WATCH':4,'WATCH':3,'LOW SIGNAL':2,'SKIP':1};
  out.sort((a,b)=>(rank[b.verdict]-rank[a.verdict])||(b.trend.score-a.trend.score)||(b.volume5m-a.volume5m));
  const strong=out.filter(x=>x.verdict==='STRONG WATCH').length;
  const trending=out.filter(x=>x.trend.score>=50).length;
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:60,count:out.length,strong,trending,tokens:out,
    sourceStatus:{dexscreener:'live',solanaRpc:'live',bluesky:'live-public',x:process.env.X_BEARER_TOKEN?'configured':'needs API key',youtube:process.env.YOUTUBE_API_KEY?'configured':'needs API key',reddit:process.env.REDDIT_CLIENT_ID?'configured':'needs OAuth',instagram:process.env.INSTAGRAM_SOCIAL_TOKEN?'configured':'needs API access',tiktok:process.env.TIKTOK_RESEARCH_TOKEN?'configured':'needs research access'},
    holderPolicy:{hardRules:{holder1MaxPct:10,holders2to10EachMaxPct:5},gradeA:{holder1MaxPct:5,holders2to10EachMaxPct:2.5},gradeB:{holder1MaxPct:7.5,holders2to10EachMaxPct:4},gradeC:{holder1MaxPct:10,holders2to10EachMaxPct:5},unknownFailsStrong:true},
    activityPolicy:{probableOrganicMin:72,highSecurityMin:58,method:'aggregate heuristics; not proof of human identity'},
    knowledgeEngine:{marketQuality:'transparency + liquidity + data coverage',chartDiscipline:'trend + FOMO + pump/dump guard',academy:'rug/honeypot/MEV/sniper/risk checklist; unknown checks stay manual'},
    signalWindows:{short:'5m-1h',medium:'1h-6h',long:'6h-24h',securityGate:'required for all three; insufficient history lowers confidence'},
    disclaimer:'قانون هولدرها: هولدر شماره 1 حداکثر 10% و هرکدام از هولدرهای شماره 2 تا 10 حداکثر 5% می‌توانند داشته باشند. مجموع Top10 فقط جهت اطلاع نمایش داده می‌شود و شرط رد نیست. Organic Activity یک تخمین ضدربات/ضدواش است. هیچ فیلتر آن‌چین کلاهبرداری را 100% رد نمی‌کند.'};
  cache={at:Date.now(),data};return data;
}



function metaTokenMap(rows,wallet){
  const m=new Map();
  for(const x of (rows||[])){
    if(x?.owner!==wallet)continue;
    const mint=x?.mint;if(!mint)continue;
    const a=num(x?.uiTokenAmount?.uiAmountString??x?.uiTokenAmount?.uiAmount);
    m.set(mint,(m.get(mint)||0)+a);
  }
  return m;
}
function mergeMintKeys(a,b){return new Set([...a.keys(),...b.keys()])}
function parsedAccountKey(x){return typeof x==='string'?x:(x?.pubkey||'')}
function parseTrackedWalletTx(tx,wallet,solPrice){
  const meta=tx?.result?.meta,body=tx?.result?.transaction;
  if(!meta||meta.err||!body)return [];
  const pre=metaTokenMap(meta.preTokenBalances,wallet),post=metaTokenMap(meta.postTokenBalances,wallet);
  const keys=body?.message?.accountKeys||[];
  const wi=keys.findIndex(x=>parsedAccountKey(x)===wallet);
  const solDelta=wi>=0?(num(meta.postBalances?.[wi])-num(meta.preBalances?.[wi]))/1e9:0;
  const stableDelta=[...STABLE_MINTS].reduce((a,m)=>a+(post.get(m)||0)-(pre.get(m)||0),0);
  const wsolDelta=(post.get(WSOL_MINT)||0)-(pre.get(WSOL_MINT)||0);
  const counterSolDelta=solDelta+wsolDelta;
  const paidUsd=Math.max(0,-stableDelta,-counterSolDelta*solPrice);
  const receivedUsd=Math.max(0,stableDelta,counterSolDelta*solPrice);
  const events=[];
  for(const mint of mergeMintKeys(pre,post)){
    if(STABLE_MINTS.has(mint)||mint===WSOL_MINT)continue;
    const delta=(post.get(mint)||0)-(pre.get(mint)||0);
    if(Math.abs(delta)<=0)continue;
    if(delta>0&&paidUsd>=1)events.push({side:'BUY',mint,tokenAmount:delta,approxUsd:paidUsd});
    else if(delta<0&&receivedUsd>=1)events.push({side:'SELL',mint,tokenAmount:Math.abs(delta),approxUsd:receivedUsd});
  }
  return events;
}
async function walletTokenBalances(wallet){
  const out=new Map();
  for(const programId of [SPL_TOKEN_PROGRAM,TOKEN_2022_PROGRAM]){
    try{
      const d=await rpc('getTokenAccountsByOwner',[wallet,{programId},{encoding:'jsonParsed',commitment:'confirmed'}]);
      for(const x of (d?.result?.value||[])){
        const info=x?.account?.data?.parsed?.info;
        const mint=info?.mint,amt=num(info?.tokenAmount?.uiAmountString??info?.tokenAmount?.uiAmount);
        if(mint&&amt>0)out.set(mint,(out.get(mint)||0)+amt);
      }
    }catch{}
  }
  return out;
}
async function currentSolPrice(){
  try{const p=await pairFor(WSOL_MINT);return num(p?.priceUsd,0)}catch{return 0}
}
async function buildTrackedWallets(){
  if(trackedWalletCache.data&&Date.now()-trackedWalletCache.at<TRACKED_WALLET_CACHE_MS)return trackedWalletCache.data;
  const solPrice=await currentSolPrice();
  const nowSec=Math.floor(Date.now()/1000);
  const walletRows=[];
  const agg=new Map();

  for(const w of TRACKED_WALLETS){
    const events=[];
    let balances=new Map(),rpcOk=true,lastActivity=null;
    try{
      balances=await walletTokenBalances(w.address);
      const sigs=await rpc('getSignaturesForAddress',[w.address,{limit:6,commitment:'confirmed'}]);
      const recent=(sigs?.result||[]).filter(x=>x.blockTime&&nowSec-x.blockTime<=48*3600).slice(0,4);
      for(const sig of recent){
        try{
          const tx=await rpc('getTransaction',[sig.signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
          const parsed=parseTrackedWalletTx(tx,w.address,solPrice);
          for(const e of parsed){
            e.signature=sig.signature;e.ts=num(sig.blockTime)*1000;e.wallet=w.name;e.walletAddress=w.address;
            events.push(e);
            const a=agg.get(e.mint)||{mint:e.mint,buyers:new Set(),sellers:new Set(),buyUsd:0,sellUsd:0,events:[],latestTs:0};
            if(e.side==='BUY'){a.buyers.add(w.name);a.buyUsd+=num(e.approxUsd)}
            else {a.sellers.add(w.name);a.sellUsd+=num(e.approxUsd)}
            a.events.push(e);a.latestTs=Math.max(a.latestTs,e.ts||0);agg.set(e.mint,a);
          }
          lastActivity=Math.max(lastActivity||0,num(sig.blockTime)*1000);
        }catch{}
        await sleep(35);
      }
    }catch{rpcOk=false}
    walletRows.push({...w,rpcOk,lastActivity,events:events.sort((a,b)=>b.ts-a.ts),_balances:balances});
    await sleep(45);
  }

  const rankedAgg=[...agg.values()].sort((a,b)=>(b.buyers.size-a.buyers.size)||(b.buyUsd-b.sellUsd)-(a.buyUsd-a.sellUsd)).slice(0,20);
  for(const a of rankedAgg){
    let p=null;
    try{p=await pairFor(a.mint)}catch{}
    const price=num(p?.priceUsd);
    const holders=[];
    let currentHoldingUsd=0;
    for(const w of walletRows){
      const amount=num(w._balances.get(a.mint));
      if(amount<=0)continue;
      const valueUsd=price>0?amount*price:null;
      holders.push({wallet:w.name,address:w.address,amount,valueUsd});
      if(valueUsd!=null)currentHoldingUsd+=valueUsd;
    }
    a.symbol=p?.baseToken?.symbol||'?';a.name=p?.baseToken?.name||'Unknown';
    for(const e of a.events){e.symbol=a.symbol;e.name=a.name;e.dexUrl=p?.url||''}
    a.dexUrl=p?.url||'';a.priceUsd=price;a.liquidity=num(p?.liquidity?.usd);a.marketCap=num(p?.marketCap||p?.fdv);
    a.currentHoldingUsd=currentHoldingUsd;a.holders=holders;a.holdingWallets=holders.length;
    a.uniqueBuyers=a.buyers.size;a.uniqueSellers=a.sellers.size;a.buyers=[...a.buyers];a.sellers=[...a.sellers];
    a.netFlowUsd=a.buyUsd-a.sellUsd;
    a.consensus=a.uniqueBuyers>=2&&a.netFlowUsd>0;
  }
  const tokens=rankedAgg;
  const topHoldings=[...tokens].filter(x=>x.currentHoldingUsd>0).sort((a,b)=>b.currentHoldingUsd-a.currentHoldingUsd).slice(0,10);
  const topNetBuys=[...tokens].filter(x=>x.buyUsd>0).sort((a,b)=>b.netFlowUsd-a.netFlowUsd).slice(0,10);
  const consensus=[...tokens].filter(x=>x.consensus).sort((a,b)=>(b.uniqueBuyers-a.uniqueBuyers)||(b.netFlowUsd-a.netFlowUsd)).slice(0,10);

  const publicWallets=walletRows.map(w=>{
    const { _balances,...rest}=w;
    const speed=w.highFrequencyRisk?'ربات/فرکانس بسیار بالا محتمل':w.medianHoldSec!=null&&w.medianHoldSec<60?'اسکالپر بسیار سریع':w.medianHoldSec!=null&&w.medianHoldSec<=180?'اسکالپر سریع':'نامشخص';
    return {...rest,speed,solscanUrl:'https://solscan.io/account/'+w.address,gmgnUrl:'https://gmgn.ai/sol/address/'+w.address};
  });
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:300,source:'Solana RPC live + seed rankings from KOL Explorer/Solana Tracker',solPrice,wallets:publicWallets,tokens,topHoldings,topNetBuys,consensus,
    disclaimer:'خرید/فروش از تغییر موجودی توکن همراه با خروج/ورود SOL یا استیبل‌کوین استنباط می‌شود. انتقال ساده حذف می‌شود اما تشخیص Swap صددرصد نیست. رتبه/سود تاریخی Seed است و تصمیم خرید نیست.'};
  trackedWalletCache={at:Date.now(),data};return data;
}

function liveEventSeverity(e){
  if(e.alertType!=='sell')return e.alertType==='buy'?'BUY':'INFO';
  const now=e.ts||Date.now();
  const recent=liveFomoState.events.filter(x=>x.alertType==='sell'&&x.tokenAddress===e.tokenAddress&&Math.abs((x.ts||0)-now)<=10*60*1000);
  const unique=new Set(recent.map(x=>String(x.trader||'').toLowerCase()).filter(Boolean));
  if(e.trader)unique.add(String(e.trader).toLowerCase());
  if(unique.size>=2)return 'MULTI-WALLET EXIT';
  if(num(e.tradeUsd)>=5000)return 'HEAVY SELL';
  return 'SELL STARTED';
}
async function verifySellPosition(evt){
  const key=process.env.FOMO_API_KEY;
  if(!key||!evt?.trader||!evt?.tokenAddress||!smartTraderHandles.has(String(evt.trader).toLowerCase()))return;
  try{
    await sleep(2500);
    const d=await jfetch('https://api.fomoapi.io/v2/users/'+encodeURIComponent(evt.trader)+'/balances?chain=solana',{headers:{authorization:'Bearer '+key}},10000);
    const h=(d?.holdings||[]).find(x=>String(x?.token?.address||'')===String(evt.tokenAddress));
    evt.remainingValueUsd=h?num(h.valueUsd):0;
    evt.remainingAmount=h?num(h.amount):0;
    evt.positionVerified=true;
    if(!h||num(h.valueUsd)<25)evt.exitStatus='POSITION CLOSED / NEAR ZERO';
    else evt.exitStatus='POSITION REDUCED / STILL HOLDING';
    liveFomoState.updatedAt=new Date().toISOString();
  }catch{
    evt.positionVerified=false;
  }
}
function pushLiveFomoEvent(m){
  if(!m||m.type!=='alert'||!['buy','sell'].includes(m.alertType)||String(m.chain||'').toLowerCase()!=='solana')return;
  const e={
    eventId:m.eventId||String(Date.now())+Math.random(),
    alertType:m.alertType,
    trader:m.trader||'unknown',
    userId:m.userId||null,
    tradeId:m.tradeId||null,
    token:m.token||'?',
    tokenAddress:m.tokenAddress||'',
    tradeUsd:m.tradeUsd==null?null:num(m.tradeUsd),
    positionValueUsd:m.positionValueUsd==null?null:num(m.positionValueUsd),
    text:m.text||'',
    ts:num(m.execTs||m.ts,Date.now()),
    txHash:m.txHash||null,
    trackedSmart:smartTraderHandles.has(String(m.trader||'').toLowerCase()),
    positionVerified:false
  };
  if(liveFomoState.events.some(x=>x.eventId===e.eventId))return;
  e.severity=liveEventSeverity(e);
  liveFomoState.events.unshift(e);
  liveFomoState.events=liveFomoState.events.slice(0,80);
  // Recompute exit severity after inserting the latest event.
  for(const x of liveFomoState.events.slice(0,30)){
    if(x.alertType==='sell')x.severity=liveEventSeverity(x);
  }
  liveFomoState.updatedAt=new Date().toISOString();
  if(e.alertType==='sell')verifySellPosition(e);
}
function startLiveFomoStream(){
  if(typeof WebSocket==='undefined')return;
  try{
    if(liveFomoSocket&&[0,1].includes(liveFomoSocket.readyState))return;
    const key=process.env.FOMO_API_KEY;
    const url='wss://api.fomoapi.io/ws/alerts?chain=solana'+(key?'&key='+encodeURIComponent(key):'');
    const ws=new WebSocket(url);
    liveFomoSocket=ws;
    ws.onopen=()=>{liveFomoState.connected=true;liveFomoState.lastError=null;liveFomoState.updatedAt=new Date().toISOString()};
    ws.onmessage=(ev)=>{
      try{
        const m=JSON.parse(String(ev.data));
        if(m.type==='welcome'){
          liveFomoState.realtime=!!m.realtime;
          liveFomoState.delaySeconds=m.delaySeconds??null;
          liveFomoState.updatedAt=new Date().toISOString();
          return;
        }
        pushLiveFomoEvent(m);
      }catch{}
    };
    ws.onerror=()=>{liveFomoState.lastError='stream error'};
    ws.onclose=()=>{
      liveFomoState.connected=false;
      liveFomoState.updatedAt=new Date().toISOString();
      setTimeout(startLiveFomoStream,5000);
    };
  }catch(e){
    liveFomoState.connected=false;
    liveFomoState.lastError=String(e?.message||e);
    setTimeout(startLiveFomoStream,10000);
  }
}
startLiveFomoStream();

function liveSmartMoneyPayload(){
  const events=liveFomoState.events.slice(0,50);
  const exits=events.filter(x=>x.alertType==='sell');
  const buys=events.filter(x=>x.alertType==='buy');
  const byToken=new Map();
  for(const e of exits.filter(x=>(Date.now()-(x.ts||0))<=30*60*1000)){
    const k=e.tokenAddress||e.token;
    const x=byToken.get(k)||{token:e.token,tokenAddress:e.tokenAddress,sellers:new Set(),sellEvents:0,knownSellUsd:0,severity:'SELL STARTED',latestTs:0};
    x.sellers.add(e.trader);x.sellEvents++;x.knownSellUsd+=num(e.tradeUsd);x.latestTs=Math.max(x.latestTs,e.ts||0);
    byToken.set(k,x);
  }
  const exitClusters=[...byToken.values()].map(x=>({...x,sellers:[...x.sellers],uniqueSellers:x.sellers.size,severity:x.sellers.size>=2?'MULTI-WALLET EXIT':x.knownSellUsd>=5000?'HEAVY SELL':'SELL STARTED'})).sort((a,b)=>b.latestTs-a.latestTs);
  const whaleBuys=buys.filter(x=>num(x.tradeUsd)>=5000||num(x.positionValueUsd)>=25000).slice(0,20);
  const whaleSells=exits.filter(x=>num(x.tradeUsd)>=5000||num(x.positionValueUsd)>=25000).slice(0,20);
  return {ok:true,connected:liveFomoState.connected,realtime:liveFomoState.realtime,delaySeconds:liveFomoState.delaySeconds,updatedAt:liveFomoState.updatedAt,lastError:liveFomoState.lastError,keyConfigured:!!process.env.FOMO_API_KEY,events,buys:buys.slice(0,20),exits:exits.slice(0,20),whaleBuys,whaleSells,exitClusters};
}

async function buildSmartMoney(){
  const key=process.env.FOMO_API_KEY;
  if(!key){
    return {ok:false,configured:false,source:'fomoapi',message:'FOMO_API_KEY لازم است',traders:[],tokens:[]};
  }
  if(smartMoneyCache.data&&Date.now()-smartMoneyCache.at<SMART_MONEY_CACHE_MS)return smartMoneyCache.data;
  const auth={authorization:'Bearer '+key};
  const [b7,b30]=await Promise.all([
    jfetch('https://api.fomoapi.io/v2/leaderboard/7d?limit=30',{headers:auth},12000),
    jfetch('https://api.fomoapi.io/v2/leaderboard/30d?limit=30',{headers:auth},12000)
  ]);
  const m=new Map();
  const ingest=(board,window)=>{
    for(const r of (board?.traders||[])){
      const wallet=r?.wallets?.solana;
      if(!wallet||r?.verified!==true||num(r.pnlUsd)<=0)continue;
      const id=r.userId||r.handle||wallet;
      const x=m.get(id)||{id,handle:r.handle||'',displayName:r.displayName||r.handle||'',wallet,verified:true,pnl7d:0,pnl30d:0,volume7d:0,volume30d:0,rank7d:null,rank30d:null};
      if(window==='7d'){x.pnl7d=num(r.pnlUsd);x.volume7d=num(r.volumeUsd);x.rank7d=r.rank??null}
      else{x.pnl30d=num(r.pnlUsd);x.volume30d=num(r.volumeUsd);x.rank30d=r.rank??null}
      m.set(id,x);
    }
  };
  ingest(b7,'7d'); ingest(b30,'30d');
  let traders=[...m.values()].map(x=>{
    const consistency=(x.pnl7d>0?1:0)+(x.pnl30d>0?1:0);
    const score=(consistency*100)+Math.log10(1+Math.max(0,x.pnl7d))*12+Math.log10(1+Math.max(0,x.pnl30d))*10;
    return {...x,consistency,smartScore:+score.toFixed(1)};
  }).filter(x=>x.consistency>=1).sort((a,b)=>b.smartScore-a.smartScore).slice(0,3);

  smartTraderHandles=new Set(traders.map(x=>String(x.handle||'').toLowerCase()).filter(Boolean));
  const tokenMap=new Map();
  for(const tr of traders){
    let bal;
    try{
      bal=await jfetch('https://api.fomoapi.io/v2/users/'+encodeURIComponent(tr.id)+'/balances?chain=solana',{headers:auth},12000);
    }catch{
      try{bal=await jfetch('https://api.fomoapi.io/v2/users/'+encodeURIComponent(tr.handle)+'/balances?chain=solana',{headers:auth},12000)}catch{continue}
    }
    for(const h of (bal?.holdings||[])){
      const address=h?.token?.address;
      const symbol=String(h?.token?.symbol||'').toUpperCase();
      if(!address||['SOL','WSOL','USDC','USDT'].includes(symbol))continue;
      const value=num(h.valueUsd);
      if(value<25)continue;
      const old=tokenMap.get(address)||{address,symbol:symbol||'?',name:h?.token?.name||'',smartMoneyCount:0,totalValueUsd:0,traders:[],change24h:num(h.change24h),marketCap:0,liquidity:0,security:null};
      old.smartMoneyCount+=1;
      old.totalValueUsd+=value;
      old.traders.push({handle:tr.handle||tr.displayName,wallet:tr.wallet,valueUsd:value,pnl7d:tr.pnl7d,pnl30d:tr.pnl30d});
      tokenMap.set(address,old);
    }
  }

  let tokens=[...tokenMap.values()].sort((a,b)=>(b.smartMoneyCount-a.smartMoneyCount)||(b.totalValueUsd-a.totalValueUsd)).slice(0,12);
  for(const t of tokens){
    try{
      const p=await pairFor(t.address);
      if(p){t.marketCap=num(p.marketCap||p.fdv);t.liquidity=num(p.liquidity?.usd);t.dexUrl=p.url||'';t.volume5m=num(p.volume?.m5);t.txns5m=num(p.txns?.m5?.buys)+num(p.txns?.m5?.sells)}
      t.security=await security(t.address);
    }catch{}
  }
  tokens.sort((a,b)=>{
    const qa=(a.security?.holderStrong?2:a.security?.holderPolicyPassed?1:0)+(a.security?.mintDisabled&&a.security?.freezeDisabled?2:0);
    const qb=(b.security?.holderStrong?2:b.security?.holderPolicyPassed?1:0)+(b.security?.mintDisabled&&b.security?.freezeDisabled?2:0);
    return (b.smartMoneyCount-a.smartMoneyCount)||(qb-qa)||(b.totalValueUsd-a.totalValueUsd);
  });
  const data={ok:true,configured:true,source:'fomoapi',generatedAt:new Date().toISOString(),cacheHours:6,traders,tokens,disclaimer:'Smart Money یعنی کیف‌پول‌های سودده/تأییدشده در leaderboard؛ تضمین سود آینده یا سالم بودن توکن نیست.'};
  smartMoneyCache={at:Date.now(),data};
  return data;
}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=()=>`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>رادار سولانا</title>
<style>
:root{color-scheme:dark;--bg:#07101d;--panel:#0d1829;--line:#203653;--text:#eef5ff;--muted:#8ea3c2;--good:#69efaa;--warn:#ffd36a;--bad:#ff8799;--blue:#9bd4ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Tahoma,Arial,sans-serif}
header{position:sticky;top:0;z-index:20;background:rgba(7,16,29,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.head,.shell{max-width:1240px;margin:auto}.head{padding:11px 15px;display:flex;align-items:center;justify-content:space-between;gap:10px}.shell{padding:14px}
.brand{display:flex;align-items:center;gap:9px}.logo{width:34px;height:34px;border-radius:10px;background:#183454;display:grid;place-items:center;font-weight:900}.brand b{font-size:17px}.brand small{display:block;color:var(--muted);font-size:11px;margin-top:2px}
button,input,select,a.action{border:1px solid var(--line);background:#101d31;color:var(--text);border-radius:9px;padding:8px 10px;font:inherit}button{cursor:pointer}.primary{background:#153d32;border-color:#2f6d57;color:#8dffc8}.muted{color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:11px}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}.kpi small{color:var(--muted);font-size:11px}.kpi b{display:block;font-size:21px;margin-top:3px}
.alerts{display:grid;gap:6px;margin-bottom:9px}.alert{padding:8px 10px;border:1px solid #703343;background:#25151d;color:#ffb0bd;border-radius:10px;font-size:12px}
.tabs{display:flex;gap:6px;overflow:auto;scrollbar-width:none;margin-bottom:10px}.tab{white-space:nowrap}.tab.active{background:#193759;border-color:#3d709f;color:#c0e1ff}
.toolbar{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}.toolbar input{flex:1;min-width:220px}.toolbar select{min-width:140px}
.panel{display:none}.panel.active{display:block}.section-title{display:flex;justify-content:space-between;gap:10px;align-items:end;margin:6px 0 9px}.section-title h2{margin:0;font-size:16px}.section-title p{margin:3px 0 0;color:var(--muted);font-size:11px}
.list{display:grid;gap:7px}.row{display:grid;grid-template-columns:minmax(175px,1.6fr) repeat(5,minmax(80px,.7fr)) auto;gap:7px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:9px}.asset{min-width:0}.asset b{font-size:13px}.asset small{display:block;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;font-size:10px}.cell small{display:block;color:var(--muted);font-size:9px}.cell b{font-size:12px}.actions{display:flex;gap:4px}.actions a,.actions button{font-size:11px;padding:6px 7px;text-decoration:none}
.badge{display:inline-flex;padding:3px 6px;border-radius:999px;font-size:10px;font-weight:700}.good{background:#123a2d;color:var(--good)}.mid{background:#3b3317;color:var(--warn)}.bad{background:#421a24;color:var(--bad)}.blue{background:#152d49;color:var(--blue)}
.empty{background:var(--panel);border:1px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--muted);font-size:12px}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mini{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}.mini h3{font-size:13px;margin:0 0 7px}.mini-row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #182b45;font-size:11px}.mini-row:first-of-type{border-top:0}.mini-row span{color:var(--muted)}
dialog{width:min(720px,94vw);max-height:88vh;border:1px solid #36506e;border-radius:15px;background:#091426;color:var(--text);padding:0;box-shadow:0 30px 90px #0009}dialog::backdrop{background:#000a}.modal-head{position:sticky;top:0;background:#091426;border-bottom:1px solid var(--line);padding:12px 14px;display:flex;justify-content:space-between;align-items:center}.modal-body{padding:13px}.modal-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.box{background:#0f1d31;border:1px solid var(--line);border-radius:10px;padding:8px}.box small{display:block;color:var(--muted);font-size:9px}.box b{display:block;margin-top:3px;font-size:12px}.holders{margin-top:11px}.holder,.check{display:flex;justify-content:space-between;gap:7px;padding:6px 0;border-top:1px solid var(--line);font-size:11px}.holder a{color:var(--blue);text-decoration:none}.links{display:flex;flex-wrap:wrap;gap:5px;margin-top:11px}.links a{color:#b5ddff;text-decoration:none;border:1px solid #315071;background:#10243b;padding:6px 8px;border-radius:8px;font-size:11px}.note{margin-top:10px;color:var(--muted);font-size:11px;line-height:1.65}.pass{color:var(--good)}.fail{color:var(--bad)}.manual{color:var(--warn)}
@media(max-width:900px){.row{grid-template-columns:1.5fr repeat(3,.8fr) auto}.hide-md{display:none}.three{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){.head{padding:9px 10px}.shell{padding:10px}.brand small,.status{display:none}.row{grid-template-columns:1fr 1fr}.asset,.actions{grid-column:1/-1}.hide-sm{display:none}.modal-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<header>
<div class="head">
  <div class="brand"><div class="logo">S</div><div><b>رادار سولانا</b><small>میم‌کوین · نهنگ · اسمارت‌مانی</small></div></div>
  <div style="display:flex;align-items:center;gap:7px"><span class="muted status" id="updated">در حال اتصال…</span><button class="primary" id="refresh">↻ بروزرسانی</button></div>
</div>
</header>

<main class="shell">
<section class="kpis">
  <div class="kpi"><small>توکن‌ها</small><b id="kTokens">—</b></div>
  <div class="kpi"><small>پیشنهاد ۹۰+</small><b id="kFeatured">—</b></div>
  <div class="kpi"><small>خرید نهنگ</small><b id="kWhales">—</b></div>
  <div class="kpi"><small>خروج همزمان</small><b id="kExits">—</b></div>
</section>

<div class="alerts" id="alerts"></div>

<nav class="tabs" id="tabs">
  <button class="tab active" data-tab="featured">🔥 پیشنهادها</button>
  <button class="tab" data-tab="whales">🐋 نهنگ‌ها</button>
  <button class="tab" data-tab="smart">🧠 اسمارت‌مانی</button>
  <button class="tab" data-tab="wallets">🏆 کیف‌پول‌ها</button>
  <button class="tab" data-tab="tokens">🪙 همه توکن‌ها</button>
</nav>

<div class="toolbar">
  <input id="search" placeholder="جستجو نام، نماد یا آدرس">
  <select id="securityFilter"><option value="">همه امنیت‌ها</option><option value="MAX SECURITY">امنیت خیلی بالا</option><option value="HIGH">امنیت بالا</option></select>
  <select id="activityFilter"><option value="">همه فعالیت‌ها</option><option value="PROBABLE ORGANIC">فعالیت طبیعی</option><option value="BOT RISK">ریسک ربات</option></select>
</div>

<section class="panel active" id="featuredPanel">
  <div class="section-title"><div><h2>پیشنهادهای اولویت‌دار</h2><p>امتیاز ۹۰/۱۰۰+؛ این عدد احتمال قطعی پامپ نیست.</p></div></div>
  <div class="list" id="featuredList"></div>
</section>

<section class="panel" id="whalesPanel">
  <div class="section-title"><div><h2>نهنگ‌ها</h2><p>خرید بزرگ اخیر و هشدار خروج.</p></div></div>
  <div class="list" id="whaleList"></div>
</section>

<section class="panel" id="smartPanel">
  <div class="section-title"><div><h2>اسمارت‌مانی</h2><p id="smartStatus">در حال دریافت…</p></div></div>
  <div class="list" id="smartList"></div>
</section>

<section class="panel" id="walletsPanel">
  <div class="section-title"><div><h2>۱۲ کیف‌پول برتر</h2><p id="walletStatus">در حال اسکن آن‌چین…</p></div></div>
  <div class="three">
    <div class="mini"><h3>💰 بیشترین سرمایه فعلی</h3><div id="topHoldings"></div></div>
    <div class="mini"><h3>🟢 بیشترین خرید خالص</h3><div id="topBuys"></div></div>
    <div class="mini"><h3>🤝 خرید همزمان</h3><div id="consensus"></div></div>
  </div>
  <div class="section-title" style="margin-top:13px"><div><h2>خود کیف‌پول‌ها</h2><p>آخرین حرکت و لینک بررسی.</p></div></div>
  <div class="list" id="walletList"></div>
</section>

<section class="panel" id="tokensPanel">
  <div class="section-title"><div><h2>همه توکن‌ها</h2><p>سه سیگنال زمانی + امنیت و هولدرها برای همه توکن‌های کشف‌شده رادار.</p></div></div>
  <div class="list" id="tokenList"></div>
</section>
</main>

<dialog id="detailDialog">
  <div class="modal-head"><b id="detailTitle">جزئیات</b><button id="closeDetail">×</button></div>
  <div class="modal-body" id="detailBody"></div>
</dialog>

<script>
var tokens=[],smart=null,live=null,tracked=null,activeTab='featured';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function money(v){var n=Number(v||0);if(!Number.isFinite(n))return '—';return '$'+n.toLocaleString(undefined,{maximumFractionDigits:n<1?4:0})}
function pct(v){return v==null?'—':Number(v).toFixed(1)+'%'}
function short(v){v=String(v||'');return v.length>16?v.slice(0,7)+'…'+v.slice(-6):v}
function faSec(v){return {'MAX SECURITY':'خیلی بالا','HIGH':'بالا','REVIEW':'بررسی','REJECT':'رد'}[v]||v||'—'}
function faAct(v){return {'PROBABLE ORGANIC':'طبیعی','MIXED':'ترکیبی','BOT RISK':'ریسک ربات'}[v]||v||'—'}
function faVerdict(v){return {'STRONG WATCH':'قوی','WATCH':'واچ','LOW SIGNAL':'ضعیف','SKIP':'رد','REVIEW':'بررسی'}[v]||v||'—'}
function secClass(v){return v==='MAX SECURITY'||v==='HIGH'?'good':v==='REJECT'?'bad':'mid'}
function verdictClass(v){return v==='STRONG WATCH'?'good':v==='SKIP'?'bad':'mid'}
function faSignal(v){return {'STRONG':'قوی','POSITIVE':'مثبت','NEUTRAL':'خنثی','AVOID':'ورود نکن','BLOCKED':'مسدود امنیتی','WAIT_DATA':'داده ناکافی'}[v]||v||'—'}
function signalClass(v){return v==='STRONG'||v==='POSITIVE'?'good':v==='AVOID'||v==='BLOCKED'?'bad':'mid'}

function dexUrl(mint,url){if(url)return url;var t=tokens.find(function(x){return x.mint===mint});if(t&&t.dexUrl)return t.dexUrl;var tr=tracked&&tracked.tokens?tracked.tokens.find(function(x){return x.mint===mint}):null;if(tr&&tr.dexUrl)return tr.dexUrl;return 'https://dexscreener.com/search?q='+encodeURIComponent(mint||'')}
function findToken(m){return tokens.find(function(x){return x.mint===m})||null}
function findTracked(m){return tracked&&tracked.tokens?tracked.tokens.find(function(x){return x.mint===m}):null}
function smartFor(m){return smart&&smart.tokens?smart.tokens.find(function(x){return x.address===m}):null}
function whaleFor(m){var r=live&&live.whaleBuys?live.whaleBuys.filter(function(x){return x.tokenAddress===m}):[];return {count:r.length,usd:r.reduce(function(a,x){return a+Number(x.tradeUsd||0)},0)}}
function exitFor(m){return live&&live.exits?live.exits.filter(function(x){return x.tokenAddress===m}):[]}
async function safeJson(u){try{var r=await fetch(u,{cache:'no-store'});if(!r.ok)throw 0;return await r.json()}catch(e){return null}}

function featuredRows(){
  return tokens.map(function(t){
    var s=0,w=[],sec=t.security&&t.security.tier?t.security.tier:'REVIEW';
    if(sec==='MAX SECURITY'){s+=22;w.push('امنیت خیلی بالا')}else if(sec==='HIGH')s+=14;
    if(t.activity&&t.activity.score>=72){s+=14;w.push('فعالیت طبیعی')}
    if(t.trend&&t.trend.score>=60){s+=11;w.push('ترند قوی')}
    if(Number(t.liquidity)>=10000)s+=9;
    if(Number(t.volume5m)>=5000){s+=10;w.push('حجم قوی')}
    if(Number(t.txns5m)>=50)s+=6;
    if((Number(t.buys5m)+1)/(Number(t.sells5m)+1)>=1.35){s+=8;w.push('فشار خرید')}
    if(t.security&&t.security.holderStrong){s+=7;w.push('هولدر مناسب')}
    if(t.marketQuality&&t.marketQuality.score>=80)s+=7;
    if(t.chart&&t.chart.pumpDumpRisk==='HIGH')s-=25;
    if(t.chart&&t.chart.fomoRisk==='HIGH')s-=12;
    if(t.academy&&t.academy.blocked)s-=25;
    var sm=smartFor(t.mint);if(sm){s+=Math.min(10,5+Number(sm.smartMoneyCount||0)*2);w.push('اسمارت‌مانی')}
    var wh=whaleFor(t.mint);if(wh.count){s+=Math.min(14,7+wh.count*3);w.push('خرید نهنگ')}
    var tr=findTracked(t.mint);if(tr&&tr.uniqueBuyers>=2&&tr.netFlowUsd>0){s+=12;w.push('خرید همزمان کیف‌پول‌ها')}else if(tr&&tr.uniqueBuyers>=1&&tr.netFlowUsd>0)s+=5;
    if(tr&&tr.uniqueSellers>=2)s-=18;
    if(exitFor(t.mint).length)s-=28;
    s=Math.max(0,Math.min(100,Math.round(s)));
    return {token:t,score:s,why:w,whale:wh,smart:sm,tracked:tr};
  }).filter(function(x){return x.score>=90&&(!x.token.chart||x.token.chart.pumpDumpRisk!=='HIGH')&&(!x.token.academy||!x.token.academy.blocked)&&!exitFor(x.token.mint).length})
    .sort(function(a,b){return b.score-a.score}).slice(0,8);
}

function tokenRow(t){
  var s=t.security||{},g=t.securityGate||{},sg=t.signals||{},sh=sg.short||{},md=sg.medium||{},lg=sg.long||{};
  return '<div class="row">'+
  '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><small>'+esc(short(t.mint))+'</small></div>'+
  '<div class="cell"><small>کوتاه</small><b><span class="badge '+signalClass(sh.label)+'">'+esc(faSignal(sh.label))+' '+Number(sh.score||0)+'</span></b></div>'+
  '<div class="cell"><small>میان</small><b><span class="badge '+signalClass(md.label)+'">'+esc(faSignal(md.label))+' '+Number(md.score||0)+'</span></b></div>'+
  '<div class="cell"><small>بلند</small><b><span class="badge '+signalClass(lg.label)+'">'+esc(faSignal(lg.label))+' '+Number(lg.score||0)+'</span></b></div>'+
  '<div class="cell hide-sm"><small>امنیت</small><b><span class="badge '+secClass(s.tier)+'">'+esc(faSec(s.tier))+'</span></b></div>'+
  '<div class="cell hide-md"><small>Top1 / 2-10</small><b>'+pct(s.largestHolder)+' / '+pct(s.maxOtherHolder)+'</b></div>'+
  '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
}

function renderFeatured(){
  var r=featuredRows();document.getElementById('kFeatured').textContent=r.length;
  document.getElementById('featuredList').innerHTML=r.length?r.map(function(x){
    var t=x.token;
    return '<div class="row"><div class="asset"><b>🔥 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><small>'+esc(x.why.slice(0,3).join(' • '))+'</small></div>'+
    '<div class="cell"><small>امتیاز</small><b><span class="badge good">'+x.score+'/100</span></b></div>'+
    '<div class="cell"><small>نهنگ</small><b>'+money(x.whale.usd)+'</b></div>'+
    '<div class="cell"><small>اسمارت</small><b>'+(x.smart?Number(x.smart.smartMoneyCount||0):0)+'</b></div>'+
    '<div class="cell hide-sm"><small>کیف‌پول برتر</small><b>'+(x.tracked?Number(x.tracked.uniqueBuyers||0):0)+'</b></div>'+
    '<div class="cell hide-md"><small>Vol 5m</small><b>'+money(t.volume5m)+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً هیچ توکنی معیار سخت‌گیرانه ۹۰/۱۰۰ را رد نکرده.</div>';
}
function renderWhales(){
  var r=live&&live.whaleBuys?live.whaleBuys:[];
  document.getElementById('kWhales').textContent=r.length;
  document.getElementById('whaleList').innerHTML=r.length?r.slice(0,20).map(function(e){
    var t=findToken(e.tokenAddress),s=t&&t.security?t.security:{};
    return '<div class="row"><div class="asset"><b>🐋 '+esc(e.token||t&&t.symbol||'?')+'</b><small>'+esc(short(e.tokenAddress))+' · '+esc(e.trader||'نامشخص')+'</small></div>'+
    '<div class="cell"><small>خرید</small><b>'+money(e.tradeUsd)+'</b></div><div class="cell"><small>پوزیشن</small><b>'+money(e.positionValueUsd)+'</b></div>'+
    '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(s.tier)+'">'+esc(faSec(s.tier))+'</span></b></div>'+
    '<div class="cell hide-sm"><small>زمان</small><b>'+new Date(Number(e.ts||Date.now())).toLocaleTimeString('fa-IR')+'</b></div>'+
    '<div class="cell hide-md"><small>خروج</small><b>'+exitFor(e.tokenAddress).length+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(e.tokenAddress,''))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(e.tokenAddress)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً خرید نهنگ تازه‌ای ثبت نشده.</div>';
}
function renderSmart(){
  var r=smart&&smart.tokens?smart.tokens:[];
  document.getElementById('smartStatus').textContent=smart&&smart.configured?'پوزیشن‌های فعلی کیف‌پول‌های سودده':'منبع کامل اسمارت‌مانی نیاز به API key دارد.';
  document.getElementById('smartList').innerHTML=r.length?r.slice(0,20).map(function(t){
    var s=t.security||{};
    return '<div class="row"><div class="asset"><b>🧠 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><small>'+esc(short(t.address))+'</small></div>'+
    '<div class="cell"><small>کیف‌پول</small><b>'+Number(t.smartMoneyCount||0)+'</b></div><div class="cell"><small>ارزش پوزیشن</small><b>'+money(t.totalValueUsd)+'</b></div>'+
    '<div class="cell"><small>نقدینگی</small><b>'+money(t.liquidity)+'</b></div><div class="cell hide-sm"><small>Top10</small><b>'+pct(s.top10)+'</b></div>'+
    '<div class="cell hide-md"><small>امنیت</small><b><span class="badge '+secClass(s.tier)+'">'+esc(faSec(s.tier))+'</span></b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.address,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.address)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً پوزیشن اسمارت‌مانی قابل‌نمایش نیست.</div>';
}
function miniRows(r,m){
  if(!r||!r.length)return '<div class="mini-row"><span>موردی نیست</span><b>—</b></div>';
  return r.slice(0,5).map(function(t){var v=m==='hold'?money(t.currentHoldingUsd):m==='buy'?money(t.netFlowUsd):(Number(t.uniqueBuyers||0)+' خریدار');return '<div class="mini-row"><span>'+esc(t.symbol||short(t.mint))+'</span><b>'+v+'</b></div>'}).join('');
}
function renderWallets(){
  if(!tracked){document.getElementById('walletStatus').textContent='داده در دسترس نیست';return}
  document.getElementById('walletStatus').textContent='آخرین اسکن: '+new Date(tracked.generatedAt||Date.now()).toLocaleTimeString('fa-IR')+' · '+(tracked.wallets?tracked.wallets.length:0)+' کیف‌پول';
  document.getElementById('topHoldings').innerHTML=miniRows(tracked.topHoldings,'hold');document.getElementById('topBuys').innerHTML=miniRows(tracked.topNetBuys,'buy');document.getElementById('consensus').innerHTML=miniRows(tracked.consensus,'consensus');
  var r=tracked.wallets||[];
  document.getElementById('walletList').innerHTML=r.length?r.map(function(w){
    var e=w.events&&w.events[0]?w.events[0]:null;
    return '<div class="row"><div class="asset"><b>'+esc(w.name)+'</b><small>'+esc(short(w.address))+' · '+esc(w.speed||'')+'</small></div>'+
    '<div class="cell"><small>PnL Seed</small><b>'+money(w.seedPnl30d)+'</b></div><div class="cell"><small>Win Rate</small><b>'+pct(w.seedWinRate)+'</b></div>'+
    '<div class="cell"><small>آخرین حرکت</small><b>'+(e?(e.side==='BUY'?'🟢 خرید ':'🔴 فروش ')+money(e.approxUsd):'—')+'</b></div>'+
    '<div class="cell hide-sm"><small>توکن</small><b>'+(e?esc(e.symbol||short(e.mint)):'—')+'</b></div>'+
    '<div class="cell hide-md"><small>Median Hold</small><b>'+(w.medianHoldSec==null?'—':w.medianHoldSec+'s')+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(w.solscanUrl)+'">Solscan</a><a class="action" target="_blank" rel="noopener" href="'+esc(w.gmgnUrl)+'">GMGN</a></div></div>';
  }).join(''):'<div class="empty">کیف‌پولی برای نمایش نیست.</div>';
}
function filteredTokens(){
  var q=document.getElementById('search').value.toLowerCase().trim(),sf=document.getElementById('securityFilter').value,af=document.getElementById('activityFilter').value;
  return tokens.filter(function(t){return (!q||[t.name,t.symbol,t.mint].join(' ').toLowerCase().includes(q))&&(!sf||(t.security&&t.security.tier===sf))&&(!af||(t.activity&&t.activity.label===af))});
}
function renderTokens(){var r=filteredTokens();document.getElementById('tokenList').innerHTML=r.length?r.map(tokenRow).join(''):'<div class="empty">موردی با این فیلترها نیست.</div>'}
function renderAlerts(){
  var c=live&&live.exitClusters?live.exitClusters.filter(function(x){return x.severity==='MULTI-WALLET EXIT'}).slice(0,3):[];
  document.getElementById('kExits').textContent=c.length;document.getElementById('alerts').innerHTML=c.map(function(x){return '<div class="alert">🚨 خروج همزمان چند کیف‌پول از <b>'+esc(x.token||short(x.tokenAddress))+'</b> · '+Number(x.uniqueSellers||0)+' فروشنده</div>'}).join('');
}
function renderAll(){document.getElementById('kTokens').textContent=tokens.length;renderAlerts();renderFeatured();renderWhales();renderSmart();renderWallets();renderTokens()}
function stateLabel(v){return v==='pass'?'<span class="pass">✓ تأیید</span>':v==='fail'?'<span class="fail">✕ رد</span>':'<span class="manual">◌ دستی</span>'}
function openDetail(m){
  var t=findToken(m),tr=findTracked(m),sm=smartFor(m),wh=whaleFor(m),name=t?(t.symbol+' · '+t.name):(tr?(tr.symbol+' · '+tr.name):short(m)),h='';
  document.getElementById('detailTitle').textContent=name;
  if(t){
    var s=t.security||{},a=t.activity||{},mq=t.marketQuality||{},ch=t.chart||{},ac=t.academy||{};
    h+='<div class="modal-grid"><div class="box"><small>امنیت</small><b>'+esc(faSec(s.tier))+' · '+Number(s.score||0)+'/100</b></div><div class="box"><small>فعالیت</small><b>'+esc(faAct(a.label))+' · '+Number(a.score||0)+'/100</b></div><div class="box"><small>ترند</small><b>'+Number(t.trend&&t.trend.score||0)+'/100</b></div><div class="box"><small>Market Cap</small><b>'+money(t.marketCap)+'</b></div><div class="box"><small>Liquidity</small><b>'+money(t.liquidity)+'</b></div><div class="box"><small>Vol 5m</small><b>'+money(t.volume5m)+'</b></div><div class="box"><small>هولدر #1</small><b>'+pct(s.largestHolder)+'</b></div><div class="box"><small>بیشترین 2-10</small><b>'+pct(s.maxOtherHolder)+'</b></div><div class="box"><small>Top10</small><b>'+pct(s.top10)+'</b></div><div class="box"><small>کیفیت بازار</small><b>'+Number(mq.score||0)+'/100</b></div><div class="box"><small>FOMO</small><b>'+esc(ch.fomoRisk||'—')+'</b></div><div class="box"><small>Pump/Dump</small><b>'+esc(ch.pumpDumpRisk||'—')+'</b></div></div>';
    h+='<div class="holders"><b>هولدرهای بزرگ</b>'+(s.topHolders&&s.topHolders.length?s.topHolders.slice(0,10).map(function(x,i){return '<div class="holder"><span>#'+(i+1)+' · '+pct(x.pct)+'</span><a target="_blank" rel="noopener" href="https://solscan.io/account/'+esc(x.owner)+'">'+esc(short(x.owner))+'</a></div>'}).join(''):'<div class="note">داده هولدر موجود نیست.</div>')+'</div>';
    if(ac.checks&&ac.checks.length)h+='<div class="holders"><b>چک‌لیست امنیتی</b>'+ac.checks.map(function(c){return '<div class="check"><span>'+esc(c.name)+'</span>'+stateLabel(c.state)+'</div>'}).join('')+'</div>';
  }
  if(tr)h+='<div class="note"><b>کیف‌پول‌های برتر:</b> '+Number(tr.uniqueBuyers||0)+' خریدار، '+Number(tr.uniqueSellers||0)+' فروشنده، جریان خالص '+money(tr.netFlowUsd)+'، هولدینگ '+money(tr.currentHoldingUsd)+'</div>';
  if(sm)h+='<div class="note"><b>اسمارت‌مانی:</b> '+Number(sm.smartMoneyCount||0)+' کیف‌پول · '+money(sm.totalValueUsd)+' پوزیشن</div>';
  if(wh.count)h+='<div class="note"><b>نهنگ:</b> '+wh.count+' خرید بزرگ · '+money(wh.usd)+'</div>';
  h+='<div class="links"><a target="_blank" rel="noopener" href="'+esc(dexUrl(m,t&&t.dexUrl))+'">📈 DexScreener</a><a target="_blank" rel="noopener" href="https://solscan.io/token/'+encodeURIComponent(m)+'">Solscan</a><a target="_blank" rel="noopener" href="https://gmgn.ai/sol/token/'+encodeURIComponent(m)+'">GMGN</a><a target="_blank" rel="noopener" href="https://v2.bubblemaps.io/map?address='+encodeURIComponent(m)+'&chain=solana&partnerId=regular">Bubblemaps</a><a target="_blank" rel="noopener" href="https://www.solanatracker.io/rugcheck/'+encodeURIComponent(m)+'">Rugcheck</a></div><div class="note">این رادار ابزار تحقیق است؛ هیچ امتیازی تضمین سود یا نبود کلاهبرداری نیست.</div>';
  document.getElementById('detailBody').innerHTML=h;document.getElementById('detailDialog').showModal();
}
async function loadAll(){
  var b=document.getElementById('refresh');b.disabled=true;b.textContent='در حال دریافت…';
  var r=await Promise.all([safeJson('/api/v1/tokens'),safeJson('/api/v1/smart-money'),safeJson('/api/v1/smart-money-live'),safeJson('/api/v1/tracked-wallets')]);
  tokens=r[0]&&r[0].tokens?r[0].tokens:[];smart=r[1];live=r[2];tracked=r[3];
  document.getElementById('updated').textContent='آخرین بروزرسانی: '+new Date().toLocaleTimeString('fa-IR');b.disabled=false;b.textContent='↻ بروزرسانی';renderAll();
}
document.addEventListener('click',function(e){var d=e.target.closest('.detail-btn');if(!d)return;openDetail(d.getAttribute('data-mint')||'')});
document.getElementById('tabs').addEventListener('click',function(e){var b=e.target.closest('[data-tab]');if(!b)return;activeTab=b.dataset.tab;document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x===b)});document.querySelectorAll('.panel').forEach(function(x){x.classList.remove('active')});document.getElementById(activeTab+'Panel').classList.add('active')});
document.getElementById('search').addEventListener('input',renderTokens);document.getElementById('securityFilter').addEventListener('change',renderTokens);document.getElementById('activityFilter').addEventListener('change',renderTokens);document.getElementById('refresh').addEventListener('click',loadAll);document.getElementById('closeDetail').addEventListener('click',function(){document.getElementById('detailDialog').close()});document.getElementById('detailDialog').addEventListener('click',function(e){if(e.target===this)this.close()});
loadAll();setInterval(loadAll,60000);
</script>
</body>
</html>`;

createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(url.pathname==='/api/health'){res.writeHead(200,{'content-type':'application/json',...headers});return res.end(JSON.stringify({ok:true,time:new Date().toISOString()}))}
    if(url.pathname==='/api/v1/tracked-wallets'){const tw=await buildTrackedWallets();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(tw))}
    if(url.pathname==='/api/v1/smart-money'){const sm=await buildSmartMoney();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(sm))}
    if(url.pathname==='/api/v1/smart-money-live'){const sm=liveSmartMoneyPayload();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(sm))}
    if(url.pathname==='/api/v1/tokens'||url.pathname==='/api/radar'||url.pathname==='/api/v1/trending'){
      const d=await build(); let body=d;
      if(url.pathname==='/api/v1/trending')body={...d,tokens:[...d.tokens].sort((a,b)=>b.trend.score-a.trend.score)};
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(body));
    }
    if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',...headers});return res.end(html())}
    res.writeHead(404,headers);res.end('Not found');
  }catch(e){res.writeHead(502,{'content-type':'application/json',...headers});res.end(JSON.stringify({ok:false,error:String(e?.message||e)}))}
}).listen(PORT,'0.0.0.0',()=>console.log('Solana Meme Radar v3 live on '+PORT));
