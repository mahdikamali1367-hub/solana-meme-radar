import {createServer} from 'node:http';

const PORT=Number(process.env.PORT||4173);
const RPC=process.env.SOLANA_RPC_URL||'https://api.mainnet.solana.com';
const CACHE_MS=55_000;
const SOCIAL_QUERY_CACHE_MS=2*60*60*1000;
const socialQueryCache=new Map();
const SECURITY_CACHE_MS=5*60*1000;
let cache={at:0,data:null};
const securityCache=new Map();
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
  {name:'Cap',address:'CAPn1yH4oSywsxGU456jfgTrSSUidf9jgeAnHceNUJdw',source:'KOL Explorer',sourceUrl:'https://kolexplorer.com/kol/cap',seedPnl30d:234612,seedWinRate:41.8,medianHoldSec:60},
  {name:'moonlobsterdisc',address:'CFzVktB6sfK8rpewZeJ5VRPcvG5BBtK6pSbZ7FHVze4V',source:'Solana Tracker',sourceUrl:'https://www.solanatracker.io/wallet/CFzVktB6sfK8rpewZeJ5VRPcvG5BBtK6pSbZ7FHVze4V',seedPnl30d:9530000,seedWinRate:37.3,medianHoldSec:null}
];
let trackedWalletCache={at:0,data:null};
const TRACKED_WALLET_CACHE_MS=5*60*1000;
let convictionCache={at:0,data:null};
const CONVICTION_CACHE_MS=30*60*1000;


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
  let last;
  for(let i=0;i<3;i++){
    try{
      return await jfetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    }catch(e){
      last=e;
      if(i<2)await sleep(180*(i+1));
    }
  }
  throw last;
}

async function tfetch(url,opt={},timeout=12000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{...opt,signal:c.signal,headers:{'user-agent':'Mozilla/5.0 SolanaMemeRadar/1.0',...(opt.headers||{})}});
    if(!r.ok)throw new Error(r.status+' '+r.statusText);
    return await r.text();
  }finally{clearTimeout(t)}
}
function humanNum(v){
  const m=String(v||'').replace(/,/g,'').trim().match(/^(-?\$?)([\d.]+)\s*([KMB])?$/i);
  if(!m)return num(String(v||'').replace(/[$,]/g,''));
  const n=num(m[2]),u=(m[3]||'').toUpperCase();
  return n*(u==='K'?1e3:u==='M'?1e6:u==='B'?1e9:1);
}
async function pairsForMany(mints){
  const uniq=[...new Set((mints||[]).filter(Boolean))].slice(0,900);
  const batches=[];for(let i=0;i<uniq.length;i+=30)batches.push(uniq.slice(i,i+30));
  const out=new Map();
  const settled=await Promise.allSettled(batches.map(async batch=>{
    const rows=await jfetch('https://api.dexscreener.com/tokens/v1/solana/'+batch.join(','),{},12000);
    return Array.isArray(rows)?rows:[];
  }));
  for(const r of settled){
    if(r.status!=='fulfilled')continue;
    for(const p of r.value){
      const addr=p?.baseToken?.address||p?.quoteToken?.address;if(!addr)continue;
      const old=out.get(addr);
      if(!old||num(p?.liquidity?.usd)>num(old?.liquidity?.usd))out.set(addr,p);
    }
  }
  return out;
}
function stripHtml(x){
  return String(x||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
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
  const cached=securityCache.get(mint);
  if(cached&&Date.now()-cached.at<SECURITY_CACHE_MS)return cached.data;
  let mintDisabled=null,freezeDisabled=null,top5=null,top10=null,largestHolder=null,maxOtherHolder=null,holderGrade='UNKNOWN',flags=[],score=50,coverage=0,topHolders=[],ownerAggregationComplete=false;
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
        ownerAggregationComplete=parsed.length>=Math.min(rows.length,10)&&parsed.slice(0,Math.min(rows.length,10)).every(Boolean);
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
  let holderPolicyPassed=null,holderStrong=null;
  if(top10==null){
    holderGrade='UNKNOWN';flags.push('داده هولدرها نامشخص');
  }else if(!ownerAggregationComplete){
    holderGrade='UNKNOWN';flags.push('تجمیع مالک هولدرها ناقص؛ نتیجه قطعی نیست');
  }else{
    holderPolicyPassed=['A','B','C'].includes(holderGrade);
    holderStrong=['A','B'].includes(holderGrade);
  }
  const result={score:clamp(score),coverage,mintDisabled,freezeDisabled,top5,top10,largestHolder,maxOtherHolder,holderGrade,holderPolicyPassed,holderStrong,ownerAggregationComplete,topHolders,flags};
  securityCache.set(mint,{at:Date.now(),data:result});
  return result;
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
    else if(u.includes('facebook.com')||u.includes('fb.com'))add('Facebook',x.url);
    else if(u.includes('tiktok.com'))add('TikTok',x.url);
    else if(u.includes('reddit.com'))add('Reddit',x.url);
    else if(u.includes('bsky.app')||u.includes('bluesky'))add('Bluesky',x.url);
    else add('Website',x.url);
  }
  return sources;
}

