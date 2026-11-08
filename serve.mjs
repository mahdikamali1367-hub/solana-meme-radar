import {createServer} from 'node:http';

const PORT=Number(process.env.PORT||4173);
const RPC=process.env.SOLANA_RPC_URL||'https://api.mainnet.solana.com';
const CACHE_MS=55_000;
const SOCIAL_QUERY_CACHE_MS=2*60*60*1000;
const socialQueryCache=new Map();
const SECURITY_CACHE_MS=2*60*1000;
const EXTERNAL_SECURITY_CACHE_MS=10*60*1000;
let cache={at:0,data:null};
let buildInFlight=null;
const securityCache=new Map();
const externalSecurityCache=new Map();
const holderBehaviorState=new Map();
const signalConfirmState=new Map();
let smartMoneyCache={at:0,data:null};
const SMART_MONEY_CACHE_MS=6*60*60*1000;
let smartTraderHandles=new Set();
let liveFomoState={connected:false,realtime:false,delaySeconds:null,updatedAt:null,events:[],lastError:null};
let liveFomoSocket=null;
const liveSseClients=new Set();
function broadcastLiveState(kind='update'){
  if(!liveSseClients.size)return;
  const payload='event: '+kind+'\ndata: '+JSON.stringify(liveSmartMoneyPayload())+'\n\n';
  for(const res of [...liveSseClients]){try{res.write(payload)}catch{liveSseClients.delete(res)}}
}

const SPL_TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL_MINT='So11111111111111111111111111111111111111112';
const STABLE_MINTS=new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD6PGVgN7k9Yg1iQeSxGZ7'
]);
const KOL_WATCH_NAMES=new Set(['Cented','Decu','Theo','Trunoest','Nyhrox','Limfork','Kadenox','Casino','Jijo','Johnson']);
let kolTrendCache={at:0,data:null};
const KOL_TREND_CACHE_MS=2*60*1000;

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


function agoMinutes(text){
  const x=String(text||'');
  let m=x.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|m)\s*ago/i);if(m)return num(m[1]);
  m=x.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*ago/i);if(m)return num(m[1])*60;
  m=x.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days)\s*ago/i);if(m)return num(m[1])*1440;
  return null;
}
function kolSeed(){
  return {kolNames:new Set(),kolHandles:new Set(),holdingCount:0,recentCount:0,xMentionCount:0,xEngagement:0,evidence:[]};
}
async function kolTrendDiscovery(){
  if(kolTrendCache.data&&Date.now()-kolTrendCache.at<KOL_TREND_CACHE_MS)return kolTrendCache.data;
  const profiles=TRACKED_WALLETS.filter(w=>KOL_WATCH_NAMES.has(w.name)&&w.source==='KOL Explorer'&&w.sourceUrl);
  const agg=new Map(),handles=[];
  const settled=await Promise.allSettled(profiles.map(async w=>{
    const html=await tfetch(w.sourceUrl,{},12000);
    const txt=stripHtml(html);
    const hm=txt.match(/Follow\s+@([A-Za-z0-9_]{1,15})\s+on X/i)||html.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})/i);
    const handle=hm?hm[1]:null;
    if(handle)handles.push({name:w.name,handle});
    const rows=[];
    const re=/<a\b[^>]*href=["'](?:https?:\/\/kolexplorer\.com)?\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while((m=re.exec(html))){
      const mint=m[1],label=stripHtml(m[2]),age=agoMinutes(label);
      const holding=/\bHolding\b/i.test(label);
      const recent=age!=null&&age<=360;
      if(!holding&&!recent)continue;
      rows.push({mint,label:label.slice(0,180),holding,recent,ageMinutes:age});
    }
    return {w,handle,rows};
  }));
  for(const r of settled){
    if(r.status!=='fulfilled')continue;
    const {w,handle,rows}=r.value;
    for(const row of rows){
      const a=agg.get(row.mint)||kolSeed();
      a.kolNames.add(w.name);if(handle)a.kolHandles.add(handle);
      if(row.holding)a.holdingCount++;
      if(row.recent)a.recentCount++;
      a.evidence.push({kol:w.name,handle:handle||null,type:row.holding?'HOLDING':'RECENT_TRADE',ageMinutes:row.ageMinutes,label:row.label});
      agg.set(row.mint,a);
    }
  }

  // If X API is configured, scan the watched KOL accounts for direct Solana mint mentions.
  const xKey=process.env.X_BEARER_TOKEN;
  if(xKey&&handles.length){
    for(let i=0;i<handles.length;i+=4){
      const group=handles.slice(i,i+4);
      const q='('+group.map(x=>'from:'+x.handle).join(' OR ')+') -is:retweet';
      const startTime=new Date(Date.now()-6*60*60*1000).toISOString();
      const u='https://api.x.com/2/tweets/search/recent?query='+encodeURIComponent(q)+'&max_results=100&start_time='+encodeURIComponent(startTime)+'&tweet.fields=public_metrics,author_id,created_at&expansions=author_id&user.fields=username';
      try{
        const d=await jfetch(u,{headers:{authorization:'Bearer '+xKey}},12000);
        const users=new Map((d?.includes?.users||[]).map(x=>[String(x.id),String(x.username||'')]));
        for(const tw of (d?.data||[])){
          const username=users.get(String(tw.author_id))||'';
          const who=group.find(x=>x.handle.toLowerCase()===username.toLowerCase());
          const mints=[...new Set(String(tw.text||'').match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g)||[])];
          const pm=tw.public_metrics||{};
          const engagement=num(pm.like_count)+num(pm.retweet_count)*2+num(pm.reply_count)+num(pm.quote_count)*2;
          for(const mint of mints){
            const a=agg.get(mint)||kolSeed();
            if(who){a.kolNames.add(who.name);a.kolHandles.add(who.handle)}
            a.xMentionCount++;a.xEngagement+=engagement;
            a.evidence.push({kol:who?.name||username,handle:username||null,type:'X_MENTION',ageMinutes:null,label:String(tw.text||'').slice(0,180)});
            agg.set(mint,a);
          }
        }
      }catch{}
      await sleep(80);
    }
  }

  const tokens=[...agg.entries()].map(([mint,a])=>{
    const kolNames=[...a.kolNames],kolHandles=[...a.kolHandles];
    let score=kolNames.length*18+a.recentCount*8+a.holdingCount*4+a.xMentionCount*12;
    if(a.xEngagement>0)score+=Math.min(15,Math.log10(1+a.xEngagement)*5);
    score=clamp(Math.round(score));
    return {mint,score,kolCount:kolNames.length,kolNames,kolHandles,holdingCount:a.holdingCount,recentCount:a.recentCount,xMentionCount:a.xMentionCount,xEngagement:a.xEngagement,evidence:a.evidence.slice(0,12)};
  }).sort((a,b)=>b.score-a.score||b.kolCount-a.kolCount);
  const data={tokens:tokens.slice(0,30),handles,xConfigured:!!xKey,generatedAt:new Date().toISOString()};
  kolTrendCache={at:Date.now(),data};return data;
}

async function discovery(){
  const urls=['https://api.dexscreener.com/token-profiles/latest/v1','https://api.dexscreener.com/token-boosts/latest/v1','https://api.dexscreener.com/token-boosts/top/v1'];
  const [sets,kol]=await Promise.all([Promise.allSettled(urls.map(u=>jfetch(u))),kolTrendDiscovery()]);
  const m=new Map();
  const blank=mint=>({mint,description:'',image:'',links:[],boostAmount:0,boostTotal:0,boostSeen:false,profileSeen:false,kolTrend:null});
  sets.forEach((r,idx)=>{
    if(r.status!=='fulfilled')return;
    for(const x of (Array.isArray(r.value)?r.value:[])){
      if(x.chainId!=='solana'||!x.tokenAddress)continue;
      const old=m.get(x.tokenAddress)||blank(x.tokenAddress);
      old.description=x.description||old.description;
      old.image=x.icon||old.image;
      old.links=Array.isArray(x.links)&&x.links.length?x.links:old.links;
      if(idx===0)old.profileSeen=true;
      else {old.boostSeen=true;old.boostAmount=Math.max(old.boostAmount,num(x.amount));old.boostTotal=Math.max(old.boostTotal,num(x.totalAmount));}
      m.set(x.tokenAddress,old);
    }
  });
  for(const k of (kol?.tokens||[])){
    const old=m.get(k.mint)||blank(k.mint);
    old.kolTrend=k;
    m.set(k.mint,old);
  }
  return [...m.values()].sort((a,b)=>{
    const ka=num(a.kolTrend?.score),kb=num(b.kolTrend?.score);
    if(kb!==ka)return kb-ka;
    if(a.kolTrend&&!b.kolTrend)return -1;if(b.kolTrend&&!a.kolTrend)return 1;
    return num(b.boostTotal)-num(a.boostTotal);
  }).slice(0,60);
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
  let tokenProgram=null,tokenExtensions={isToken2022:false,names:[],permanentDelegate:false,nonTransferable:false,defaultFrozen:false,transferHook:false,transferFeeBps:null,hardFail:false,warnings:[]};
  try{
    const d=await rpc('getAccountInfo',[mint,{encoding:'jsonParsed',commitment:'confirmed'}]);
    const account=d?.result?.value;
    const info=account?.data?.parsed?.info;
    tokenProgram=account?.owner||null;
    if(info){
      mintDisabled=info.mintAuthority==null;
      freezeDisabled=info.freezeAuthority==null;
      coverage+=45;
      score+=(mintDisabled?15:-30)+(freezeDisabled?15:-25);
      if(!mintDisabled)flags.push('Mint authority فعال');
      if(!freezeDisabled)flags.push('Freeze authority فعال');

      tokenExtensions.isToken2022=tokenProgram===TOKEN_2022_PROGRAM;
      const ext=Array.isArray(info.extensions)?info.extensions:[];
      tokenExtensions.names=ext.map(e=>String(e?.extension||e?.type||e?.name||'')).filter(Boolean);
      const extText=ext.map(e=>JSON.stringify(e)).join(' ').toLowerCase();
      tokenExtensions.permanentDelegate=/permanentdelegate|permanent_delegate/.test(extText);
      tokenExtensions.nonTransferable=/nontransferable|non_transferable/.test(extText);
      tokenExtensions.transferHook=/transferhook|transfer_hook/.test(extText);
      tokenExtensions.defaultFrozen=/defaultaccountstate[^}]*frozen|default_account_state[^}]*frozen/.test(extText);

      const feeExt=ext.find(e=>/transferfeeconfig|transfer_fee_config/i.test(String(e?.extension||e?.type||e?.name||'')));
      if(feeExt){
        const raw=feeExt?.state||feeExt;
        const newer=raw?.newerTransferFee||raw?.newer_transfer_fee||raw?.transferFee||raw?.transfer_fee||raw;
        const bps=pick(newer,'transferFeeBasisPoints','transfer_fee_basis_points','basisPoints','basis_points');
        if(Number.isFinite(Number(bps)))tokenExtensions.transferFeeBps=num(bps);
      }

      if(tokenExtensions.permanentDelegate){tokenExtensions.hardFail=true;flags.push('Token-2022 Permanent Delegate فعال');score-=35}
      if(tokenExtensions.nonTransferable){tokenExtensions.hardFail=true;flags.push('Token-2022 Non-Transferable فعال');score-=40}
      if(tokenExtensions.defaultFrozen){tokenExtensions.hardFail=true;flags.push('Token-2022 Default Frozen فعال');score-=35}
      if(tokenExtensions.transferFeeBps!=null&&tokenExtensions.transferFeeBps>=500){tokenExtensions.hardFail=true;flags.push('Transfer Fee حداقل 5%');score-=30}
      else if(tokenExtensions.transferFeeBps!=null&&tokenExtensions.transferFeeBps>200){tokenExtensions.warnings.push('Transfer Fee بالاتر از 2%');score-=10}
      if(tokenExtensions.transferHook){tokenExtensions.warnings.push('Transfer Hook فعال؛ منطق سفارشی انتقال');score-=8}
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
      else if(largestHolder<10&&maxOtherHolder<5){holderGrade='C';score+=2}
      else {holderGrade='F';score-=35}
      if(largestHolder>=10)flags.push('هولدر شماره 1 باید کمتر از 10% عرضه داشته باشد');
      if(maxOtherHolder>=5)flags.push('هر هولدر شماره 2 تا 10 باید کمتر از 5% عرضه داشته باشد');
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
  const result={score:clamp(score),coverage,mintDisabled,freezeDisabled,top5,top10,largestHolder,maxOtherHolder,holderGrade,holderPolicyPassed,holderStrong,ownerAggregationComplete,topHolders,tokenProgram,tokenExtensions,flags,checkedAt:Date.now()};
  securityCache.set(mint,{at:Date.now(),data:result});
  return result;
}