async function xSignal(t){
  const key=process.env.X_BEARER_TOKEN;
  if(!key)return {configured:false,posts2h:0,engagement2h:0};
  const ck='x:'+t.mint,c=socialQueryCache.get(ck);
  if(c&&Date.now()-c.at<SOCIAL_QUERY_CACHE_MS)return c.data;
  const symbolPart=t.symbol&&String(t.symbol).length>=2?(' OR $'+String(t.symbol)+' OR "'+String(t.symbol)+' solana"'):'';
  const q='('+t.mint+symbolPart+') -is:retweet';
  const startTime=new Date(Date.now()-2*60*60*1000).toISOString();
  let d=null;
  const headers={authorization:'Bearer '+key};
  const path='?query='+encodeURIComponent(q)+'&max_results=10&start_time='+encodeURIComponent(startTime)+'&tweet.fields=public_metrics,created_at';
  try{d=await jfetch('https://api.x.com/2/tweets/search/recent'+path,{headers},12000)}
  catch{
    try{d=await jfetch('https://api.twitter.com/2/tweets/search/recent'+path,{headers},12000)}catch{}
  }
  const rows=Array.isArray(d?.data)?d.data:[];
  let engagement=0;
  for(const p of rows){
    const m=p?.public_metrics||{};
    engagement+=num(m.like_count)+num(m.retweet_count)*2+num(m.reply_count)+num(m.quote_count)*2;
  }
  const data={configured:true,posts2h:num(d?.meta?.result_count,rows.length),engagement2h:engagement};
  socialQueryCache.set(ck,{at:Date.now(),data});return data;
}
async function youtubeSignal(t){
  const key=process.env.YOUTUBE_API_KEY;
  if(!key)return {configured:false,videos24h:0};
  const ck='yt:'+t.mint,c=socialQueryCache.get(ck);
  if(c&&Date.now()-c.at<SOCIAL_QUERY_CACHE_MS)return c.data;
  const publishedAfter=new Date(Date.now()-24*60*60*1000).toISOString();
  const q=[t.symbol&&String(t.symbol).length>=2?t.symbol:'',t.name||'',t.mint,'solana'].filter(Boolean).join(' ');
  let d=null;
  try{
    d=await jfetch('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=10&publishedAfter='+encodeURIComponent(publishedAfter)+'&q='+encodeURIComponent(q)+'&key='+encodeURIComponent(key),{},12000);
  }catch{}
  const data={configured:true,videos24h:Array.isArray(d?.items)?d.items.length:0,totalApprox:num(d?.pageInfo?.totalResults)};
  socialQueryCache.set(ck,{at:Date.now(),data});return data;
}
function socialHeatScore(t){
  const names=new Set((t.socialSources||[]).map(x=>x.name).filter(x=>x!=='Website'));
  const b=t.bluesky||{},x=t.xSocial||{},y=t.youtubeSocial||{};
  let score=Math.min(22,names.size*4),reasons=[];
  if(names.size>=3)reasons.push(names.size+' شبکه رسمی');
  if(num(b.mentions2h)>0){score+=Math.min(20,num(b.mentions2h)*3);reasons.push('Bluesky '+num(b.mentions2h)+' mention / 2h')}
  if(num(b.engagement2h)>0)score+=Math.min(5,Math.log10(1+num(b.engagement2h))*3);
  if(num(x.posts2h)>0){score+=Math.min(30,num(x.posts2h)*4);reasons.push('X '+num(x.posts2h)+' پست / 2h')}
  if(num(x.engagement2h)>0)score+=Math.min(8,Math.log10(1+num(x.engagement2h))*4);
  if(num(y.videos24h)>0){score+=Math.min(20,num(y.videos24h)*4);reasons.push('YouTube '+num(y.videos24h)+' ویدیو / 24h')}
  score=clamp(Math.round(score));
  const label=score>=75?'VIRAL':score>=55?'HOT':score>=35?'WARM':'LOW';
  return {score,label,reasons,sources:[...names],xPosts2h:num(x.posts2h),youtubeVideos24h:num(y.videos24h),blueskyMentions2h:num(b.mentions2h)};
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
  if(socialCount>=2)reasons.push(socialCount+' شبکه اجتماعی لینک‌شده');
  if(socialNames.has('X'))score+=3;
  if(socialNames.has('Telegram'))score+=2;
  if(socialNames.has('YouTube')||socialNames.has('Instagram')||socialNames.has('TikTok')||socialNames.has('Facebook'))score+=2;
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



function flowQuality(t){
  const ratioPct=(b,s)=>{const total=num(b)+num(s);return total>0?num(b)/total*100:null};
  const buyer5=ratioPct(t.buys5m,t.sells5m);
  const buyer1h=ratioPct(t.buys1h,t.sells1h);
  const buyer6h=ratioPct(t.buys6h,t.sells6h);
  const liq=num(t.liquidity),v5=num(t.volume5m),v1=num(t.volume1h),tx5=num(t.txns5m);
  const volLiq=liq>0?v5/liq:null;
  let volumeScore=0,volumeLabel='LOW',flags=[];
  if(v5>=10000)volumeScore+=35; else if(v5>=5000)volumeScore+=28; else if(v5>=2000)volumeScore+=18; else if(v5>=500)volumeScore+=8;
  if(v1>=50000)volumeScore+=20; else if(v1>=20000)volumeScore+=15; else if(v1>=5000)volumeScore+=8;
  if(tx5>=80)volumeScore+=20; else if(tx5>=50)volumeScore+=15; else if(tx5>=25)volumeScore+=8;
  if(volLiq!=null){
    if(volLiq>=0.08&&volLiq<=1.2)volumeScore+=25;
    else if(volLiq>=0.03&&volLiq<=1.5)volumeScore+=15;
    else if(volLiq>2){volumeScore-=25;flags.push('حجم نسبت به نقدینگی غیرعادی/واش محتمل')}
    else if(volLiq<0.01)flags.push('حجم نسبت به نقدینگی کم');
  }
  volumeScore=clamp(Math.round(volumeScore));
  volumeLabel=volumeScore>=80?'STRONG':volumeScore>=60?'GOOD':volumeScore>=40?'MEDIUM':volumeScore>=20?'LOW':'WEAK';
  if(volLiq!=null&&volLiq>2)volumeLabel='SUSPICIOUS';

  let buyerScore=50;
  if(buyer5!=null)buyerScore=buyer5;
  if(buyer1h!=null)buyerScore=buyer5==null?buyer1h:buyer5*0.65+buyer1h*0.35;
  buyerScore=clamp(Math.round(buyerScore));
  const buyerDominant=buyer5!=null&&buyer5>=55&&(buyer1h==null||buyer1h>=51);
  const sellerDominant=buyer5!=null&&buyer5<45&&(buyer1h==null||buyer1h<49);
  const pressureLabel=buyerDominant?'BUYERS':sellerDominant?'SELLERS':'BALANCED';
  return {buyerPower:buyerScore,buyerPower5m:buyer5==null?null:+buyer5.toFixed(1),buyerPower1h:buyer1h==null?null:+buyer1h.toFixed(1),buyerPower6h:buyer6h==null?null:+buyer6h.toFixed(1),buyerDominant,sellerDominant,pressureLabel,volumeScore,volumeLabel,volumeLiquidity:volLiq,flags};
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
  checks.push({name:'حجم معاملات سالم',state:(t.flow?.volumeLabel==='STRONG'||t.flow?.volumeLabel==='GOOD')?'pass':t.flow?.volumeLabel==='SUSPICIOUS'?'fail':'manual'});
  checks.push({name:'قدرت خریدار بیشتر از فروشنده',state:t.flow?.buyerDominant?'pass':t.flow?.sellerDominant?'fail':'manual'});
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
    t.activity?.label==='BOT RISK'||chart.pumpDumpRisk==='HIGH'||t.flow?.volumeLabel==='SUSPICIOUS'||(mq.liqRatio>0&&mq.liqRatio<0.02);
  const blocked=criticalFail||fail>=2;
  const score=Math.round(pass/checks.length*100);
  const label=blocked?'BLOCK':fail===0&&pass>=6?'BASIC PASS':fail===0?'NEEDS REVIEW':'CAUTION';
  return {score,label,pass,fail,manual,blocked,checks,source:'memecoin-academy-derived rules; manual checks remain manual'};
}


function securityGate(t){
  const sec=t.security||{},mq=t.marketQuality||{},act=t.activity||{},chart=t.chart||{},academy=t.academy||{};
  const hard=[],cautions=[];
  if(sec.mintDisabled===false)hard.push('Mint authority فعال');
  else if(sec.mintDisabled!==true)cautions.push('Mint authority نامشخص');
  if(sec.freezeDisabled===false)hard.push('Freeze authority فعال');
  else if(sec.freezeDisabled!==true)cautions.push('Freeze authority نامشخص');
  if(sec.holderPolicyPassed===false)hard.push('توزیع هولدرها رد شده');
  else if(sec.holderPolicyPassed!==true)cautions.push('توزیع هولدرها نیازمند داده کامل‌تر');
  if(act.label==='BOT RISK')hard.push('ریسک ربات/Wash');
  else if(!act.label)cautions.push('فعالیت معاملاتی نامشخص');
  if(chart.pumpDumpRisk==='HIGH')hard.push('ریسک Pump/Dump بالا');
  if(academy.blocked)hard.push('Academy Guard مسدود');
  if(num(t.liquidity)>0&&num(t.liquidity)<3000)hard.push('نقدینگی خیلی کم');
  else if(num(t.liquidity)<=0)cautions.push('نقدینگی نامشخص');
  if(num(mq.score)<65)cautions.push('کیفیت بازار/داده متوسط یا پایین');
  if(sec.tier==='REVIEW')cautions.push('امنیت هنوز کامل تأیید نشده');
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
  if(t.flow?.volumeLabel==='STRONG')add(8,'حجم معاملات قوی');
  else if(t.flow?.volumeLabel==='GOOD')add(5,'حجم معاملات خوب');
  else if(t.flow?.volumeLabel==='SUSPICIOUS')add(-14,'حجم غیرعادی/مشکوک');
  if(t.flow?.buyerDominant)add(8,'قدرت خریدار بیشتر از فروشنده');
  else if(t.flow?.sellerDominant)add(-12,'قدرت فروشنده غالب');
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
  if(gate.level==='CAUTION')score=Math.min(score,74);
  score=clamp(Math.round(score));
  let confidence=gate.level==='CAUTION'?'MEDIUM':'HIGH';
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
  const s=t.security||{};
  const explicitFail=
    s.mintDisabled===false||
    s.freezeDisabled===false||
    s.holderPolicyPassed===false||
    t.activity?.label==='BOT RISK'||
    t.chart?.pumpDumpRisk==='HIGH'||
    t.academy?.blocked===true||
    (num(t.liquidity)>0&&num(t.liquidity)<3000);

  const verifiedCore=s.mintDisabled===true&&s.freezeDisabled===true&&s.holderPolicyPassed===true;
  const organicOk=t.activity&&t.activity.score>=72&&t.activity.label==='PROBABLE ORGANIC';
  const organicHigh=t.activity&&t.activity.score>=58&&t.activity.label!=='BOT RISK';
  const knowledgeOk=t.academy?.blocked!==true&&(t.marketQuality?.score??0)>=65&&t.chart?.pumpDumpRisk!=='HIGH';

  const maxOk=!explicitFail&&verifiedCore&&organicOk&&knowledgeOk&&s.holderStrong===true&&s.score>=85&&t.liquidity>=10000;
  const highOk=!explicitFail&&verifiedCore&&organicHigh&&s.score>=75&&t.liquidity>=5000;
  const tier=explicitFail?'REJECT':maxOk?'MAX SECURITY':highOk?'HIGH':'REVIEW';
  return {tier,maxOk,highOk,explicitFail,verifiedCore};
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
    if(ageMinutes>43200)continue;
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
    t.xSocial={configured:!!process.env.X_BEARER_TOKEN,posts2h:0,engagement2h:0};
    t.youtubeSocial={configured:!!process.env.YOUTUBE_API_KEY,videos24h:0};
    t.activity=activityScore(t);
    t.flow=flowQuality(t);
    t.trend=trendScore(t,s);
    t.socialHeat=socialHeatScore(t);
    t.marketQuality=marketQualityScore(t);
    t.chart=chartDiscipline(t);
    t.academy=academyGuard(t);
    t.signals=multiHorizonSignals(t);
    t.verdict=verdict(t); out.push(t); await sleep(55);
  }
  const pre=[...out].sort((a,b)=>b.trend.score-a.trend.score).slice(0,10);
  for(let i=0;i<pre.length;i++){
    const t=pre[i];
    const jobs=[blueskySignal(t)];
    if(i<5){jobs.push(xSignal(t),youtubeSignal(t))}
    const r=await Promise.allSettled(jobs);
    if(r[0]?.status==='fulfilled')t.bluesky=r[0].value;
    if(i<5&&r[1]?.status==='fulfilled')t.xSocial=r[1].value;
    if(i<5&&r[2]?.status==='fulfilled')t.youtubeSocial=r[2].value;
    t.socialHeat=socialHeatScore(t);
    const b=t.bluesky||{},x=t.xSocial||{},y=t.youtubeSocial||{};
    let liveBonus=0;
    if(num(b.mentions2h)>0)liveBonus+=Math.min(10,num(b.mentions2h)*2);
    if(num(x.posts2h)>0)liveBonus+=Math.min(12,num(x.posts2h)*2);
    if(num(y.videos24h)>0)liveBonus+=Math.min(9,num(y.videos24h)*3);
    if(liveBonus>0){
      t.trend.score=clamp(t.trend.score+Math.min(25,liveBonus));
      t.trend.reasons.push(...t.socialHeat.reasons.slice(0,3));
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
    sourceStatus:{dexscreener:'live',solanaRpc:'live',bluesky:'live-public',x:process.env.X_BEARER_TOKEN?'live-api':'needs API key',youtube:process.env.YOUTUBE_API_KEY?'live-api':'needs API key',reddit:process.env.REDDIT_CLIENT_ID?'configured':'presence-only',instagram:'presence-only',facebook:'presence-only',tiktok:'presence-only',telegram:'presence-only'},
    holderPolicy:{hardRules:{holder1MaxPct:10,holders2to10EachMaxPct:5},gradeA:{holder1MaxPct:5,holders2to10EachMaxPct:2.5},gradeB:{holder1MaxPct:7.5,holders2to10EachMaxPct:4},gradeC:{holder1MaxPct:10,holders2to10EachMaxPct:5},unknownFailsStrong:true},
    activityPolicy:{probableOrganicMin:72,highSecurityMin:58,method:'aggregate heuristics; not proof of human identity'},
    orderFlowPolicy:{buyerPower:'buy transaction count / total buy+sell transactions; not dollar buy volume',strongBuyer:'5m >=55% and 1h >=51% when available',volumeQuality:'absolute volume + tx count + volume/liquidity sanity check'},
    knowledgeEngine:{marketQuality:'transparency + liquidity + data coverage',chartDiscipline:'trend + FOMO + pump/dump guard',academy:'rug/honeypot/MEV/sniper/risk checklist; unknown checks stay manual'},
    ageBuckets:{fresh:'0-24h',day:'24h-7d',week:'7d-30d discovery horizon'},
    signalWindows:{short:'5m-1h',medium:'1h-6h',long:'6h-24h',securityGate:'explicit failures block; unknown security data becomes CAUTION and caps confidence instead of auto-reject'},
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


  // Value the current portfolios of every tracked wallet, not only tokens traded recently.
  const portfolioAgg=new Map();
  for(const w of walletRows){
    for(const [mint,amount] of w._balances.entries()){
      if(!mint||STABLE_MINTS.has(mint)||mint===WSOL_MINT||amount<=0)continue;
      const a=portfolioAgg.get(mint)||{mint,holders:[],holdingWallets:0,totalAmount:0};
      a.holders.push({wallet:w.name,address:w.address,amount});
      a.holdingWallets+=1;a.totalAmount+=amount;portfolioAgg.set(mint,a);
    }
  }
  const portfolioPairs=await pairsForMany([...portfolioAgg.keys()]);
  for(const [mint,a] of portfolioAgg){
    const p=portfolioPairs.get(mint);if(!p)continue;
    const price=num(p.priceUsd);if(price<=0)continue;
    a.symbol=p?.baseToken?.symbol||'?';a.name=p?.baseToken?.name||'Unknown';a.priceUsd=price;
    a.dexUrl=p.url||'';a.liquidity=num(p?.liquidity?.usd);a.marketCap=num(p.marketCap||p.fdv);
    a.currentHoldingUsd=0;
    for(const h of a.holders){h.valueUsd=h.amount*price;a.currentHoldingUsd+=h.valueUsd}
  }
  const marketTopHoldings=[...portfolioAgg.values()].filter(x=>num(x.currentHoldingUsd)>0)
    .sort((a,b)=>b.currentHoldingUsd-a.currentHoldingUsd).slice(0,20);

  const walletPortfolioMap=new Map();
  for(const w of walletRows)walletPortfolioMap.set(w.address,[]);
  for(const a of portfolioAgg.values()){
    if(!num(a.currentHoldingUsd))continue;
    for(const h of a.holders||[]){
      if(!num(h.valueUsd))continue;
      const rows=walletPortfolioMap.get(h.address)||[];
      rows.push({
        mint:a.mint,symbol:a.symbol,name:a.name,amount:h.amount,valueUsd:h.valueUsd,
        priceUsd:a.priceUsd,dexUrl:a.dexUrl,liquidity:a.liquidity,marketCap:a.marketCap
      });
      walletPortfolioMap.set(h.address,rows);
    }
  }
  for(const rows of walletPortfolioMap.values())rows.sort((a,b)=>b.valueUsd-a.valueUsd);


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
    const portfolio=walletPortfolioMap.get(w.address)||[];
    const portfolioValueUsd=portfolio.reduce((a,x)=>a+num(x.valueUsd),0);
    const topPosition=portfolio[0]?{...portfolio[0],sharePct:portfolioValueUsd>0?portfolio[0].valueUsd/portfolioValueUsd*100:null}:null;
    const topPortfolio=portfolio.slice(0,8).map(x=>({...x,sharePct:portfolioValueUsd>0?x.valueUsd/portfolioValueUsd*100:null}));
    return {...rest,speed,portfolioValueUsd,topPosition,portfolio:topPortfolio,solscanUrl:'https://solscan.io/account/'+w.address,gmgnUrl:'https://gmgn.ai/sol/address/'+w.address};
  });
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:300,source:'Solana RPC live + seed rankings from KOL Explorer/Solana Tracker',solPrice,wallets:publicWallets,tokens,topHoldings,marketTopHoldings,topNetBuys,consensus,
    disclaimer:'خرید/فروش از تغییر موجودی توکن همراه با خروج/ورود SOL یا استیبل‌کوین استنباط می‌شود. انتقال ساده حذف می‌شود اما تشخیص Swap صددرصد نیست. رتبه/سود تاریخی Seed است و تصمیم خرید نیست.'};
  trackedWalletCache={at:Date.now(),data};return data;
}