function holderBehaviorAudit(t){
  const sec=t.security||{},mint=t.mint,checkedAt=num(sec.checkedAt);
  let state=holderBehaviorState.get(mint)||{snapshots:[]};
  const holders=(sec.topHolders||[]).map(h=>({owner:String(h.owner||''),pct:num(h.pct)})).filter(h=>h.owner&&h.pct>=0);
  if(checkedAt&&holders.length&&(!state.snapshots.length||state.snapshots[state.snapshots.length-1].at!==checkedAt)){
    state.snapshots.push({at:checkedAt,holders,top10:num(sec.top10),top1:num(sec.largestHolder)});
    if(state.snapshots.length>8)state.snapshots=state.snapshots.slice(-8);
    holderBehaviorState.set(mint,state);
  }
  let outflowPct=0,top1DropPct=0,movedHolders=0,observedMinutes=0;
  if(state.snapshots.length>=2){
    const prev=state.snapshots[state.snapshots.length-2],cur=state.snapshots[state.snapshots.length-1];
    observedMinutes=Math.max(0,(cur.at-prev.at)/60000);
    const cm=new Map(cur.holders.map(h=>[h.owner,h.pct]));
    for(let i=0;i<prev.holders.length;i++){
      const p=prev.holders[i],now=cm.get(p.owner)||0,drop=Math.max(0,p.pct-now);
      if(drop>=0.10)movedHolders++;
      outflowPct+=drop;
      if(i===0)top1DropPct=drop;
    }
  }
  const sellRatio=(num(t.sells5m)+1)/(num(t.buys5m)+1);
  const marketWeak=sellRatio>=0.85||num(t.priceChange5m)<-2;
  const risk=state.snapshots.length>=2&&(
    top1DropPct>=0.75||
    outflowPct>=1.5||
    (outflowPct>=0.50&&marketWeak)
  );
  const stable=state.snapshots.length>=2&&!risk&&outflowPct<0.50&&sellRatio<=0.80;
  return {
    snapshots:state.snapshots.length,
    observedMinutes:+observedMinutes.toFixed(1),
    outflowPct:+outflowPct.toFixed(3),
    top1DropPct:+top1DropPct.toFixed(3),
    movedHolders,
    sellBuyRatio:+sellRatio.toFixed(2),
    status:risk?'RISK':stable?'STABLE':'WAIT',
    note:risk?'حرکت/خروج هولدر بزرگ همراه فشار فروش دیده شده':stable?'دو snapshot هولدر پایدار و فشار فروش کنترل‌شده':'برای تأیید پایداری هولدر داده بیشتری لازم است'
  };
}
function preSignalConfirmation(t){
  const mint=t.mint,h=t.holderBehavior||holderBehaviorAudit(t);
  const sec=t.security||{},fl=t.flow||{},chart=t.chart||{};
  const reasons=[],blocks=[];
  const sellRatio=(num(t.sells5m)+1)/(num(t.buys5m)+1);
  if(sec.holderPolicyPassed!==true)blocks.push('قانون هولدر تأیید نشده');
  if(h.status==='RISK')blocks.push('خروج/حرکت هولدر بزرگ');
  if(fl.sellerDominant)blocks.push('فروشنده‌ها غالب‌اند');
  if(sellRatio>1.05)blocks.push('فروش 5m از خرید بیشتر شده');
  if(chart.pumpDumpRisk==='HIGH')blocks.push('Pump/Dump risk بالا');
  if(num(t.priceChange5m)<-8)blocks.push('افت سریع قیمت');
  if(num(t.priceChange5m)>15)reasons.push('بعد از پامپ کوتاه‌مدت نیاز به cooldown');
  if(num(t.priceChange1h)>55)reasons.push('حرکت 1h بیش‌ازحد کشیده');
  if(!(fl.volumeLabel==='GOOD'||fl.volumeLabel==='STRONG'))reasons.push('حجم هنوز تأیید قوی نیست');
  if(!fl.buyerDominant)reasons.push('قدرت خریدار هنوز غالب نیست');
  if(h.snapshots<2)reasons.push('کمتر از دو snapshot هولدر');
  if(h.status!=='STABLE')reasons.push('پایداری هولدر هنوز تأیید نشده');

  const baseGood=!blocks.length&&
    sec.holderPolicyPassed===true&&
    (fl.volumeLabel==='GOOD'||fl.volumeLabel==='STRONG')&&
    fl.buyerDominant===true&&
    sellRatio<=0.80&&
    num(t.priceChange5m)<=15&&
    num(t.priceChange1h)<=55&&
    h.status==='STABLE';

  let st=signalConfirmState.get(mint)||{firstGoodAt:null,goodScans:0,lastObservedAt:0};
  const now=Date.now();
  if(now-st.lastObservedAt>30_000){
    if(baseGood){
      if(!st.firstGoodAt)st.firstGoodAt=now;
      st.goodScans++;
    }else{
      st.firstGoodAt=null;st.goodScans=0;
    }
    st.lastObservedAt=now;
    signalConfirmState.set(mint,st);
  }
  const confirmedMinutes=st.firstGoodAt?Math.max(0,(now-st.firstGoodAt)/60000):0;
  // Fast confirmation for fast-moving meme coins: keep every hard block,
  // but do not require three scans / two full minutes before surfacing a usable entry.
  const confirmed=baseGood&&st.goodScans>=2&&confirmedMinutes>=0.75&&h.snapshots>=2;
  const status=blocks.length?'BLOCK':confirmed?'CONFIRMED':'WAIT';
  return {
    status,goodScans:st.goodScans,confirmedMinutes:+confirmedMinutes.toFixed(1),
    holderSnapshots:h.snapshots,reasons:[...new Set(reasons)].slice(0,6),blocks:[...new Set(blocks)].slice(0,6)
  };
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
  if(seed.kolTrend){
    const k=seed.kolTrend;
    score+=Math.min(22,Math.round(num(k.score)*0.22));
    if(num(k.kolCount)>=2)reasons.push(k.kolCount+' KOL همزمان');
    else if(num(k.kolCount)===1)reasons.push('ردیابی KOL');
    if(num(k.xMentionCount)>0)reasons.push(k.xMentionCount+' اشاره مستقیم X');
  }
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


function auditState(state,detail,source){return {state,detail:detail||'',source:source||''}}
function pick(obj,...keys){for(const k of keys){if(obj&&obj[k]!=null)return obj[k]}return null}
function textRisk(r){return ((r?.name||'')+' '+(r?.description||'')+' '+(r?.value||'')).toLowerCase()}
async function externalSecurityAudit(t){
  const mint=t.mint,old=externalSecurityCache.get(mint);
  if(old&&Date.now()-old.at<EXTERNAL_SECURITY_CACHE_MS)return old.data;

  const [fullR,summaryR]=await Promise.allSettled([
    jfetch('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(mint)+'/report',{},12000),
    jfetch('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(mint)+'/report/summary',{},12000)
  ]);
  const report=fullR.status==='fulfilled'?fullR.value:null;
  const summary=summaryR.status==='fulfilled'?summaryR.value:null;
  const sourceObj=report||summary||{};
  const risks=Array.isArray(report?.risks)?report.risks:Array.isArray(summary?.risks)?summary.risks:[];
  const risky=(re)=>risks.filter(r=>re.test(textRisk(r)));

  // LP lock: summary endpoint is the most direct RugCheck field.
  let lpLockedPct=num(pick(summary,'lpLockedPct','lp_locked_pct'),NaN);
  if(!Number.isFinite(lpLockedPct))lpLockedPct=num(pick(report,'lpLockedPct','lp_locked_pct'),NaN);
  if(!Number.isFinite(lpLockedPct)){
    const markets=Array.isArray(report?.markets)?report.markets:[];
    const vals=markets.flatMap(m=>[
      pick(m,'lpLockedPct','lp_locked_pct'),
      pick(m?.lp,'lpLockedPct','lp_locked_pct','lockedPct','locked_pct')
    ]).map(v=>num(v,NaN)).filter(Number.isFinite);
    if(vals.length)lpLockedPct=Math.max(...vals);
  }
  let lp;
  if(Number.isFinite(lpLockedPct)){
    if(lpLockedPct>=90)lp=auditState('pass','LP قفل/سوخته: '+lpLockedPct.toFixed(1)+'%','RugCheck summary');
    else if(lpLockedPct<50)lp=auditState('fail','LP قفل‌شده فقط '+lpLockedPct.toFixed(1)+'%','RugCheck summary');
    else lp=auditState('warn','LP قفل‌شده '+lpLockedPct.toFixed(1)+'%؛ برای سطح امن بالا حداقل 90% ترجیح داده می‌شود','RugCheck summary');
  }else{
    const lpRisks=risky(/liquidity.*lock|lp.*lock|unlocked liquidity|liquidity.*unlocked/);
    lp=lpRisks.length?auditState('fail',lpRisks[0].name||'ریسک LP','RugCheck'):auditState('unknown','RugCheck درصد LP Lock برنگرداند','RugCheck');
  }

  // Creator/dev holding: RugCheck top holders first, then direct Solana RPC fallback.
  const creator=String(pick(report,'creator')||'');
  const top=Array.isArray(pick(report,'topHolders','top_holders'))?pick(report,'topHolders','top_holders'):[];
  let creatorPct=null,creatorBound=null;
  if(creator&&top.length){
    const h=top.find(x=>String(x?.owner||x?.address||'')===creator);
    if(h&&Number.isFinite(Number(h.pct)))creatorPct=num(h.pct);
    else if(top.length>=10){
      const vals=top.map(x=>num(x?.pct,NaN)).filter(Number.isFinite).sort((a,b)=>b-a);
      if(vals.length>=10)creatorBound=vals[9];
    }
  }
  if(creator&&creatorPct==null){
    try{
      const [sp,acc]=await Promise.all([
        rpc('getTokenSupply',[mint,{commitment:'confirmed'}]),
        rpc('getTokenAccountsByOwner',[creator,{mint},{encoding:'jsonParsed',commitment:'confirmed'}])
      ]);
      const supply=num(sp?.result?.value?.uiAmount);
      const held=(acc?.result?.value||[]).reduce((n,x)=>n+num(x?.account?.data?.parsed?.info?.tokenAmount?.uiAmountString??x?.account?.data?.parsed?.info?.tokenAmount?.uiAmount),0);
      if(supply>0)creatorPct=held/supply*100;
    }catch{}
  }
  const devRisks=risky(/creator|developer|dev wallet|dev holding/);
  let dev;
  if(creatorPct!=null){
    dev=creatorPct<5?auditState('pass','Dev holding '+creatorPct.toFixed(2)+'%','RugCheck + Solana RPC'):
        creatorPct>=10?auditState('fail','Dev holding بالا: '+creatorPct.toFixed(2)+'%','RugCheck + Solana RPC'):
        auditState('warn','Dev holding '+creatorPct.toFixed(2)+'%','RugCheck + Solana RPC');
  }else if(creator&&creatorBound!=null&&creatorBound<5){
    dev=auditState('pass','کیف‌پول سازنده خارج Top10 است؛ سقف تقریبی <'+creatorBound.toFixed(2)+'%','RugCheck');
  }else if(devRisks.some(r=>/danger|critical|high/i.test(String(r.level||'')))){
    dev=auditState('fail',devRisks[0].name||'ریسک سازنده','RugCheck');
  }else{
    dev=auditState('unknown',creator?'درصد Dev با RPC هم قابل محاسبه نبود':'Creator در گزارش مشخص نیست','RugCheck + Solana RPC');
  }

  // Insider/sniper/bundle graph.
  const networks=Array.isArray(report?.insiderNetworks)?report.insiderNetworks:[];
  const graphRaw=pick(report,'graphInsidersDetected','graph_insiders_detected');
  const graphCount=graphRaw==null?NaN:num(graphRaw,NaN);
  const insiderTop=top.filter(x=>x?.insider===true).length;
  const insiderRisks=risky(/insider|sniper|bundle|bundled|connected wallet/);
  const severeInsider=insiderRisks.some(r=>/danger|critical|high/i.test(String(r.level||'')));
  let insider;
  if(severeInsider||insiderTop>=2||(Number.isFinite(graphCount)&&graphCount>=2)||networks.length>=2){
    insider=auditState('fail','Insider/Sniper/Bundle مشکوک: '+Math.max(Number.isFinite(graphCount)?graphCount:0,insiderTop,networks.length)+' مورد','RugCheck graph');
  }else if(insiderTop===1||(Number.isFinite(graphCount)&&graphCount===1)||networks.length===1||insiderRisks.length){
    insider=auditState('warn','یک سیگنال Insider/Sniper/Bundle دیده شد','RugCheck graph');
  }else if(Number.isFinite(graphCount)||Array.isArray(report?.insiderNetworks)){
    insider=auditState('pass','گراف RugCheck مورد Insider/Sniper فعال نشان نداد','RugCheck graph');
  }else{
    insider=auditState('unknown','گراف Insider نتیجه قابل اتکا برنگرداند','RugCheck');
  }

  // Creator history / metadata are additional automatic checks.
  const creatorHistoryRisks=risky(/creator history|rugged tokens|previous rug|deployer history/);
  const creatorTokens=Array.isArray(report?.creatorTokens)?report.creatorTokens:[];
  let creatorHistory;
  if(creatorHistoryRisks.some(r=>/danger|critical|high/i.test(String(r.level||''))))creatorHistory=auditState('fail',creatorHistoryRisks[0].name||'سابقه Rug سازنده','RugCheck');
  else if(creatorTokens.length)creatorHistory=auditState('pass','سابقه سازنده بررسی شد؛ پرچم Rug شدید دیده نشد','RugCheck');
  else creatorHistory=auditState('unknown','تاریخچه سازنده برنگشت','RugCheck');

  const mutable=pick(report?.tokenMeta,'mutable');
  const metadata=mutable===false?auditState('pass','Metadata immutable','RugCheck'):
    mutable===true?auditState('warn','Metadata هنوز قابل تغییر است','RugCheck'):
    auditState('unknown','وضعیت mutable metadata گزارش نشد','RugCheck');

  // RugCheck overall score.
  let rugScore=num(pick(report,'score_normalised','scoreNormalised'),NaN);
  if(!Number.isFinite(rugScore))rugScore=num(pick(summary,'score_normalised','scoreNormalised'),NaN);
  const rugged=pick(report,'rugged')===true;
  let overall;
  if(rugged)overall=auditState('fail','RugCheck: rugged=true','RugCheck');
  else if(Number.isFinite(rugScore))overall=rugScore<=20?auditState('pass','RugCheck risk '+rugScore+'/100 (کمتر بهتر)','RugCheck'):
       rugScore>=45?auditState('fail','RugCheck risk '+rugScore+'/100','RugCheck'):
       auditState('warn','RugCheck risk '+rugScore+'/100','RugCheck');
  else overall=auditState('unknown','امتیاز نرمال RugCheck گزارش نشده','RugCheck');

  // Sellability: reject dangerous RugCheck/Token-2022 flags, otherwise try Jupiter quote.
  const sellRisks=risky(/honeypot|cannot sell|unable to sell|sell restriction|transfer fee|permanent delegate|non-transferable/);
  const severeSell=sellRisks.some(r=>/danger|critical|high/i.test(String(r.level||'')));
  let sell=severeSell?auditState('fail',sellRisks[0].name||'ریسک فروش','RugCheck'):null;
  if(t.security?.tokenExtensions?.hardFail){
    sell=auditState('fail','Token-2022 extension پرریسک می‌تواند انتقال/فروش را محدود کند','Solana RPC');
  }
  if(!sell){
    const decimals=Math.max(0,Math.min(9,num(pick(report?.token,'decimals'),6)));
    const desiredTokens=t.priceUsd>0?Math.max(1,Math.min(1e9,50/t.priceUsd)):1000;
    const units=(BigInt(Math.max(1,Math.floor(desiredTokens)))*(10n**BigInt(decimals))).toString();
    const query='?inputMint='+encodeURIComponent(mint)+'&outputMint='+encodeURIComponent(WSOL_MINT)+'&amount='+units+'&slippageBps=500&instructionVersion=V2';
    const urls=[];
    if(process.env.JUPITER_API_KEY)urls.push({u:'https://api.jup.ag/swap/v1/quote'+query,h:{'x-api-key':process.env.JUPITER_API_KEY}});
    urls.push({u:'https://lite-api.jup.ag/swap/v1/quote'+query,h:{}});
    let quote=null;
    for(const x of urls){
      try{quote=await jfetch(x.u,{headers:x.h},9000);if(quote?.outAmount&&num(quote.outAmount)>0)break}catch{}
    }
    if(quote?.outAmount&&num(quote.outAmount)>0){
      const impact=Math.abs(num(quote?.priceImpactPct))*100;
      sell=impact<=10?auditState('pass','مسیر فروش Jupiter موجود؛ impact تقریبی '+impact.toFixed(2)+'%','Jupiter quote'):
           auditState('warn','مسیر فروش موجود ولی impact '+impact.toFixed(2)+'%','Jupiter quote');
    }else if(num(t.sells5m)>=3||num(t.sells1h)>=10){
      sell=auditState('warn','فروش واقعی اخیر در DEX مشاهده شده، ولی quote مستقل Jupiter تأیید نشد','DexScreener');
    }else if(sellRisks.length){
      sell=auditState('warn','RugCheck ریسک فروش/fee گزارش کرده: '+(sellRisks[0].name||''),'RugCheck');
    }else{
      sell=auditState('unknown','نه quote فروش و نه فروش اخیر کافی برای تأیید پیدا شد','Jupiter + DexScreener');
    }
  }

  // Token-2022 extension audit from direct mint parsing.
  const te=t.security?.tokenExtensions||{};
  let extensions=auditState('pass','Token program استاندارد یا extension پرریسک شناسایی نشد','Solana RPC');
  if(te.hardFail)extensions=auditState('fail',(te.names||[]).join(', ')||'Token-2022 extension پرریسک','Solana RPC');
  else if(te.transferHook||(te.transferFeeBps!=null&&te.transferFeeBps>200))extensions=auditState('warn',(te.warnings||[]).join('؛ ')||'Token-2022 نیازمند احتیاط','Solana RPC');
  else if(te.isToken2022)extensions=auditState('pass','Token-2022 بررسی شد؛ extension بحرانی شناسایی نشد','Solana RPC');

  const available=!!(report||summary||t.security);
  const data={available,lp,dev,insider,sell,overall,creatorHistory,metadata,extensions,rugcheckScore:Number.isFinite(rugScore)?rugScore:null,lpLockedPct:Number.isFinite(lpLockedPct)?lpLockedPct:null,creator,creatorPct,rawRiskCount:risks.length,tokenProgram:pick(summary,'tokenProgram')||pick(report,'tokenProgram')||t.security?.tokenProgram||null};
  externalSecurityCache.set(mint,{at:Date.now(),data});return data;
}

function academyGuard(t){
  const checks=[]; const sec=t.security||{},chart=t.chart||{},mq=t.marketQuality||{},ext=t.externalSecurity||{};
  const state=(ok,bad)=>ok?'pass':bad?'fail':'unknown';
  checks.push({name:'Mint authority لغو شده',state:state(sec.mintDisabled===true,sec.mintDisabled===false),detail:'Solana RPC'});
  checks.push({name:'Freeze authority غیرفعال',state:state(sec.freezeDisabled===true,sec.freezeDisabled===false),detail:'Solana RPC'});
  checks.push({name:'هولدر #1 <10% و هر هولدر #2 تا #10 <5%',state:state(sec.holderPolicyPassed===true,sec.holderPolicyPassed===false),detail:'Owner-aggregated holders'});
  checks.push({name:'Token-2022 extensionهای پرریسک',state:ext.extensions?.state||'unknown',detail:ext.extensions?.detail||'داده ناکافی'});
  checks.push({name:'نقدینگی سالم نسبت به Market Cap',state:mq.liqRatio>=0.05?'pass':mq.liqRatio>0&&mq.liqRatio<0.02?'fail':'warn',detail:'Liq/MC '+(mq.liqRatio*100).toFixed(1)+'%'});
  checks.push({name:'حجم در حال رشد، نه محو شدن',state:chart.volumeTrend==='RISING'?'pass':chart.volumeTrend==='FADING'?'fail':'warn',detail:'Volume trend '+chart.volumeTrend});
  checks.push({name:'فعالیت غیررباتی',state:t.activity?.label==='PROBABLE ORGANIC'?'pass':t.activity?.label==='BOT RISK'?'fail':'warn',detail:t.activity?.label||'UNKNOWN'});
  checks.push({name:'حجم معاملات سالم',state:(t.flow?.volumeLabel==='STRONG'||t.flow?.volumeLabel==='GOOD')?'pass':t.flow?.volumeLabel==='SUSPICIOUS'?'fail':'warn',detail:t.flow?.volumeLabel||'UNKNOWN'});
  checks.push({name:'قدرت خریدار بیشتر از فروشنده',state:t.flow?.buyerDominant?'pass':t.flow?.sellerDominant?'fail':'warn',detail:'Buyer power '+num(t.flow?.buyerPower)+'%'});
  checks.push({name:'شبکه اجتماعی/جامعه قابل مشاهده',state:(t.socialSources||[]).length>=2&&t.trend?.score>=40?'pass':'warn',detail:(t.socialSources||[]).length+' شبکه'});
  checks.push({name:'Liquidity Lock/Burn خودکار',state:ext.lp?.state||'unknown',detail:ext.lp?.detail||'داده ناکافی'});
  checks.push({name:'Dev holding خودکار',state:ext.dev?.state||'unknown',detail:ext.dev?.detail||'داده ناکافی'});
  checks.push({name:'سابقه سازنده / Rug history',state:ext.creatorHistory?.state||'unknown',detail:ext.creatorHistory?.detail||'داده ناکافی'});
  checks.push({name:'Metadata تغییرناپذیر',state:ext.metadata?.state||'unknown',detail:ext.metadata?.detail||'داده ناکافی'});
  checks.push({name:'Bundle/Sniper/Insider خودکار',state:ext.insider?.state||'unknown',detail:ext.insider?.detail||'داده ناکافی'});
  checks.push({name:'Sellability / Honeypot خودکار',state:ext.sell?.state||'unknown',detail:ext.sell?.detail||'داده ناکافی'});
  checks.push({name:'RugCheck ریسک کلی',state:ext.overall?.state||'unknown',detail:ext.overall?.detail||'داده ناکافی'});
  const pass=checks.filter(x=>x.state==='pass').length;
  const fail=checks.filter(x=>x.state==='fail').length;
  const warn=checks.filter(x=>x.state==='warn').length;
  const unknown=checks.filter(x=>x.state==='unknown').length;
  const externalCritical=['lp','dev','insider','sell','overall','extensions','creatorHistory'].some(k=>ext[k]?.state==='fail');
  const criticalFail=
    sec.mintDisabled===false||sec.freezeDisabled===false||sec.holderPolicyPassed===false||sec.tokenExtensions?.hardFail===true||
    t.activity?.label==='BOT RISK'||chart.pumpDumpRisk==='HIGH'||t.flow?.volumeLabel==='SUSPICIOUS'||
    (mq.liqRatio>0&&mq.liqRatio<0.02)||externalCritical;
  const blocked=criticalFail||fail>=2;
  const score=Math.round((pass+warn*0.4)/checks.length*100);
  const label=blocked?'BLOCK':fail===0&&warn<=2&&unknown===0?'AUTO PASS':fail===0?'NEEDS REVIEW':'CAUTION';
  return {score,label,pass,fail,warn,unknown,manual:0,blocked,checks,source:'fully automated evidence pipeline: Solana RPC + RugCheck full/summary + Jupiter quote + DexScreener; missing evidence stays UNKNOWN'};
}

function securityGate(t){
  const sec=t.security||{},mq=t.marketQuality||{},act=t.activity||{},chart=t.chart||{},academy=t.academy||{};
  const hard=[],cautions=[];
  if(sec.mintDisabled===false)hard.push('Mint authority فعال');
  else if(sec.mintDisabled!==true)cautions.push('Mint authority نامشخص');
  if(sec.freezeDisabled===false)hard.push('Freeze authority فعال');
  else if(sec.freezeDisabled!==true)cautions.push('Freeze authority نامشخص');
  if(sec.holderPolicyPassed===false)hard.push('قانون هولدر رد: #1 باید <10% و #2 تا #10 هرکدام <5% باشند');
  else if(sec.holderPolicyPassed!==true)cautions.push('توزیع هولدرها نیازمند داده کامل‌تر');
  if(sec.tokenExtensions?.hardFail)hard.push('Token-2022 extension پرریسک شناسایی شد');
  else if(sec.tokenExtensions?.warnings?.length)cautions.push(...sec.tokenExtensions.warnings);
  if(act.label==='BOT RISK')hard.push('ریسک ربات/Wash');
  else if(!act.label)cautions.push('فعالیت معاملاتی نامشخص');
  if(chart.pumpDumpRisk==='HIGH')hard.push('ریسک Pump/Dump بالا');
  if(academy.blocked)hard.push('Academy Guard مسدود');
  if(num(t.liquidity)>0&&num(t.liquidity)<3000)hard.push('نقدینگی خیلی کم');
  else if(num(t.liquidity)<=0)cautions.push('نقدینگی نامشخص');
  if(num(mq.score)<65)cautions.push('کیفیت بازار/داده متوسط یا پایین');
  if(sec.tier==='REVIEW')cautions.push('امنیت هنوز کامل تأیید نشده');
  if(chart.fomoRisk==='HIGH')cautions.push('ریسک FOMO بالا');
  if(num(academy.unknown)>0)cautions.push('شواهد امنیتی خودکار هنوز کامل نیست: '+num(academy.unknown)+' مورد نامشخص');
  if(num(academy.fail)>0)hard.push('یک یا چند چک امنیتی خودکار رد شده');
  const blocked=hard.length>0;
  const level=blocked?'BLOCK':cautions.length?'CAUTION':'PASS';
  return {level,blocked,hard,cautions,automaticChecks:(academy.checks||[]).length,unknownChecks:num(academy.unknown),manualChecks:0};
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
    s.tokenExtensions?.hardFail===true||
    t.activity?.label==='BOT RISK'||
    t.chart?.pumpDumpRisk==='HIGH'||
    t.academy?.blocked===true||
    (num(t.liquidity)>0&&num(t.liquidity)<3000);

  const verifiedCore=s.mintDisabled===true&&s.freezeDisabled===true&&s.holderPolicyPassed===true;
  const organicOk=t.activity&&t.activity.score>=72&&t.activity.label==='PROBABLE ORGANIC';
  const organicHigh=t.activity&&t.activity.score>=58&&t.activity.label!=='BOT RISK';
  const academy=t.academy||{};
  const criticalNames=['Liquidity Lock/Burn خودکار','Dev holding خودکار','Bundle/Sniper/Insider خودکار','Sellability / Honeypot خودکار','RugCheck ریسک کلی','Token-2022 extensionهای پرریسک','سابقه سازنده / Rug history'];
  const criticalChecks=(academy.checks||[]).filter(x=>criticalNames.includes(x.name));
  const criticalEvidenceComplete=criticalChecks.length===criticalNames.length&&criticalChecks.every(x=>x.state!=='unknown'&&x.state!=='fail');
  const fullAutoEvidence=num(academy.manual)===0&&num(academy.unknown)===0&&num(academy.fail)===0;
  const knowledgeOk=academy.blocked!==true&&criticalEvidenceComplete&&(t.marketQuality?.score??0)>=65&&t.chart?.pumpDumpRisk!=='HIGH';

  const maxOk=!explicitFail&&verifiedCore&&organicOk&&knowledgeOk&&fullAutoEvidence&&academy.warn<=2&&s.holderStrong===true&&s.score>=85&&t.liquidity>=10000;
  const highOk=!explicitFail&&verifiedCore&&organicHigh&&knowledgeOk&&num(academy.unknown)===0&&num(academy.fail)===0&&s.score>=75&&t.liquidity>=5000;
  const tier=explicitFail?'REJECT':maxOk?'MAX SECURITY':highOk?'HIGH':'REVIEW';
  return {tier,maxOk,highOk,explicitFail,verifiedCore};
}
function verdict(t){
  const sec=assessSecurity(t);
  t.security.tier=sec.tier;
  const early=t.ageMinutes<=20&&t.marketCap>=12000&&t.marketCap<=250000&&t.volume5m>=5000&&t.txns5m>=50;
  const strong=early&&sec.maxOk&&t.preSignalGuard?.status==='CONFIRMED'&&t.trend.score>=55&&t.buys5m>t.sells5m;
  if(strong)return 'STRONG WATCH';
  if(sec.tier==='REJECT')return 'SKIP';
  if(sec.tier==='MAX SECURITY'||sec.tier==='HIGH')return t.trend.score>=35?'WATCH':'LOW SIGNAL';
  return 'REVIEW';
}
async function buildFresh(){
  if(cache.data&&Date.now()-cache.at<CACHE_MS)return cache.data;
  const seeds=await discovery();
  const out=[];
  for(const s of seeds.slice(0,45)){
    const p=await pairFor(s.mint); if(!p)continue;
    const created=num(p.pairCreatedAt);
    if(!created)continue;
    const ageMinutes=Math.max(0,(Date.now()-created)/60000);
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
      priceChange5m:num(p.priceChange?.m5),priceChange1h:num(p.priceChange?.h1),priceChange6h:num(p.priceChange?.h6),priceChange24h:num(p.priceChange?.h24),security:sec,kolTrend:s.kolTrend||null
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
    t.externalSecurity=await externalSecurityAudit(t);
    t.academy=academyGuard(t);
    t.holderBehavior=holderBehaviorAudit(t);
    t.preSignalGuard=preSignalConfirmation(t);
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
    if(!t.externalSecurity)t.externalSecurity=await externalSecurityAudit(t);
    t.academy=academyGuard(t);
    t.holderBehavior=holderBehaviorAudit(t);
    t.preSignalGuard=preSignalConfirmation(t);
    t.signals=multiHorizonSignals(t);
    t.verdict=verdict(t);
  }
  const rank={'STRONG WATCH':4,'WATCH':3,'LOW SIGNAL':2,'SKIP':1};
  out.sort((a,b)=>(rank[b.verdict]-rank[a.verdict])||(b.trend.score-a.trend.score)||(b.volume5m-a.volume5m));
  const strong=out.filter(x=>x.verdict==='STRONG WATCH').length;
  const trending=out.filter(x=>x.trend.score>=50).length;
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:60,count:out.length,strong,trending,tokens:out,
    sourceStatus:{dexscreener:'live',solanaRpc:'live',kolExplorer:'live-public profiles + on-chain holdings/trades',kolX:process.env.X_BEARER_TOKEN?'live-api':'on-chain fallback; X API key not configured',bluesky:'live-public',x:process.env.X_BEARER_TOKEN?'live-api':'needs API key',youtube:process.env.YOUTUBE_API_KEY?'live-api':'needs API key',reddit:process.env.REDDIT_CLIENT_ID?'configured':'presence-only',instagram:'presence-only',facebook:'presence-only',tiktok:'presence-only',telegram:'presence-only'},
    holderPolicy:{hardRules:{holder1MustBeBelowPct:10,holders2to10EachMustBeBelowPct:5,exclusive:true},gradeA:{holder1MaxPct:5,holders2to10EachMaxPct:2.5},gradeB:{holder1MaxPct:7.5,holders2to10EachMaxPct:4},gradeC:{holder1MaxPct:10,holders2to10EachMaxPct:5},unknownFailsStrong:true},
    activityPolicy:{probableOrganicMin:72,highSecurityMin:58,method:'aggregate heuristics; not proof of human identity'},
    orderFlowPolicy:{buyerPower:'buy transaction count / total buy+sell transactions; not dollar buy volume',strongBuyer:'5m >=55% and 1h >=51% when available',volumeQuality:'absolute volume + tx count + volume/liquidity sanity check'},
    knowledgeEngine:{marketQuality:'transparency + liquidity + data coverage',chartDiscipline:'trend + FOMO + pump/dump guard',academy:'automated Solana RPC + Token-2022 extension audit + RugCheck full/summary + Jupiter sell-route quote + DexScreener sell evidence; unavailable evidence stays UNKNOWN'},
    ageBuckets:{fresh:'0-24h',day:'24h-7d',week:'7d-30d discovery horizon'},
    entryExitPolicy:{entry:'HIGH/MAX security + GOOD/STRONG volume + buyer strength + adequate liquidity + confirmed or early-confirmed Trust Guard + anti-FOMO price condition',exit:'live exit/whale sell/seller dominance/Trust Guard block; price invalidation is a risk reference, not guaranteed execution'},
    trustGuard:{strongSignalRequires:'2+ holder snapshots, 2 consecutive good scans, >=45 seconds stable confirmation, buyer strength, healthy volume, no holder-outflow risk',downgrade:'holder movement, seller dominance, whale/tracked exits or pump cooldown immediately remove strong status'},
    signalWindows:{short:'5m-1h',medium:'1h-6h',long:'6h-24h',securityGate:'HIGH/MAX requires zero manual, zero unknown and zero failed automated security checks; unknown evidence cannot receive strong approval'},
    disclaimer:'قانون هولدرها: هولدر شماره 1 باید کمتر از 10% و هرکدام از هولدرهای شماره 2 تا 10 باید کمتر از 5% داشته باشند. مجموع Top10 فقط جهت اطلاع نمایش داده می‌شود و شرط رد نیست. Organic Activity یک تخمین ضدربات/ضدواش است. هیچ فیلتر آن‌چین کلاهبرداری را 100% رد نمی‌کند.'};
  cache={at:Date.now(),data};return data;
}
async function build(){
  if(cache.data&&Date.now()-cache.at<CACHE_MS)return cache.data;
  if(buildInFlight)return buildInFlight;
  buildInFlight=buildFresh();
  try{return await buildInFlight}
  finally{buildInFlight=null}
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
    const holderFlow=new Map();
    for(const e of a.events){
      const k=e.walletAddress||e.wallet||'unknown';
      const x=holderFlow.get(k)||{wallet:e.wallet||'نامشخص',address:e.walletAddress||'',buyUsd:0,sellUsd:0,buyCount:0,sellCount:0};
      if(e.side==='BUY'){x.buyUsd+=num(e.approxUsd);x.buyCount++}
      else if(e.side==='SELL'){x.sellUsd+=num(e.approxUsd);x.sellCount++}
      holderFlow.set(k,x);
    }
    a.convictionHolders=[...holderFlow.values()].map(x=>{
      const h=holders.find(v=>v.address===x.address);
      return {...x,currentHoldingUsd:num(h?.valueUsd),netBuyUsd:x.buyUsd-x.sellUsd,sellBuyRatio:x.buyUsd>0?x.sellUsd/x.buyUsd:null};
    }).filter(x=>x.buyUsd>=1000&&x.sellUsd<x.buyUsd&&x.currentHoldingUsd>0)
      .sort((x,y)=>y.netBuyUsd-x.netBuyUsd);
    a.convictionHolderCount=a.convictionHolders.length;
    a.convictionBuyUsd=a.convictionHolders.reduce((n,x)=>n+x.buyUsd,0);
    a.convictionSellUsd=a.convictionHolders.reduce((n,x)=>n+x.sellUsd,0);
    const flowWallets=[...holderFlow.values()];
    a.largeBuyers500=flowWallets.filter(x=>x.buyUsd>=500&&x.buyUsd>x.sellUsd)
      .sort((x,y)=>(y.buyUsd-y.sellUsd)-(x.buyUsd-x.sellUsd));
    a.netSellerWallets=flowWallets.filter(x=>x.sellUsd>0&&x.sellUsd>=x.buyUsd)
      .sort((x,y)=>(y.sellUsd-y.buyUsd)-(x.sellUsd-x.buyUsd));
    a.largeBuyer500Count=a.largeBuyers500.length;
    a.netSellerWalletCount=a.netSellerWallets.length;
    a.largeBuyer500Usd=a.largeBuyers500.reduce((n,x)=>n+x.buyUsd,0);
    a.netSellerUsd=a.netSellerWallets.reduce((n,x)=>n+x.sellUsd,0);
    a.largeBuyer500Dominant=a.largeBuyer500Count>a.netSellerWalletCount;
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

function normalizeTs(v){
  const n=num(v,Date.now());
  return n>0&&n<1e12?n*1000:n;
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
    broadcastLiveState('position');
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
    ts:normalizeTs(m.execTs||m.ts||Date.now()),
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
  broadcastLiveState('market');
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
    ws.onopen=()=>{liveFomoState.connected=true;liveFomoState.lastError=null;liveFomoState.updatedAt=new Date().toISOString();broadcastLiveState('status')};
    ws.onmessage=(ev)=>{
      try{
        const m=JSON.parse(String(ev.data));
        if(m.type==='welcome'){
          liveFomoState.realtime=!!m.realtime;
          liveFomoState.delaySeconds=m.delaySeconds??null;
          liveFomoState.updatedAt=new Date().toISOString();
          broadcastLiveState('status');
          return;
        }
        pushLiveFomoEvent(m);
      }catch{}
    };
    ws.onerror=()=>{liveFomoState.lastError='stream error'};
    ws.onclose=()=>{
      liveFomoState.connected=false;
      liveFomoState.updatedAt=new Date().toISOString();
      broadcastLiveState('status');
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
  const cutoff=Date.now()-30*60*1000;
  const recentEvents=events.filter(x=>normalizeTs(x.ts)>=cutoff);
  const exits=recentEvents.filter(x=>x.alertType==='sell');
  const buys=recentEvents.filter(x=>x.alertType==='buy');
  const byToken=new Map();
  for(const e of exits){
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
.toolbar{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}.toolbar input{flex:1;min-width:220px}.toolbar select{min-width:140px}.subfilters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px;margin:8px 0 11px}.subfilters label{font-size:12px;color:var(--muted);font-weight:800}.subfilters select{width:100%;margin-top:4px;padding:8px}.social-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.social-actions a{font-size:11px;text-decoration:none;padding:5px 7px;border:1px solid var(--line);border-radius:8px;color:#b5ddff;background:#10243b}
.accordion{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:9px;overflow:hidden}
.accordion>summary{list-style:none;cursor:pointer;padding:14px 15px;font-weight:900;font-size:16px;display:flex;align-items:center;justify-content:space-between;gap:8px;user-select:none}
.accordion>summary::-webkit-details-marker{display:none}.accordion>summary:after{content:'⌄';color:var(--muted);transition:transform .15s ease}.accordion[open]>summary:after{transform:rotate(180deg)}
.accordion-body{padding:0 10px 10px}.accordion .kpis{margin:0}.accordion .toolbar{margin:0}.accordion.highlight{border-color:#34745e;background:linear-gradient(135deg,#0e241f,#0d1729)}
.panel{display:none}.panel.active{display:block}.section-title{display:flex;justify-content:space-between;gap:10px;align-items:end;margin:6px 0 9px}.section-title h2{margin:0;font-size:18px}.section-title p{margin:3px 0 0;color:var(--muted);font-size:11px}
.list{display:grid;gap:7px}.row{display:grid;grid-template-columns:minmax(175px,1.6fr) repeat(5,minmax(80px,.7fr)) auto;gap:7px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:9px}.asset{min-width:0}.asset b{font-size:14px}.asset small{display:block;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;font-size:10px}.cell small{display:block;color:var(--muted);font-size:9px}.cell b{font-size:13px}.actions{display:flex;gap:4px}.actions a,.actions button{font-size:11px;padding:6px 7px;text-decoration:none}
.badge{display:inline-flex;padding:3px 6px;border-radius:999px;font-size:10px;font-weight:700}.good{background:#123a2d;color:var(--good)}.mid{background:#3b3317;color:var(--warn)}.bad{background:#421a24;color:var(--bad)}.blue{background:#152d49;color:var(--blue)}
.empty{background:var(--panel);border:1px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--muted);font-size:12px}.bucket-best{border:1px solid #34745e;background:linear-gradient(135deg,#102b27,#101f35);border-radius:12px;padding:10px;margin-bottom:10px}.bucket-best-title{font-size:12px;color:var(--muted);font-weight:800}.bucket-best-main{display:grid;grid-template-columns:1.5fr repeat(4,.7fr) auto;gap:8px;align-items:center;margin-top:7px}.bucket-score{font-size:22px;font-weight:900;color:var(--good)}.age-chip{display:inline-flex;padding:3px 7px;border-radius:999px;background:#152d49;color:var(--blue);font-size:10px;font-weight:800;margin-top:5px}.whale-buy-chip{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:#123a2d;color:var(--good);border:1px solid #34745e;font-size:10px;font-weight:900;margin:5px 4px 0 0}.social-trend-chip{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:#172a45;color:#b9dcff;border:1px solid #31547a;font-size:10px;font-weight:900;margin:5px 4px 0 0}.social-trend-hot{background:#3a2415;color:#ffd28c;border-color:#76502b}.social-trend-viral{background:#40203d;color:#ffb8f4;border-color:#794671}.entry-chip{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:900;margin:4px 3px 0 0}.entry-ready{background:#123a2d;color:var(--good);border:1px solid #34745e}.entry-wait{background:#3b3317;color:var(--warn);border:1px solid #6d5d24}.entry-exit{background:#421a24;color:var(--bad);border:1px solid #743040}.return-pos{color:var(--good)}.return-neg{color:var(--bad)}.return-flat{color:var(--muted)}.perf-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}.perf-stat{background:#101d31;border:1px solid var(--line);border-radius:10px;padding:9px}.perf-stat small{display:block;color:var(--muted);font-size:10px}.perf-stat b{display:block;font-size:15px;margin-top:3px}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mini{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}.mini h3{font-size:15px;margin:0 0 9px;font-weight:900}.mini-row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #182b45;font-size:11px}.mini-row:first-of-type{border-top:0}.mini-row span{color:var(--muted)}.portfolio-item{padding:8px 0;border-top:1px solid #1b304b}.portfolio-item:first-child{border-top:0}.portfolio-top{display:flex;justify-content:space-between;gap:8px;font-size:12px}.portfolio-bar{height:6px;background:#15263d;border-radius:999px;overflow:hidden;margin-top:5px}.portfolio-fill{height:100%;background:#3d8f72;border-radius:999px}.portfolio-meta{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:10px;margin-top:4px}
dialog{width:min(720px,94vw);max-height:88vh;border:1px solid #36506e;border-radius:15px;background:#091426;color:var(--text);padding:0;box-shadow:0 30px 90px #0009}dialog::backdrop{background:#000a}.modal-head{position:sticky;top:0;background:#091426;border-bottom:1px solid var(--line);padding:12px 14px;display:flex;justify-content:space-between;align-items:center}.modal-body{padding:13px}.modal-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.box{background:#0f1d31;border:1px solid var(--line);border-radius:10px;padding:8px}.box small{display:block;color:var(--muted);font-size:9px}.box b{display:block;margin-top:3px;font-size:12px}.holders{margin-top:11px}.holder,.check{display:flex;justify-content:space-between;gap:7px;padding:6px 0;border-top:1px solid var(--line);font-size:11px}.holder a{color:var(--blue);text-decoration:none}.links{display:flex;flex-wrap:wrap;gap:5px;margin-top:11px}.links a{color:#b5ddff;text-decoration:none;border:1px solid #315071;background:#10243b;padding:6px 8px;border-radius:8px;font-size:11px}.note{margin-top:10px;color:var(--muted);font-size:11px;line-height:1.65}.pass{color:var(--good)}.fail{color:var(--bad)}.manual{color:var(--warn)}
@media(max-width:900px){.bucket-best-main{grid-template-columns:1fr 1fr}.bucket-best-main .asset,.bucket-best-main .actions{grid-column:1/-1}.champion-grid{grid-template-columns:1fr 1fr}.champion-grid .asset,.champion-grid .actions{grid-column:1/-1}.row{grid-template-columns:1.5fr repeat(3,.8fr) auto}.hide-md{display:none}.three{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){.perf-summary{grid-template-columns:1fr 1fr}.whale-summary{grid-template-columns:1fr}.subfilters{grid-template-columns:1fr 1fr}.head{padding:9px 10px}.shell{padding:10px}.brand small,.status{display:none}.row{grid-template-columns:1fr 1fr}.asset,.actions{grid-column:1/-1}.hide-sm{display:none}.modal-grid{grid-template-columns:repeat(2,1fr)}}
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
<details class="accordion highlight" open>
  <summary>🐋 پیشنهادهای نهنگ‌ها و همه خریدهای زنده</summary>
  <div class="accordion-body">
    <p class="muted" style="font-size:11px">خریدهای نهنگ از جریان زنده API جمع می‌شوند و فقط رویدادهای تازه در پنجره ۳۰ دقیقه‌ای لحاظ می‌شوند. «اولویت بررسی» تضمین رشد یا سود نیست.</p>
    <div id="whaleTopSummary"></div>
    <div class="list" id="whaleTopList"></div>
  </div>
</details>
  <details class="accordion highlight" open>
    <summary>📈 بازده واقعی ۲۴ساعته سیگنال‌های رادار</summary>
    <div class="accordion-body">
      <p class="muted" style="font-size:11px">بازدهی بازار در ۲۴ ساعت اخیر برای توکن‌های امن و امتیازبالای فعلی رادار. برای توکن جوان‌تر از ۲۴ ساعت، تغییر از زمان ساخت تا اکنون نمایش داده می‌شود.</p>
      <div id="performance24Summary"></div>
      <div class="list" id="performance24List"></div>
    </div>
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
    <div class="accordion-body"><p class="muted" style="font-size:11px">فقط توکن‌های بدون هشدار خروج/رد امنیتی که نقطه ورود فعال دارند. ورود قوی و ورود قابل‌بررسی جدا نمایش داده می‌شوند؛ هیچ‌کدام تضمین سود نیست.</p><div class="subfilters">
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
  <details class="accordion highlight" open>
    <summary>👑 ترند KOL — فقط بالاترین امنیت</summary>
    <div class="accordion-body"><p class="muted" id="kolTrendStatus" style="font-size:11px">توکن‌هایی که همین KOLهای منتخب در پوزیشن/معامله اخیر داشته‌اند یا مستقیماً در X اشاره کرده‌اند؛ فقط امنیت HIGH/MAX نمایش داده می‌شود.</p><div class="list" id="kolTrendList"></div></div>
  </details>
  <details class="accordion">
    <summary>🎛 فیلتر مشترک سه گروه</summary>
    <div class="accordion-body"><div class="subfilters">
<label>کوتاه‌مدت<select class="signal-filter" data-filter="short"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>میان‌مدت<select class="signal-filter" data-filter="medium"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>بلندمدت<select class="signal-filter" data-filter="long"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>امنیت<select class="signal-filter" data-filter="security"><option value="">همه</option><option value="MAX SECURITY">خیلی بالا</option><option value="HIGH">بالا</option><option value="REVIEW">نیاز به بررسی</option><option value="REJECT">رد</option></select></label>
<label>هولدر ردیابی‌شده ۱۰۰۰$+<select class="signal-filter" data-filter="holders"><option value="">همه</option><option value="1">حداقل ۱ هولدر</option><option value="2">حداقل ۲ هولدر</option><option value="3">حداقل ۳ هولدر</option></select></label>
<label>خریدار ۵۰۰$+ بیشتر از فروشنده<select class="signal-filter" data-filter="bigbuyers"><option value="">همه</option><option value="yes">فقط خریدار غالب</option></select></label>
</div><p class="muted" style="font-size:11px">قانون اجباری هولدر برای همه توکن‌ها: هولدر #1 کمتر از 10% و هرکدام از هولدرهای #2 تا #10 کمتر از 5%. رتبه هر گروه با مدل امتیاز مخصوص همان سن محاسبه می‌شود. فیلترها فقط کیف‌پول‌های تحت ردیابی و تراکنش‌های قابل‌تشخیص ۴۸ ساعت اخیر را بررسی می‌کنند. هولدر ۱۰۰۰$+: خرید حداقل ۱۰۰۰ دلار، فروش کمتر از خرید و موجودی فعلی مثبت. خریدار ۵۰۰$+: خرید تجمعی حداقل ۵۰۰ دلار و خرید بیشتر از فروش همان کیف‌پول؛ تعدادشان باید از کیف‌پول‌های فروشنده خالص بیشتر باشد.</p></div>
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
var tokens=[],smart=null,live=null,tracked=null,conviction=null,activeTab='featured',signalFilters={short:'',medium:'',long:'',security:'',holders:'',bigbuyers:''};
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
function return24Value(t){var n=Number(t&&t.priceChange24h);return Number.isFinite(n)?n:null}
function return24Text(t){var n=return24Value(t);return n==null?'—':(n>0?'+':'')+n.toFixed(1)+'%'}
function return24Class(t){var n=return24Value(t);return n==null?'return-flat':n>0?'return-pos':n<0?'return-neg':'return-flat'}
function return24Period(t){return Number(t&&t.ageMinutes||0)<1440?'از ساخت / ≤24h':'بازده 24h'}

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
  if(t.securityGate?.blocked||sec.tier==='REJECT'||trustGuard(t).status==='BLOCK')return Math.min(39,Math.round((sh+md+lg)/12));
  var security=sec.tier==='MAX SECURITY'?100:sec.tier==='HIGH'?86:sec.tier==='REVIEW'?55:20;
  var buyer=Number(fl.buyerPower||50),volume=Number(fl.volumeScore||0),social=Number(t.socialHeat?.score||0),market=Number(mq.score||0);
  var score=0;
  if(bucket==='fresh')score=security*.18+sh*.22+md*.12+lg*.05+buyer*.13+volume*.12+social*.13+market*.05;
  else if(bucket==='day')score=security*.22+sh*.10+md*.18+lg*.15+buyer*.12+volume*.12+social*.06+market*.05;
  else score=security*.28+sh*.05+md*.13+lg*.22+buyer*.10+volume*.08+social*.04+market*.10;
  var wh=whaleFor(t.mint),tr=findTracked(t.mint),sm=smartFor(t.mint);
  if(wh.count)score+=3;if(t.kolTrend?.kolCount>=2)score+=Math.min(7,t.kolTrend.kolCount*2);else if(t.kolTrend?.kolCount===1)score+=2;if(t.kolTrend?.xMentionCount>0)score+=Math.min(5,t.kolTrend.xMentionCount*2);if(tr&&Number(tr.uniqueBuyers||0)>=2&&Number(tr.netFlowUsd||0)>0)score+=3;if(tr&&Number(tr.convictionHolderCount||0)>=1)score+=Math.min(5,Number(tr.convictionHolderCount||0)*2);if(tr?.largeBuyer500Dominant)score+=5;else if(Number(tr?.netSellerWalletCount||0)>Number(tr?.largeBuyer500Count||0))score-=4;if(sm)score+=2;
  if(exitFor(t.mint).length)score-=18;
  if(fl.sellerDominant)score-=8;
  if(fl.volumeLabel==='SUSPICIOUS')score-=12;
  score=Math.max(0,Math.min(100,Math.round(score)));if(trustGuard(t).status==='WAIT'||t.flow?.volumeLabel!=='STRONG'||tradePlan(t).status!=='ENTRY')score=Math.min(score,74);return score;
}
function bucketSignalLabel(score,t){
  if(t&&trustGuard(t).status==='BLOCK')return 'ریسک خروج / ورود نکن';
  if(t&&tradePlan(t).status==='EXIT')return 'خروج / ورود نکن';
  if(t&&tradePlan(t).status!=='ENTRY'&&score>=65)return 'در انتظار تأیید';
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

function qualifyingTrackedHolders(t){
  var tr=t?findTracked(t.mint):null;
  return tr&&Array.isArray(tr.convictionHolders)?tr.convictionHolders:[];
}
function kolTrendSafe(t){
  if(!t||!t.kolTrend)return false;
  var sec=t.security||{},ac=t.academy||{},gate=t.securityGate||{};
  return tradePlan(t).status==='ENTRY'&&t.flow?.volumeLabel==='STRONG'&&trustGuard(t).status==='CONFIRMED'&&!gate.blocked&&!ac.blocked&&Number(ac.manual||0)===0&&Number(ac.unknown||0)===0&&Number(ac.fail||0)===0&&sec.holderPolicyPassed===true&&(sec.tier==='MAX SECURITY'||sec.tier==='HIGH');
}
function kolTrendScore(t){
  if(!t||!t.kolTrend)return 0;
  var k=t.kolTrend||{},base=Number(k.score||0);
  return Math.min(100,Math.round(base*.45+bucketScore(t,ageBucket(t))*.55));
}
function largeBuyerFlow(t){
  var tr=t?findTracked(t.mint):null;
  return {
    buyers:Number(tr?.largeBuyer500Count||0),
    sellers:Number(tr?.netSellerWalletCount||0),
    buyerUsd:Number(tr?.largeBuyer500Usd||0),
    sellerUsd:Number(tr?.netSellerUsd||0),
    dominant:tr?.largeBuyer500Dominant===true
  };
}
function passesSignalFilters(t){
  var any=signalFilters.short||signalFilters.medium||signalFilters.long||signalFilters.security||signalFilters.holders||signalFilters.bigbuyers;
  if(!t)return !any;
  var sg=t.signals||{},sec=t.security||{},bf=largeBuyerFlow(t);
  if(signalFilters.short&&sg.short?.label!==signalFilters.short)return false;
  if(signalFilters.medium&&sg.medium?.label!==signalFilters.medium)return false;
  if(signalFilters.long&&sg.long?.label!==signalFilters.long)return false;
  if(signalFilters.security&&sec.tier!==signalFilters.security)return false;
  if(signalFilters.holders&&qualifyingTrackedHolders(t).length<Number(signalFilters.holders))return false;
  if(signalFilters.bigbuyers==='yes'&&!bf.dominant)return false;
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
function whaleSellsFor(m){var r=live&&live.whaleSells?live.whaleSells.filter(function(x){return x.tokenAddress===m}):[];return {count:r.length,usd:r.reduce(function(a,x){return a+Number(x.tradeUsd||0)},0)}}
function trustGuard(t){
  if(!t)return {status:'BLOCK',reasons:['توکن نامشخص']};
  var pre=t.preSignalGuard||{},tr=findTracked(t.mint),ws=whaleSellsFor(t.mint),ex=exitFor(t.mint),reasons=[];
  if(pre.status==='BLOCK')reasons=reasons.concat(pre.blocks||[]);
  if(ex.length)reasons.push('هشدار خروج زنده');
  if(ws.count)reasons.push('فروش نهنگ ثبت شده');
  if(tr&&Number(tr.uniqueSellers||0)>=2)reasons.push('چند کیف‌پول برتر در حال فروش');
  if(tr&&Number(tr.netFlowUsd||0)<-500)reasons.push('جریان خالص کیف‌پول‌های برتر منفی');
  if(reasons.length)return {status:'BLOCK',reasons:reasons.slice(0,6)};
  if(pre.status!=='CONFIRMED')return {status:'WAIT',reasons:(pre.reasons||['در انتظار تأیید چند اسکن']).slice(0,6)};
  return {status:'CONFIRMED',reasons:['پایداری هولدر و جریان خرید چند اسکن متوالی تأیید شده']};
}
function trustLabel(t){var g=trustGuard(t);return g.status==='CONFIRMED'?'✓ تأیید چندمرحله‌ای':g.status==='BLOCK'?'✕ ریسک خروج':'⏳ در انتظار تأیید'}
function trustClass(t){var g=trustGuard(t);return g.status==='CONFIRMED'?'good':g.status==='BLOCK'?'bad':'mid'}

function fmtPrice(v){
  var n=Number(v||0);
  if(!n)return '—';
  if(n>=1)return 'USD '+n.toFixed(4);
  if(n>=0.01)return 'USD '+n.toFixed(6);
  if(n>=0.0001)return 'USD '+n.toFixed(8);
  return 'USD '+n.toPrecision(5);
}
function tradePlan(t){
  if(!t)return {status:'WAIT',entry:null,entryLow:null,entryHigh:null,exit:null,reason:'داده کافی نیست'};
  var sec=t.security||{},fl=t.flow||{},tg=trustGuard(t),pre=t.preSignalGuard||{};
  var ws=whaleSellsFor(t.mint),ex=exitFor(t.mint),wh=whaleFor(t.mint);
  var p=Number(t.priceUsd||0),pc5=Number(t.priceChange5m||0),pc1=Number(t.priceChange1h||0);
  var riskPct=(sec.tier==='MAX SECURITY'&&Number(t.liquidity||0)>=25000)?0.055:0.07;
  var invalidation=p>0?p*(1-riskPct):null;
  var entryLow=p>0?p*0.985:null,entryHigh=p>0?p*1.012:null;

  // Never create an entry when there is an actual safety/exit condition.
  var hardExit=tg.status==='BLOCK'||fl.sellerDominant===true||ws.count>0||ex.length>0||pc5<=-8||
    t.securityGate?.blocked===true||t.academy?.blocked===true;
  if(hardExit)return {status:'EXIT',entry:null,entryLow:null,entryHigh:null,exit:invalidation,reason:'فشار فروش/هشدار خروج یا رد امنیتی فعال است',riskPct:riskPct*100};

  var safe=(sec.tier==='MAX SECURITY'||sec.tier==='HIGH')&&t.securityGate?.blocked!==true;
  var volumeStrong=fl.volumeLabel==='STRONG'&&Number(fl.volumeScore||0)>=75;
  var volumeGood=(fl.volumeLabel==='STRONG'||fl.volumeLabel==='GOOD')&&Number(fl.volumeScore||0)>=60;
  var buyerPower=Number(fl.buyerPower||0);
  var buyerOk=fl.buyerDominant===true||buyerPower>=54;
  var marketOk=Number(t.marketQuality?.score||0)>=60&&Number(t.liquidity||0)>=5000;
  var notChasing=pc5>=-3&&pc5<=12&&pc1<=45;
  var fullyConfirmed=tg.status==='CONFIRMED';
  var earlyConfirmed=tg.status==='WAIT'&&
    (!Array.isArray(pre.blocks)||pre.blocks.length===0)&&
    Number(pre.goodScans||0)>=1&&
    Number(pre.holderSnapshots||0)>=2&&
    sec.holderPolicyPassed===true;

  // Full entry: strongest path.
  var ready=!!p&&safe&&volumeGood&&buyerOk&&marketOk&&notChasing&&(fullyConfirmed||earlyConfirmed);
  if(ready){
    var confidence=fullyConfirmed&&volumeStrong?'HIGH':'MEDIUM';
    return {
      status:'ENTRY',confidence,
      entry:p,entryLow,entryHigh,exit:invalidation,
      reason:confidence==='HIGH'
        ?'امنیت HIGH/MAX + حجم قوی + خریدار غالب + تأیید چندمرحله‌ای'
        :'امنیت HIGH/MAX + حجم مناسب + خریدار غالب + تأیید اولیه بدون هشدار خروج',
      riskPct:riskPct*100
    };
  }

  var reasons=[];
  if(!p)reasons.push('قیمت معتبر دریافت نشده');
  if(!safe)reasons.push('امنیت HIGH/MAX نیست');
  if(!volumeGood)reasons.push('حجم حداقل GOOD نیست');
  if(!buyerOk)reasons.push('قدرت خریدار کمتر از حد ورود است');
  if(!marketOk)reasons.push('نقدینگی/کیفیت بازار کافی نیست');
  if(!notChasing)reasons.push('قیمت برای ورود کشیده است');
  if(!(fullyConfirmed||earlyConfirmed))reasons.push('تأیید جریان/هولدر هنوز کافی نیست');
  return {status:'WAIT',entry:null,entryLow:null,entryHigh:null,exit:invalidation,reason:reasons.slice(0,4).join(' • ')||'در انتظار تأیید',riskPct:riskPct*100};
}
function tradePlanChips(t){
  var p=tradePlan(t);
  if(p.status==='ENTRY'){
    var zone=(p.entryLow&&p.entryHigh)?fmtPrice(p.entryLow)+' تا '+fmtPrice(p.entryHigh):fmtPrice(p.entry);
    var label=p.confidence==='HIGH'?'🟢 نقطه ورود قوی':'🟡 نقطه ورود قابل‌بررسی';
    return '<span class="entry-chip entry-ready">'+label+' · '+zone+'</span><span class="entry-chip entry-exit">🛑 خروج/ابطال · '+fmtPrice(p.exit)+'</span>';
  }
  if(p.status==='EXIT')return '<span class="entry-chip entry-exit">🔴 خروج / ورود نکن'+(p.exit?' · '+fmtPrice(p.exit):'')+'</span>';
  return '<span class="entry-chip entry-wait">⏳ '+esc(p.reason||'در انتظار تأیید')+'</span>'+(p.exit?'<span class="entry-chip entry-exit">حد ابطال مرجع · '+fmtPrice(p.exit)+'</span>':'');
}


function isTrendingToken(t){
  if(!t)return false;
  return Number(t.trend?.score||0)>=60||Number(t.socialHeat?.score||0)>=55||Number(t.kolTrend?.score||0)>=55;
}
function whaleTrendBadge(t){
  if(!isTrendingToken(t))return '';
  var w=whaleFor(t.mint);
  if(!w.count)return '';
  return '<span class="whale-buy-chip">🐋 نهنگ‌ها در حال خرید · '+w.count+' خرید · '+money(w.usd)+'</span>';
}

function socialTrendBadges(t){
  if(!t)return '';
  var h=t.socialHeat||{},x=t.xSocial||{},y=t.youtubeSocial||{},b=t.bluesky||{},k=t.kolTrend||{},rows=[];
  if(Number(x.posts2h||0)>=3)rows.push('<span class="social-trend-chip '+(Number(x.posts2h)>=8?'social-trend-viral':'social-trend-hot')+'">𝕏 ترند · '+Number(x.posts2h)+' پست/2h</span>');
  if(Number(y.videos24h||0)>=2)rows.push('<span class="social-trend-chip '+(Number(y.videos24h)>=5?'social-trend-viral':'social-trend-hot')+'">▶ YouTube ترند · '+Number(y.videos24h)+' ویدیو/24h</span>');
  if(Number(b.mentions2h||0)>=2)rows.push('<span class="social-trend-chip '+(Number(b.mentions2h)>=6?'social-trend-viral':'social-trend-hot')+'">🦋 Bluesky ترند · '+Number(b.mentions2h)+' mention/2h</span>');
  if(Number(k.xMentionCount||0)>=1)rows.push('<span class="social-trend-chip social-trend-viral">👑 X توسط KOL · '+Number(k.xMentionCount)+' اشاره</span>');
  if(!rows.length&&Number(h.score||0)>=75)rows.push('<span class="social-trend-chip social-trend-viral">📣 وایرال چندشبکه‌ای · '+Number(h.score)+'/100</span>');
  else if(!rows.length&&Number(h.score||0)>=55)rows.push('<span class="social-trend-chip social-trend-hot">📣 ترند چندشبکه‌ای · '+Number(h.score)+'/100</span>');
  return rows.join('');
}

function exitFor(m){var cut=Date.now()-30*60*1000;return live&&live.exits?live.exits.filter(function(x){var ts=Number(x.ts||0);if(ts>0&&ts<1e12)ts*=1000;return x.tokenAddress===m&&ts>=cut}):[]}
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
    if(t.kolTrend&&t.kolTrend.kolCount>=2){s+=10;w.push(t.kolTrend.kolCount+' KOL همزمان')}else if(t.kolTrend&&t.kolTrend.kolCount===1){s+=4;w.push('KOL ردیابی‌شده')}
    if(t.kolTrend&&t.kolTrend.xMentionCount>0){s+=Math.min(6,t.kolTrend.xMentionCount*2);w.push('اشاره X توسط KOL')}
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
  }).filter(function(x){
    var tp=tradePlan(x.token);
    return x.score>=78&&tp.status==='ENTRY'&&
      (!x.token.chart||x.token.chart.pumpDumpRisk!=='HIGH')&&
      (!x.token.academy||!x.token.academy.blocked)&&
      !exitFor(x.token.mint).length;
  }).sort(function(a,b){
    var ac=tradePlan(a.token).confidence==='HIGH'?1:0,bc=tradePlan(b.token).confidence==='HIGH'?1:0;
    return (bc-ac)||(b.score-a.score);
  }).slice(0,8);
}

function tokenRow(t,bucket){
  var s=t.security||{},sg=t.signals||{},sh=sg.short||{},md=sg.medium||{},lg=sg.long||{},fl=t.flow||{},bs=bucketScore(t,bucket||ageBucket(t));
  return '<div class="row">'+
  '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><span class="age-chip">'+esc(ageText(t))+'</span>'+(t.kolTrend?'<span class="age-chip">👑 '+Number(t.kolTrend.kolCount||0)+' KOL</span>':'')+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(short(t.mint))+'</small>'+socialButtons(t)+'</div>'+
  '<div class="cell"><small>امتیاز گروه</small><b><span class="badge '+bucketSignalClass(bs,t)+'">'+bs+'/100</span></b></div>'+
  '<div class="cell"><small>کوتاه / میان / بلند</small><b>'+Number(sh.score||0)+' / '+Number(md.score||0)+' / '+Number(lg.score||0)+'</b></div>'+
  '<div class="cell"><small>قدرت خریدار</small><b><span class="badge '+pressureClass(t)+'">'+(fl.buyerPower==null?'—':Number(fl.buyerPower)+'%')+'</span></b></div>'+
  '<div class="cell hide-sm"><small>امنیت</small><b><span class="badge '+secClass(s.tier)+'">'+esc(faSec(s.tier))+'</span></b></div>'+
  '<div class="cell hide-md"><small>خریدار $500+ / فروشنده</small><b><span class="badge '+(largeBuyerFlow(t).dominant?'good':'mid')+'">'+largeBuyerFlow(t).buyers+' / '+largeBuyerFlow(t).sellers+'</span></b></div>'+
  '<div class="cell"><small>Trust Guard</small><b><span class="badge '+trustClass(t)+'">'+esc(trustLabel(t))+'</span></b></div><div class="cell"><small>'+esc(return24Period(t))+'</small><b class="'+return24Class(t)+'">'+esc(return24Text(t))+'</b></div>'+
  '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
}

function beginnerDecision(t,overallScore){
  if(!t)return {label:'صبر کن',cls:'decision-wait',reason:'فعلاً سیگنال کامل و امنی وجود ندارد'};
  var sec=t.security||{},gate=t.securityGate||{},sg=t.signals||{},wh=whaleFor(t.mint);
  if(gate.blocked||sec.tier==='REJECT'||trustGuard(t).status==='BLOCK'||exitFor(t.mint).length)return {label:'ورود نکن',cls:'decision-stop',reason:'ریسک امنیتی، فشار فروش یا هشدار خروج فعال است'};
  if(trustGuard(t).status!=='CONFIRMED')return {label:'صبر کن',cls:'decision-wait',reason:'Trust Guard هنوز پایداری هولدرها و جریان خرید را در چند اسکن تأیید نکرده'};
  var strongWindows=[sg.short,sg.medium,sg.long].filter(function(x){return Number(x?.score||0)>=75&&x?.label!=='BLOCKED'&&x?.label!=='AVOID'}).length;
  var flow=t.flow||{};
  var autoSecure=t.academy&&Number(t.academy.manual||0)===0&&Number(t.academy.unknown||0)===0&&Number(t.academy.fail||0)===0;
  var safe=(sec.tier==='MAX SECURITY'||sec.tier==='HIGH')&&autoSecure&&Number(t.liquidity||0)>=10000&&t.activity?.label!=='BOT RISK';
  var flowOk=flow.volumeLabel==='STRONG'&&Number(flow.volumeScore||0)>=80&&flow.buyerDominant===true;
  var bf=largeBuyerFlow(t),trackedOk=(bf.buyers+bf.sellers===0)||bf.dominant;
  if(safe&&flowOk&&trackedOk&&strongWindows>=2&&Number(overallScore||0)>=78)return {label:'شرایط ورود قوی',cls:'decision-buy',reason:'امنیت بالا + حجم خوب + قدرت خریدار غالب + خریدارهای ۵۰۰$+ بیشتر از فروشنده‌ها (اگر داده ردیابی موجود باشد) + حداقل دو بازه زمانی قوی'};
  return {label:'صبر کن',cls:'decision-wait',reason:'برای مبتدی بهتر است تا تکمیل تأییدها صبر شود'};
}
function overallCandidates(){
  return tokens.map(function(t){
    var gate=t.securityGate||{},sec=t.security||{},sg=t.signals||{},sh=sg.short||{},md=sg.medium||{},lg=sg.long||{};
    if(gate.blocked||sec.tier==='REJECT'||t.flow?.volumeLabel!=='STRONG'||trustGuard(t).status!=='CONFIRMED'||tradePlan(t).status!=='ENTRY'||exitFor(t.mint).length)return null;
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
    '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>بدون هشدار خروج · امنیت '+esc(faSec(t.security?.tier))+'</small>'+socialButtons(t)+'</div>'+
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
    return '<div class="row"><div class="asset"><b>🔥 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(x.why.slice(0,3).join(' • '))+'</small>'+socialButtons(t)+'</div>'+
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
  var r=live&&live.whaleBuys?live.whaleBuys:[];
  r=r.slice().sort(function(a,b){return Number(b.tradeUsd||0)-Number(a.tradeUsd||0)});

  var summaryHtml=(function(){
    var top=agg[0]||null;
    return '<div class="whale-summary">'+
      '<div class="whale-stat"><small>کل حجم خرید نهنگ‌ها · ۳۰ دقیقه</small><b>'+money(total)+'</b></div>'+
      '<div class="whale-stat"><small>بیشترین خرید روی</small><b>'+(top?esc(top.token||short(top.tokenAddress)):'—')+'</b></div>'+
      '<div class="whale-stat"><small>تعداد خریدهای نهنگ</small><b>'+r.length+'</b></div>'+
    '</div>';
  })();

  var rankedHtml=agg.length?'<div class="list">'+agg.slice(0,12).map(function(a,i){
    var t=findToken(a.tokenAddress),sec=t&&t.security?t.security:{},tp=t?tradePlan(t):null;
    var strength=t?Math.round(tokenStrength(t)):0;
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🐋 '+esc(a.token||t&&t.symbol||'?')+'</b>'+whaleTrendBadge(t)+socialTrendBadges(t)+(t?tradePlanChips(t):'')+
      '<small>'+Number(a.uniqueTraders||0)+' نهنگ · '+Number(a.buyCount||0)+' خرید · منبع: Live whale API</small>'+socialButtons(t)+'</div>'+
      '<div class="cell"><small>کل خرید</small><b>'+money(a.totalBuyUsd)+'</b></div>'+
      '<div class="cell"><small>نهنگ یکتا</small><b>'+Number(a.uniqueTraders||0)+'</b></div>'+
      '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
      '<div class="cell hide-sm"><small>قدرت رادار</small><b>'+strength+'/100</b></div>'+
      '<div class="cell hide-md"><small>وضعیت</small><b>'+(tp?esc(tp.label||'بررسی'):'بررسی')+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(a.tokenAddress,t&&t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(a.tokenAddress)+'">جزئیات</button></div></div>';
  }).join('')+'</div>':'<div class="empty">فعلاً خرید نهنگ تازه‌ای در پنجره ۳۰ دقیقه‌ای ثبت نشده.</div>';

  var topSummary=document.getElementById('whaleTopSummary');
  var topList=document.getElementById('whaleTopList');
  if(topSummary)topSummary.innerHTML=summaryHtml;
  if(topList)topList.innerHTML=rankedHtml;

  var sum=document.getElementById('whaleSummary');
  if(sum)sum.innerHTML=summaryHtml+rankedHtml;

  document.getElementById('kWhales').textContent=r.length;
  var filtered=r.filter(function(e){return passesSignalFilters(findToken(e.tokenAddress))});
  document.getElementById('whaleList').innerHTML=filtered.length?filtered.map(function(e){
    var t=findToken(e.tokenAddress),sec=t&&t.security?t.security:{};
    return '<div class="row"><div class="asset"><b>🐋 '+esc(e.token||t&&t.symbol||'?')+'</b><small>'+esc(short(e.tokenAddress))+' · '+esc(e.trader||'نامشخص')+' · Live whale API</small>'+socialButtons(t)+'</div>'+
    '<div class="cell"><small>خرید</small><b>'+money(e.tradeUsd)+'</b></div><div class="cell"><small>پوزیشن</small><b>'+money(e.positionValueUsd)+'</b></div>'+
    '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
    '<div class="cell hide-sm"><small>زمان</small><b>'+new Date(Number(e.ts||Date.now())).toLocaleTimeString('fa-IR')+'</b></div>'+
    '<div class="cell hide-md"><small>خروج</small><b>'+exitFor(e.tokenAddress).length+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(e.tokenAddress,t&&t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(e.tokenAddress)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">با فیلتر فعلی خرید نهنگ تازه‌ای نمایش داده نمی‌شود.</div>';
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
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' 📣 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc((h.reasons||[]).slice(0,3).join(' • '))+'</small>'+socialButtons(t)+'</div>'+
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
    '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><span class="age-chip">'+esc(ageText(t))+'</span>'+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(bucketSignalLabel(bs,t))+'</small>'+socialButtons(t)+'</div>'+
    '<div><small class="muted">امتیاز نهایی</small><div class="bucket-score">'+bs+'/100</div></div>'+
    '<div class="cell"><small>قدرت خریدار</small><b>'+Number(fl.buyerPower||0)+'%</b></div>'+
    '<div class="cell"><small>حجم</small><b>'+esc(faVolume(fl.volumeLabel))+'</b></div>'+
    '<div class="cell"><small>امنیت</small><b>'+esc(faSec(t.security?.tier))+'</b></div><div class="cell"><small>Trust Guard</small><b><span class="badge '+trustClass(t)+'">'+esc(trustLabel(t))+'</span></b></div><div class="cell"><small>هولدر $1k+</small><b>'+qualifyingTrackedHolders(t).length+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div>'+
  '</div></div>';
}
function renderPerformance24(){
  var list=document.getElementById('performance24List'),sum=document.getElementById('performance24Summary');
  if(!list||!sum)return;
  var r=tokens.map(function(t){
    var sec=t.security||{},ac=t.academy||{},gate=t.securityGate||{};
    var safe=tradePlan(t).status==='ENTRY'&&trustGuard(t).status==='CONFIRMED'&&!gate.blocked&&!ac.blocked&&Number(ac.fail||0)===0&&sec.holderPolicyPassed===true&&(sec.tier==='MAX SECURITY'||sec.tier==='HIGH');
    return {t:t,score:bucketScore(t,ageBucket(t)),ret:return24Value(t),safe:safe};
  }).sort(function(a,b){
    if(a.safe!==b.safe)return a.safe?-1:1;
    return b.score-a.score;
  }).slice(0,20);
  var safeRows=r.filter(function(x){return x.safe}),valid=safeRows.filter(function(x){return x.ret!=null}),wins=valid.filter(function(x){return x.ret>0});
  var avg=valid.length?valid.reduce(function(a,x){return a+x.ret},0)/valid.length:null;
  var best=valid.slice().sort(function(a,b){return b.ret-a.ret})[0]||null;
  sum.innerHTML='<div class="perf-summary">'+
    '<div class="perf-stat"><small>سیگنال امن کامل</small><b>'+safeRows.length+'</b></div>'+
    '<div class="perf-stat"><small>مثبت در 24h</small><b class="return-pos">'+wins.length+'</b></div>'+
    '<div class="perf-stat"><small>میانگین بازده امن‌ها</small><b class="'+(avg==null?'return-flat':avg>=0?'return-pos':'return-neg')+'">'+(avg==null?'—':(avg>0?'+':'')+avg.toFixed(1)+'%')+'</b></div>'+
    '<div class="perf-stat"><small>بهترین بازده امن</small><b class="return-pos">'+(best?esc(best.t.symbol)+' '+esc(return24Text(best.t)):'—')+'</b></div>'+
  '</div>'+
  (safeRows.length?'':'<div class="note">فعلاً هیچ توکنی همه شروط سخت‌گیرانه امنیتی HIGH/MAX را کامل پاس نکرده؛ پایین‌تر بهترین توکن‌های فعلی برای بررسی نمایش داده می‌شوند، نه به‌عنوان سیگنال قطعی.</div>');
  list.innerHTML=r.length?r.map(function(x,i){
    var t=x.t,sec=t.security||{},sg=t.signals||{};
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' '+(x.safe?'🏅':'🔎')+' '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(ageText(t))+' · '+(x.safe?'امن کامل':'نیازمند بررسی امنیت')+'</small>'+socialButtons(t)+'</div>'+
      '<div class="cell"><small>امتیاز رادار</small><b><span class="badge '+bucketSignalClass(x.score,t)+'">'+x.score+'/100</span></b></div>'+
      '<div class="cell"><small>'+esc(return24Period(t))+'</small><b class="'+return24Class(t)+'">'+esc(return24Text(t))+'</b></div>'+
      '<div class="cell"><small>کوتاه / میان / بلند</small><b>'+Number(sg.short?.score||0)+' / '+Number(sg.medium?.score||0)+' / '+Number(sg.long?.score||0)+'</b></div>'+
      '<div class="cell hide-sm"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
      '<div class="cell hide-md"><small>خریدار</small><b>'+Number(t.flow?.buyerPower||0)+'%</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">هنوز داده توکنی دریافت نشده.</div>';
}
function renderKolTrends(){
  var el=document.getElementById('kolTrendList');if(!el)return;
  var r=tokens.filter(kolTrendSafe).sort(function(a,b){return kolTrendScore(b)-kolTrendScore(a)}).slice(0,15);
  var st=document.getElementById('kolTrendStatus');
  if(st){
    var xConfigured=tokens.some(function(t){return t.kolTrend&&Number(t.kolTrend.xMentionCount||0)>0});
    st.textContent='فقط HIGH/MAX + قانون هولدر + چک‌لیست امنیتی. '+(xConfigured?'اشاره‌های X هم در امتیاز دیده شده‌اند.':'فعلاً منبع اصلی خرید/هولد آن‌چین KOLهاست؛ X فقط وقتی API فعال باشد شمارش می‌شود.');
  }
  el.innerHTML=r.length?r.map(function(t,i){
    var k=t.kolTrend||{},score=kolTrendScore(t),names=(k.kolNames||[]).slice(0,5).join('، ');
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' 👑 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(names||'KOL')+' · '+Number(k.recentCount||0)+' معامله اخیر · '+Number(k.holdingCount||0)+' هولد · '+Number(k.xMentionCount||0)+' اشاره X</small>'+socialButtons(t)+'</div>'+
      '<div class="cell"><small>امتیاز KOL+امنیت</small><b><span class="badge good">'+score+'/100</span></b></div>'+
      '<div class="cell"><small>KOLها</small><b>'+Number(k.kolCount||0)+'</b></div>'+
      '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(t.security?.tier)+'">'+esc(faSec(t.security?.tier))+'</span></b></div>'+
      '<div class="cell hide-sm"><small>قدرت خریدار</small><b>'+Number(t.flow?.buyerPower||0)+'%</b></div>'+
      '<div class="cell hide-md"><small>حجم</small><b>'+esc(faVolume(t.flow?.volumeLabel))+'</b></div>'+
      '<div class="cell"><small>'+esc(return24Period(t))+'</small><b class="'+return24Class(t)+'">'+esc(return24Text(t))+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً توکن KOL که همزمان امنیت HIGH/MAX را پاس کند پیدا نشده.</div>';
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
function renderAll(){document.getElementById('kTokens').textContent=tokens.length;renderChampion();renderAlerts();renderFeatured();renderWhales();renderSmart();renderSocialTrends();renderWallets();renderConviction();renderPerformance24();renderKolTrends();renderTokens()}
function stateLabel(v){return v==='pass'?'<span class="pass">✓ تأیید خودکار</span>':v==='fail'?'<span class="fail">✕ رد خودکار</span>':v==='warn'?'<span class="manual">△ هشدار خودکار</span>':'<span class="manual">? تأیید نشده — داده ناکافی</span>'}
function openDetail(m){
  var t=findToken(m),tr=findTracked(m),sm=smartFor(m),wh=whaleFor(m),name=t?(t.symbol+' · '+t.name):(tr?(tr.symbol+' · '+tr.name):short(m)),h='';
  document.getElementById('detailTitle').textContent=name;
  if(t){
    var s=t.security||{},a=t.activity||{},mq=t.marketQuality||{},ch=t.chart||{},ac=t.academy||{};
    h+='<div class="modal-grid"><div class="box"><small>امنیت</small><b>'+esc(faSec(s.tier))+' · '+Number(s.score||0)+'/100</b></div><div class="box"><small>فعالیت</small><b>'+esc(faAct(a.label))+' · '+Number(a.score||0)+'/100</b></div><div class="box"><small>ترند</small><b>'+Number(t.trend&&t.trend.score||0)+'/100</b></div><div class="box"><small>Market Cap</small><b>'+money(t.marketCap)+'</b></div><div class="box"><small>Liquidity</small><b>'+money(t.liquidity)+'</b></div><div class="box"><small>Vol 5m</small><b>'+money(t.volume5m)+'</b></div><div class="box"><small>'+esc(return24Period(t))+'</small><b class="'+return24Class(t)+'">'+esc(return24Text(t))+'</b></div><div class="box"><small>هولدر #1</small><b>'+pct(s.largestHolder)+'</b></div><div class="box"><small>بیشترین 2-10</small><b>'+pct(s.maxOtherHolder)+'</b></div><div class="box"><small>Top10</small><b>'+pct(s.top10)+'</b></div><div class="box"><small>کیفیت بازار</small><b>'+Number(mq.score||0)+'/100</b></div><div class="box"><small>FOMO</small><b>'+esc(ch.fomoRisk||'—')+'</b></div><div class="box"><small>Pump/Dump</small><b>'+esc(ch.pumpDumpRisk||'—')+'</b></div></div>';
    h+='<details class="accordion" open><summary>👥 هولدرهای بزرگ</summary><div class="accordion-body">'+(s.topHolders&&s.topHolders.length?s.topHolders.slice(0,10).map(function(x,i){return '<div class="holder"><span>#'+(i+1)+' · '+pct(x.pct)+'</span><a target="_blank" rel="noopener" href="https://solscan.io/account/'+esc(x.owner)+'">'+esc(short(x.owner))+'</a></div>'}).join(''):'<div class="note">داده هولدر موجود نیست.</div>')+'</div></details>';
    if(ac.checks&&ac.checks.length)h+='<details class="accordion"><summary>🛡 چک‌لیست امنیتی</summary><div class="accordion-body">'+ac.checks.map(function(c){return '<div class="check"><span>'+esc(c.name)+(c.detail?'<small style="display:block;color:var(--muted);margin-top:3px">'+esc(c.detail)+'</small>':'')+'</span>'+stateLabel(c.state)+'</div>'}).join('')+'</div></details>';
  }
  if(tr)h+='<div class="note"><b>کیف‌پول‌های برتر:</b> '+Number(tr.uniqueBuyers||0)+' خریدار، '+Number(tr.uniqueSellers||0)+' فروشنده، جریان خالص '+money(tr.netFlowUsd)+'، هولدینگ '+money(tr.currentHoldingUsd)+'</div>';
  if(t&&isTrendingToken(t)&&wh.count)h+='<div class="note"><span class="pass"><b>🐋 ترند + خرید نهنگ:</b></span> '+wh.count+' خرید نهنگ با مجموع '+money(wh.usd)+'</div>';
  if(t&&socialTrendBadges(t))h+='<div class="note"><b>📣 شبکه‌های ترند تأییدشده:</b><div>'+socialTrendBadges(t)+'</div></div>';
  if(t){var tp=tradePlan(t);h+='<div class="note"><b>🎯 برنامه ورود/خروج:</b> '+tradePlanChips(t)+'<div style="margin-top:5px">'+esc(tp.reason||'')+(tp.riskPct?' · فاصله ابطال تقریبی '+Number(tp.riskPct).toFixed(1)+'%':'')+'</div><div class="muted" style="margin-top:4px">قیمت‌ها مرجع مدیریت ریسک‌اند، نه تضمین اجرا یا سود.</div></div>';}
  if(t){var tg=trustGuard(t),hb=t.holderBehavior||{};h+='<div class="note"><b>🛡 Trust Guard:</b> <span class="'+trustClass(t)+'">'+esc(trustLabel(t))+'</span> · snapshot هولدر '+Number(hb.snapshots||0)+' · خروج هولدر '+Number(hb.outflowPct||0).toFixed(2)+'% · نسبت Sell/Buy '+Number(hb.sellBuyRatio||0).toFixed(2)+(tg.reasons&&tg.reasons.length?' · '+esc(tg.reasons.join(' • ')):'')+'</div>';}
  if(t.kolTrend){var k=t.kolTrend;h+='<details class="accordion" open><summary>👑 شواهد KOL</summary><div class="accordion-body"><div class="note"><b>KOLها:</b> '+esc((k.kolNames||[]).join('، ')||'—')+' · معامله اخیر '+Number(k.recentCount||0)+' · هولد '+Number(k.holdingCount||0)+' · اشاره X '+Number(k.xMentionCount||0)+'</div>'+(k.evidence||[]).slice(0,8).map(function(e){return '<div class="check"><span>'+esc(e.kol||'KOL')+' · '+esc(e.type||'')+'</span><span class="manual">'+esc(e.label||'')+'</span></div>'}).join('')+'</div></details>';}
  if(tr){var bf=largeBuyerFlow(t);h+='<div class="note"><b>خریدارهای ردیابی‌شده ۵۰۰$+:</b> '+bf.buyers+' کیف‌پول ('+money(bf.buyerUsd)+') · <b>فروشنده خالص:</b> '+bf.sellers+' کیف‌پول ('+money(bf.sellerUsd)+') · '+(bf.dominant?'<span class="pass">✓ خریدارها بیشترند</span>':'<span class="manual">خریدارها بیشتر نیستند</span>')+'</div>';}
  if(tr&&tr.convictionHolders&&tr.convictionHolders.length)h+='<details class="accordion"><summary>💎 هولدرهای ردیابی‌شده با خرید ۱۰۰۰$+ و فروش کمتر</summary><div class="accordion-body">'+tr.convictionHolders.map(function(x){return '<div class="check"><span>'+esc(x.wallet)+' · خرید '+money(x.buyUsd)+' · فروش '+money(x.sellUsd)+'</span><span class="pass">هولد فعلی '+money(x.currentHoldingUsd)+'</span></div>'}).join('')+'<div class="note">بر اساس Swapهای قابل‌تشخیص ۴۸ ساعت اخیر کیف‌پول‌های تحت ردیابی؛ پوشش کل بازار نیست.</div></div></details>';
  if(sm)h+='<div class="note"><b>اسمارت‌مانی:</b> '+Number(sm.smartMoneyCount||0)+' کیف‌پول · '+money(sm.totalValueUsd)+' پوزیشن</div>';
  if(wh.count)h+='<div class="note"><b>نهنگ:</b> '+wh.count+' خرید بزرگ · '+money(wh.usd)+'</div>';if(t)h+=socialButtons(t);
  h+='<div class="links"><a target="_blank" rel="noopener" href="'+esc(dexUrl(m,t&&t.dexUrl))+'">📈 DexScreener</a><a target="_blank" rel="noopener" href="https://solscan.io/token/'+encodeURIComponent(m)+'">Solscan</a><a target="_blank" rel="noopener" href="https://gmgn.ai/sol/token/'+encodeURIComponent(m)+'">GMGN</a><a target="_blank" rel="noopener" href="https://v2.bubblemaps.io/map?address='+encodeURIComponent(m)+'&chain=solana&partnerId=regular">Bubblemaps</a><a target="_blank" rel="noopener" href="https://www.solanatracker.io/rugcheck/'+encodeURIComponent(m)+'">Rugcheck</a></div><div class="note">این رادار ابزار تحقیق است؛ هیچ امتیازی تضمین سود یا نبود کلاهبرداری نیست.</div>';
  document.getElementById('detailBody').innerHTML=h;document.getElementById('detailDialog').showModal();
}
var loadAllBusy=false;
async function loadAll(){
  if(loadAllBusy)return;
  loadAllBusy=true;
  var b=document.getElementById('refresh');
  if(b){b.disabled=true;b.textContent='در حال دریافت…'}
  try{
    var r=await Promise.all([safeJson('/api/v1/tokens'),safeJson('/api/v1/smart-money'),safeJson('/api/v1/smart-money-live'),safeJson('/api/v1/tracked-wallets'),safeJson('/api/v1/conviction-wallets')]);
    if(r[0]&&Array.isArray(r[0].tokens))tokens=r[0].tokens;
    if(r[1])smart=r[1];
    if(r[2])live=r[2];
    if(r[3])tracked=r[3];
    if(r[4])conviction=r[4];
    document.getElementById('updated').textContent='آخرین بروزرسانی سالم: '+new Date().toLocaleTimeString('fa-IR');
    renderAll();
  }finally{
    loadAllBusy=false;
    if(b){b.disabled=false;b.textContent='↻ بروزرسانی'}
  }
}
var liveStream=null,liveStreamConnected=false,liveFallbackTimer=null;
function applyLivePayload(x,label){
  if(!x)return;
  live=x;
  renderAlerts();renderWhales();renderChampion();renderFeatured();renderSocialTrends();renderPerformance24();renderKolTrends();renderTokens();
  document.getElementById('updated').textContent=(label||'زنده')+': '+new Date().toLocaleTimeString('fa-IR');
}
async function pollLiveFallback(){
  if(liveStreamConnected)return;
  var x=await safeJson('/api/v1/smart-money-live');
  applyLivePayload(x,'fallback');
}
function startLivePush(){
  if(typeof EventSource==='undefined'){liveFallbackTimer=setInterval(pollLiveFallback,1000);return}
  try{
    liveStream=new EventSource('/api/v1/live-stream');
    var handler=function(ev){try{applyLivePayload(JSON.parse(ev.data),'push زنده')}catch(e){}};
    liveStream.addEventListener('snapshot',handler);
    liveStream.addEventListener('market',handler);
    liveStream.addEventListener('position',handler);
    liveStream.addEventListener('status',handler);
    liveStream.onopen=function(){liveStreamConnected=true;if(liveFallbackTimer){clearInterval(liveFallbackTimer);liveFallbackTimer=null}document.getElementById('updated').textContent='اتصال Push زنده برقرار'};
    liveStream.onerror=function(){
      liveStreamConnected=false;
      if(!liveFallbackTimer)liveFallbackTimer=setInterval(pollLiveFallback,1000);
    };
  }catch(e){
    liveStreamConnected=false;
    if(!liveFallbackTimer)liveFallbackTimer=setInterval(pollLiveFallback,1000);
  }
}
document.addEventListener('click',function(e){var d=e.target.closest('.detail-btn');if(!d)return;openDetail(d.getAttribute('data-mint')||'')});
document.getElementById('tabs').addEventListener('click',function(e){var b=e.target.closest('[data-tab]');if(!b)return;activeTab=b.dataset.tab;document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x===b)});document.querySelectorAll('.panel').forEach(function(x){x.classList.remove('active')});document.getElementById(activeTab+'Panel').classList.add('active')});
document.addEventListener('change',function(e){var sfel=e.target.closest('.signal-filter');if(!sfel)return;signalFilters[sfel.dataset.filter]=sfel.value;document.querySelectorAll('.signal-filter[data-filter="'+sfel.dataset.filter+'"]').forEach(function(x){if(x!==sfel)x.value=sfel.value});renderChampion();renderFeatured();renderWhales();renderSmart();renderTokens()});
document.getElementById('search').addEventListener('input',renderTokens);document.getElementById('securityFilter').addEventListener('change',renderTokens);document.getElementById('activityFilter').addEventListener('change',renderTokens);document.getElementById('refresh').addEventListener('click',loadAll);document.getElementById('closeDetail').addEventListener('click',function(){document.getElementById('detailDialog').close()});document.getElementById('detailDialog').addEventListener('click',function(e){if(e.target===this)this.close()});
loadAll();startLivePush();setInterval(loadAll,60000);
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
    if(url.pathname==='/api/v1/live-stream'){
      res.writeHead(200,{
        'content-type':'text/event-stream; charset=utf-8',
        'cache-control':'no-cache, no-transform',
        'connection':'keep-alive',
        'x-accel-buffering':'no',
        ...headers
      });
      res.write('retry: 1000\nevent: snapshot\ndata: '+JSON.stringify(liveSmartMoneyPayload())+'\n\n');
      liveSseClients.add(res);
      const heartbeat=setInterval(()=>{try{res.write(': ping '+Date.now()+'\n\n')}catch{}},15000);
      req.on('close',()=>{clearInterval(heartbeat);liveSseClients.delete(res)});
      return;
    }
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