async function discoverKolProfiles(){
  const urls=new Set(TRACKED_WALLETS.filter(w=>w.source==='KOL Explorer'&&w.sourceUrl).map(w=>w.sourceUrl));
  try{
    const html=await tfetch('https://kolexplorer.com/');
    const re=/href=["'](?:https?:\/\/kolexplorer\.com)?\/kol\/([a-zA-Z0-9_-]+)["']/g;let m;
    while((m=re.exec(html))&&urls.size<24)urls.add('https://kolexplorer.com/kol/'+m[1]);
  }catch{}
  return [...urls].slice(0,20);
}
function parseKolProfile(html,url){
  const text=stripHtml(html);
  const nameMatch=text.match(/#?\s*([A-Za-z0-9 _.-]{2,30})\s+[—-]\s+Solana/i);
  const name=(nameMatch?.[1]||url.split('/').pop()||'KOL').trim();
  const walletMatch=text.match(/Wallet address\s+([1-9A-HJ-NP-Za-km-z]{32,44})/i);
  const pnlMatch=text.match(/7D PnL\s*\+?\$([\d.,]+(?:\s*[KMB])?)/i);
  const pnl7d=pnlMatch?humanNum(pnlMatch[1]):null;
  const anchors=[];
  const ar=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let a;
  while((a=ar.exec(html))){
    const txt=stripHtml(a[2]);
    if(!/Holding/i.test(txt)||!/\b\d+(?:\.\d+)?\s*d\s*ago\b/i.test(txt))continue;
    const age=txt.match(/(\d+(?:\.\d+)?)\s*d\s*ago/i);
    const inv=txt.match(/Invested\s*\$([\d.,]+)\s*([KMB])?/i);
    const hp=txt.match(/Holding\s*(\d+(?:\.\d+)?)%/i);
    const symbol=(txt.match(/^([A-Za-z0-9$._-]{1,16})\b/)||[])[1]||'?';
    const ageDays=age?num(age[1]):0;if(ageDays<7)continue;
    anchors.push({
      symbol,ageDays,holdingPct:hp?num(hp[1]):null,
      investedUsd:inv?humanNum(inv[1]+(inv[2]||'')):null,
      url:a[1].startsWith('http')?a[1]:'https://kolexplorer.com'+a[1],
      raw:txt.slice(0,220)
    });
  }
  return {name,wallet:walletMatch?.[1]||null,pnl7d,profileUrl:url,holdings:anchors};
}
async function buildConvictionWallets(){
  if(convictionCache.data&&Date.now()-convictionCache.at<CONVICTION_CACHE_MS)return convictionCache.data;
  const profiles=await discoverKolProfiles();
  const wallets=[];
  for(const url of profiles){
    try{
      const p=parseKolProfile(await tfetch(url),url);
      if(p.pnl7d!=null&&p.pnl7d>0&&p.holdings.length)wallets.push(p);
    }catch{}
    await sleep(80);
  }
  const holdings=[];
  for(const w of wallets)for(const h of w.holdings)holdings.push({...h,walletName:w.name,wallet:w.wallet,pnl7d:w.pnl7d,profileUrl:w.profileUrl});
  holdings.sort((a,b)=>(b.investedUsd||0)-(a.investedUsd||0)||b.ageDays-a.ageDays);
  const data={ok:true,generatedAt:new Date().toISOString(),source:'KOL Explorer public on-chain profiles',wallets,holdings:holdings.slice(0,30),
    disclaimer:'7D+ means the public profile reports the position is still held and its displayed holding age is at least 7 days. It does not prove the wallet never partially sold; always verify the trade history.'};
  convictionCache={at:Date.now(),data};return data;
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
  const whaleBuys=buys.filter(x=>num(x.tradeUsd)>=5000||num(x.positionValueUsd)>=25000).slice(0,50);
  const whaleSells=exits.filter(x=>num(x.tradeUsd)>=5000||num(x.positionValueUsd)>=25000).slice(0,50);
  const whaleAggMap=new Map();
  for(const e of whaleBuys){
    const k=e.tokenAddress||e.token||'unknown';
    const a=whaleAggMap.get(k)||{token:e.token||'',tokenAddress:e.tokenAddress||'',totalBuyUsd:0,buyCount:0,traders:new Set(),latestTs:0};
    a.totalBuyUsd+=num(e.tradeUsd);a.buyCount+=1;
    if(e.trader)a.traders.add(String(e.trader));
    a.latestTs=Math.max(a.latestTs,num(e.ts));
    whaleAggMap.set(k,a);
  }
  const whaleByToken=[...whaleAggMap.values()].map(x=>({...x,traders:[...x.traders],uniqueTraders:x.traders.size}))
    .sort((a,b)=>b.totalBuyUsd-a.totalBuyUsd);
  const totalWhaleBuyUsd=whaleByToken.reduce((a,x)=>a+x.totalBuyUsd,0);
  return {ok:true,connected:liveFomoState.connected,realtime:liveFomoState.realtime,delaySeconds:liveFomoState.delaySeconds,updatedAt:liveFomoState.updatedAt,lastError:liveFomoState.lastError,keyConfigured:!!process.env.FOMO_API_KEY,events,buys:buys.slice(0,20),exits:exits.slice(0,20),whaleBuys,whaleSells,whaleByToken,totalWhaleBuyUsd,exitClusters};
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
.champion{background:linear-gradient(135deg,#102b27,#101f35);border:1px solid #34745e;border-radius:14px;padding:12px;margin-bottom:10px}.champion h2{font-size:15px;margin:0 0 6px}.champion .score{font-size:24px;font-weight:900;color:var(--good)}.champion-grid{display:grid;grid-template-columns:1.4fr repeat(4,.7fr) auto;gap:8px;align-items:center}.decision-banner{border-radius:11px;padding:10px 12px;margin-bottom:10px;font-weight:900;font-size:16px}.decision-buy{background:#123a2d;color:var(--good);border:1px solid #34745e}.decision-wait{background:#3b3317;color:var(--warn);border:1px solid #6d5d24}.decision-stop{background:#421a24;color:var(--bad);border:1px solid #743040}.beginner-note{font-size:11px;color:var(--muted);margin-top:4px;line-height:1.55}.whale-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:7px 0 10px}.whale-stat{background:#101d31;border:1px solid var(--line);border-radius:10px;padding:9px}.whale-stat small{display:block;color:var(--muted);font-size:10px}.whale-stat b{display:block;margin-top:3px;font-size:14px}.alerts{display:grid;gap:6px;margin-bottom:9px}.alert{padding:8px 10px;border:1px solid #703343;background:#25151d;color:#ffb0bd;border-radius:10px;font-size:12px}
.tabs{display:flex;gap:6px;overflow:auto;scrollbar-width:none;margin-bottom:10px}.tab{white-space:nowrap}.tab.active{background:#193759;border-color:#3d709f;color:#c0e1ff}
.toolbar{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}.toolbar input{flex:1;min-width:220px}.toolbar select{min-width:140px}.subfilters{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:7px;margin:8px 0 11px}.subfilters label{font-size:12px;color:var(--muted);font-weight:800}.subfilters select{width:100%;margin-top:4px;padding:8px}.social-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.social-actions a{font-size:11px;text-decoration:none;padding:5px 7px;border:1px solid var(--line);border-radius:8px;color:#b5ddff;background:#10243b}
.accordion{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:9px;overflow:hidden}
.accordion>summary{list-style:none;cursor:pointer;padding:14px 15px;font-weight:900;font-size:16px;display:flex;align-items:center;justify-content:space-between;gap:8px;user-select:none}
.accordion>summary::-webkit-details-marker{display:none}.accordion>summary:after{content:'⌄';color:var(--muted);transition:transform .15s ease}.accordion[open]>summary:after{transform:rotate(180deg)}
.accordion-body{padding:0 10px 10px}.accordion .kpis{margin:0}.accordion .toolbar{margin:0}.accordion.highlight{border-color:#34745e;background:linear-gradient(135deg,#0e241f,#0d1729)}
.panel{display:none}.panel.active{display:block}.section-title{display:flex;justify-content:space-between;gap:10px;align-items:end;margin:6px 0 9px}.section-title h2{margin:0;font-size:18px}.section-title p{margin:3px 0 0;color:var(--muted);font-size:11px}
.list{display:grid;gap:7px}.row{display:grid;grid-template-columns:minmax(175px,1.6fr) repeat(5,minmax(80px,.7fr)) auto;gap:7px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:9px}.asset{min-width:0}.asset b{font-size:14px}.asset small{display:block;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;font-size:10px}.cell small{display:block;color:var(--muted);font-size:9px}.cell b{font-size:13px}.actions{display:flex;gap:4px}.actions a,.actions button{font-size:11px;padding:6px 7px;text-decoration:none}
.badge{display:inline-flex;padding:3px 6px;border-radius:999px;font-size:10px;font-weight:700}.good{background:#123a2d;color:var(--good)}.mid{background:#3b3317;color:var(--warn)}.bad{background:#421a24;color:var(--bad)}.blue{background:#152d49;color:var(--blue)}
.empty{background:var(--panel);border:1px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--muted);font-size:12px}.bucket-best{border:1px solid #34745e;background:linear-gradient(135deg,#102b27,#101f35);border-radius:12px;padding:10px;margin-bottom:10px}.bucket-best-title{font-size:12px;color:var(--muted);font-weight:800}.bucket-best-main{display:grid;grid-template-columns:1.5fr repeat(4,.7fr) auto;gap:8px;align-items:center;margin-top:7px}.bucket-score{font-size:22px;font-weight:900;color:var(--good)}.age-chip{display:inline-flex;padding:3px 7px;border-radius:999px;background:#152d49;color:var(--blue);font-size:10px;font-weight:800;margin-top:5px}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mini{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}.mini h3{font-size:15px;margin:0 0 9px;font-weight:900}.mini-row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #182b45;font-size:11px}.mini-row:first-of-type{border-top:0}.mini-row span{color:var(--muted)}.portfolio-item{padding:8px 0;border-top:1px solid #1b304b}.portfolio-item:first-child{border-top:0}.portfolio-top{display:flex;justify-content:space-between;gap:8px;font-size:12px}.portfolio-bar{height:6px;background:#15263d;border-radius:999px;overflow:hidden;margin-top:5px}.portfolio-fill{height:100%;background:#3d8f72;border-radius:999px}.portfolio-meta{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:10px;margin-top:4px}
dialog{width:min(720px,94vw);max-height:88vh;border:1px solid #36506e;border-radius:15px;background:#091426;color:var(--text);padding:0;box-shadow:0 30px 90px #0009}dialog::backdrop{background:#000a}.modal-head{position:sticky;top:0;background:#091426;border-bottom:1px solid var(--line);padding:12px 14px;display:flex;justify-content:space-between;align-items:center}.modal-body{padding:13px}.modal-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.box{background:#0f1d31;border:1px solid var(--line);border-radius:10px;padding:8px}.box small{display:block;color:var(--muted);font-size:9px}.box b{display:block;margin-top:3px;font-size:12px}.holders{margin-top:11px}.holder,.check{display:flex;justify-content:space-between;gap:7px;padding:6px 0;border-top:1px solid var(--line);font-size:11px}.holder a{color:var(--blue);text-decoration:none}.links{display:flex;flex-wrap:wrap;gap:5px;margin-top:11px}.links a{color:#b5ddff;text-decoration:none;border:1px solid #315071;background:#10243b;padding:6px 8px;border-radius:8px;font-size:11px}.note{margin-top:10px;color:var(--muted);font-size:11px;line-height:1.65}.pass{color:var(--good)}.fail{color:var(--bad)}.manual{color:var(--warn)}
@media(max-width:900px){.bucket-best-main{grid-template-columns:1fr 1fr}.bucket-best-main .asset,.bucket-best-main .actions{grid-column:1/-1}.champion-grid{grid-template-columns:1fr 1fr}.champion-grid .asset,.champion-grid .actions{grid-column:1/-1}.row{grid-template-columns:1.5fr repeat(3,.8fr) auto}.hide-md{display:none}.three{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){.whale-summary{grid-template-columns:1fr}.subfilters{grid-template-columns:1fr 1fr}.head{padding:9px 10px}.shell{padding:10px}.brand small,.status{display:none}.row{grid-template-columns:1fr 1fr}.asset,.actions{grid-column:1/-1}.hide-sm{display:none}.modal-grid{grid-template-columns:repeat(2,1fr)}}
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
<details class="accordion highlight" open>
  <summary>🏆 بهترین سیگنال کل رادار</summary>
  <div class="accordion-body" id="championBox"></div>
</details>
<details class="accordion" open>
  <summary>📊 خلاصه رادار</summary>
  <div class="accordion-body"><section class="kpis">
    <div class="kpi"><small>توکن‌ها</small><b id="kTokens">—</b></div>
    <div class="kpi"><small>پیشنهاد ۹۰+</small><b id="kFeatured">—</b></div>
    <div class="kpi"><small>خرید نهنگ</small><b id="kWhales">—</b></div>
    <div class="kpi"><small>خروج همزمان</small><b id="kExits">—</b></div>
  </section></div>
</details>

<details class="accordion">
  <summary>🚨 هشدارهای خروج و فروش</summary>
  <div class="accordion-body"><div class="alerts" id="alerts"></div></div>
</details>

<nav class="tabs" id="tabs">
  <button class="tab active" data-tab="featured">🔥 پیشنهادها</button>
  <button class="tab" data-tab="whales">🐋 نهنگ‌ها</button>
  <button class="tab" data-tab="smart">🧠 اسمارت‌مانی</button>
  <button class="tab" data-tab="social">📣 ترند اجتماعی</button>
  <button class="tab" data-tab="wallets">🏆 کیف‌پول‌ها</button>
  <button class="tab" data-tab="tokens">🪙 همه توکن‌ها</button>
</nav>

<details class="accordion">
  <summary>🔎 جستجو و فیلترها</summary>
  <div class="accordion-body"><div class="toolbar">
    <input id="search" placeholder="جستجو نام، نماد یا آدرس">
    <select id="securityFilter"><option value="">همه امنیت‌ها</option><option value="MAX SECURITY">امنیت خیلی بالا</option><option value="HIGH">امنیت بالا</option></select>
    <select id="activityFilter"><option value="">همه فعالیت‌ها</option><option value="PROBABLE ORGANIC">فعالیت طبیعی</option><option value="BOT RISK">ریسک ربات</option></select>
  </div></div>
</details>

<section class="panel active" id="featuredPanel">
  <details class="accordion" open>
    <summary>🔥 پیشنهادهای اولویت‌دار</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">امتیاز ۹۰/۱۰۰+؛ این عدد احتمال قطعی پامپ نیست.</p><div class="subfilters">
<label>کوتاه‌مدت<select class="signal-filter" data-filter="short"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>میان‌مدت<select class="signal-filter" data-filter="medium"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>بلندمدت<select class="signal-filter" data-filter="long"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>امنیت<select class="signal-filter" data-filter="security"><option value="">همه</option><option value="MAX SECURITY">خیلی بالا</option><option value="HIGH">بالا</option><option value="REVIEW">نیاز به بررسی</option><option value="REJECT">رد</option></select></label>
</div><div class="list" id="featuredList"></div></div>
  </details>
</section>

<section class="panel" id="whalesPanel">
  <details class="accordion" open>
    <summary>🐋 خریدهای نهنگ</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">خرید بزرگ اخیر و هشدار خروج.</p><div id="whaleSummary"></div><div class="subfilters">
<label>کوتاه‌مدت<select class="signal-filter" data-filter="short"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>میان‌مدت<select class="signal-filter" data-filter="medium"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>بلندمدت<select class="signal-filter" data-filter="long"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>امنیت<select class="signal-filter" data-filter="security"><option value="">همه</option><option value="MAX SECURITY">خیلی بالا</option><option value="HIGH">بالا</option><option value="REVIEW">نیاز به بررسی</option><option value="REJECT">رد</option></select></label>
</div><div class="list" id="whaleList"></div></div>
  </details>
</section>

<section class="panel" id="smartPanel">
  <details class="accordion" open>
    <summary>🧠 اسمارت‌مانی</summary>
    <div class="accordion-body"><p class="muted" id="smartStatus" style="font-size:11px">در حال دریافت…</p><div class="subfilters">
<label>کوتاه‌مدت<select class="signal-filter" data-filter="short"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>میان‌مدت<select class="signal-filter" data-filter="medium"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>بلندمدت<select class="signal-filter" data-filter="long"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>امنیت<select class="signal-filter" data-filter="security"><option value="">همه</option><option value="MAX SECURITY">خیلی بالا</option><option value="HIGH">بالا</option><option value="REVIEW">نیاز به بررسی</option><option value="REJECT">رد</option></select></label>
</div><div class="list" id="smartList"></div></div>
  </details>
</section>

<section class="panel" id="socialPanel">
  <details class="accordion" open>
    <summary>📣 داغ‌ترین توکن‌ها در شبکه‌های اجتماعی</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">Social Heat از mentionهای قابل‌شمارش + حضور رسمی چندشبکه‌ای ساخته می‌شود. امنیت همچنان شرط مستقل است.</p><div class="list" id="socialList"></div></div>
  </details>
</section>

<section class="panel" id="walletsPanel">
  <details class="accordion" open>
    <summary>🏆 وضعیت کیف‌پول‌های برتر</summary>
    <div class="accordion-body"><p class="muted" id="walletStatus" style="font-size:11px">در حال اسکن آن‌چین…</p></div>
  </details>
  <details class="accordion" open>
    <summary>💰 بیشترین سرمایه کل کیف‌پول‌ها</summary>
    <div class="accordion-body"><div id="topHoldings"></div></div>
  </details>
  <details class="accordion">
    <summary>🟢 بیشترین خرید خالص</summary>
    <div class="accordion-body"><div id="topBuys"></div></div>
  </details>
  <details class="accordion">
    <summary>🤝 خرید همزمان چند کیف‌پول</summary>
    <div class="accordion-body"><div id="consensus"></div></div>
  </details>
  <details class="accordion" open>
    <summary>🧱 کیف‌پول‌های سودده با هولد ۷ روز+</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">فروش جزئی ممکن است رخ داده باشد؛ برای تأیید نهایی تاریخچه را بررسی کن.</p><div class="list" id="convictionList"></div></div>
  </details>
  <details class="accordion">
    <summary>👛 فهرست کیف‌پول‌ها و آخرین حرکت</summary>
    <div class="accordion-body"><div class="list" id="walletList"></div></div>
  </details>
</section>

<section class="panel" id="tokensPanel">
  <details class="accordion">
    <summary>🎛 فیلتر مشترک سه گروه</summary>
    <div class="accordion-body"><div class="subfilters">
<label>کوتاه‌مدت<select class="signal-filter" data-filter="short"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>میان‌مدت<select class="signal-filter" data-filter="medium"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>بلندمدت<select class="signal-filter" data-filter="long"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>امنیت<select class="signal-filter" data-filter="security"><option value="">همه</option><option value="MAX SECURITY">خیلی بالا</option><option value="HIGH">بالا</option><option value="REVIEW">نیاز به بررسی</option><option value="REJECT">رد</option></select></label>
</div><p class="muted" style="font-size:11px">رتبه هر گروه با مدل امتیاز مخصوص همان سن محاسبه می‌شود.</p></div>
  </details>
  <details class="accordion" open>
    <summary>⚡ توکن‌های تازه و ترند — کمتر از ۲۴ ساعت</summary>
    <div class="accordion-body"><div id="freshBest"></div><div class="list" id="freshTokenList"></div></div>
  </details>
  <details class="accordion" open>
    <summary>🌱 توکن‌های ۱ تا ۷ روزه</summary>
    <div class="accordion-body"><div id="dayBest"></div><div class="list" id="dayTokenList"></div></div>
  </details>
  <details class="accordion" open>
    <summary>🧱 توکن‌های ۷ روزه به بالا</summary>
    <div class="accordion-body"><div id="weekBest"></div><div class="list" id="weekTokenList"></div><div class="note">دامنه کشف فعلی رادار تا حدود ۳۰ روز است؛ اگر منابع کشف، توکن قدیمی‌تر را برنگردانند در این بخش ظاهر نمی‌شود.</div></div>
  </details>
</section>
</main>

<dialog id="detailDialog">
  <div class="modal-head"><b id="detailTitle">جزئیات</b><button id="closeDetail">×</button></div>
  <div class="modal-body" id="detailBody"></div>
</dialog>

<script>
var tokens=[],smart=null,live=null,tracked=null,conviction=null,activeTab='featured',signalFilters={short:'',medium:'',long:'',security:''};
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
function faSocialHeat(v){return {'VIRAL':'وایرال','HOT':'خیلی داغ','WARM':'رو به رشد','LOW':'کم'}[v]||v||'—'}
function socialHeatClass(v){return v==='VIRAL'||v==='HOT'?'good':v==='WARM'?'mid':'blue'}
function faVolume(v){return {'STRONG':'قوی','GOOD':'خوب','MEDIUM':'متوسط','LOW':'کم','WEAK':'ضعیف','SUSPICIOUS':'مشکوک'}[v]||v||'—'}
function volumeClass(v){return v==='STRONG'||v==='GOOD'?'good':v==='SUSPICIOUS'||v==='WEAK'?'bad':'mid'}
function pressureClass(t){return t&&t.flow&&t.flow.buyerDominant?'good':t&&t.flow&&t.flow.sellerDominant?'bad':'mid'}


function tokenStrength(t){
  if(!t)return -1;
  var sg=t.signals||{},sec=t.security||{};
  var secScore=sec.tier==='MAX SECURITY'?30:sec.tier==='HIGH'?22:sec.tier==='REVIEW'?8:0;
  return secScore+Number(sg.short?.score||0)*0.27+Number(sg.medium?.score||0)*0.31+Number(sg.long?.score||0)*0.25+Number(t.socialHeat?.score||0)*0.10+(t.activity?.label==='PROBABLE ORGANIC'?5:0)+(sec.holderStrong?5:0);
}
function ageBucket(t){
  var a=Number(t&&t.ageMinutes||0);
  if(a<1440)return 'fresh';
  if(a<10080)return 'day';
  return 'week';
}
function ageText(t){
  var m=Number(t&&t.ageMinutes||0);
  if(m<60)return Math.round(m)+' دقیقه';
  if(m<1440)return (m/60).toFixed(m<360?1:0)+' ساعت';
  return (m/1440).toFixed(m<4320?1:0)+' روز';
}
function bucketScore(t,bucket){
  if(!t)return 0;
  var sec=t.security||{},sg=t.signals||{},fl=t.flow||{},mq=t.marketQuality||{},sh=Number(sg.short?.score||0),md=Number(sg.medium?.score||0),lg=Number(sg.long?.score||0);
  if(t.securityGate?.blocked||sec.tier==='REJECT')return Math.min(39,Math.round((sh+md+lg)/12));
  var security=sec.tier==='MAX SECURITY'?100:sec.tier==='HIGH'?86:sec.tier==='REVIEW'?55:20;
  var buyer=Number(fl.buyerPower||50),volume=Number(fl.volumeScore||0),social=Number(t.socialHeat?.score||0),market=Number(mq.score||0);
  var score=0;
  if(bucket==='fresh')score=security*.18+sh*.22+md*.12+lg*.05+buyer*.13+volume*.12+social*.13+market*.05;
  else if(bucket==='day')score=security*.22+sh*.10+md*.18+lg*.15+buyer*.12+volume*.12+social*.06+market*.05;
  else score=security*.28+sh*.05+md*.13+lg*.22+buyer*.10+volume*.08+social*.04+market*.10;
  var wh=whaleFor(t.mint),tr=findTracked(t.mint),sm=smartFor(t.mint);
  if(wh.count)score+=3;if(tr&&Number(tr.uniqueBuyers||0)>=2&&Number(tr.netFlowUsd||0)>0)score+=3;if(sm)score+=2;
  if(exitFor(t.mint).length)score-=18;
  if(fl.sellerDominant)score-=8;
  if(fl.volumeLabel==='SUSPICIOUS')score-=12;
  return Math.max(0,Math.min(100,Math.round(score)));
}
function bucketSignalLabel(score,t){
  if(t&&t.securityGate?.blocked)return 'رد امنیتی';
  if(score>=85)return 'سیگنال بسیار قوی';
  if(score>=75)return 'سیگنال قوی';
  if(score>=65)return 'مثبت';
  if(score>=50)return 'صبر / بررسی';
  return 'ضعیف';
}
function bucketSignalClass(score,t){
  if(t&&t.securityGate?.blocked)return 'bad';
  return score>=75?'good':score>=50?'mid':'bad';
}

function passesSignalFilters(t){
  var any=signalFilters.short||signalFilters.medium||signalFilters.long||signalFilters.security;
  if(!t)return !any;
  var sg=t.signals||{},sec=t.security||{};
  if(signalFilters.short&&sg.short?.label!==signalFilters.short)return false;
  if(signalFilters.medium&&sg.medium?.label!==signalFilters.medium)return false;
  if(signalFilters.long&&sg.long?.label!==signalFilters.long)return false;
  if(signalFilters.security&&sec.tier!==signalFilters.security)return false;
  return true;
}
function socialButtons(t){
  var src=t&&Array.isArray(t.socialSources)?t.socialSources:[];
  if(!src.length)return '';
  var labels={X:'𝕏',Telegram:'✈ تلگرام',Instagram:'◎ اینستاگرام',YouTube:'▶ یوتیوب',Facebook:'f فیسبوک',TikTok:'♪ تیک‌تاک',Reddit:'Reddit',Bluesky:'🦋'};
  var allowed=['X','Telegram','Instagram','YouTube','Facebook','TikTok','Reddit','Bluesky'];
  var rows=src.filter(function(v){return allowed.includes(v.name)}).slice(0,8);
  if(!rows.length)return '';
  return '<span class="social-actions">'+rows.map(function(v){return '<a target="_blank" rel="noopener" href="'+esc(v.url)+'">'+esc(labels[v.name]||v.name)+'</a>'}).join('')+'</span>';
}
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
    if(t.flow&&t.flow.volumeLabel==='STRONG'){s+=9;w.push('حجم قوی')}else if(t.flow&&t.flow.volumeLabel==='GOOD'){s+=5;w.push('حجم خوب')}
    if(t.flow&&t.flow.buyerDominant){s+=10;w.push('قدرت خریدار غالب')}else if(t.flow&&t.flow.sellerDominant)s-=12;
    if(t.socialHeat&&t.socialHeat.score>=75){s+=10;w.push('وایرال اجتماعی')}else if(t.socialHeat&&t.socialHeat.score>=55){s+=6;w.push('ترند اجتماعی داغ')}
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

function tokenRow(t,bucket){
  var s=t.security||{},sg=t.signals||{},sh=sg.short||{},md=sg.medium||{},lg=sg.long||{},fl=t.flow||{},bs=bucketScore(t,bucket||ageBucket(t));
  return '<div class="row">'+
  '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><span class="age-chip">'+esc(ageText(t))+'</span><small>'+esc(short(t.mint))+'</small>'+socialButtons(t)+'</div>'+
  '<div class="cell"><small>امتیاز گروه</small><b><span class="badge '+bucketSignalClass(bs,t)+'">'+bs+'/100</span></b></div>'+
  '<div class="cell"><small>کوتاه / میان / بلند</small><b>'+Number(sh.score||0)+' / '+Number(md.score||0)+' / '+Number(lg.score||0)+'</b></div>'+
  '<div class="cell"><small>قدرت خریدار</small><b><span class="badge '+pressureClass(t)+'">'+(fl.buyerPower==null?'—':Number(fl.buyerPower)+'%')+'</span></b></div>'+
  '<div class="cell hide-sm"><small>امنیت</small><b><span class="badge '+secClass(s.tier)+'">'+esc(faSec(s.tier))+'</span></b></div>'+
  '<div class="cell hide-md"><small>حجم</small><b><span class="badge '+volumeClass(fl.volumeLabel)+'">'+esc(faVolume(fl.volumeLabel))+'</span></b></div>'+
  '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
}

function beginnerDecision(t,overallScore){
  if(!t)return {label:'صبر کن',cls:'decision-wait',reason:'فعلاً سیگنال کامل و امنی وجود ندارد'};
  var sec=t.security||{},gate=t.securityGate||{},sg=t.signals||{},wh=whaleFor(t.mint);
  if(gate.blocked||sec.tier==='REJECT'||exitFor(t.mint).length)return {label:'ورود نکن',cls:'decision-stop',reason:'ریسک امنیتی یا هشدار خروج فعال است'};
  var strongWindows=[sg.short,sg.medium,sg.long].filter(function(x){return Number(x?.score||0)>=75&&x?.label!=='BLOCKED'&&x?.label!=='AVOID'}).length;
  var flow=t.flow||{};
  var safe=(sec.tier==='MAX SECURITY'||sec.tier==='HIGH')&&Number(t.liquidity||0)>=10000&&t.activity?.label!=='BOT RISK';
  var flowOk=(flow.volumeLabel==='STRONG'||flow.volumeLabel==='GOOD')&&flow.buyerDominant===true;
  if(safe&&flowOk&&strongWindows>=2&&Number(overallScore||0)>=78)return {label:'شرایط ورود قوی',cls:'decision-buy',reason:'امنیت بالا + حجم خوب + قدرت خریدار غالب + حداقل دو بازه زمانی قوی + بدون هشدار خروج'};
  return {label:'صبر کن',cls:'decision-wait',reason:'برای مبتدی بهتر است تا تکمیل تأییدها صبر شود'};
}
function overallCandidates(){
  return tokens.map(function(t){
    var gate=t.securityGate||{},sec=t.security||{},sg=t.signals||{},sh=sg.short||{},md=sg.medium||{},lg=sg.long||{};
    if(gate.blocked||sec.tier==='REJECT'||exitFor(t.mint).length)return null;
    if(sec.tier!=='MAX SECURITY'&&sec.tier!=='HIGH')return null;
    if(Number(sh.score||0)<60||Number(md.score||0)<60)return null;
    var score=0;
    score+=sec.tier==='MAX SECURITY'?30:22;
    score+=Number(sh.score||0)*0.16+Number(md.score||0)*0.22+Number(lg.score||0)*0.22;
    if(t.security&&t.security.holderStrong)score+=6;
    if(t.activity&&t.activity.label==='PROBABLE ORGANIC')score+=5;
    if(t.marketQuality&&t.marketQuality.score>=80)score+=5;
    if(t.flow?.volumeLabel==='STRONG')score+=7; else if(t.flow?.volumeLabel==='GOOD')score+=4;
    if(t.flow?.buyerDominant)score+=8; else if(t.flow?.sellerDominant)score-=10;
    score+=Math.min(8,Number(t.socialHeat?.score||0)*0.10);
    var sm=smartFor(t.mint),wh=whaleFor(t.mint),tr=findTracked(t.mint);
    if(sm)score+=4;if(wh.count)score+=4;if(tr&&tr.uniqueBuyers>=2&&tr.netFlowUsd>0)score+=5;
    return {t:t,score:Math.min(100,Math.round(score)),sm:sm,wh:wh,tr:tr};
  }).filter(Boolean).sort(function(a,b){return b.score-a.score});
}
function renderChampion(){
  var x=overallCandidates()[0],el=document.getElementById('championBox');
  if(!x){el.innerHTML='<div class="muted">فعلاً توکنی نیست که هم امنیت بالا و هم حداقل دو بازه زمانی قوی را همزمان پاس کند.</div>';return}
  var t=x.t,sg=t.signals||{},d=beginnerDecision(t,x.score);
  el.innerHTML='<div class="decision-banner '+d.cls+'">'+esc(d.label)+'<div class="beginner-note">'+esc(d.reason)+' · تضمین سود نیست و اندازه پوزیشن باید کوچک بماند.</div></div><div class="champion-grid">'+
    '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><small>بدون هشدار خروج · امنیت '+esc(faSec(t.security?.tier))+'</small>'+socialButtons(t)+'</div>'+
    '<div><small class="muted">امتیاز کل</small><div class="score">'+x.score+'/100</div></div>'+
    '<div class="cell"><small>کوتاه</small><b>'+Number(sg.short?.score||0)+'</b></div>'+
    '<div class="cell"><small>میان</small><b>'+Number(sg.medium?.score||0)+'</b></div>'+
    '<div class="cell"><small>بلند</small><b>'+Number(sg.long?.score||0)+'</b></div><div class="cell"><small>قدرت خریدار</small><b><span class="badge '+pressureClass(t)+'">'+Number(t.flow?.buyerPower||0)+'%</span></b></div><div class="cell"><small>حجم</small><b><span class="badge '+volumeClass(t.flow?.volumeLabel)+'">'+esc(faVolume(t.flow?.volumeLabel))+'</span></b></div><div class="cell"><small>Social Heat</small><b><span class="badge '+socialHeatClass(t.socialHeat?.label)+'">'+esc(faSocialHeat(t.socialHeat?.label))+' '+Number(t.socialHeat?.score||0)+'</span></b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div>'+
  '</div></div>';
}

function renderFeatured(){
  var r=featuredRows().filter(function(x){return passesSignalFilters(x.token)}).sort(function(a,b){return (b.score-a.score)||(tokenStrength(b.token)-tokenStrength(a.token))});document.getElementById('kFeatured').textContent=r.length;
  document.getElementById('featuredList').innerHTML=r.length?r.map(function(x){
    var t=x.token;
    return '<div class="row"><div class="asset"><b>🔥 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><small>'+esc(x.why.slice(0,3).join(' • '))+'</small>'+socialButtons(t)+'</div>'+
    '<div class="cell"><small>امتیاز</small><b><span class="badge good">'+x.score+'/100</span></b></div>'+
    '<div class="cell"><small>نهنگ</small><b>'+money(x.whale.usd)+'</b></div>'+
    '<div class="cell"><small>اسمارت</small><b>'+(x.smart?Number(x.smart.smartMoneyCount||0):0)+'</b></div>'+
    '<div class="cell hide-sm"><small>کیف‌پول برتر</small><b>'+(x.tracked?Number(x.tracked.uniqueBuyers||0):0)+'</b></div>'+
    '<div class="cell hide-md"><small>خریدار / حجم</small><b>'+Number(t.flow?.buyerPower||0)+'% · '+esc(faVolume(t.flow?.volumeLabel))+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً هیچ توکنی معیار سخت‌گیرانه ۹۰/۱۰۰ را رد نکرده.</div>';
}
function renderWhales(){
  var agg=live&&live.whaleByToken?live.whaleByToken:[];
  var total=live?Number(live.totalWhaleBuyUsd||0):0;
  var sum=document.getElementById('whaleSummary');
  if(sum){
    var top=agg[0]||null;
    sum.innerHTML='<div class="whale-summary">'+
      '<div class="whale-stat"><small>کل حجم خرید نهنگ‌ها</small><b>'+money(total)+'</b></div>'+
      '<div class="whale-stat"><small>بیشترین خرید روی</small><b>'+(top?esc(top.token||short(top.tokenAddress)):'—')+'</b></div>'+
      '<div class="whale-stat"><small>حجم توکن اول</small><b>'+(top?money(top.totalBuyUsd):'—')+'</b></div>'+
    '</div>'+
    (agg.length?'<div class="list">'+agg.slice(0,8).map(function(a,i){
      var t=findToken(a.tokenAddress);
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🐋 '+esc(a.token||t&&t.symbol||'?')+'</b><small>'+Number(a.uniqueTraders||0)+' نهنگ · '+Number(a.buyCount||0)+' خرید</small>'+socialButtons(t)+'</div>'+
      '<div class="cell"><small>کل خرید</small><b>'+money(a.totalBuyUsd)+'</b></div>'+
      '<div class="cell"><small>تعداد نهنگ</small><b>'+Number(a.uniqueTraders||0)+'</b></div>'+
      '<div class="cell"><small>تعداد خرید</small><b>'+Number(a.buyCount||0)+'</b></div>'+
      '<div class="cell hide-sm"><small>امنیت</small><b><span class="badge '+secClass(t?.security?.tier)+'">'+esc(faSec(t?.security?.tier))+'</span></b></div>'+
      '<div class="cell hide-md"><small>قدرت سیگنال</small><b>'+Math.round(tokenStrength(t))+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(a.tokenAddress,''))+'">📈 چارت</a></div></div>';
    }).join('')+'</div>':'');
  }
  var r=live&&live.whaleBuys?live.whaleBuys:[];
  r=r.filter(function(e){return passesSignalFilters(findToken(e.tokenAddress))}).sort(function(a,b){return Number(b.tradeUsd||0)-Number(a.tradeUsd||0)});
  document.getElementById('kWhales').textContent=r.length;
  document.getElementById('whaleList').innerHTML=r.length?r.slice(0,20).map(function(e){
    var t=findToken(e.tokenAddress),sec=t&&t.security?t.security:{};
    return '<div class="row"><div class="asset"><b>🐋 '+esc(e.token||t&&t.symbol||'?')+'</b><small>'+esc(short(e.tokenAddress))+' · '+esc(e.trader||'نامشخص')+'</small>'+socialButtons(t)+'</div>'+
    '<div class="cell"><small>خرید</small><b>'+money(e.tradeUsd)+'</b></div><div class="cell"><small>پوزیشن</small><b>'+money(e.positionValueUsd)+'</b></div>'+
    '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
    '<div class="cell hide-sm"><small>زمان</small><b>'+new Date(Number(e.ts||Date.now())).toLocaleTimeString('fa-IR')+'</b></div>'+
    '<div class="cell hide-md"><small>خروج</small><b>'+exitFor(e.tokenAddress).length+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(e.tokenAddress,''))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(e.tokenAddress)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً خرید نهنگ تازه‌ای ثبت نشده.</div>';
}
function renderSmart(){
  var r=smart&&smart.tokens?smart.tokens:[];r=r.filter(function(x){return passesSignalFilters(findToken(x.address))}).sort(function(a,b){return tokenStrength(findToken(b.address))-tokenStrength(findToken(a.address))});
  document.getElementById('smartStatus').textContent=smart&&smart.configured?'پوزیشن‌های فعلی کیف‌پول‌های سودده':'منبع کامل اسمارت‌مانی نیاز به API key دارد.';
  document.getElementById('smartList').innerHTML=r.length?r.slice(0,20).map(function(t){
    var s=t.security||{},base=findToken(t.address);
    return '<div class="row"><div class="asset"><b>🧠 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><small>'+esc(short(t.address))+'</small>'+socialButtons(base)+'</div>'+
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

function renderConviction(){
  var el=document.getElementById('convictionList');if(!el)return;
  var rows=conviction&&conviction.holdings?conviction.holdings:[];
  el.innerHTML=rows.length?rows.slice(0,15).map(function(h){
    return '<div class="row"><div class="asset"><b>🧱 '+esc(h.symbol||'?')+' · '+esc(h.walletName||'')+'</b><small>هنوز در پوزیشن · '+Number(h.ageDays||0).toFixed(0)+' روز</small></div>'+
    '<div class="cell"><small>PnL 7D کیف‌پول</small><b>'+money(h.pnl7d)+'</b></div>'+
    '<div class="cell"><small>سرمایه اولیه</small><b>'+money(h.investedUsd)+'</b></div>'+
    '<div class="cell"><small>عمر هولد</small><b>'+Number(h.ageDays||0).toFixed(0)+'d</b></div>'+
    '<div class="cell hide-sm"><small>درصد باقی‌مانده</small><b>'+(h.holdingPct==null?'—':pct(h.holdingPct))+'</b></div>'+
    '<div class="cell hide-md"><small>وضعیت</small><b><span class="badge good">۷ روز+</span></b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(h.profileUrl||h.url)+'">پروفایل</a><a class="action" target="_blank" rel="noopener" href="'+esc(h.url||h.profileUrl)+'">پوزیشن</a></div></div>';
  }).join(''):'<div class="empty">فعلاً پوزیشن سودده ۷روزه+ قابل‌تأیید از منابع عمومی پیدا نشد.</div>';
}


function renderSocialTrends(){
  var el=document.getElementById('socialList');if(!el)return;
  var r=tokens.slice().filter(function(t){return Number(t.socialHeat?.score||0)>0}).sort(function(a,b){return Number(b.socialHeat?.score||0)-Number(a.socialHeat?.score||0)||tokenStrength(b)-tokenStrength(a)}).slice(0,20);
  el.innerHTML=r.length?r.map(function(t,i){
    var h=t.socialHeat||{},s=t.security||{};
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' 📣 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><small>'+esc((h.reasons||[]).slice(0,3).join(' • '))+'</small>'+socialButtons(t)+'</div>'+
      '<div class="cell"><small>Social Heat</small><b><span class="badge '+socialHeatClass(h.label)+'">'+esc(faSocialHeat(h.label))+' '+Number(h.score||0)+'</span></b></div>'+
      '<div class="cell"><small>X / 2h</small><b>'+Number(h.xPosts2h||0)+'</b></div>'+
      '<div class="cell"><small>YouTube / 24h</small><b>'+Number(h.youtubeVideos24h||0)+'</b></div>'+
      '<div class="cell hide-sm"><small>Bluesky / 2h</small><b>'+Number(h.blueskyMentions2h||0)+'</b></div>'+
      '<div class="cell hide-md"><small>امنیت</small><b><span class="badge '+secClass(s.tier)+'">'+esc(faSec(s.tier))+'</span></b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً داده Social Heat برای توکن‌های رادار کافی نیست.</div>';
}

function renderWallets(){
  if(!tracked){document.getElementById('walletStatus').textContent='داده در دسترس نیست';return}
  document.getElementById('walletStatus').textContent='آخرین اسکن: '+new Date(tracked.generatedAt||Date.now()).toLocaleTimeString('fa-IR')+' · '+(tracked.wallets?tracked.wallets.length:0)+' کیف‌پول';
  document.getElementById('topHoldings').innerHTML=miniRows(tracked.marketTopHoldings||tracked.topHoldings,'hold');
  document.getElementById('topBuys').innerHTML=miniRows(tracked.topNetBuys,'buy');
  document.getElementById('consensus').innerHTML=miniRows(tracked.consensus,'consensus');
  var r=(tracked.wallets||[]).slice().sort(function(a,b){return Number(b.portfolioValueUsd||0)-Number(a.portfolioValueUsd||0)});
  document.getElementById('walletList').innerHTML=r.length?r.map(function(w){
    var e=w.events&&w.events[0]?w.events[0]:null,tp=w.topPosition||null,portfolio=w.portfolio||[];
    var portfolioHtml=portfolio.length?portfolio.map(function(p,i){
      var width=Math.max(2,Math.min(100,Number(p.sharePct||0)));
      return '<div class="portfolio-item"><div class="portfolio-top"><b>#'+(i+1)+' '+esc(p.symbol||'?')+'</b><b>'+money(p.valueUsd)+'</b></div>'+
        '<div class="portfolio-bar"><div class="portfolio-fill" style="width:'+width+'%"></div></div>'+
        '<div class="portfolio-meta"><span>'+pct(p.sharePct)+' از پورتفولیوی قابل قیمت‌گذاری</span><span>'+money(p.marketCap)+' MC</span></div>'+
        '<div class="links"><a target="_blank" rel="noopener" href="'+esc(p.dexUrl||dexUrl(p.mint,''))+'">📈 چارت</a><a target="_blank" rel="noopener" href="https://solscan.io/token/'+esc(p.mint)+'">Solscan</a></div></div>';
    }).join(''):'<div class="note">فعلاً پوزیشن قابل قیمت‌گذاری پیدا نشد.</div>';
    return '<div class="row"><div class="asset"><b>'+esc(w.name)+'</b><small>'+esc(short(w.address))+' · '+esc(w.speed||'')+'</small></div>'+
      '<div class="cell"><small>ارزش پورتفولیو</small><b>'+money(w.portfolioValueUsd)+'</b></div>'+
      '<div class="cell"><small>بیشترین سرمایه روی</small><b>'+(tp?esc(tp.symbol||'?'):'—')+'</b></div>'+
      '<div class="cell"><small>ارزش پوزیشن اول</small><b>'+(tp?money(tp.valueUsd):'—')+'</b></div>'+
      '<div class="cell hide-sm"><small>تمرکز پوزیشن اول</small><b>'+(tp?pct(tp.sharePct):'—')+'</b></div>'+
      '<div class="cell hide-md"><small>آخرین حرکت</small><b>'+(e?(e.side==='BUY'?'🟢 خرید ':'🔴 فروش ')+money(e.approxUsd):'—')+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(w.solscanUrl)+'">Solscan</a><a class="action" target="_blank" rel="noopener" href="'+esc(w.gmgnUrl)+'">GMGN</a></div>'+
      '<div style="grid-column:1/-1"><details class="accordion"><summary>💼 پورتفولیو — بیشترین پول روی '+(tp?esc(tp.symbol||'?'):'نامشخص')+'</summary><div class="accordion-body">'+portfolioHtml+'</div></details></div></div>';
  }).join(''):'<div class="empty">کیف‌پولی برای نمایش نیست.</div>';
}
function filteredTokens(){
  var q=document.getElementById('search').value.toLowerCase().trim(),sf=document.getElementById('securityFilter').value,af=document.getElementById('activityFilter').value;
  return tokens.filter(function(t){return (!q||[t.name,t.symbol,t.mint].join(' ').toLowerCase().includes(q))&&(!sf||(t.security&&t.security.tier===sf))&&(!af||(t.activity&&t.activity.label===af))&&passesSignalFilters(t)}).sort(function(a,b){return tokenStrength(b)-tokenStrength(a)});
}
function renderBucketBest(id,rows,bucket,title){
  var el=document.getElementById(id);if(!el)return;
  if(!rows.length){el.innerHTML='<div class="empty">فعلاً توکنی در این بازه پیدا نشده.</div>';return}
  var t=rows[0],bs=bucketScore(t,bucket),sg=t.signals||{},fl=t.flow||{};
  el.innerHTML='<div class="bucket-best"><div class="bucket-best-title">🏆 بهترین توکن '+esc(title)+' — رتبه ۱ این گروه</div><div class="bucket-best-main">'+
    '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><span class="age-chip">'+esc(ageText(t))+'</span><small>'+esc(bucketSignalLabel(bs,t))+'</small>'+socialButtons(t)+'</div>'+
    '<div><small class="muted">امتیاز نهایی</small><div class="bucket-score">'+bs+'/100</div></div>'+
    '<div class="cell"><small>قدرت خریدار</small><b>'+Number(fl.buyerPower||0)+'%</b></div>'+
    '<div class="cell"><small>حجم</small><b>'+esc(faVolume(fl.volumeLabel))+'</b></div>'+
    '<div class="cell"><small>امنیت</small><b>'+esc(faSec(t.security?.tier))+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div>'+
  '</div></div>';
}
function renderTokens(){
  var r=filteredTokens();
  var fresh=r.filter(function(t){return ageBucket(t)==='fresh'}).sort(function(a,b){return bucketScore(b,'fresh')-bucketScore(a,'fresh')});
  var day=r.filter(function(t){return ageBucket(t)==='day'}).sort(function(a,b){return bucketScore(b,'day')-bucketScore(a,'day')});
  var week=r.filter(function(t){return ageBucket(t)==='week'}).sort(function(a,b){return bucketScore(b,'week')-bucketScore(a,'week')});
  renderBucketBest('freshBest',fresh,'fresh','تازه و ترند');
  renderBucketBest('dayBest',day,'day','۱ تا ۷ روزه');
  renderBucketBest('weekBest',week,'week','۷ روزه+');
  document.getElementById('freshTokenList').innerHTML=fresh.length?fresh.map(function(t){return tokenRow(t,'fresh')}).join(''):'';
  document.getElementById('dayTokenList').innerHTML=day.length?day.map(function(t){return tokenRow(t,'day')}).join(''):'';
  document.getElementById('weekTokenList').innerHTML=week.length?week.map(function(t){return tokenRow(t,'week')}).join(''):'';
}
function renderAlerts(){
  var c=live&&live.exitClusters?live.exitClusters.filter(function(x){return x.severity==='MULTI-WALLET EXIT'}).slice(0,3):[];
  document.getElementById('kExits').textContent=c.length;document.getElementById('alerts').innerHTML=c.map(function(x){return '<div class="alert">🚨 خروج همزمان چند کیف‌پول از <b>'+esc(x.token||short(x.tokenAddress))+'</b> · '+Number(x.uniqueSellers||0)+' فروشنده</div>'}).join('');
}
function renderAll(){document.getElementById('kTokens').textContent=tokens.length;renderChampion();renderAlerts();renderFeatured();renderWhales();renderSmart();renderSocialTrends();renderWallets();renderConviction();renderTokens()}
function stateLabel(v){return v==='pass'?'<span class="pass">✓ تأیید</span>':v==='fail'?'<span class="fail">✕ رد</span>':'<span class="manual">◌ دستی</span>'}
function openDetail(m){
  var t=findToken(m),tr=findTracked(m),sm=smartFor(m),wh=whaleFor(m),name=t?(t.symbol+' · '+t.name):(tr?(tr.symbol+' · '+tr.name):short(m)),h='';
  document.getElementById('detailTitle').textContent=name;
  if(t){
    var s=t.security||{},a=t.activity||{},mq=t.marketQuality||{},ch=t.chart||{},ac=t.academy||{};
    h+='<div class="modal-grid"><div class="box"><small>امنیت</small><b>'+esc(faSec(s.tier))+' · '+Number(s.score||0)+'/100</b></div><div class="box"><small>فعالیت</small><b>'+esc(faAct(a.label))+' · '+Number(a.score||0)+'/100</b></div><div class="box"><small>ترند</small><b>'+Number(t.trend&&t.trend.score||0)+'/100</b></div><div class="box"><small>Market Cap</small><b>'+money(t.marketCap)+'</b></div><div class="box"><small>Liquidity</small><b>'+money(t.liquidity)+'</b></div><div class="box"><small>Vol 5m</small><b>'+money(t.volume5m)+'</b></div><div class="box"><small>هولدر #1</small><b>'+pct(s.largestHolder)+'</b></div><div class="box"><small>بیشترین 2-10</small><b>'+pct(s.maxOtherHolder)+'</b></div><div class="box"><small>Top10</small><b>'+pct(s.top10)+'</b></div><div class="box"><small>کیفیت بازار</small><b>'+Number(mq.score||0)+'/100</b></div><div class="box"><small>FOMO</small><b>'+esc(ch.fomoRisk||'—')+'</b></div><div class="box"><small>Pump/Dump</small><b>'+esc(ch.pumpDumpRisk||'—')+'</b></div></div>';
    h+='<details class="accordion" open><summary>👥 هولدرهای بزرگ</summary><div class="accordion-body">'+(s.topHolders&&s.topHolders.length?s.topHolders.slice(0,10).map(function(x,i){return '<div class="holder"><span>#'+(i+1)+' · '+pct(x.pct)+'</span><a target="_blank" rel="noopener" href="https://solscan.io/account/'+esc(x.owner)+'">'+esc(short(x.owner))+'</a></div>'}).join(''):'<div class="note">داده هولدر موجود نیست.</div>')+'</div></details>';
    if(ac.checks&&ac.checks.length)h+='<details class="accordion"><summary>🛡 چک‌لیست امنیتی</summary><div class="accordion-body">'+ac.checks.map(function(c){return '<div class="check"><span>'+esc(c.name)+'</span>'+stateLabel(c.state)+'</div>'}).join('')+'</div></details>';
  }
  if(tr)h+='<div class="note"><b>کیف‌پول‌های برتر:</b> '+Number(tr.uniqueBuyers||0)+' خریدار، '+Number(tr.uniqueSellers||0)+' فروشنده، جریان خالص '+money(tr.netFlowUsd)+'، هولدینگ '+money(tr.currentHoldingUsd)+'</div>';
  if(sm)h+='<div class="note"><b>اسمارت‌مانی:</b> '+Number(sm.smartMoneyCount||0)+' کیف‌پول · '+money(sm.totalValueUsd)+' پوزیشن</div>';
  if(wh.count)h+='<div class="note"><b>نهنگ:</b> '+wh.count+' خرید بزرگ · '+money(wh.usd)+'</div>';if(t)h+=socialButtons(t);
  h+='<div class="links"><a target="_blank" rel="noopener" href="'+esc(dexUrl(m,t&&t.dexUrl))+'">📈 DexScreener</a><a target="_blank" rel="noopener" href="https://solscan.io/token/'+encodeURIComponent(m)+'">Solscan</a><a target="_blank" rel="noopener" href="https://gmgn.ai/sol/token/'+encodeURIComponent(m)+'">GMGN</a><a target="_blank" rel="noopener" href="https://v2.bubblemaps.io/map?address='+encodeURIComponent(m)+'&chain=solana&partnerId=regular">Bubblemaps</a><a target="_blank" rel="noopener" href="https://www.solanatracker.io/rugcheck/'+encodeURIComponent(m)+'">Rugcheck</a></div><div class="note">این رادار ابزار تحقیق است؛ هیچ امتیازی تضمین سود یا نبود کلاهبرداری نیست.</div>';
  document.getElementById('detailBody').innerHTML=h;document.getElementById('detailDialog').showModal();
}
async function loadAll(){
  var b=document.getElementById('refresh');b.disabled=true;b.textContent='در حال دریافت…';
  var r=await Promise.all([safeJson('/api/v1/tokens'),safeJson('/api/v1/smart-money'),safeJson('/api/v1/smart-money-live'),safeJson('/api/v1/tracked-wallets'),safeJson('/api/v1/conviction-wallets')]);
  tokens=r[0]&&r[0].tokens?r[0].tokens:[];smart=r[1];live=r[2];tracked=r[3];conviction=r[4];
  document.getElementById('updated').textContent='آخرین بروزرسانی: '+new Date().toLocaleTimeString('fa-IR');b.disabled=false;b.textContent='↻ بروزرسانی';renderAll();
}
async function loadLiveEverySecond(){
  var x=await safeJson('/api/v1/smart-money-live');
  if(!x)return;
  live=x;
  renderAlerts();renderWhales();renderChampion();
  document.getElementById('updated').textContent='زنده: '+new Date().toLocaleTimeString('fa-IR');
}
document.addEventListener('click',function(e){var d=e.target.closest('.detail-btn');if(!d)return;openDetail(d.getAttribute('data-mint')||'')});
document.getElementById('tabs').addEventListener('click',function(e){var b=e.target.closest('[data-tab]');if(!b)return;activeTab=b.dataset.tab;document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x===b)});document.querySelectorAll('.panel').forEach(function(x){x.classList.remove('active')});document.getElementById(activeTab+'Panel').classList.add('active')});
document.addEventListener('change',function(e){var sfel=e.target.closest('.signal-filter');if(!sfel)return;signalFilters[sfel.dataset.filter]=sfel.value;document.querySelectorAll('.signal-filter[data-filter="'+sfel.dataset.filter+'"]').forEach(function(x){if(x!==sfel)x.value=sfel.value});renderChampion();renderFeatured();renderWhales();renderSmart();renderTokens()});
document.getElementById('search').addEventListener('input',renderTokens);document.getElementById('securityFilter').addEventListener('change',renderTokens);document.getElementById('activityFilter').addEventListener('change',renderTokens);document.getElementById('refresh').addEventListener('click',loadAll);document.getElementById('closeDetail').addEventListener('click',function(){document.getElementById('detailDialog').close()});document.getElementById('detailDialog').addEventListener('click',function(e){if(e.target===this)this.close()});
loadAll();setInterval(loadLiveEverySecond,1000);setInterval(loadAll,60000);
</script>
</body>
</html>`;

createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(url.pathname==='/api/health'){res.writeHead(200,{'content-type':'application/json',...headers});return res.end(JSON.stringify({ok:true,time:new Date().toISOString()}))}
    if(url.pathname==='/api/v1/conviction-wallets'){const cw=await buildConvictionWallets();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(cw))}
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
