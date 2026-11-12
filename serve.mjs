import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';

const PORT=Number(process.env.PORT||4173);
const RPC=process.env.SOLANA_RPC_URL||'https://api.mainnet.solana.com';
const CACHE_MS=15_000;
const SOCIAL_QUERY_CACHE_MS=10*60*1000;
const socialQueryCache=new Map();


const X_FAMOUS_ACCOUNTS=[
  {handle:'blknoiz06',name:'Ansem',group:'Solana meme commentator'},
  {handle:'theunipcs',name:'Unipcs',group:'meme coin commentator'},
  {handle:'MustStopMurad',name:'Murad',group:'meme coin commentator'},
  {handle:'CryptoKaduna',name:'Crypto Kaduna',group:'meme coin commentator'},
  {handle:'BillyM2k',name:'Billy Markus',group:'Dogecoin co-creator'},
  {handle:'cb_doge',name:'DogeDesigner',group:'meme coin commentator'}
];
const X_FAMOUS_POLL_MS=15*60*1000; // at most one search per hour; X API credits are not free by default
let xFamousCache={at:0,data:null},xFamousInFlight=null;
function famousXTextKind(text){
  const t=String(text||'');
  const mintMatches=[...new Set(t.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)||[])].filter(x=>PUMP_X_MINT_RE.test(x));
  return {contractMints:mintMatches.slice(0,5),
    topic:/\b(dogecoin|doge|memecoin|meme coin|shib|pepe|bonk|floki|pump\.fun|cryptocurrency|solana)\b/i.test(t)||
      mintMatches.length>0};
}
async function buildFamousXMonitor(){
  const now=Date.now();
  if(xFamousCache.data&&now-xFamousCache.at<X_FAMOUS_POLL_MS)return xFamousCache.data;
  if(xFamousInFlight)return xFamousInFlight;
  xFamousInFlight=(async()=>{
    const accounts=X_FAMOUS_ACCOUNTS.map(a=>({...a,url:'https://x.com/'+a.handle}));
    const base={ok:true,generatedAt:new Date().toISOString(),accounts,posts:[],
      source:'X API recent search',intervalMinutes:15,
      note:'Public posts only; this is radar monitoring, not a follow action on your personal X account. An account mention is not a buy recommendation.'};
    const bearer=process.env.X_BEARER_TOKEN;
    if(!bearer)return {...base,status:'not-configured',
      message:'X_BEARER_TOKEN is not configured for this service.'};
    try{
      const handles=X_FAMOUS_ACCOUNTS.map(a=>'from:'+a.handle).join(' OR ');
      const query='('+handles+') -is:retweet -is:reply';
      const url='https://api.x.com/2/tweets/search/recent?query='+encodeURIComponent(query)+
        '&max_results=100&tweet.fields=created_at,author_id,public_metrics,referenced_tweets'+
        '&expansions=author_id&user.fields=username,name';
      const payload=await jfetch(url,{headers:{authorization:'Bearer '+bearer}},12000);
      const users=new Map((payload?.includes?.users||[]).map(u=>[String(u.id),u]));
      const accountSet=new Set(X_FAMOUS_ACCOUNTS.map(a=>a.handle.toLowerCase()));
      const posts=(payload?.data||[]).map(post=>{
        const author=users.get(String(post.author_id));
        const handle=String(author?.username||'');
        const kind=famousXTextKind(post.text);
        if(!accountSet.has(handle.toLowerCase())||!kind.topic)return null;
        const at=Date.parse(post.created_at||'');
        if(!Number.isFinite(at)||at>now||now-at>7*24*60*60*1000)return null;
        return {id:String(post.id),handle,name:String(author?.name||handle),
          createdAt:post.created_at,url:'https://x.com/'+handle+'/status/'+post.id,
          text:String(post.text||'').slice(0,800),contractMints:kind.contractMints,
          likes:num(post.public_metrics?.like_count),reposts:num(post.public_metrics?.retweet_count),
          type:kind.contractMints.length?'contract-mention':'topic-mention'};
      }).filter(Boolean).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,30);
      return {...base,status:'ok',posts,partial:!!payload?.meta?.next_token,
        message:posts.length?'Recent public X mentions retrieved.':'No matching posts returned in the recent search window.'};
    }catch(e){
      return {...base,status:'api-error',message:String(e?.message||e).slice(0,180)};
    }
  })();
  try{
    const result=await xFamousInFlight;
    xFamousCache={at:Date.now(),data:result};
    return result;
  }finally{xFamousInFlight=null}
}

const pumpXMonitorCache={at:0,data:null};
let pumpXMonitorInFlight=null;
const pumpXAccountEvidence=new Map();
const pumpXCandleCache=new Map();
const pumpXPostCache=new Map();
const PUMP_X_REFRESH_MS=15*60*1000;
// User-submitted backtest cases: onset time is user-reported, NOT verified
// by historical candles. No authors become trusted from an unverified case.
const SUBMITTED_PUMP_CASES=[
  {mint:'4xgqefa5WcdHWKXzqvM9MRJqWYGaHVEUnpUL4Vq5pump',
    symbol:'HUNG',name:'Jensen Hung',
    reportedOnset:'2026-11-11T20:30:00.000Z',
    reportedTimezone:'Asia/Tehran',
    source:'user-reported',verifiedOnset:false},
  {mint:'4CxjZyMNoF1p6eXHXHv1TWpS2X47CuUmLwtGe18spump',
    symbol:'MIHAO',name:'ni hao cat',
    reportedOnset:null,reportedTimezone:'Europe/Paris',
    source:'historical-public-report',verifiedOnset:false,
    contextualPeak:'2026-11-11T05:41:00.000Z',
    contextualArticle:'https://trenches-on.com/en/runners/2026-11-11-mihao/',
    contextualAccounts:[
      {handle:'Dior100x',postUrl:'https://x.com/Dior100x/status/2120315999882985979',note:'تصویر گربه؛ صرفاً اشاره فرهنگی'},
      {handle:'iAmNihaoCat',postUrl:'https://x.com/iAmNihaoCat/status/2120317299341349020',note:'بازنشر تصویر، نه سیگنال خرید'},
      {handle:'blknoiz06',postUrl:'https://x.com/blknoiz06/status/2120363216043704466',note:'اشاره به روایت مرتبط، بدون اثبات اشاره به کانترکت'},
      {handle:'durki0h',postUrl:'https://x.com/durki0h/status/2120376082444779621',note:'آواتار، نه سیگنال خرید'}
    ]},
  {mint:'KMifrkYmDdAKtVXAVBEPEQxJ7qP2iLgUcfZjUZipump',
    symbol:'RAMBO',name:'RAMBO',
    reportedOnset:null,reportedTimezone:'UTC',source:'public-market-reports',verifiedOnset:false,
    contextualPeak:null,
    contextualArticle:'https://pumpdata.fun/check/KMifrkYmDdAKtVXAVBEPEQxJ7qP2iLgUcfZjUZipump',
    contextualAccounts:[],
    historicalSecurityWarning:'تمرکز اولیه عرضه: ۲۳ کیف پول حدود ۸۷٫۸٪ عرضه در ۱۰ ثانیه نخست',
    historicalPeakMarketCapUsd:9500000}
];
async function reviewSubmittedPumpCases(){
  const now=Date.now(),items=[];
  for(const item of SUBMITTED_PUMP_CASES){
    if(!PUMP_X_MINT_RE.test(item.mint))continue;
    const onsetAt=item.reportedOnset?Date.parse(item.reportedOnset):NaN;
    if(!Number.isFinite(onsetAt)){
      items.push({mint:item.mint,symbol:item.symbol,name:item.name,
        reportedOnset:null,verifiedOnset:false,windowStart:null,windowEnd:null,
        contextualPeak:item.contextualPeak||null,contextualArticle:item.contextualArticle||null,
        historicalSecurityWarning:item.historicalSecurityWarning||null,
        contextualAccounts:item.contextualAccounts||[],status:'needs-onset',
        checkedAt:new Date(now).toISOString(),accounts:[],
        note:'زمان آغاز پامپ از کندل تاریخی تأیید نشده؛ پست‌های اشاره‌شده در گزارش رسانه‌ای سیگنال خرید با کانترکت دقیق نیستند.'});
      continue;
    }
    const startAt=onsetAt-24*60*60*1000;
    const q=await queryXPostsForMint(item.mint,startAt,onsetAt);
    const posts=q.status==='ok'?[...new Map((q.posts||[]).map(p=>[p.authorId,p])).values()]
      .filter(p=>p.postedAt>=startAt&&p.postedAt<onsetAt):[];
    items.push({mint:item.mint,symbol:item.symbol,name:item.name,
      reportedOnset:item.reportedOnset,reportedTimezone:item.reportedTimezone,
      verifiedOnset:false,windowStart:new Date(startAt).toISOString(),
      windowEnd:new Date(onsetAt).toISOString(),status:q.status,
      checkedAt:new Date(now).toISOString(),partial:!!q.partial,
      accounts:posts.slice(0,25).map(p=>({handle:p.handle,authorId:p.authorId,
        postAt:p.postedAt,postUrl:p.url,text:p.text.slice(0,400)})),
      note:posts.length
        ?'پست‌ها از نظر آدرس قرارداد و زمان بررسی شده‌اند؛ زمان شروع پامپ هنوز تأیید بازار ندارد.'
        :'هیچ پست X با آدرس دقیق قرارداد و جهت‌گیری خرید در بازه انتخاب‌شده تأیید نشده است. نبود نتیجه اثبات نبودن پست نیست.'});
  }
  return items;
}
const PUMP_X_MINT_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function findPumpOnset(candles,pairCreatedAt){
  // Time stamped completed 15m candles, not a current 24h change masquerading as onset.
  const now=Date.now();
  const rows=(Array.isArray(candles)?candles:[]).filter(x=>
    Array.isArray(x)&&Number.isFinite(+x[0])&&num(x[4])>0&&
    x[0]*1000<now-15*60*1000).sort((a,b)=>a[0]-b[0]);
  for(let i=4;i<rows.length;i++){
    if(rows[i][0]-rows[i-4][0]>75*60)continue; // disallow gaps
    const before=num(rows[i-4][4]),after=num(rows[i][4]);
    if(before<=0||after/before<1.5)continue;
    // Post attribution uses the beginning of the rise, not its final
    // confirming candle, to avoid counting posts during the pump.
    const onset=rows[i-4][0]*1000;
    if(onset<num(pairCreatedAt))continue;
    // Ignore events in the current candle and historical events outside X recent search.
    if(now-onset>5*24*60*60*1000)continue;
    return {onsetAt:onset,growth1hPct:(after/before-1)*100,priceBefore:before,priceAfter:after};
  }
  return null;
}
async function historicalPumpOnset(t){
  if(!PUMP_X_MINT_RE.test(t?.mint||'')||!PUMP_X_MINT_RE.test(t?.pairAddress||''))return null;
  const ck=t.pairAddress,hit=pumpXCandleCache.get(ck);
  if(hit&&Date.now()-hit.at<(hit.value?6*60*60*1000:10*60*1000))return hit.value;
  let onset=null;
  try{
    const endpoint='https://api.geckoterminal.com/api/v2/networks/solana/pools/'+
      encodeURIComponent(ck)+'/ohlcv/minute?aggregate=15&limit=480&currency=usd&token=base&include_empty_intervals=true';
    const d=await jfetch(endpoint,{},12000);
    onset=findPumpOnset(d?.data?.attributes?.ohlcv_list,Date.now()-num(t.ageMinutes)*60000);
  }catch{}
  pumpXCandleCache.set(ck,{at:Date.now(),value:onset});
  return onset;
}
function bullishXPost(p,mint){
  const txt=String(p?.text||'');
  // Exact CA evidence, original authored post, with a directional trading thesis.
  // Mention-only, backwards-looking and generic promotions do not count.
  return txt.includes(mint)&&
    /\b(buy|buying|accumulat(?:e|ing|ion)|bullish|entry|early|long|gem|ape(?:d|ing)?|potential|undervalued|ape in)\b|خرید|ورود|صعود|مستعد رشد/i.test(txt)&&
    !/\b(sold|selling|exit|take profit|avoid|scam|rug|dumped)\b/i.test(txt);
}
async function queryXPostsForMint(mint,startAt,endAt){
  const key=process.env.X_BEARER_TOKEN;
  if(!key||!PUMP_X_MINT_RE.test(mint))return {status:'not-configured',posts:[]};
  const now=Date.now(),start=Math.max(0,Number(startAt)),end=Math.min(now-15000,Number(endAt));
  if(!(start<end))return {status:'invalid-window',posts:[]};
  const cacheKey=mint+':'+Math.floor(start/3600000)+':'+Math.floor(end/3600000);
  const found=pumpXPostCache.get(cacheKey);
  if(found&&now-found.at<10*60*1000)return found.value;
  const recent=start>=now-7*24*3600000;
  if(!recent&&process.env.X_FULL_ARCHIVE_SEARCH!=='true')return {status:'full-archive-required',posts:[]};
  const url='https://api.x.com/2/tweets/search/'+(recent?'recent':'all')+'?'+
    'query='+encodeURIComponent(mint+' -is:retweet -is:reply')+
    '&start_time='+encodeURIComponent(new Date(start).toISOString())+
    '&end_time='+encodeURIComponent(new Date(end).toISOString())+
    '&max_results=100&tweet.fields=created_at,author_id,public_metrics'+
    '&expansions=author_id&user.fields=username,name';
  let result={status:'unavailable',posts:[]};
  try{
    const d=await jfetch(url,{headers:{authorization:'Bearer '+key}},12000);
    const users=new Map((d?.includes?.users||[]).map(u=>[String(u.id),u]));
    const posts=(d?.data||[]).map(p=>{
      const user=users.get(String(p.author_id));
      const posted=Date.parse(p.created_at||'');
      return {id:String(p.id||''),createdAt:p.created_at,postedAt:posted,
        handle:String(user?.username||''),authorId:String(p.author_id||''),
        text:String(p.text||''),url:user?.username&&p.id?'https://x.com/'+user.username+'/status/'+p.id:'',
        likes:num(p.public_metrics?.like_count)};
    }).filter(p=>p.handle&&p.url&&p.postedAt>=start&&p.postedAt<end&&bullishXPost(p,mint));
    result={status:'ok',posts,partial:!!d?.meta?.next_token,source:recent?'recent':'full-archive'};
  }catch(e){result={status:'api-error',posts:[],error:String(e?.message||e).slice(0,110)}}
  pumpXPostCache.set(cacheKey,{at:now,value:result});
  return result;
}
async function geckoHistoricalPumpCandidates(){
  // Broaden beyond the current radar's small discovery sample.
  // GeckoTerminal related base token is the source of the exact mint.
  try{
    const d=await jfetch('https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?duration=24h&include=base_token',{},12000);
    return (d?.data||[]).map(x=>{
      const attr=x?.attributes||{},relation=String(x?.relationships?.base_token?.data?.id||'');
      const mint=relation.startsWith('solana_')?relation.slice(7):'';
      const pairAddress=String(attr.address||'');
      const createdAt=Date.parse(attr.pool_created_at||'');
      const volume24h=num(attr.volume_usd?.h24),change24h=num(attr.price_change_percentage?.h24);
      if(!PUMP_X_MINT_RE.test(mint)||!PUMP_X_MINT_RE.test(pairAddress)||
         !Number.isFinite(createdAt)||Date.now()-createdAt<2*3600*1000||
         volume24h<100000||change24h<60||num(attr.reserve_in_usd)<25000)return null;
      return {mint,pairAddress,symbol:String(attr.name||'').split('/')[0].trim(),
        ageMinutes:(Date.now()-createdAt)/60000,liquidity:num(attr.reserve_in_usd),
        volume24h,priceChange24h:change24h,discoverySource:'GeckoTerminal historical pump discovery'};
    }).filter(Boolean).slice(0,5);
  }catch{return []}
}
async function buildPumpXMonitor(){
  const now=Date.now();
  if(pumpXMonitorCache.data&&now-pumpXMonitorCache.at<PUMP_X_REFRESH_MS)return pumpXMonitorCache.data;
  if(pumpXMonitorInFlight)return pumpXMonitorInFlight;
  pumpXMonitorInFlight=(async()=>{
    // Even without X authorization, still expose verified historical pump
    // onset times and contract addresses from public market data.
    const xConfigured=!!process.env.X_BEARER_TOKEN;
    const submittedCases=await reviewSubmittedPumpCases();
    const base=cache.data?.tokens||[];
    const gecko=await geckoHistoricalPumpCandidates();
    const historyCandidates=[...new Map(gecko.concat(base.filter(t=>t.pairAddress&&t.mint&&
      t.ageMinutes>=2*60&&num(t.liquidity)>=25000&&
      num(t.priceChange24h)>=60)).sort((a,b)=>num(b.volume24h)-num(a.volume24h))
      .map(t=>[t.mint,t])).values()].slice(0,8);
    if(!base.length&&!historyCandidates.length){
      return {ok:true,configured:xConfigured,status:'waiting-for-first-token-scan',
        generatedAt:new Date().toISOString(),submittedCases,discoveredPumps:[],trackedAccounts:[],watchlist:[],
        note:'Token discovery has not completed. Retry after the initial radar scan.'};
    }
    const discoveredPumps=[];
    const xDiagnostics={apiErrors:0,archivalAccessRequired:0,successfulQueries:0,partialResults:0};
    for(const t of historyCandidates){
      const onset=await historicalPumpOnset(t);
      if(!onset)continue;
      const posts=xConfigured?
        await queryXPostsForMint(t.mint,onset.onsetAt-24*3600000,onset.onsetAt):
        {status:'not-configured',posts:[],partial:false};
      if(posts.status==='api-error')xDiagnostics.apiErrors++;
      if(posts.status==='full-archive-required')xDiagnostics.archivalAccessRequired++;
      if(posts.status==='ok')xDiagnostics.successfulQueries++;
      if(posts.partial)xDiagnostics.partialResults++;
      const distinct=posts.status==='ok'?[...new Map(posts.posts.map(p=>[p.authorId,p])).values()]:[];
      for(const post of distinct){
        const a=pumpXAccountEvidence.get(post.authorId)||{authorId:post.authorId,handle:post.handle,
          calls:new Map(),updatedAt:now};
        a.handle=post.handle;a.updatedAt=now;
        if(!a.calls.has(t.mint))a.calls.set(t.mint,{mint:t.mint,symbol:t.symbol,
          onsetAt:onset.onsetAt,growth1hPct:onset.growth1hPct,postUrl:post.url,postAt:post.postedAt});
        pumpXAccountEvidence.set(post.authorId,a);
      }
      discoveredPumps.push({mint:t.mint,symbol:t.symbol,contract:t.mint,
        onsetAt:onset.onsetAt,growth1hPct:onset.growth1hPct,
        pairAddress:t.pairAddress,postCount:distinct.length,accounts:distinct.slice(0,12).map(p=>({
          handle:p.handle,authorId:p.authorId,postAt:p.postedAt,postUrl:p.url
        })),partial:posts.partial});
    }
    // A 'tracked' user needs two independently documented, distinct pumps,
    // not two reposts or two posts about one token.
    const tracked=[...pumpXAccountEvidence.values()].filter(x=>x.calls.size>=2)
      .sort((a,b)=>b.calls.size-a.calls.size).slice(0,25);
    const trackedIds=new Set(tracked.map(x=>x.authorId));
    const watchlist=[];
    const upcoming=base.filter(t=>t.pairAddress&&t.mint&&
      Number.isInteger(t.totalHolderCount)&&t.totalHolderCount>=1000&&
      num(t.liquidity)>=40000&&num(t.priceChange5m)>=0&&num(t.priceChange5m)<=8&&
      num(t.priceChange1h)<=22).sort((a,b)=>num(b.volume5m)-num(a.volume5m)).slice(0,4);
    for(const t of upcoming){
      if(!trackedIds.size)break;
      const q=await queryXPostsForMint(t.mint,now-2*3600000,now-30000);
      if(q.status!=='ok')continue;
      const matching=[...new Map(q.posts.filter(p=>trackedIds.has(p.authorId)).map(p=>[p.authorId,p])).values()];
      const qualified=matching.length>=2&&
        Number(t.totalHolderCount)>=1000&&
        t.security?.holderPolicyPassed===true&&
        ['MAX SECURITY','HIGH'].includes(t.security?.tier||'')&&
        t.activity?.label!=='BOT RISK'&&t.chart?.pumpDumpRisk!=='HIGH'&&
        num(t.liquidity)>=40000&&num(t.volume5m)>=5000&&
        num(t.buys5m)>num(t.sells5m);
      if(!matching.length)continue;
      watchlist.push({mint:t.mint,symbol:t.symbol,name:t.name,
        greenWatch:qualified,verifiedEarlyAccounts:matching.length,
        holders:t.totalHolderCount,liquidity:t.liquidity,change5m:t.priceChange5m,
        accounts:matching.map(p=>({handle:p.handle,authorId:p.authorId,postUrl:p.url,
          postAt:p.postedAt,historicalPumps:pumpXAccountEvidence.get(p.authorId)?.calls.size||0}))});
    }
    return {ok:true,configured:xConfigured,
      status:!xConfigured?'needs-x-bearer-token':xDiagnostics.apiErrors?'x-api-errors':xDiagnostics.archivalAccessRequired?'archive-access-needed':'scanned',
      xDiagnostics,generatedAt:new Date().toISOString(),submittedCases,
      samplesScanned:historyCandidates.length,discoveredPumps,trackedAccounts:tracked.map(a=>({
        authorId:a.authorId,handle:a.handle,documentedPumps:a.calls.size,
        calls:[...a.calls.values()].slice(-6)
      })),watchlist,
      note:'Exploratory evidence only. Historical search is limited to sampled surviving high-volume pools; no calibrated pump probability is implied. X accounts are followed inside this radar, not in your X account.'};
  })();
  try{
    const data=await pumpXMonitorInFlight;
    pumpXMonitorCache.at=data.status==='waiting-for-first-token-scan'
      ?Date.now()-PUMP_X_REFRESH_MS+30000:Date.now();
    pumpXMonitorCache.data=data;return data;
  }finally{pumpXMonitorInFlight=null}
}

const SECURITY_CACHE_MS=2*60*1000;
const EXTERNAL_SECURITY_CACHE_MS=10*60*1000;
let cache={at:0,data:null};
// Pool-liquidity history is tracked by pair, not token symbol. Missing history
// is WAIT, never silently treated as proof of pool safety.
const poolLiquidityHistory=new Map();
function poolLiquidityAudit(t){
  const pair=String(t?.pairAddress||'');
  const liquidity=Number(t?.liquidity);
  if(!pair||!Number.isFinite(liquidity)||liquidity<=0)return {status:'WAIT',reason:'نقدینگی/استخر قابل تأیید نیست'};
  const now=Date.now(),key=String(t.mint||'')+':'+pair;
  const previous=(poolLiquidityHistory.get(key)||[]).filter(x=>now-x.at<=30*60*1000);
  const baseline=previous.length?Math.max(...previous.map(x=>x.liquidity)):liquidity;
  const dropPct=baseline>0?(baseline-liquidity)/baseline*100:0;
  if(!previous.length||now-previous[previous.length-1].at>=45*1000){
    previous.push({at:now,liquidity});
    poolLiquidityHistory.set(key,previous.slice(-30));
  }
  if(poolLiquidityHistory.size>700){
    for(const [k,v] of poolLiquidityHistory)if(!v.length||now-v[v.length-1].at>45*60*1000)poolLiquidityHistory.delete(k);
  }
  if(previous.length<2)return {status:'WAIT',reason:'هنوز دو نمونه زمانی از نقدینگی ثبت نشده',dropPct:0};
  if(dropPct>=20)return {status:'RISK',reason:'کاهش دست‌کم ۲۰٪ نقدینگی استخر در ۳۰ دقیقه',dropPct:+dropPct.toFixed(1)};
  return {status:'CLEAR',reason:'افت سریع نقدینگی در نمونه‌های موجود مشاهده نشده',dropPct:+dropPct.toFixed(1)};
}

let buildInFlight=null;
let marketLiveCache={at:0,data:null};
const exactDexPriceCache=new Map();
const EXACT_DEX_PRICE_CACHE_MS=650;
const contractPriceCache=new Map();
const CONTRACT_PRICE_CACHE_MS=700;
const jupiterPriceCache=new Map();
let jupiterLastFetchAt=0;
let jupiterInFlight=null;
const JUPITER_PRICE_CACHE_MS=20000;
const TOTAL_HOLDERS_MIN=1000;
const tokenHolderCountCache=new Map();
const TOKEN_HOLDER_COUNT_CACHE_MS=2*60*1000;
let holderCountLastQuery=0;
async function fetchTokenHolderCounts(mints){
  const ids=[...new Set((mints||[]).filter(m=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))].slice(0,100);
  const now=Date.now(),out=new Map(),missing=[];
  for(const mint of ids){
    const hit=tokenHolderCountCache.get(mint);
    if(hit&&now-hit.at<TOKEN_HOLDER_COUNT_CACHE_MS){
      if(Number.isInteger(hit.count)&&hit.count>=0)out.set(mint,hit.count);
    }else missing.push(mint);
  }
  if(!missing.length||now-holderCountLastQuery<2200)return out;
  holderCountLastQuery=now;
  const headers=process.env.JUPITER_API_KEY?{'x-api-key':process.env.JUPITER_API_KEY}:{};
  try{
    const rows=await pacedJupiterFetch('https://api.jup.ag/tokens/v2/search?query='+encodeURIComponent(missing.join(',')),{headers},10000);
    for(const row of (Array.isArray(rows)?rows:[])){
      const mint=String(row?.id||row?.address||'');
      const count=Number(row?.holderCount);
      if(!ids.includes(mint)||!Number.isInteger(count)||count<0)continue;
      tokenHolderCountCache.set(mint,{at:Date.now(),count});
      out.set(mint,count);
    }
  }catch{}
  return out;
}
async function jupiterPrices(mints){
  const now=Date.now(), ids=[...new Set((mints||[]).filter(m=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))].slice(0,50);
  const out=new Map();
  for(const id of ids){
    const h=jupiterPriceCache.get(id);
    if(h&&now-h.at<JUPITER_PRICE_CACHE_MS&&h.data)out.set(id,h.data);
  }
  const missing=ids.filter(id=>!out.has(id));
  if(!missing.length)return out;
  // Keyless Jupiter is limited to 0.5 RPS; avoid a burst and
  // never block the dashboard while another batch is in flight.
  if(jupiterInFlight||now-jupiterLastFetchAt<2200)return out;
  jupiterLastFetchAt=now;
  const headers=process.env.JUPITER_API_KEY?{'x-api-key':process.env.JUPITER_API_KEY}:{};
  jupiterInFlight=pacedJupiterFetch('https://api.jup.ag/price/v3?ids='+encodeURIComponent(missing.join(',')),{headers},8500);
  try{
    const response=await jupiterInFlight;
    for(const id of missing){
      const v=response?.[id];
      if(num(v?.usdPrice)>0){
        const result={priceUsd:num(v.usdPrice),liquidity:num(v.liquidity),blockId:v.blockId||null,source:'Jupiter Price V3'};
        jupiterPriceCache.set(id,{at:Date.now(),data:result});
        out.set(id,result);
      }
    }
  }catch(e){}finally{jupiterInFlight=null}
  return out;
}



// Keyless GeckoTerminal fallback and optional Birdeye fallback. These sources
// are used sparingly, at documented rate-limits, and never fabricate quotes.
const secondaryPriceCache=new Map();
const SECONDARY_PRICE_TTL_MS=45000;
let geckoLastPriceFetchAt=0,birdeyeLastPriceFetchAt=0;
async function geckoTokenPrice(mint){
  if(!PUMP_X_MINT_RE.test(mint))return null;
  const key='gecko:'+mint,now=Date.now(),hit=secondaryPriceCache.get(key);
  if(hit&&now-hit.at<SECONDARY_PRICE_TTL_MS)return hit.data;
  // Public GeckoTerminal budget is about 10/min; never exceed it here.
  if(now-geckoLastPriceFetchAt<6500)return null;
  geckoLastPriceFetchAt=now;
  let value=null;
  try{
    const json=await jfetch('https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/'+encodeURIComponent(mint),
      {headers:{accept:'application/json;version=20230203'}},8500);
    const p=num(json?.data?.attributes?.token_prices?.[mint]);
    if(p>0)value={priceUsd:p,source:'GeckoTerminal token price',observedAt:Date.now()};
  }catch{}
  secondaryPriceCache.set(key,{at:Date.now(),data:value});
  return value;
}
async function birdeyeTokenPrice(mint){
  const keyval=process.env.BIRDEYE_API_KEY;
  if(!keyval||!PUMP_X_MINT_RE.test(mint))return null;
  const key='birdeye:'+mint,now=Date.now(),hit=secondaryPriceCache.get(key);
  if(hit&&now-hit.at<SECONDARY_PRICE_TTL_MS)return hit.data;
  if(now-birdeyeLastPriceFetchAt<1200)return null;
  birdeyeLastPriceFetchAt=now;
  let value=null;
  try{
    const json=await jfetch('https://public-api.birdeye.so/defi/price?address='+encodeURIComponent(mint),
      {headers:{'X-API-KEY':keyval,'x-chain':'solana'}},8500);
    const price=num(json?.data?.value??json?.data?.price);
    if(json?.success!==false&&price>0)value={priceUsd:price,source:'Birdeye',observedAt:Date.now()};
  }catch{}
  secondaryPriceCache.set(key,{at:Date.now(),data:value});
  return value;
}

let prelaunchCache={at:0,data:null};
let pumpTraderIntelCache={at:0,data:null};
let solidProofIntelCache={at:0,data:null};
const PUMP_TRADER_INTEL_CACHE_MS=60*1000;
const SOLIDPROOF_INTEL_CACHE_MS=5*60*1000;

const prelaunchWatchState=new Map();
const launchPerfCache=new Map();

const PRELAUNCH_CACHE_MS=2*60*1000;

let marketLiveInFlight=null;
const MARKET_LIVE_CACHE_MS=900;
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

const USER_TOP_TRADER_ADDRESSES=[
'8k1sAmVUjzaZkxqexeYkCPphjcQobYugQeGmCyvKtHNG',
'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6',
'6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP',
'87rRdssFiTJKY4MGARa4G5vQ31hmR7MxSmhzeaJ5AAxJ',
'DuARUpsEzdVbVpSnbGipLJvWxaXUCPLDJDjNov6Rc6s6',
'CE44oKS3wpUerx8afyeii56u5oQjBLZknzm4Q2CYHUz9',
'BAr5csYtpWoNpwhUjixX7ZPHXkUciFZzjBp9uNxZXJPh',
'6qudAN2kV8mtCcYJxb5QQ6Vr15itdHHdeVbYm99NKMhy',
'9z332Pxs4xaz7CdE4sYPEHu9a9qrxcUTkbvMXVo1q1Q8',
'5hAgYC8TJCcEZV7LTXAzkTrm7YL29YXyQQJPCNrG84zM',
'HVaeUPbAwFhZnY8T3MrUzTWqpHiAbTU1NACmCQdJrqZp',
'AvGiSdrkwtGYhrrFXZPtdhNhV4pASUR67TmRjfaKGdMP',
'CAPn1yH4oSywsxGU456jfgTrSSUidf9jgeAnHceNUJdw',
'5B52w1ZW9tuwUduueP5J7HXz5AcGfruGoX6YoAudvyxG',
'2ksQ77e9e5SS6VA6poanRGWfkU3R4R5wZnptbJHb2nx9',
'6vbrTLsWy76TxDQAUKLqZrPohQuq6EVaJgfGzR82paFa',
'DrJ6SnDXkEsPeGdmSs93v5rwWumv5QMvAGSZjAyWSd5o',
'7g5CJ754NboeY6D44MDdGwQmVX4Fvu59Q47c9ZKLPMkE',
'8deJ9xeUvXSJwicYptA9mHsU2rN2pDx37KWzkDkEXhU6',
'4y2T1ghykCTq4EddoXjptZamk4qAsqcZw6eKxS8jdvE1',
'BSzpGGB3AMwtW126RT3Z27STSBrVjKV5A96H4BsUKdtD',
'6yVb4pxNwDfr6rovwNnBg3SyKSvDcHGD4WdFPN1JJBqm',
'DAEdBmTPEKM6xkwfzC3d411QUe6coKpkND6UURa4CvHC',
'8MaVa9kdt3NW4Q5HyNAm1X5LbR8PQRVDc1W8NMVK88D5',
'DdM1tyCdoEyoxYYmGMjdf5rRPcpmj3UzZTpE7ScuTf7d',
'2M2vLX34LXMg24dMEnjWHvRXS1tshpEDRWzmXgV8ENNZ',
'29yFzeBZgxf5zqrAkKXwgZtQehRf4pL8WbV2nRJikbw8',
'4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9',
'2jgmHtkCkJXm3Xq4dp9DgippkQjXLK3rhaREAz7oG7s7',
'J23qr98GjGJJqKq9CBEnyRhHbmkaVxtTJNNxKu597wsA',
'ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT',
'FFdBLYqL9rs5fUT38ArE8GV2L3BziEgG5LJUu6sshfkF',
'6HJetMbdHBuk3mLUainxAPpBpWzDgYbHGTS2TqDAUSX2',
'24L6uekgvsQRgT41DZRhahEAAVnkseTT7x4qyigC3HvH',
'GeUnv1jmtviRbR7Gu1JnXSGkUMUgFVBHuEVQVpTaUX1W',
'3VUNtVtjjx5ckUojT7UocJ5fbuAJRsNUXNfTBnPte9vC',
'GijFWw4oNyh9ko3FaZforNsi3jk6wDovARpkKahPD4o5',
'F9zT1F46HAoPanR4NC1Yw7TyP8Z9tCavTe48mrzK7aN4',
'B5TrL7PsRUwCTL5bVcueieht5QchTw4TWLQDKqEaxEzi',
'6mrqa4cDaqBCD9UrUiUyoK78e4AJ8XzRaF8uTbcuTVae',
'EqBQhoU88ty3a3aDphDRCBuiRirjUsFSFi4UHGY64qvv',
'CwUHN4zTn5wiEYoZjsP4FrDvAT9heDWewCTQjhgwhJqS'
];
const USER_TOP_TRADERS=[...new Set(USER_TOP_TRADER_ADDRESSES)]
  .filter(a=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))
  .map((address,i)=>{
    const known=TRACKED_WALLETS.find(w=>w.address===address);
    return {
      name:known?.name||('Top Trader '+String(i+1).padStart(2,'0')),
      address,source:'User supplied top traders',
      knownName:known?.name||null
    };
  });

let topTraderIntelCache={at:0,data:null};
const TOP_TRADER_INTEL_CACHE_MS=12*1000;
const topTraderPreviousBalances=new Map();
const topTraderPositionBaselines=new Map();
let topTraderBuyEvents=[];
let trackedWalletCache={at:0,data:null};
const TRACKED_WALLET_CACHE_MS=60*1000;
let convictionCache={at:0,data:null};prelaunchCache={at:0,data:null};
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
// Share a strict Jupiter request budget across token metadata, prices,
// quote-only routing and API diagnostics. Keyless is 0.5 RPS, free key 1 RPS.
let jupiterPaceQueue=Promise.resolve(),jupiterNextAllowedAt=0;
function pacedJupiterFetch(url,opt={},timeout=10000){
  const minInterval=process.env.JUPITER_API_KEY?1100:2200;
  const run=jupiterPaceQueue.then(async()=>{
    const wait=Math.max(0,jupiterNextAllowedAt-Date.now());
    if(wait>0)await sleep(wait);
    jupiterNextAllowedAt=Date.now()+minInterval;
    return jfetch(url,opt,timeout);
  });
  jupiterPaceQueue=run.catch(()=>{});
  return run;
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
function isTrustedQuotePair(p){
  const q=String(p?.quoteToken?.address||'');
  return q===WSOL_MINT||STABLE_MINTS.has(q);
}
function canonicalPairScore(p,mint){
  if(!p||String(p.chainId||'').toLowerCase()!=='solana')return -1;
  if(String(p?.baseToken?.address||'')!==String(mint||''))return -1;
  const price=num(p.priceUsd);
  if(!(price>0))return -1;
  const liq=num(p?.liquidity?.usd),v5=num(p?.volume?.m5),v1=num(p?.volume?.h1),v24=num(p?.volume?.h24);
  const tx5=num(p?.txns?.m5?.buys)+num(p?.txns?.m5?.sells);
  return Math.log10(1+Math.max(0,liq))*100+
    Math.log10(1+Math.max(0,v24))*8+
    Math.log10(1+Math.max(0,v1))*5+
    Math.log10(1+Math.max(0,v5))*3+
    Math.min(20,tx5/5);
}
function chooseCanonicalPair(rows,mint){
  // DEXScreener token-pairs endpoint is the source of truth.
  // Keep its first valid base-token pair instead of imposing our own quote-token preference.
  const valid=(Array.isArray(rows)?rows:[]).filter(function(p){
    return canonicalPairScore(p,mint)>=0;
  });
  return valid[0]||null;
}

async function pairsForMany(mints,preferredPairs=null){
  const uniq=[...new Set((mints||[]).filter(Boolean))].slice(0,900);
  const requested=new Set(uniq);
  const batches=[];for(let i=0;i<uniq.length;i+=30)batches.push(uniq.slice(i,i+30));
  const candidates=new Map();
  const settled=await Promise.allSettled(batches.map(async batch=>{
    const rows=await jfetch('https://api.dexscreener.com/tokens/v1/solana/'+batch.join(','),{},12000);
    return Array.isArray(rows)?rows:[];
  }));
  for(const r of settled){
    if(r.status!=='fulfilled')continue;
    for(const p of r.value){
      const base=String(p?.baseToken?.address||'');
      if(!base||!requested.has(base))continue;
      const arr=candidates.get(base)||[];
      arr.push(p);candidates.set(base,arr);
    }
  }
  const out=new Map();
  for(const mint of uniq){
    const rows=candidates.get(mint)||[];
    const preferred=preferredPairs&&typeof preferredPairs.get==='function'?String(preferredPairs.get(mint)||''):'';
    let p=null;
    if(preferred){
      p=rows.find(function(x){
        return String(x?.pairAddress||'')===preferred&&canonicalPairScore(x,mint)>=0;
      })||null;
    }
    if(!p)p=chooseCanonicalPair(rows,mint);
    if(p)out.set(mint,p);
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

function prelaunchState(v){
  var s=String(v||'unknown').toLowerCase();
  if(['pass','verified','yes','true'].includes(s))return 'pass';
  if(['fail','no','false','rejected'].includes(s))return 'fail';
  if(['planned','promised','future','post-launch'].includes(s))return 'planned';
  return 'unknown';
}
function prelaunchScore(x){
  var kyc=prelaunchState(x.kycState),audit=prelaunchState(x.auditState),lp=prelaunchState(x.lpLockState);
  var tokenomics=prelaunchState(x.tokenomicsState),teamVerified=prelaunchState(x.teamVerifiedState);

  // PDF-derived model: evidence beats claims. Total = 100.
  var social=Math.max(0,Math.min(20,Number(x.socialScore||0)));
  var team=Math.max(0,Math.min(15,Number(x.teamScore||0)));
  var backing=Math.max(0,Math.min(10,Number(x.backingScore||0)));
  var launch=Math.max(0,Math.min(5,Number(x.launchScore||0)));

  var kycScore=kyc==='pass'?10:kyc==='planned'?2:0;
  var auditScore=audit==='pass'?15:audit==='planned'?3:0;
  var lpScore=lp==='pass'?15:lp==='planned'?2:0;
  var tokenomicsScore=tokenomics==='pass'?10:tokenomics==='planned'?3:0;
  var teamVerifyScore=teamVerified==='pass'?5:0;

  var score=Math.round(social+team+backing+launch+kycScore+auditScore+lpScore+tokenomicsScore+teamVerifyScore);
  var corePassed=[kyc,audit,lp].filter(function(s){return s==='pass'}).length;
  var fullVerified=corePassed===3&&teamVerified==='pass'&&tokenomics!=='fail';
  var evidenceCount=[
    social>0,team>0,backing>0,launch>0,
    kyc==='pass',audit==='pass',lp==='pass',tokenomics==='pass',teamVerified==='pass'
  ].filter(Boolean).length;

  var risk=
    kyc==='fail'||audit==='fail'||lp==='fail'||tokenomics==='fail'?'HIGH':
    fullVerified?'VERIFIED':
    corePassed>=2?'REVIEW':
    'INSUFFICIENT';

  var grade=fullVerified&&score>=80?'A':score>=65&&corePassed>=2?'B':score>=50?'C':'WATCH';

  return {
    ...x,score,grade,risk,evidenceCount,corePassed,fullVerified,
    kycState:kyc,auditState:audit,lpLockState:lp,tokenomicsState:tokenomics,teamVerifiedState:teamVerified,
    scoreBreakdown:{social,team,backing,launch,kyc:kycScore,audit:auditScore,lpLock:lpScore,tokenomics:tokenomicsScore,teamVerified:teamVerifyScore}
  };
}

function parsePrelaunchEnv(){
  try{
    const raw=process.env.PRELAUNCH_PROJECTS_JSON;
    if(!raw)return [];
    const arr=JSON.parse(raw);
    if(!Array.isArray(arr))return [];
    return arr.map(x=>prelaunchScore({
      name:String(x.name||'Unknown'),symbol:String(x.symbol||''),ecosystem:String(x.ecosystem||'Solana'),
      source:String(x.source||'Manual/verified feed'),sourceUrl:String(x.sourceUrl||x.website||''),website:String(x.website||''),
      launchpad:String(x.launchpad||''),socials:Array.isArray(x.socials)?x.socials:[],tge:String(x.tge||x.launchDate||''),mint:String(x.mint||x.tokenAddress||''),recommendedAt:String(x.recommendedAt||''),
      socialScore:Number(x.socialScore||0),teamScore:Number(x.teamScore||0),backingScore:Number(x.backingScore||0),launchScore:Number(x.launchScore||0),
      kycState:x.kycState||'unknown',auditState:x.auditState||'unknown',lpLockState:x.lpLockState||'unknown',
      tokenomicsState:x.tokenomicsState||'unknown',teamVerifiedState:x.teamVerifiedState||'unknown',
      auditProvider:String(x.auditProvider||''),kycProvider:String(x.kycProvider||''),lpLockProofUrl:String(x.lpLockProofUrl||''),
      socialEvidence:Array.isArray(x.socialEvidence)?x.socialEvidence:[],teamEvidence:Array.isArray(x.teamEvidence)?x.teamEvidence:[],
      securityEvidence:Array.isArray(x.securityEvidence)?x.securityEvidence:[],backingEvidence:Array.isArray(x.backingEvidence)?x.backingEvidence:[],
      launchEvidence:Array.isArray(x.launchEvidence)?x.launchEvidence:[],notes:String(x.notes||'')
    }));
  }catch{return []}
}

function parseRootDataPublicProjects(html){
  const out=[]; const source=String(html||'');
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(source))){
    const href=m[1],name=stripHtml(m[2]);
    if(!name||name.length<2||name.length>70)continue;
    if(!/\/projects|\/project|rootdata/i.test(href))continue;
    const around=stripHtml(source.slice(Math.max(0,m.index-900),Math.min(source.length,m.index+1700)));
    if(!/Solana/i.test(around))continue;
    if(!/(TGE|Token Issuance|token issuance|pre[- ]?TGE|launch|upcoming|not issued|planned)/i.test(around))continue;
    const hm=around.match(/(?:RD\s*(?:Popularity|Heat)\s*(?:Index)?|Popularity\s*Index)\s*[:：]?\s*([\d.]+)/i);
    const gm=around.match(/RD\s*Growth\s*(?:Index)?\s*[:：]?\s*([\d.]+)/i);
    const heat=hm?Number(hm[1]):0, growth=gm?Number(gm[1]):0;
    const transparencyA=/Transparency[^A-C]{0,20}A\b/i.test(around);
    const transparencyB=/Transparency[^A-C]{0,20}B\b/i.test(around);
    const hasTeam=/team|founder|co-founder|core contributor/i.test(around);
    const hasInvestor=/investor|funding|raised|seed round|series [abc]/i.test(around);
    const hasAudit=/audit|audited|security firm|multisig|multi-sig/i.test(around);
    const hasTokenomics=/tokenomics|vesting|cliff|allocation/i.test(around);
    const hasKyc=/\bKYC\b|identity verified|team verified/i.test(around);
    const auditVerified=/audit(?:ed)?\s+(?:by|report)|security audit|audit report/i.test(around);
    const lpVerified=/liquidity\s+(?:locked|burned)|LP\s+(?:locked|burned)|lock transaction|locker contract/i.test(around);
    const lpPlanned=/will\s+lock|planned\s+lock|lock\s+after\s+launch|post[- ]launch\s+lock/i.test(around);
    const teamVerified=/doxxed|verified team|named founder|linkedin/i.test(around);

    const socialScore=Math.min(30,Math.round((heat?Math.min(18,Math.log10(1+heat)*7):0)+(growth?Math.min(12,Math.log10(1+growth)*4):0)));
    out.push(prelaunchScore({
      name,symbol:'',ecosystem:'Solana',source:'RootData public',
      sourceUrl:href.startsWith('http')?href:'https://www.rootdata.com'+href,website:'',socials:[],tge:'',
      socialScore,teamScore:hasTeam?12:0,
      backingScore:hasInvestor?10:0,launchScore:/(TGE|Token Issuance|upcoming|launch)/i.test(around)?5:2,
      kycState:hasKyc?'planned':'unknown',
      auditState:auditVerified?'planned':hasAudit?'planned':'unknown',
      lpLockState:lpVerified?'planned':lpPlanned?'planned':'unknown',
      tokenomicsState:hasTokenomics?'planned':'unknown',
      teamVerifiedState:teamVerified?'planned':hasTeam?'planned':'unknown',
      socialEvidence:[heat?'RD Heat/Popularity '+heat:null,growth?'RD Growth '+growth:null].filter(Boolean),
      teamEvidence:hasTeam?['اطلاعات تیم در پروفایل عمومی دیده شد']:[],
      securityEvidence:[
        auditVerified?'Audit claim/report mention موجود':hasAudit?'Audit ادعا شده':null,
        hasKyc?'KYC claim موجود':null,
        lpVerified?'LP lock/burn claim موجود':lpPlanned?'LP lock فقط برای آینده وعده شده':null,
        hasTokenomics?'Tokenomics/Vesting قابل مشاهده':null,
        transparencyA?'Transparency A':transparencyB?'Transparency B':null
      ].filter(Boolean),
      backingEvidence:hasInvestor?['Funding/Investor evidence موجود']:[],
      notes:'امتیاز فقط از شواهد قابل استخراج عمومی ساخته شده؛ نبود داده امتیاز نمی‌گیرد.'
    }));
  }
  const seen=new Map();
  for(const x of out){const k=x.name.toLowerCase().replace(/\s+/g,' ').trim();const old=seen.get(k);if(!old||x.score>old.score)seen.set(k,x)}
  return [...seen.values()];
}

function normProjectText(v){
  return String(v||'').toLowerCase().replace(/[^a-z0-9آ-ی]+/g,'').trim();
}
function rememberPrelaunchProject(x){
  if(!x||!x.name)return;
  var key=normProjectText(x.name)+'|'+normProjectText(x.symbol);
  if(!key)return;
  var old=prelaunchWatchState.get(key)||{};
  prelaunchWatchState.set(key,{
    ...old,...x,
    firstRecommendedAt:old.firstRecommendedAt||x.recommendedAt||new Date().toISOString(),
    lastSeenPrelaunchAt:new Date().toISOString()
  });
}
function findLaunchedMintForProject(x){
  var direct=String(x?.mint||'').trim();
  if(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(direct))return direct;

  var nn=normProjectText(x?.name),ss=normProjectText(x?.symbol);
  var candidates=(cache.data?.tokens||[]).filter(function(t){
    var nameOk=nn&&normProjectText(t.name)===nn;
    var symbolOk=ss&&normProjectText(t.symbol)===ss;
    return ss?nameOk&&symbolOk:nameOk;
  });
  return candidates.length===1?candidates[0].mint:'';
}
async function firstPoolPrice(pair){
  var pool=String(pair?.pairAddress||'').trim();
  var createdMs=num(pair?.pairCreatedAt);
  if(!pool||!createdMs)return null;
  var createdSec=Math.floor(createdMs/1000);
  var key=pool+'|'+createdSec;
  var hit=launchPerfCache.get(key);
  if(hit&&Date.now()-hit.at<30*60*1000)return hit.data;

  var before=createdSec+6*3600;
  var u='https://api.geckoterminal.com/api/v2/networks/solana/pools/'+encodeURIComponent(pool)+'/ohlcv/minute?aggregate=1&before_timestamp='+before+'&limit=1000';
  try{
    var d=await jfetch(u,{},12000);
    var rows=d?.data?.attributes?.ohlcv_list||[];
    rows=rows.map(function(r){return {ts:num(r?.[0]),open:num(r?.[1]),high:num(r?.[2]),low:num(r?.[3]),close:num(r?.[4]),volume:num(r?.[5])}})
      .filter(function(r){return r.ts&&r.open>0})
      .sort(function(a,b){return a.ts-b.ts});
    var first=rows.find(function(r){return r.ts>=createdSec-120&&r.ts<=createdSec+6*3600})||rows[0]||null;
    var data=first?{price:first.open,ts:first.ts*1000,source:'GeckoTerminal OHLCV'}:null;
    launchPerfCache.set(key,{at:Date.now(),data});
    return data;
  }catch{
    launchPerfCache.set(key,{at:Date.now(),data:null});
    return null;
  }
}
async function launchPerformanceForProject(x){
  var mint=findLaunchedMintForProject(x);
  if(!mint)return {launched:false,mint:''};
  var p=await pairFor(mint);
  if(!p||!num(p.priceUsd)||!num(p.pairCreatedAt))return {launched:false,mint};
  var first=await firstPoolPrice(p);
  var current=num(p.priceUsd),createdAt=num(p.pairCreatedAt);
  if(!first||!first.price){
    return {launched:true,mint,createdAt,currentPrice:current,launchPrice:null,growthPct:null,source:'DexScreener current; launch OHLCV unavailable',dexUrl:p.url||''};
  }
  var growth=(current/first.price-1)*100;
  return {
    launched:true,mint,createdAt,currentPrice:current,launchPrice:first.price,
    launchPriceAt:first.ts,growthPct:+growth.toFixed(2),
    source:first.source,dexUrl:p.url||''
  };
}


function parsePrelaunchWatchCandidates(html,sourceName,baseUrl,options={}){
  const out=[],src=String(html||'');
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const sourceSolana=options.sourceSolana===true;
  const allowUnconfirmed=options.allowUnconfirmed===true;
  let m;
  while((m=re.exec(src))){
    const href=String(m[1]||''),name=stripHtml(m[2]).replace(/\s+/g,' ').trim();
    if(!name||name.length<2||name.length>90)continue;
    if(/^(home|login|sign in|learn more|read more|projects?|calendar|launchpad|all|upcoming|live|closed)$/i.test(name))continue;

    const around=stripHtml(src.slice(Math.max(0,m.index-1800),Math.min(src.length,m.index+3200)));
    const prelaunchHint=/(TGE|token generation|token public offering|token sale|presale|pre-sale|upcoming|launch date|launching|not launched|not issued|IDO|IEO|allowlist open|fundraise goal)/i.test(around);
    if(!prelaunchHint)continue;

    const explicitSolana=/\bSolana\b|\bSOL\b/i.test(around);
    const solanaConfirmed=sourceSolana||explicitSolana;
    if(!solanaConfirmed&&!allowUnconfirmed)continue;

    const hasTeam=/founder|co-founder|team|doxxed|linkedin/i.test(around);
    const hasBacking=/investor|backed by|funding|raised|seed|venture|fundraise goal/i.test(around);
    const hasTokenomics=/tokenomics|vesting|allocation|cliff/i.test(around);
    const hasAudit=/audit|audited|certik|solidproof|security audit/i.test(around);
    const hasKyc=/\bKYC\b|identity verified|team verified/i.test(around);
    const socialBuzz=/trending|popular|heat|community|followers|mentions|allowlist open/i.test(around);

    out.push(prelaunchScore({
      name,symbol:'',ecosystem:solanaConfirmed?'Solana':'UNCONFIRMED',
      solanaConfirmed:solanaConfirmed,
      source:sourceName,
      sourceUrl:href.startsWith('http')?href:(baseUrl||'')+href,
      website:'',launchpad:sourceName,socials:[],tge:'',
      socialScore:socialBuzz?10:4,
      teamScore:hasTeam?9:3,
      backingScore:hasBacking?7:0,
      launchScore:5,
      kycState:hasKyc?'planned':'unknown',
      auditState:hasAudit?'planned':'unknown',
      lpLockState:'unknown',
      tokenomicsState:hasTokenomics?'planned':'unknown',
      teamVerifiedState:hasTeam?'planned':'unknown',
      socialEvidence:socialBuzz?['نشانه ترند/جامعه در منبع عمومی']:[],
      teamEvidence:hasTeam?['اطلاعات تیم در منبع عمومی دیده شد']:[],
      securityEvidence:[
        hasAudit?'Audit mention/claim — نیازمند تأیید مستقل':null,
        hasKyc?'KYC mention/claim — نیازمند تأیید مستقل':null,
        hasTokenomics?'Tokenomics/Vesting mention موجود':null,
        solanaConfirmed?'اکوسیستم Solana در منبع تأیید شد':'اکوسیستم Solana هنوز تأیید نشده'
      ].filter(Boolean),
      backingEvidence:hasBacking?['Investor/Funding mention موجود']:[],
      launchEvidence:['Upcoming/TGE/Presale evidence در '+sourceName],
      notes:solanaConfirmed
        ?'Watch Candidate سولانا؛ ادعاها تا قبل از مدرک مستقل امتیاز تأیید کامل نمی‌گیرند.'
        :'Watch Candidate عمومی؛ تا تأیید اکوسیستم Solana فقط برای بررسی نمایش داده می‌شود.'
    }));
  }
  const seen=new Map();
  for(const x of out){
    const k=String(x.name||'').toLowerCase().replace(/\s+/g,' ').trim();
    const old=seen.get(k);if(!old||Number(x.score||0)>Number(old.score||0))seen.set(k,x);
  }
  return [...seen.values()].slice(0,50);
}

function parseRootDataCalendarWatch(html){
  const txt=String(html||'');
  const out=[];
  // Re-use anchor parser with unconfirmed ecosystem allowed. RootData Calendar
  // explicitly lists Token Public Offerings/TGE events, but ecosystem may not
  // appear in the compact event row.
  out.push(...parsePrelaunchWatchCandidates(
    txt,'RootData Calendar','https://www.rootdata.com',
    {allowUnconfirmed:true}
  ));
  return out;
}


function normalizePumpLeaderboardRows(d){
  const arr=Array.isArray(d)?d:
    Array.isArray(d?.data)?d.data:
    Array.isArray(d?.results)?d.results:
    Array.isArray(d?.leaderboard)?d.leaderboard:
    Array.isArray(d?.entries)?d.entries:[];
  return arr.map(function(x,i){
    const u=x?.user||x?.profile||x?.trader||{};
    const wallet=String(x?.wallet||x?.address||x?.solanaAddress||u?.address||u?.canonical_svm_wallet||'');
    const userId=String(x?.userId||x?.user_id||u?.id||u?.userId||wallet||'');
    const username=String(x?.username||u?.username||x?.displayName||u?.displayName||short(wallet)||'Trader');
    const pnlUsd=num(x?.pnlUsd??x?.pnl_usd??x?.profitUsd??x?.profit_usd??x?.profit??x?.pnl);
    const pnlSol=num(x?.pnlSol??x?.pnl_sol);
    const rank=num(x?.rank,i+1);
    const topPositions=Array.isArray(x?.topPositions)?x.topPositions:Array.isArray(x?.positions)?x.positions:[];
    return {rank,userId,wallet,username,pnlUsd,pnlSol,topPositions,source:'Pump.fun official API'};
  }).filter(x=>x.userId||x.wallet||x.username);
}

function parsePumpPublicLeaderboard(html){
  const txt=stripHtml(html);
  const out=[];
  // Public fallback: only publish rows when a rank, name and profit can be tied together.
  const re=/(?:^|\s)(\d{1,3})\s+(?:Image)?([A-Za-z0-9_.-]{2,32})\s+([1-9A-HJ-NP-Za-km-z]{4})…([1-9A-HJ-NP-Za-km-z]{4})\s+\+?\$([\d,.]+)/g;
  let m;
  while((m=re.exec(txt))&&out.length<50){
    out.push({
      rank:num(m[1]),username:m[2],walletShort:m[3]+'…'+m[4],
      wallet:'',userId:'',pnlUsd:humanNum(m[5]),pnlSol:0,topPositions:[],
      source:'Pump.fun public leaderboard'
    });
  }
  return out;
}

function pumpPortfolioPositions(d){
  const arr=Array.isArray(d)?d:
    Array.isArray(d?.positions)?d.positions:
    Array.isArray(d?.data?.positions)?d.data.positions:
    Array.isArray(d?.data)?d.data:[];
  return arr.map(function(x){
    const coin=x?.coin||x?.token||{};
    return {
      mint:String(x?.mint||coin?.mint||coin?.address||''),
      symbol:String(x?.symbol||coin?.symbol||'?'),
      name:String(x?.name||coin?.name||''),
      valueUsd:num(x?.valueUsd??x?.value_usd??x?.currentValueUsd??x?.current_value_usd),
      pnlUsd:num(x?.pnlUsd??x?.pnl_usd??x?.profitUsd??x?.profit_usd),
      unrealizedPnlUsd:num(x?.unrealizedPnlUsd??x?.unrealized_pnl_usd),
      amount:num(x?.amount??x?.balance),
      status:String(x?.status||'open')
    };
  }).filter(x=>x.mint&&((x.valueUsd>0)||x.amount>0||/open/i.test(x.status)));
}

function pumpRecentTrades(d){
  const arr=Array.isArray(d)?d:
    Array.isArray(d?.trades)?d.trades:
    Array.isArray(d?.data?.trades)?d.data.trades:
    Array.isArray(d?.data)?d.data:[];
  return arr.map(function(x){
    const coin=x?.coin||x?.token||{};
    return {
      mint:String(x?.mint||coin?.mint||coin?.address||''),
      symbol:String(x?.symbol||coin?.symbol||'?'),
      side:String(x?.side||x?.type||'').toUpperCase(),
      usd:num(x?.usd??x?.usdValue??x?.valueUsd??x?.value_usd),
      sol:num(x?.sol??x?.solAmount??x?.amountSol),
      ts:normalizeTs(x?.timestamp||x?.createdAt||x?.created_at||x?.ts||0)
    };
  }).filter(x=>x.mint&&['BUY','SELL'].includes(x.side));
}

async function buildPumpTraderIntel(){
  if(pumpTraderIntelCache.data&&Date.now()-pumpTraderIntelCache.at<PUMP_TRADER_INTEL_CACHE_MS)return pumpTraderIntelCache.data;
  const key=process.env.PUMP_FUN_API_KEY;
  let leaders=[],mode='public-leaderboard',apiError=null;

  if(key){
    try{
      const board=await jfetch(
        'https://api.pump.fun/v1/pnl-leaderboard?period=weekly&limit=25',
        {headers:{authorization:'Bearer '+key}},
        12000
      );
      leaders=normalizePumpLeaderboardRows(board).slice(0,15);
      mode='official-api';

      // Enrich only the top profitable traders to control rate limits.
      for(const tr of leaders.slice(0,8)){
        if(!tr.userId)continue;
        const [portfolioR,tradesR]=await Promise.allSettled([
          jfetch('https://api.pump.fun/v1/user-portfolio/'+encodeURIComponent(tr.userId),{headers:{authorization:'Bearer '+key}},10000),
          jfetch('https://api.pump.fun/v1/user-trades/'+encodeURIComponent(tr.userId)+'?limit=30',{headers:{authorization:'Bearer '+key}},10000)
        ]);
        tr.positions=portfolioR.status==='fulfilled'?pumpPortfolioPositions(portfolioR.value).slice(0,20):[];
        tr.recentTrades=tradesR.status==='fulfilled'?pumpRecentTrades(tradesR.value).slice(0,30):[];
        tr.currentBuys=tr.recentTrades.filter(x=>x.side==='BUY').slice(0,10);
      }
    }catch(e){
      apiError=String(e?.message||e);
      leaders=[];
    }
  }

  if(!leaders.length){
    try{
      leaders=parsePumpPublicLeaderboard(await tfetch('https://pump.fun/leaderboard',{},12000)).slice(0,25);
    }catch(e){
      if(!apiError)apiError=String(e?.message||e);
    }
  }

  const mintHeat=new Map();
  for(const tr of leaders){
    for(const p of (tr.positions||[])){
      if(!p.mint)continue;
      const a=mintHeat.get(p.mint)||{mint:p.mint,symbol:p.symbol||'?',traders:0,totalValueUsd:0,totalPnlUsd:0,buyingTraders:0,names:[]};
      a.traders++;a.totalValueUsd+=num(p.valueUsd);a.totalPnlUsd+=num(p.pnlUsd)+num(p.unrealizedPnlUsd);a.names.push(tr.username);
      mintHeat.set(p.mint,a);
    }
    const recentBuyMints=new Set((tr.currentBuys||[]).filter(x=>Date.now()-x.ts<=6*60*60*1000).map(x=>x.mint));
    for(const mint of recentBuyMints){
      const a=mintHeat.get(mint)||{mint,symbol:'?',traders:0,totalValueUsd:0,totalPnlUsd:0,buyingTraders:0,names:[]};
      a.buyingTraders++;a.names.push(tr.username);
      mintHeat.set(mint,a);
    }
  }
  const hotMints=[...mintHeat.values()].sort((a,b)=>(b.buyingTraders-a.buyingTraders)||(b.traders-a.traders)||(b.totalValueUsd-a.totalValueUsd)).slice(0,30);
  const data={
    ok:true,configured:!!key,mode,generatedAt:new Date().toISOString(),
    leaders,hotMints,apiError,
    disclaimer:'رتبه سود گذشته تضمین عملکرد آینده نیست. Portfolio/Trades رسمی فقط وقتی PUMP_FUN_API_KEY با scopeهای leaderboards.read و positions.read فعال باشد نمایش داده می‌شود.'
  };
  pumpTraderIntelCache={at:Date.now(),data};
  return data;
}

// ---------- SolidProof public intelligence ----------
function parseSolidProofSolana(html,sourceName){
  const out=[],src=String(html||'');
  const re=/<a\b[^>]*href=["']([^"']*\/projects\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(src))&&out.length<80){
    const around=stripHtml(src.slice(Math.max(0,m.index-900),Math.min(src.length,m.index+2600)));
    if(!/Solana\s*-\s*Mainnet/i.test(around))continue;
    const name=stripHtml(m[2]).replace(/\s+/g,' ').trim();
    if(!name||name.length>90)continue;
    const scoreM=around.match(/(?:Security Score|TrustNet Score)?\s*(\d{1,3}(?:\.\d{1,2})?)/i);
    const score=scoreM?num(scoreM[1]):null;
    const audited=/Contract Audited|Audit Badge|Audited/i.test(around);
    const kyc=/KYC Badge|KYC Verified|Only with KYC/i.test(around);
    const prelaunch=/Pre-?launch|Launches|Upcoming/i.test(around);
    out.push({
      name,score,audited,kyc,prelaunch,ecosystem:'Solana',
      source:sourceName||'SolidProof TrustNet',
      url:m[1].startsWith('http')?m[1]:'https://app.solidproof.io'+m[1]
    });
  }
  const seen=new Map();
  for(const x of out){if(!seen.has(x.name.toLowerCase()))seen.set(x.name.toLowerCase(),x)}
  return [...seen.values()];
}

async function buildSolidProofIntel(){
  if(solidProofIntelCache.data&&Date.now()-solidProofIntelCache.at<SOLIDPROOF_INTEL_CACHE_MS)return solidProofIntelCache.data;
  let rows=[],error=null;
  try{
    const rs=await Promise.allSettled([
      tfetch('https://app.solidproof.io/board/trending',{},12000),
      tfetch('https://app.solidproof.io/',{},12000)
    ]);
    if(rs[0].status==='fulfilled')rows.push(...parseSolidProofSolana(rs[0].value,'SolidProof Trending'));
    if(rs[1].status==='fulfilled')rows.push(...parseSolidProofSolana(rs[1].value,'SolidProof Discovery'));
  }catch(e){error=String(e?.message||e)}
  const seen=new Map();
  for(const x of rows){
    const k=x.name.toLowerCase();
    const old=seen.get(k);
    if(!old||(num(x.score)>num(old.score)))seen.set(k,x);
  }
  rows=[...seen.values()].sort((a,b)=>num(b.score)-num(a.score));
  const data={ok:true,generatedAt:new Date().toISOString(),rows:rows.slice(0,30),error};
  solidProofIntelCache={at:Date.now(),data};return data;
}

function earlyLaunchScore(t,pumpIntel){
  if(!t)return 0;
  const sec=t.security||{},fl=t.flow||{},act=t.activity||{},sh=t.socialHeat||{};
  const ph=(pumpIntel?.hotMints||[]).find(x=>x.mint===t.mint);
  let s=0;
  if(sec.tier==='MAX SECURITY')s+=32;
  else if(sec.tier==='HIGH')s+=25;
  else if(sec.tier==='REVIEW')s+=10;
  if(sec.mintDisabled===true)s+=6;
  if(sec.freezeDisabled===true)s+=6;
  if(sec.holderPolicyPassed===true)s+=10;
  if(act.label==='PROBABLE ORGANIC')s+=8;
  if(Number(fl.buyerPower||0)>50)s+=Math.min(10,(Number(fl.buyerPower)-50)/2);
  s+=Math.min(8,Number(sh.score||0)/12.5);
  if(Number(t.liquidity||0)>=10000)s+=5;
  if(ph){
    s+=Math.min(8,Number(ph.buyingTraders||0)*3+Number(ph.traders||0));
  }
  return clamp(Math.round(s));
}

async function buildEarlyLaunchCandidates(pumpIntel){
  let tokenRows=cache.data?.tokens||[];
  if(!tokenRows.length){
    try{tokenRows=(await build())?.tokens||[]}catch{}
  }
  const live=liveSmartMoneyPayload();
  return tokenRows.filter(function(t){
    return Number(t.ageMinutes||0)<=24*60 &&
      (String(t.mint||'').toLowerCase().endsWith('pump')||String(t.dexId||'').toLowerCase().includes('pump')||siteTrendSources(t).length>0);
  }).map(function(t){
    const ph=(pumpIntel?.hotMints||[]).find(x=>x.mint===t.mint)||null;
    const wh=(live.whaleByToken||[]).find(x=>x.tokenAddress===t.mint)||null;
    const tr=(trackedWalletCache?.data?.tokens||[]).find(x=>x.mint===t.mint)||null;
    return {
      mint:t.mint,name:t.name,symbol:t.symbol,priceUsd:t.priceUsd,marketCap:t.marketCap,liquidity:t.liquidity,
      ageMinutes:t.ageMinutes,dexUrl:t.dexUrl,security:t.security,activity:t.activity,flow:t.flow,socialHeat:t.socialHeat,
      traderIntel:ph,whale:wh,tracked:tr,
      score:earlyLaunchScore(t,pumpIntel),
      label:(t.security?.tier==='MAX SECURITY'||t.security?.tier==='HIGH')&&t.security?.holderPolicyPassed===true?'قابل بررسی جدی':'Watch'
    };
  }).sort((a,b)=>b.score-a.score).slice(0,20);
}

async function buildPrelaunchRadar(){
  if(prelaunchCache.data&&Date.now()-prelaunchCache.at<PRELAUNCH_CACHE_MS)return prelaunchCache.data;
  const [pumpIntel,solidProofIntel]=await Promise.all([
    buildPumpTraderIntel().catch(()=>({ok:false,leaders:[],hotMints:[]})),
    buildSolidProofIntel().catch(()=>({ok:false,rows:[]}))
  ]);
  const manual=parsePrelaunchEnv(); let publicRows=[]; let sourceError=null;
  try{
    const results=await Promise.allSettled([
      tfetch('https://www.rootdata.com/projects',{},12000),
      tfetch('https://www.rootdata.com/calendar',{},12000),
      tfetch('https://polkastarter.com/projects',{},12000),
      tfetch('https://www.pinksale.finance/solana/launchpads/contribution',{},12000)
    ]);
    const projectsHtml=results[0].status==='fulfilled'?results[0].value:'';
    const calendarHtml=results[1].status==='fulfilled'?results[1].value:'';
    const polkaHtml=results[2].status==='fulfilled'?results[2].value:'';
    const pinkHtml=results[3].status==='fulfilled'?results[3].value:'';
    publicRows=[
      ...parseRootDataPublicProjects(projectsHtml),
      ...parseRootDataCalendarWatch(calendarHtml),
      ...parsePrelaunchWatchCandidates(polkaHtml,'Polkastarter','https://polkastarter.com',{allowUnconfirmed:true}),
      ...parsePrelaunchWatchCandidates(pinkHtml,'PinkSale Solana','https://www.pinksale.finance',{sourceSolana:true})
    ];
    // SolidProof Solana entries add independent audit/KYC/security-score evidence.
    for(const sp of (solidProofIntel.rows||[])){
      publicRows.push(prelaunchScore({
        name:sp.name,symbol:'',ecosystem:'Solana',solanaConfirmed:true,
        source:sp.source,sourceUrl:sp.url,website:'',launchpad:'SolidProof TrustNet',socials:[],tge:'',
        socialScore:0,teamScore:sp.kyc?10:4,backingScore:0,launchScore:sp.prelaunch?5:1,
        kycState:sp.kyc?'pass':'unknown',auditState:sp.audited?'pass':'unknown',
        lpLockState:'unknown',tokenomicsState:'unknown',teamVerifiedState:sp.kyc?'pass':'unknown',
        socialEvidence:[],teamEvidence:sp.kyc?['SolidProof KYC badge']:[],
        securityEvidence:[
          sp.audited?'SolidProof Contract Audited':null,
          sp.score!=null?'SolidProof Security Score '+sp.score:null
        ].filter(Boolean),
        backingEvidence:[],launchEvidence:sp.prelaunch?['SolidProof Pre-launch/Launch listing']:[],
        notes:'شواهد مستقل SolidProof؛ Audit/KYC تضمین سود یا نبود ریسک نیست.',
        externalSiteScore:sp.score
      }));
    }
    const cal=stripHtml(calendarHtml);
    for(const x of publicRows){
      const key=String(x.name||'').toLowerCase();
      if(key&&cal.toLowerCase().includes(key)&&/(TGE|Token Public Offering|Token Issuance|launch)/i.test(cal)){
        x.launchScore=Math.min(10,Number(x.launchScore||0)+3);x.launchEvidence=['RootData Calendar launch/TGE evidence'];
        Object.assign(x,prelaunchScore(x));
      }
    }
  }catch(e){sourceError=String(e?.message||e)}

  const byName=new Map();
  for(const x of [...manual,...publicRows]){
    const k=String(x.name||'').toLowerCase().trim();if(!k)continue;
    const old=byName.get(k);if(!old||Number(x.score||0)>Number(old.score||0))byName.set(k,x);
  }

  const allCandidates=[...byName.values()]
    .sort((a,b)=>{
      const as=(x=>x.solanaConfirmed===true||/solana/i.test(String(x.ecosystem||''))?1:0)(a);
      const bs=(x=>x.solanaConfirmed===true||/solana/i.test(String(x.ecosystem||''))?1:0)(b);
      return (bs-as)||(Number(b.score||0)-Number(a.score||0))||(Number(b.socialScore||0)-Number(a.socialScore||0));
    });
  const projects=allCandidates
    .filter(x=>x.solanaConfirmed===true||/solana/i.test(String(x.ecosystem||'')))
    .slice(0,50);
  const watchUnconfirmed=allCandidates
    .filter(x=>!(x.solanaConfirmed===true||/solana/i.test(String(x.ecosystem||''))))
    .slice(0,20);

  // Keep a watch record so a recommendation can still be evaluated after it leaves pre-launch lists.
  projects.forEach(rememberPrelaunchProject);

  const watched=[...prelaunchWatchState.values()];
  const launched=[];
  for(const x of watched.slice(0,30)){
    const perf=await launchPerformanceForProject(x);
    if(perf.launched){
      launched.push({
        name:x.name,symbol:x.symbol||'',firstRecommendedAt:x.firstRecommendedAt||x.recommendedAt||'',
        prelaunchScore:Number(x.score||0),prelaunchGrade:x.grade||'WATCH',
        prelaunchRisk:x.risk||'',...perf
      });
      await sleep(40);
    }
  }
  launched.sort((a,b)=>Number(b.growthPct??-1e9)-Number(a.growthPct??-1e9));

  const suggestedConfirmed=projects.filter(x=>x.risk!=='HIGH').sort((a,b)=>{
    const ar=a.fullVerified?3:a.corePassed>=2?2:Number(a.score||0)>=35?1:0;
    const br=b.fullVerified?3:b.corePassed>=2?2:Number(b.score||0)>=35?1:0;
    return (br-ar)||(Number(b.score||0)-Number(a.score||0));
  });
  const suggested=suggestedConfirmed.length
    ?suggestedConfirmed.slice(0,12)
    :watchUnconfirmed.filter(x=>x.risk!=='HIGH').slice(0,12).map(x=>({...x,ecosystem:'نیازمند تأیید Solana',solanaConfirmed:false}));
  const earlyLaunch=await buildEarlyLaunchCandidates(pumpIntel).catch(()=>[]);
  const data={
    ok:true,generatedAt:new Date().toISOString(),projects,suggested,watchUnconfirmed,launched,earlyLaunch,pumpIntel,solidProofIntel,sourceError,
    sourceDiagnostics:{
      manual:manual.length,
      publicRows:publicRows.length,
      confirmedSolana:projects.length,
      unconfirmedWatch:watchUnconfirmed.length
    },
    scoring:{social:20,team:15,teamVerified:5,kyc:10,audit:15,lpLock:15,tokenomics:10,backing:10,launchTransparency:5},
    policy:{
      prelaunchOnly:true,noOnchainSecurityClaim:true,evidenceRequired:true,
      performance:'بعد از لانچ، رشد از اولین کندل OHLCV قابل‌دریافت نزدیک زمان ساخت Pair تا قیمت فعلی محاسبه می‌شود.',
      note:'قبل از TGE امنیت آن‌چین هولدر/Mint/Freeze قابل سنجش کامل نیست. KYC، Audit مستقل و LP Lock قابل‌اثبات سه شرط اصلی‌اند؛ وعده قفل LP یا نشان KYC به‌تنهایی تضمین امنیت نیست.'
    }
  };
  prelaunchCache={at:Date.now(),data};return data;
}


async function buildPrelaunchLive(){
  const launched=Array.isArray(prelaunchCache.data?.launched)?prelaunchCache.data.launched:[];
  const mints=[...new Set(launched.map(x=>x.mint).filter(Boolean))];
  if(!mints.length)return {ok:true,generatedAt:new Date().toISOString(),tokens:[]};
  let pairs=new Map();
  try{pairs=await pairsForMany(mints)}catch{}
  const tokens=launched.map(x=>{
    const p=pairs.get(x.mint);
    const current=p?num(p.priceUsd):num(x.currentPrice);
    const base=num(x.launchPrice);
    const growthPct=current>0&&base>0?+(((current-base)/base)*100).toFixed(4):null;
    return {mint:x.mint,currentPrice:current,growthPct,dexUrl:p?.url||x.dexUrl||'',updatedAt:Date.now()};
  });
  return {ok:true,generatedAt:new Date().toISOString(),tokens};
}

async function discovery(){
  const urls=[
    'https://api.dexscreener.com/token-profiles/latest/v1',
    'https://api.dexscreener.com/token-boosts/latest/v1',
    'https://api.dexscreener.com/token-boosts/top/v1'
  ];

  const blank=mint=>({mint,description:'',image:'',links:[],boostAmount:0,boostTotal:0,boostSeen:false,profileSeen:false,kolTrend:null,discoverySources:[]});
  const m=new Map();
  const addMint=(mint,patch={})=>{
    if(!mint||typeof mint!=='string')return;
    const old=m.get(mint)||blank(mint);
    Object.assign(old,patch);
    old.discoverySources=[...new Set([...(old.discoverySources||[]),...(patch.discoverySources||[])])];
    m.set(mint,old);
  };

  const [sets,kol,gtTrend,gtNew]=await Promise.all([
    Promise.allSettled(urls.map(u=>jfetch(u))),
    kolTrendDiscovery(),
    jfetch('https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1',{},12000).catch(()=>null),
    jfetch('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',{},12000).catch(()=>null)
  ]);

  sets.forEach((r,idx)=>{
    if(r.status!=='fulfilled')return;
    for(const x of (Array.isArray(r.value)?r.value:[])){
      if(x.chainId!=='solana'||!x.tokenAddress)continue;
      const old=m.get(x.tokenAddress)||blank(x.tokenAddress);
      old.description=x.description||old.description;
      old.image=x.icon||old.image;
      old.links=Array.isArray(x.links)&&x.links.length?x.links:old.links;
      if(idx===0)old.profileSeen=true;
      else {
        old.boostSeen=true;
        old.boostAmount=Math.max(old.boostAmount,num(x.amount));
        old.boostTotal=Math.max(old.boostTotal,num(x.totalAmount));
      }
      old.discoverySources=[...new Set([...(old.discoverySources||[]),'DEXScreener'])];
      m.set(x.tokenAddress,old);
    }
  });

  for(const k of (kol?.tokens||[])){
    const old=m.get(k.mint)||blank(k.mint);
    old.kolTrend=k;
    old.discoverySources=[...new Set([...(old.discoverySources||[]),'KOL'])];
    m.set(k.mint,old);
  }

  // GeckoTerminal fallback/secondary discovery. Public endpoint, no API key required.
  const ingestGt=(payload,label)=>{
    for(const row of (payload?.data||[])){
      const rel=row?.relationships||{};
      const ids=[
        rel?.base_token?.data?.id,
        rel?.quote_token?.data?.id
      ].filter(Boolean);
      for(const id of ids){
        const mint=String(id).replace(/^solana_/,'');
        if(!mint||mint===WSOL_MINT||STABLE_MINTS.has(mint))continue;
        addMint(mint,{discoverySources:[label]});
      }
    }
  };
  ingestGt(gtTrend,'GeckoTerminal Trending');
  ingestGt(gtNew,'GeckoTerminal New Pools');

  // Live whale stream is also a valid discovery source.
  for(const e of (liveFomoState.events||[]).slice(0,120)){
    const mint=e?.tokenAddress;
    if(mint)addMint(mint,{discoverySources:['Live whale stream']});
  }

  const raw=[...m.values()].slice(0,180);
  let pairs=new Map();
  try{pairs=await pairsForMany(raw.map(x=>x.mint))}catch{}

  for(const s of raw){
    const p=pairs.get(s.mint);
    if(!p){s.marketDiscoveryScore=0;continue}
    const b5=num(p.txns?.m5?.buys),s5=num(p.txns?.m5?.sells),n5=b5+s5;
    const b1=num(p.txns?.h1?.buys),s1=num(p.txns?.h1?.sells),n1=b1+s1;
    const buyer5=n5?b5/n5*100:50;
    const buyer1=n1?b1/n1*100:50;
    const liq=num(p.liquidity?.usd),v5=num(p.volume?.m5),pc5=num(p.priceChange?.m5);
    let ms=0;
    if(buyer5>50)ms+=(buyer5-50)*1.4;
    if(buyer1>50)ms+=(buyer1-50)*0.5;
    ms+=Math.min(20,n5/8);
    ms+=Math.min(18,v5/1500);
    if(liq>=3000)ms+=5;if(liq>=10000)ms+=4;
    if(pc5>80)ms-=6;
    if((s.discoverySources||[]).includes('GeckoTerminal Trending'))ms+=8;
    if((s.discoverySources||[]).includes('Live whale stream'))ms+=10;
    s.marketDiscoveryScore=Math.round(ms);
    s.discoveryBuyer5=+buyer5.toFixed(1);
    s.discoveryBuyer1=+buyer1.toFixed(1);
    s.discoveryVolume5m=v5;
    s.discoveryLiquidity=liq;
  }

  // IMPORTANT: never discard discovery candidates solely because the DEXScreener
  // batch endpoint missed them. buildFresh() performs an exact token-pairs lookup
  // for every seed. A temporary batch rate-limit/incomplete response must not make
  // the whole radar return zero tokens.
  return raw.sort((a,b)=>{
    const ap=pairs.has(a.mint)?1:0,bp=pairs.has(b.mint)?1:0;
    if(bp!==ap)return bp-ap;
    const ma=num(a.marketDiscoveryScore),mb=num(b.marketDiscoveryScore);
    if(mb!==ma)return mb-ma;
    const ka=num(a.kolTrend?.score),kb=num(b.kolTrend?.score);
    if(kb!==ka)return kb-ka;
    if(a.profileSeen&&!b.profileSeen)return -1;if(b.profileSeen&&!a.profileSeen)return 1;
    return num(b.boostTotal)-num(a.boostTotal);
  }).slice(0,120);
}
async function pairFor(mint){
  try{
    const rows=await jfetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,{},12000);
    return chooseCanonicalPair(Array.isArray(rows)?rows:[],mint);
  }catch{return null}
}
async function exactDexPrice(mint){
  const hit=exactDexPriceCache.get(mint);
  if(hit&&Date.now()-hit.at<EXACT_DEX_PRICE_CACHE_MS)return hit.data;

  let rows=[];
  // Use DEXScreener's token-by-contract endpoint first. This is the closest
  // server-side equivalent to the pairs shown for that exact contract on DEXScreener.
  try{
    const d=await jfetch('https://api.dexscreener.com/latest/dex/tokens/'+encodeURIComponent(mint),{},10000);
    rows=Array.isArray(d?.pairs)?d.pairs:[];
  }catch{}

  // Fallback to Solana token-pairs if the first endpoint is temporarily unavailable.
  if(!rows.length){
    try{
      const d=await jfetch('https://api.dexscreener.com/token-pairs/v1/solana/'+encodeURIComponent(mint),{},10000);
      rows=Array.isArray(d)?d:[];
    }catch{}
  }

  rows=rows.filter(function(p){
    return String(p?.chainId||'').toLowerCase()==='solana' &&
      String(p?.baseToken?.address||'')===String(mint) &&
      num(p?.priceUsd)>0;
  });
  if(!rows.length)return null;

  // Match DEXScreener's visible market as closely as possible.
  // Pump.fun mints can have a bonding-curve market with little/no LP plus unrelated
  // secondary pools. If DEXScreener exposes a pumpfun market for a ...pump mint,
  // use that market instead of a secondary pool with a different price.
  const looksPump=String(mint||'').toLowerCase().endsWith('pump');
  const pumpRows=rows.filter(function(p){
    return String(p?.dexId||'').toLowerCase()==='pumpfun';
  });
  if(looksPump&&pumpRows.length)rows=pumpRows;

  rows.sort(function(a,b){
    // Prefer the market with the most recent trading activity first.
    const atx=num(a?.txns?.m5?.buys)+num(a?.txns?.m5?.sells);
    const btx=num(b?.txns?.m5?.buys)+num(b?.txns?.m5?.sells);
    if(btx!==atx)return btx-atx;
    const av5=num(a?.volume?.m5),bv5=num(b?.volume?.m5);
    if(bv5!==av5)return bv5-av5;
    const al=num(a?.liquidity?.usd),bl=num(b?.liquidity?.usd);
    if(bl!==al)return bl-al;
    return num(b?.volume?.h24)-num(a?.volume?.h24);
  });
  const p=rows[0];
  const data={
    mint,
    priceUsd:num(p.priceUsd),
    pairAddress:String(p.pairAddress||''),
    dexId:String(p.dexId||''),
    dexUrl:String(p.url||''),
    quoteTokenAddress:String(p?.quoteToken?.address||''),
    quoteTokenSymbol:String(p?.quoteToken?.symbol||''),
    liquidity:num(p?.liquidity?.usd),
    volume24h:num(p?.volume?.h24),
    observedAt:Date.now(),
    source:'DEXScreener exact contract'
  };
  exactDexPriceCache.set(mint,{at:Date.now(),data});
  return data;
}

async function pumpFunCoin(mint){
  // Official keyed API, when configured.
  const key=process.env.PUMP_FUN_API_KEY;
  if(key){
    try{
      const d=await jfetch(
        'https://api.pump.fun/v1/search/resolve?identifiers='+encodeURIComponent(mint),
        {headers:{authorization:'Bearer '+key}},
        8000
      );
      const row=(d?.results||[]).find(function(x){
        return x?.kind==='coin'&&String(x?.coin?.mint||'')===String(mint);
      });
      if(row?.coin)return {...row.coin,_pumpSource:'pump.fun official'};
    }catch{}
  }

  // Server-side coin endpoint used by pump.fun itself. Never call this from browser.
  for(const path of [
    'https://frontend-api-v3.pump.fun/coins-v2/',
    'https://frontend-api-v3.pump.fun/coins/'
  ]){
    try{
      const d=await jfetch(path+encodeURIComponent(mint),{},8000);
      const coin=d?.coin||d?.data||d;
      if(coin&&String(coin.mint||'')===String(mint)){
        return {...coin,_pumpSource:'pump.fun coin endpoint'};
      }
    }catch{}
  }
  return null;
}

async function pumpFunPrice(mint){
  const coin=await pumpFunCoin(mint);
  if(!coin)return null;

  const complete=coin.complete===true || !!coin.pump_swap_pool || !!coin.raydium_pool;
  let price=num(coin.price_usd);
  let method='price_usd';

  // Some Pump responses expose USD market cap rather than an explicit token price.
  // Derive price using on-chain UI supply, not an assumed 1B supply.
  if(!(price>0)&&num(coin.usd_market_cap)>0){
    try{
      const sp=await rpc('getTokenSupply',[mint,{commitment:'confirmed'}]);
      const supply=num(sp?.result?.value?.uiAmount);
      if(supply>0){
        price=num(coin.usd_market_cap)/supply;
        method='usd_market_cap / on-chain supply';
      }
    }catch{}
  }

  // For a live Pump bonding curve, reserve ratio is the most direct Pump-native price.
  if(!complete&&num(coin.virtual_sol_reserves)>0&&num(coin.virtual_token_reserves)>0){
    try{
      const sp=await rpc('getTokenSupply',[mint,{commitment:'confirmed'}]);
      const decimals=Number(sp?.result?.value?.decimals);
      const solUsd=await (async()=>{
        try{
          const d=await jfetch('https://api.dexscreener.com/latest/dex/tokens/'+WSOL_MINT,{},8000);
          const rows=(d?.pairs||[]).filter(p=>String(p?.chainId||'').toLowerCase()==='solana'&&num(p?.priceUsd)>0);
          rows.sort((a,b)=>num(b?.liquidity?.usd)-num(a?.liquidity?.usd));
          return num(rows[0]?.priceUsd);
        }catch{return 0}
      })();
      if(Number.isFinite(decimals)&&solUsd>0){
        const solUnits=num(coin.virtual_sol_reserves)/1e9;
        const tokenUnits=num(coin.virtual_token_reserves)/(10**decimals);
        const curveUsd=tokenUnits>0?(solUnits/tokenUnits)*solUsd:0;
        if(curveUsd>0){
          price=curveUsd;
          method='pump.fun bonding curve reserves';
        }
      }
    }catch{}
  }

  if(!(price>0))return {
    mint,isPump:true,complete,priceUsd:null,
    source:coin._pumpSource||'pump.fun',
    method:'metadata only',
    pumpUrl:'https://pump.fun/coin/'+mint
  };

  return {
    mint,isPump:true,complete,priceUsd:price,
    source:coin._pumpSource||'pump.fun',
    method,
    pumpUrl:'https://pump.fun/coin/'+mint,
    marketCapUsd:num(coin.usd_market_cap||coin.market_cap),
    observedAt:Date.now()
  };
}

async function contractPrice(mint){
  const hit=contractPriceCache.get(mint);
  if(hit&&Date.now()-hit.at<CONTRACT_PRICE_CACHE_MS)return hit.data;

  const [dex,pump,jupMap]=await Promise.all([
    exactDexPrice(mint).catch(()=>null),
    pumpFunPrice(mint).catch(()=>null),
    jupiterPrices([mint]).catch(()=>new Map())
  ]);
  const jup=jupMap.get(mint)||null;

  const dp=num(dex?.priceUsd),pp=num(pump?.priceUsd),jp=num(jup?.priceUsd);
  // Only fetch additional providers when Jupiter could not validate the DEX
  // price, or when no price is available at all.
  // Never delay an available DEX/Jupiter price while a slow public fallback responds.
  const gecko=jp>0||dp>0?null:await geckoTokenPrice(mint);
  const gp=num(gecko?.priceUsd);
  const birdeye=dp<=0&&pp<=0&&jp<=0&&gp<=0?await birdeyeTokenPrice(mint):null;
  const bp=num(birdeye?.priceUsd);
  let priceUsd=0,source='',status='single-source',deviationPct=null;
  const jupiterDeviationPct=dp>0&&jp>0?Math.abs(dp-jp)/Math.min(dp,jp)*100:null;
  // Do not publish a 'live' PnL against mutually incompatible independent quotes.
  // Pump.fun reserves/market-cap estimates can diverge; a verified Jupiter/Dex
  // disagreement is a stronger warning than Pump-only disagreement.
  if(jupiterDeviationPct!==null&&jupiterDeviationPct>30){
    return {ok:false,mint,priceUsd:null,status:'price-source-disagreement',
      dexPriceUsd:dp,jupiterPriceUsd:jp,pumpPriceUsd:pp,
      jupiterDeviationPct,observedAt:Date.now(),source:'DEXScreener vs Jupiter'};
  }

  if(dp>0&&pp>0){
    deviationPct=Math.abs(dp-pp)/Math.min(dp,pp)*100;

    // IMPORTANT: the user-visible live price follows DEXScreener whenever
    // DEXScreener has a valid exact-contract market. Pump.fun only validates it.
    priceUsd=dp;
    source='DEXScreener exact contract';
    status=deviationPct<=20?'confirmed-by-pump':'dex-pump-disagreement';
  }else if(dp>0){
    priceUsd=dp;
    source='DEXScreener exact contract';
    status='dex-only';
  }else if(pp>0){
    // Only use Pump.fun if DEXScreener currently has no price for this contract.
    priceUsd=pp;
    source=pump?.complete===false?'Pump.fun bonding curve fallback':'Pump.fun fallback';
    status='pump-fallback';
  }

  if(jp>0&&(dp>0||!pp)){
    priceUsd=jp;source='Jupiter Price V3';
    status=dp>0?'confirmed-by-dex':'jupiter-only';
  }
  // Cross-check primary market against an independent free price feed.
  // A different Gecko pool can deviate without making the canonical DEX
  // quote wrong, so record disagreement instead of swapping pools silently.
  const geckoDeviationPct=dp>0&&gp>0?Math.abs(dp-gp)/Math.min(dp,gp)*100:null;
  if(dp>0&&gp>0&&geckoDeviationPct<=25&&jp<=0&&source.startsWith('DEXScreener')){
    status='confirmed-by-gecko';
  }else if(geckoDeviationPct!==null&&geckoDeviationPct>30&&jp<=0){
    status='dex-gecko-disagreement';
  }
  if(!(priceUsd>0)&&gp>0){
    priceUsd=gp;source='GeckoTerminal token price';status='gecko-fallback';
  }
  if(!(priceUsd>0)&&bp>0){
    priceUsd=bp;source='Birdeye';status='birdeye-fallback';
  }
  if(!(priceUsd>0))return null;

  const data={
    ok:true,mint,priceUsd,
    source,status,deviationPct,jupiterDeviationPct,jupiterPriceUsd:jp||null,
    geckoPriceUsd:gp||null,geckoDeviationPct,birdeyePriceUsd:bp||null,
    observedAt:Date.now(),
    pairAddress:String(dex?.pairAddress||''),
    dexId:String(dex?.dexId||''),
    dexUrl:String(dex?.dexUrl||''),
    pumpUrl:String(pump?.pumpUrl||''),
    dexPriceUsd:dp||null,
    pumpPriceUsd:pp||null,
    pumpComplete:pump?.complete??null,
    pumpMethod:pump?.method||null,
    liquidity:num(dex?.liquidity),
    quoteTokenSymbol:dex?.quoteTokenSymbol||''
  };
  contractPriceCache.set(mint,{at:Date.now(),data});
  return data;
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
        ownerAggregationComplete=rows.length>=10&&parsed.length>=10&&parsed.slice(0,10).every(Boolean);
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
  if(top10==null||topHolders.length<10){
    holderGrade='UNKNOWN';flags.push('داده 10 هولدر بزرگ کامل نیست');
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

  const goHeaders=process.env.GOPLUS_ACCESS_TOKEN?{authorization:'Bearer '+process.env.GOPLUS_ACCESS_TOKEN}:{};
  const [fullR,summaryR,goR]=await Promise.allSettled([
    jfetch('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(mint)+'/report',{},12000),
    jfetch('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(mint)+'/report/summary',{},12000),
    jfetch('https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses='+encodeURIComponent(mint),{headers:goHeaders},12000)
  ]);
  const rawReport=fullR.status==='fulfilled'?fullR.value:null;
  const rawSummary=summaryR.status==='fulfilled'?summaryR.value:null;
  const report=rawReport&&typeof rawReport==='object'&&!rawReport.error&&
    (!rawReport.mint||rawReport.mint===mint)?rawReport:null;
  const summary=rawSummary&&typeof rawSummary==='object'&&!rawSummary.error&&
    (!rawSummary.mint||rawSummary.mint===mint)?rawSummary:null;
  const goRaw=goR.status==='fulfilled'?goR.value:null;
  const goResult=goRaw?.result?.[mint]||goRaw?.result?.[String(mint).toLowerCase()]||goRaw?.result||null;
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
    // Jupiter Swap V1 /quote is deprecated. V2 /order without taker
    // returns a quote without constructing or executing a transaction.
    const query='?inputMint='+encodeURIComponent(mint)+'&outputMint='+encodeURIComponent(WSOL_MINT)+'&amount='+units;
    const jh=process.env.JUPITER_API_KEY?{'x-api-key':process.env.JUPITER_API_KEY}:{};
    let quote=null;
    try{quote=await pacedJupiterFetch('https://api.jup.ag/swap/v2/order'+query,{headers:jh},9000)}catch{}
    if(quote&&(num(quote.outAmount)>0||num(quote.outputAmountResult)>0)){
      const impactRaw=Number(quote.priceImpactPct);
      const hasImpact=quote.priceImpactPct!=null&&Number.isFinite(impactRaw);
      const impact=hasImpact?Math.abs(impactRaw)*100:null;
      sell=impact!==null&&impact>10
        ?auditState('warn','مسیر فروش Jupiter V2 موجود ولی impact تقریبی '+impact.toFixed(2)+'%','Jupiter Swap V2 quote')
        :auditState('warn','مسیر احتمالی فروش در Jupiter V2 پیدا شد؛ اجرا، اسلیپیج و فروش قطعی تأیید نشده','Jupiter Swap V2 quote');
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

  let goPlus=auditState('unknown','GoPlus Solana نتیجه‌ای برنگرداند','GoPlus');
  if(goResult){
    const high=Array.isArray(goResult?.risks?.high)?goResult.risks.high:[];
    const medium=Array.isArray(goResult?.risks?.medium)?goResult.risks.medium:[];
    const score=num(goResult?.security_score,NaN);
    const text=JSON.stringify(goResult).toLowerCase();
    const critical=high.length>0||/"is_honeypot"\s*:\s*"1"|"cannot_sell_all"\s*:\s*"1"|"non_transferable"\s*:\s*(true|"1")/.test(text);
    if(critical)goPlus=auditState('fail','GoPlus ریسک بحرانی: '+high.slice(0,3).join(', '),'GoPlus Solana Token Security');
    else if(medium.length)goPlus=auditState('warn','GoPlus هشدار: '+medium.slice(0,3).join(', ')+(Number.isFinite(score)?' · Score '+score:''),'GoPlus Solana Token Security');
    else goPlus=auditState('pass','GoPlus Solana بدون ریسک بحرانی'+(Number.isFinite(score)?' · Score '+score:''),'GoPlus Solana Token Security');
  }

  const rugcheckAvailable=!!(report||summary);
  const severeRisks=risks.filter(r=>{
    const level=String(r.level||'').toLowerCase();
    const detail=textRisk(r);
    return /danger|critical|high/.test(level)||
      /honeypot|fake token|scam|rug pull|rugged|cannot sell|freeze authority|mint authority|unlocked liquidity|insider network|wash trading/.test(detail);
  });
  const rugcheckState=!rugcheckAvailable?'UNKNOWN':
    rugged||severeRisks.length>0||overall.state==='fail'?'REJECT':
    overall.state==='pass'&&lp.state==='pass'?'PASS':'REVIEW';
  const rugcheck={state:rugcheckState,checkedAt:new Date().toISOString(),
    mint,url:'https://rugcheck.xyz/tokens/'+encodeURIComponent(mint),
    score:Number.isFinite(rugScore)?rugScore:null,
    lpLockedPct:Number.isFinite(lpLockedPct)?lpLockedPct:null,
    severeRiskCount:severeRisks.length,
    reasons:severeRisks.slice(0,5).map(r=>String(r.name||r.description||'High risk')),
    reportAvailable:rugcheckAvailable};
  const available=!!(report||summary||goResult||t.security);
  const data={available,rugcheck,goPlus,lp,dev,insider,sell,overall,creatorHistory,metadata,extensions,rugcheckScore:Number.isFinite(rugScore)?rugScore:null,lpLockedPct:Number.isFinite(lpLockedPct)?lpLockedPct:null,creator,creatorPct,rawRiskCount:risks.length,tokenProgram:pick(summary,'tokenProgram')||pick(report,'tokenProgram')||t.security?.tokenProgram||null};
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
  checks.push({name:'GoPlus Solana Security',state:ext.goPlus?.state||'unknown',detail:ext.goPlus?.detail||'داده ناکافی'});
  const pass=checks.filter(x=>x.state==='pass').length;
  const fail=checks.filter(x=>x.state==='fail').length;
  const warn=checks.filter(x=>x.state==='warn').length;
  const unknown=checks.filter(x=>x.state==='unknown').length;
  const externalCritical=['lp','dev','insider','sell','overall','extensions','creatorHistory','goPlus'].some(k=>ext[k]?.state==='fail');
  const criticalFail=
    sec.mintDisabled===false||sec.freezeDisabled===false||sec.holderPolicyPassed===false||sec.tokenExtensions?.hardFail===true||
    t.activity?.label==='BOT RISK'||chart.pumpDumpRisk==='HIGH'||t.flow?.volumeLabel==='SUSPICIOUS'||
    (mq.liqRatio>0&&mq.liqRatio<0.02)||externalCritical;
  const blocked=criticalFail||fail>=2;
  const score=Math.round((pass+warn*0.4)/checks.length*100);
  const label=blocked?'BLOCK':fail===0&&warn<=2&&unknown===0?'AUTO PASS':fail===0?'NEEDS REVIEW':'CAUTION';
  return {score,label,pass,fail,warn,unknown,manual:0,blocked,checks,source:'fully automated evidence pipeline: Solana RPC + RugCheck + GoPlus Solana + Jupiter + DEXScreener; missing evidence stays UNKNOWN'};
}

function securityGate(t){
  const sec=t.security||{},mq=t.marketQuality||{},act=t.activity||{},chart=t.chart||{},academy=t.academy||{};
  const hard=[],cautions=[];
  if(sec.mintDisabled===false)hard.push('Mint authority فعال');
  else if(sec.mintDisabled!==true)cautions.push('Mint authority نامشخص');
  if(sec.freezeDisabled===false)hard.push('Freeze authority فعال');
  else if(sec.freezeDisabled!==true)cautions.push('Freeze authority نامشخص');
  if(!Array.isArray(sec.topHolders)||sec.topHolders.length<10||sec.ownerAggregationComplete!==true)hard.push('داده 10 هولدر بزرگ کامل نیست');
  else if(sec.holderPolicyPassed!==true||Number(sec.largestHolder||0)>=10||Number(sec.maxOtherHolder||0)>=5)hard.push('قانون هولدر رد: #1 <10% و هرکدام از #2 تا #10 <5%');
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
  const s=t.security||{},academy=t.academy||{},mq=t.marketQuality||{},chart=t.chart||{};
  const holderKnown=Array.isArray(s.topHolders)&&s.topHolders.length>=10&&s.ownerAggregationComplete===true;
  const holderPass=holderKnown&&s.holderPolicyPassed===true&&num(s.largestHolder)<10&&num(s.maxOtherHolder)<5;

  const explicitFail=
    s.mintDisabled===false||
    s.freezeDisabled===false||
    (holderKnown&&holderPass===false)||
    s.tokenExtensions?.hardFail===true||
    t.activity?.label==='BOT RISK'||
    chart.pumpDumpRisk==='HIGH'||
    num(academy.fail)>0||
    (num(t.liquidity)>0&&num(t.liquidity)<3000);

  const verifiedCore=
    s.mintDisabled===true&&
    s.freezeDisabled===true&&
    holderPass===true&&
    s.tokenExtensions?.hardFail!==true;

  const criticalNames=['Liquidity Lock/Burn خودکار','Dev holding خودکار','Bundle/Sniper/Insider خودکار','Sellability / Honeypot خودکار','RugCheck ریسک کلی','Token-2022 extensionهای پرریسک','سابقه سازنده / Rug history'];
  const criticalChecks=(academy.checks||[]).filter(x=>criticalNames.includes(x.name));
  const criticalFail=criticalChecks.some(x=>x.state==='fail');
  const criticalComplete=criticalChecks.length===criticalNames.length&&criticalChecks.every(x=>x.state!=='unknown'&&x.state!=='fail');

  const organicStrong=t.activity?.label==='PROBABLE ORGANIC'&&num(t.activity?.score)>=72;
  const organicAccept=t.activity?.label!=='BOT RISK'&&num(t.activity?.score)>=48;
  const fullEvidence=num(academy.unknown)===0&&num(academy.fail)===0&&criticalComplete;

  // MAX remains fully verified.
  const maxOk=
    !explicitFail&&verifiedCore&&!criticalFail&&
    organicStrong&&fullEvidence&&
    num(mq.score)>=65&&num(academy.warn)<=2&&
    s.holderStrong===true&&num(s.score)>=85&&num(t.liquidity)>=10000;

  // HIGH = core on-chain safety is verified and no explicit red flag.
  // Missing supplemental evidence is a caution, not an automatic rejection.
  const highOk=
    !explicitFail&&verifiedCore&&!criticalFail&&
    organicAccept&&num(academy.fail)===0&&
    num(s.score)>=65&&num(t.liquidity)>=10000;

  const tier=explicitFail||criticalFail?'REJECT':maxOk?'MAX SECURITY':highOk?'HIGH':'REVIEW';
  return {
    tier,maxOk,highOk,explicitFail:explicitFail||criticalFail,verifiedCore,
    supplementalComplete:fullEvidence,
    supplementalUnknown:num(academy.unknown||0)
  };
}
function verdict(t){
  const sec=assessSecurity(t);
  t.security.tier=sec.tier;
  const early=t.ageMinutes<=20&&t.marketCap>=12000&&t.marketCap<=250000&&t.volume5m>=5000&&t.txns5m>=50;
  const strong=early&&t.totalHolderCount!=null&&t.totalHolderCount>=TOTAL_HOLDERS_MIN&&sec.maxOk&&t.preSignalGuard?.status==='CONFIRMED'&&t.trend.score>=55&&t.buys5m>t.sells5m;
  if(strong)return 'STRONG WATCH';
  if(sec.tier==='REJECT')return 'SKIP';
  if(sec.tier==='MAX SECURITY'||sec.tier==='HIGH')return t.trend.score>=35?'WATCH':'LOW SIGNAL';
  return 'REVIEW';
}
async function buildFresh(){
  if(cache.data&&Date.now()-cache.at<CACHE_MS)return cache.data;
  const seeds=await discovery();
  const out=[];
  const selectedSeeds=seeds.slice(0,100);
  const exactPairs=new Map();
  // Direct token-pairs lookup is the authoritative fallback. Run in small chunks
  // to avoid a single DEXScreener batch failure emptying the entire radar.
  for(let i=0;i<selectedSeeds.length;i+=10){
    const group=selectedSeeds.slice(i,i+10);
    const settled=await Promise.allSettled(group.map(async s=>[s.mint,await pairFor(s.mint)]));
    for(const r of settled){
      if(r.status==='fulfilled'&&r.value?.[1])exactPairs.set(r.value[0],r.value[1]);
    }
    await sleep(80);
  }
  for(const s of selectedSeeds){
    const p=exactPairs.get(s.mint); if(!p)continue;
    const created=num(p.pairCreatedAt);
    if(!created)continue;
    const ageMinutes=Math.max(0,(Date.now()-created)/60000);
    if(ageMinutes>43200)continue;
    const sec=await security(s.mint);
    const buys5m=num(p.txns?.m5?.buys),sells5m=num(p.txns?.m5?.sells);
    const t={
      name:p.baseToken?.name||'Unknown',symbol:p.baseToken?.symbol||'?',mint:s.mint,
      dexId:p.dexId||'',dexUrl:p.url||'',pairAddress:p.pairAddress||'',quoteTokenAddress:p.quoteToken?.address||'',priceQuoteTrusted:true,image:p.info?.imageUrl||s.image||'',description:s.description,
      ageMinutes:+ageMinutes.toFixed(1),priceUsd:num(p.priceUsd),marketCap:num(p.marketCap||p.fdv),
      liquidity:num(p.liquidity?.usd),volume5m:num(p.volume?.m5),volume1h:num(p.volume?.h1),volume6h:num(p.volume?.h6),volume24h:num(p.volume?.h24),
      buys5m,sells5m,txns5m:buys5m+sells5m,
      buys1h:num(p.txns?.h1?.buys),sells1h:num(p.txns?.h1?.sells),txns1h:num(p.txns?.h1?.buys)+num(p.txns?.h1?.sells),
      buys6h:num(p.txns?.h6?.buys),sells6h:num(p.txns?.h6?.sells),txns6h:num(p.txns?.h6?.buys)+num(p.txns?.h6?.sells),
      buys24h:num(p.txns?.h24?.buys),sells24h:num(p.txns?.h24?.sells),txns24h:num(p.txns?.h24?.buys)+num(p.txns?.h24?.sells),
      priceChange5m:num(p.priceChange?.m5),priceChange1h:num(p.priceChange?.h1),priceChange6h:num(p.priceChange?.h6),priceChange24h:num(p.priceChange?.h24),security:sec,kolTrend:s.kolTrend||null,discoverySources:s.discoverySources||[],boostSeen:!!s.boostSeen,boostTotal:num(s.boostTotal),profileSeen:!!s.profileSeen
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
  // Holder count is independently sourced from Jupiter Token API. Missing data
  // is UNKNOWN and must not be fabricated from the top 10 or tracked wallets.
  const allHolderCounts=await fetchTokenHolderCounts(out.map(t=>t.mint));
  for(const t of out){
    t.poolHealth=poolLiquidityAudit(t);
    const hc=allHolderCounts.get(t.mint);
    t.totalHolderCount=Number.isInteger(hc)?hc:null;
    t.totalHolderCountSource=Number.isInteger(hc)?'Jupiter Token API V2':'unavailable';
    t.verdict=verdict(t);
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
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:20,marketLiveRefreshSeconds:1,count:out.length,strong,trending,discovered:seeds.length,resolvedPairs:exactPairs.size,tokens:out,
    sourceStatus:{dexscreener:'live',solanaRpc:'live',kolExplorer:'live-public profiles + on-chain holdings/trades',kolX:process.env.X_BEARER_TOKEN?'live-api':'on-chain fallback; X API key not configured',bluesky:'live-public',x:process.env.X_BEARER_TOKEN?'live-api':'needs API key',youtube:process.env.YOUTUBE_API_KEY?'live-api':'needs API key',pumpFun:process.env.PUMP_FUN_API_KEY?'official API: leaderboard + positions + trades':'public leaderboard fallback; portfolio/trades require PUMP_FUN_API_KEY',reddit:process.env.REDDIT_CLIENT_ID?'configured':'presence-only',instagram:'presence-only',facebook:'presence-only',tiktok:'presence-only',telegram:'presence-only'},
    holderPolicy:{hardRules:{holder1MustBeBelowPct:10,holders2to10EachMustBeBelowPct:5,exclusive:true},gradeA:{holder1MaxPct:5,holders2to10EachMaxPct:2.5},gradeB:{holder1MaxPct:7.5,holders2to10EachMaxPct:4},gradeC:{holder1MaxPct:10,holders2to10EachMaxPct:5},unknownFailsStrong:true},
    activityPolicy:{probableOrganicMin:72,highSecurityMin:58,method:'aggregate heuristics; not proof of human identity'},
    orderFlowPolicy:{buyerPower:'buy transaction count / total buy+sell transactions; not dollar buy volume',strongBuyer:'5m >=55% and 1h >=51% when available',volumeQuality:'absolute volume + tx count + volume/liquidity sanity check'},
    knowledgeEngine:{marketQuality:'transparency + liquidity + data coverage',chartDiscipline:'trend + FOMO + pump/dump guard',academy:'automated Solana RPC + Token-2022 extension audit + RugCheck full/summary + Jupiter sell-route quote + DexScreener sell evidence; unavailable evidence stays UNKNOWN'},
    ageBuckets:{fresh:'0-24h',day:'24h-7d',week:'7d-30d discovery horizon'},
    entryExitPolicy:{entry:'At least 1000 verified token holders + buyer power > seller power + holder distribution policy + no bot-wash + healthy momentum/volume; unknown holder counts block ENTRY',exit:'live exit/whale sell/seller dominance/Trust Guard block; price invalidation is a risk reference, not guaranteed execution'},
    trustGuard:{strongSignalRequires:'2+ holder snapshots, 2 consecutive good scans, >=45 seconds stable confirmation, buyer strength, healthy volume, no holder-outflow risk',downgrade:'holder movement, seller dominance, whale/tracked exits or pump cooldown immediately remove strong status'},
    signalWindows:{short:'5m-1h',medium:'1h-6h',long:'6h-24h',securityGate:'HIGH/MAX requires zero manual, zero unknown and zero failed automated security checks; unknown evidence cannot receive strong approval'},
    disclaimer:'قانون هولدرها: هولدر شماره 1 باید کمتر از 10% و هرکدام از هولدرهای شماره 2 تا 10 باید کمتر از 5% داشته باشند. مجموع Top10 فقط جهت اطلاع نمایش داده می‌شود و شرط رد نیست. Organic Activity یک تخمین ضدربات/ضدواش است. هیچ فیلتر آن‌چین کلاهبرداری را 100% رد نمی‌کند.'};
  if(out.length===0&&cache.data&&Array.isArray(cache.data.tokens)&&cache.data.tokens.length){
    cache={at:Date.now(),data:{...cache.data,generatedAt:new Date().toISOString(),stale:true,scanWarning:'آخرین اسکن جدید صفر نتیجه داشت؛ آخرین لیست معتبر حفظ شد',discovered:seeds.length,resolvedPairs:exactPairs.size}};
    return cache.data;
  }
  cache={at:Date.now(),data};return data;
}
async function buildMarketLive(){
  if(marketLiveCache.data&&Date.now()-marketLiveCache.at<MARKET_LIVE_CACHE_MS)return marketLiveCache.data;
  if(marketLiveInFlight)return marketLiveInFlight;
  marketLiveInFlight=(async()=>{
    const base=cache.data?.tokens||[];
    if(!base.length)return {ok:true,generatedAt:new Date().toISOString(),tokens:[]};
    const preferredPairs=new Map(base.filter(t=>t.mint&&t.pairAddress).map(t=>[t.mint,t.pairAddress]));
    const pairs=await pairsForMany(base.map(t=>t.mint),preferredPairs);
    const jp=new Map();
    // Jupiter independent confirmation is batched; Dex pairs still supply
    // volume and transaction metrics and are never silently switched.
    for(let i=0;i<base.length;i+=50){
      const p=await jupiterPrices(base.slice(i,i+50).map(t=>t.mint));
      for(const [k,v] of p)jp.set(k,v);
    }
    const rows=[];
    for(const t of base){
      const p=pairs.get(t.mint);if(!p)continue;
      const j=jp.get(t.mint);
      const dexPrice=num(p.priceUsd),jupPrice=num(j?.priceUsd);
      const divergence=dexPrice>0&&jupPrice>0?Math.abs(dexPrice-jupPrice)/Math.min(dexPrice,jupPrice)*100:null;
      if(divergence!==null&&divergence>30)continue;
      const validatedPrice=jupPrice>0?jupPrice:dexPrice;
      if(!(validatedPrice>0))continue;
      const buys5m=num(p.txns?.m5?.buys),sells5m=num(p.txns?.m5?.sells);
      const patch={
        mint:t.mint,
        priceUsd:validatedPrice,
        jupiterPriceUsd:jupPrice||null,
        dexPriceUsd:dexPrice||null,
        priceValidationStatus:jupPrice>0?'confirmed-by-jupiter':'dex-only',
        marketCap:num(p.marketCap||p.fdv),
        liquidity:num(p.liquidity?.usd),
        volume5m:num(p.volume?.m5),volume1h:num(p.volume?.h1),volume6h:num(p.volume?.h6),volume24h:num(p.volume?.h24),
        buys5m,sells5m,txns5m:buys5m+sells5m,
        buys1h:num(p.txns?.h1?.buys),sells1h:num(p.txns?.h1?.sells),txns1h:num(p.txns?.h1?.buys)+num(p.txns?.h1?.sells),
        buys6h:num(p.txns?.h6?.buys),sells6h:num(p.txns?.h6?.sells),txns6h:num(p.txns?.h6?.buys)+num(p.txns?.h6?.sells),
        buys24h:num(p.txns?.h24?.buys),sells24h:num(p.txns?.h24?.sells),txns24h:num(p.txns?.h24?.buys)+num(p.txns?.h24?.sells),
        priceChange5m:num(p.priceChange?.m5),priceChange1h:num(p.priceChange?.h1),priceChange6h:num(p.priceChange?.h6),priceChange24h:num(p.priceChange?.h24),
        dexUrl:p.url||t.dexUrl||'',
        pairAddress:p.pairAddress||'',
        quoteTokenAddress:p.quoteToken?.address||'',
        priceQuoteTrusted:true,
        priceSource:jupPrice>0?'Jupiter V3 validated against DEXScreener '+String(p.pairAddress||''):'DEXScreener exact pair '+String(p.pairAddress||''),
        priceObservedAt:Date.now()
      };
      var merged={...t,...patch};
      patch.flow=flowQuality(merged);
      patch.activity=activityScore(merged);
      patch.chart=chartDiscipline({...merged,flow:patch.flow,activity:patch.activity});
      rows.push(patch);
    }
    const data={ok:true,generatedAt:new Date().toISOString(),refreshMs:1000,tokens:rows};
    marketLiveCache={at:Date.now(),data};
    return data;
  })();
  try{return await marketLiveInFlight}finally{marketLiveInFlight=null}
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
  // Never turn an RPC error into an empty wallet. An incomplete scan could
  // otherwise be mistaken for a sell-out, then for a new buy on recovery.
  for(const programId of [SPL_TOKEN_PROGRAM,TOKEN_2022_PROGRAM]){
    const d=await rpc('getTokenAccountsByOwner',[wallet,{programId},{encoding:'jsonParsed',commitment:'confirmed'}]);
    if(d?.error||!Array.isArray(d?.result?.value))throw new Error('incomplete wallet balance RPC response');
    for(const x of d.result.value){
      const info=x?.account?.data?.parsed?.info;
      const mint=info?.mint,amt=num(info?.tokenAmount?.uiAmountString??info?.tokenAmount?.uiAmount);
      if(mint&&amt>0)out.set(mint,(out.get(mint)||0)+amt);
    }
  }
  return out;
}
async function currentSolPrice(){
  try{const p=await pairFor(WSOL_MINT);return num(p?.priceUsd,0)}catch{return 0}
}

async function buildUserTopTraderIntel(){
  if(topTraderIntelCache.data&&Date.now()-topTraderIntelCache.at<TOP_TRADER_INTEL_CACHE_MS)return topTraderIntelCache.data;

  const now=Date.now();
  const scans=[];
  // Chunked concurrency keeps ~40 wallets from saturating the RPC.
  for(let i=0;i<USER_TOP_TRADERS.length;i+=6){
    const group=USER_TOP_TRADERS.slice(i,i+6);
    const settled=await Promise.allSettled(group.map(async w=>{
      const balances=await walletTokenBalances(w.address);
      return {w,balances,rpcOk:true};
    }));
    for(let j=0;j<settled.length;j++){
      if(settled[j].status==='fulfilled')scans.push(settled[j].value);
      else scans.push({w:group[j],balances:new Map(),rpcOk:false});
    }
    await sleep(40);
  }

  const mintAgg=new Map();
  for(const row of scans){
    if(!row.rpcOk)continue;
    for(const [mint,amount] of row.balances.entries()){
      if(!mint||amount<=0||STABLE_MINTS.has(mint)||mint===WSOL_MINT)continue;
      const a=mintAgg.get(mint)||{mint,holders:[],holderCount:0,totalAmount:0};
      a.holders.push({name:row.w.name,address:row.w.address,amount});
      a.holderCount++;a.totalAmount+=amount;mintAgg.set(mint,a);
    }
  }

  const pairs=await pairsForMany([...mintAgg.keys()]);
  for(const [mint,a] of mintAgg){
    const p=pairs.get(mint);
    if(!p)continue;
    const price=num(p.priceUsd);
    a.symbol=p?.baseToken?.symbol||'?';
    a.name=p?.baseToken?.name||'Unknown';
    a.priceUsd=price;
    a.dexUrl=p.url||'';
    a.pairAddress=p.pairAddress||'';
    a.liquidity=num(p?.liquidity?.usd);
    a.marketCap=num(p?.marketCap||p?.fdv);
    a.totalValueUsd=0;
    for(const h of a.holders){
      h.valueUsd=price>0?h.amount*price:0;
      a.totalValueUsd+=h.valueUsd;
    }
    a.holders.sort((x,y)=>y.valueUsd-x.valueUsd);
  }

  // Compare current balances with the previous snapshot. Existing positions on the
  // first scan are not mislabeled as buys. Future increases are tracked as accumulation.
  const changedWallets=[];
  for(const row of scans){
    if(!row.rpcOk)continue;
    const prev=topTraderPreviousBalances.get(row.w.address);
    const changes=[];
    for(const [mint,amount] of row.balances.entries()){
      if(!mint||STABLE_MINTS.has(mint)||mint===WSOL_MINT)continue;
      const old=prev?num(prev.get(mint)):null;
      const a=mintAgg.get(mint);
      const price=num(a?.priceUsd);
      const key=row.w.address+'|'+mint;
      let base=topTraderPositionBaselines.get(key);
      if(!base&&price>0){
        base={firstSeenAt:now,firstSeenPrice:price,detectedBuyAt:null,detectedBuyPrice:null,detectedBuyUsd:0};
        topTraderPositionBaselines.set(key,base);
      }
      if(prev&&old!=null&&amount>old&&price>0){
        const delta=amount-old,usd=delta*price;
        if(usd>=20){
          changes.push({mint,delta,usd,price});
          if(!base){
            base={firstSeenAt:now,firstSeenPrice:price,detectedBuyAt:now,detectedBuyPrice:price,detectedBuyUsd:usd};
          }else if(!base.detectedBuyAt){
            base.detectedBuyAt=now;base.detectedBuyPrice=price;base.detectedBuyUsd=usd;
          }else{
            const oldUsd=num(base.detectedBuyUsd),newUsd=oldUsd+usd;
            base.detectedBuyPrice=newUsd>0?((num(base.detectedBuyPrice)*oldUsd)+(price*usd))/newUsd:price;
            base.detectedBuyUsd=newUsd;
          }
          topTraderPositionBaselines.set(key,base);
        }
      }
    }
    if(changes.length)changedWallets.push({row,changes});
    topTraderPreviousBalances.set(row.w.address,new Map(row.balances));
  }

  // Verify only changed wallets against their newest transactions. This provides
  // a real on-chain timestamp when the balance increase came from a detectable swap.
  for(const x of changedWallets.slice(0,12)){
    let verified=[];
    try{
      const sigs=await rpc('getSignaturesForAddress',[x.row.w.address,{limit:6,commitment:'confirmed'}]);
      for(const sig of (sigs?.result||[]).slice(0,6)){
        if(!sig.blockTime||now-num(sig.blockTime)*1000>10*60*1000)continue;
        try{
          const tx=await rpc('getTransaction',[sig.signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
          const parsed=parseTrackedWalletTx(tx,x.row.w.address,await currentSolPrice());
          for(const e of parsed.filter(e=>e.side==='BUY')){
            const ch=x.changes.find(v=>v.mint===e.mint);
            if(!ch)continue;
            verified.push({mint:e.mint,signature:sig.signature,ts:num(sig.blockTime)*1000,approxUsd:num(e.approxUsd)||ch.usd,
              tokenAmount:num(e.tokenAmount),estimatedExecutionPrice:num(e.tokenAmount)>0&&num(e.approxUsd)>0?num(e.approxUsd)/num(e.tokenAmount):null});
          }
        }catch{}
      }
    }catch{}
    for(const ch of x.changes){
      const v=verified.find(z=>z.mint===ch.mint);
      const a=mintAgg.get(ch.mint);
      const evt={
        id:(v?.signature||('obs:'+now))+':'+x.row.w.address+':'+ch.mint,
        trader:x.row.w.name,address:x.row.w.address,mint:ch.mint,
        symbol:a?.symbol||'?',name:a?.name||'',
        usd:v?.approxUsd||ch.usd,
        price:v?.estimatedExecutionPrice||ch.price,
        priceBasis:v?.estimatedExecutionPrice?'estimated on-chain execution cost':'market price at first observed increase',
        tokenAmount:ch.delta,
        initialPairAddress:a?.pairAddress||null,
        ts:v?.ts||now,signature:v?.signature||null,
        verifiedSwap:!!v,source:v?'Solana RPC confirmed swap':'Solana RPC balance increase'
      };
      if(!topTraderBuyEvents.some(e=>e.id===evt.id))topTraderBuyEvents.unshift(evt);
    }
  }
  topTraderBuyEvents=topTraderBuyEvents.filter(e=>now-e.ts<=24*60*60*1000).slice(0,250);
  const pricedRecentBuys=topTraderBuyEvents.slice(0,80).map(e=>{
    const current=mintAgg.get(e.mint);
    const currentPriceUsd=num(current?.priceUsd);
    const samePair=!e.initialPairAddress||!current?.pairAddress||
      e.initialPairAddress===current.pairAddress;
    const valid=currentPriceUsd>0&&num(e.price)>0&&samePair;
    const pnlPct=valid?(currentPriceUsd/num(e.price)-1)*100:null;
    const pnlUsd=valid?num(e.usd)*pnlPct/100:null;
    return {...e,currentPriceUsd:valid?currentPriceUsd:null,
      currentPriceObservedAt:valid?now:null,pricePairMatched:samePair,
      pnlPct,pnlUsd,pnlBasis:e.verifiedSwap?'approximate swap cost':'balance increase observation',
      pnlNote:'Approximate mark-to-market change only, not realized trader PnL; sells, transfers, fees and slippage not included'};
  });

  const sharedHoldings=[...mintAgg.values()]
    .filter(x=>x.priceUsd>0&&x.totalValueUsd>0)
    .map(x=>{
      const radar=(cache.data?.tokens||[]).find(t=>t.mint===x.mint)||null;
      const recent=topTraderBuyEvents.filter(e=>e.mint===x.mint&&now-e.ts<=6*60*60*1000);
      const recentTraderSet=new Set(recent.map(e=>e.address));
      const safe=!!(radar&&['MAX SECURITY','HIGH'].includes(radar.security?.tier)&&
        radar.security?.mintDisabled===true&&radar.security?.freezeDisabled===true&&
        radar.security?.holderPolicyPassed===true&&radar.academy?.blocked!==true&&
        radar.activity?.label!=='BOT RISK'&&radar.chart?.pumpDumpRisk!=='HIGH');
      let score=0;
      score+=Math.min(40,x.holderCount*7);
      score+=Math.min(18,Math.log10(1+x.totalValueUsd)*4);
      score+=Math.min(20,recentTraderSet.size*7);
      if(x.liquidity>=10000)score+=7;
      if(x.liquidity>=25000)score+=5;
      if(safe)score+=10;
      return {...x,radar,recentBuyers:recentTraderSet.size,recentBuyUsd:recent.reduce((n,e)=>n+num(e.usd),0),
        safe,score:clamp(Math.round(score))};
    })
    .sort((a,b)=>(b.holderCount-a.holderCount)||(b.recentBuyers-a.recentBuyers)||(b.totalValueUsd-a.totalValueUsd));

  const walletRows=scans.map(row=>{
    const portfolio=[];
    for(const [mint,amount] of row.balances.entries()){
      const a=mintAgg.get(mint);if(!a||!(a.priceUsd>0))continue;
      const valueUsd=amount*a.priceUsd;
      const base=topTraderPositionBaselines.get(row.w.address+'|'+mint);
      const refPrice=num(base?.detectedBuyPrice)||num(base?.firstSeenPrice);
      const returnPct=refPrice>0?((a.priceUsd-refPrice)/refPrice)*100:null;
      portfolio.push({
        mint,symbol:a.symbol,name:a.name,amount,valueUsd,priceUsd:a.priceUsd,dexUrl:a.dexUrl,
        returnPct,referencePrice:refPrice>0?refPrice:null,
        returnBasis:base?.detectedBuyAt?'از خرید/انباشت مشاهده‌شده':'از شروع ردیابی',
        firstSeenAt:base?.firstSeenAt||null,
        detectedBuyAt:base?.detectedBuyAt||null,
        detectedBuyPrice:base?.detectedBuyPrice||null
      });
    }
    portfolio.sort((a,b)=>b.valueUsd-a.valueUsd);
    return {
      ...row.w,rpcOk:row.rpcOk,portfolio:portfolio.slice(0,12),
      portfolioValueUsd:portfolio.reduce((n,x)=>n+x.valueUsd,0),
      topPosition:portfolio[0]||null
    };
  }).sort((a,b)=>b.portfolioValueUsd-a.portfolioValueUsd);

  const recommendations=sharedHoldings
    .filter(x=>x.holderCount>=2)
    .map(x=>({
      ...x,
      recommendation:x.safe&&x.score>=65?'پیشنهاد برتر برای بررسی':x.safe?'کاندید امن مشترک':'Watch مشترک'
    }))
    .sort((a,b)=>(Number(b.safe)-Number(a.safe))||(b.score-a.score)||(b.holderCount-a.holderCount))
    .slice(0,15);

  const best=recommendations.find(x=>x.safe)||null;
  // A shared holding is not proof of a shared purchase. Only observed
  // on-chain events from this monitor are eligible for recent buy consensus.
  const sharedBuyMap=new Map();
  for(const e of topTraderBuyEvents){
    if(!e?.mint||!e?.address||now-num(e.ts)>24*60*60*1000)continue;
    const a=sharedBuyMap.get(e.mint)||{mint:e.mint,traders:new Map(),events:[]};
    a.events.push(e);
    const old=a.traders.get(e.address);
    if(!old)a.traders.set(e.address,{name:e.trader,address:e.address,usd:0,lastBuyAt:0,verifiedSwap:false,observedCount:0,verifiedCount:0});
    const t=a.traders.get(e.address);
    t.usd+=num(e.usd);
    t.lastBuyAt=Math.max(t.lastBuyAt,num(e.ts));
    t.observedCount++;
    if(e.verifiedSwap){t.verifiedCount++;t.verifiedSwap=true}
    sharedBuyMap.set(e.mint,a);
  }
  const sharedBuys=[...sharedBuyMap.values()].map(a=>{
    const holding=mintAgg.get(a.mint);
    const traders=[...a.traders.values()].sort((x,y)=>y.usd-x.usd);
    const verified=traders.filter(x=>x.verifiedSwap);
    return {mint:a.mint,symbol:holding?.symbol||a.events[0]?.symbol||'?',
      name:holding?.name||a.events[0]?.name||'',dexUrl:holding?.dexUrl||'',
      traderCount:traders.length,verifiedTraderCount:verified.length,
      sharedVerifiedPurchase:verified.length>=2,
      totalObservedUsd:traders.reduce((s,t)=>s+t.usd,0),
      lastObservedAt:Math.max(...a.events.map(x=>num(x.ts))),
      traders,events:a.events.sort((x,y)=>num(y.ts)-num(x.ts)).slice(0,30)};
  }).filter(x=>x.traderCount>=2).sort((a,b)=>
    (Number(b.sharedVerifiedPurchase)-Number(a.sharedVerifiedPurchase))||
    (b.verifiedTraderCount-a.verifiedTraderCount)||
    (b.traderCount-a.traderCount)||(b.lastObservedAt-a.lastObservedAt)).slice(0,30);
  const data={
    ok:true,generatedAt:new Date().toISOString(),refreshSeconds:12,
    walletCount:USER_TOP_TRADERS.length,scannedWalletCount:scans.filter(x=>x.rpcOk).length,
    failedWalletCount:scans.filter(x=>!x.rpcOk).length,partialData:scans.some(x=>!x.rpcOk),
    wallets:walletRows,
    sharedHoldings:sharedHoldings.slice(0,30),
    sharedBuys,recommendations,best,
    recentBuys:pricedRecentBuys,
    source:'User supplied wallets + Solana RPC balances/transactions + DEXScreener valuation',
    disclaimer:'پوزیشن‌های موجود قبل از شروع مانیتور، زمان خرید تاریخی قطعی ندارند و بازده آن‌ها از شروع ردیابی محاسبه می‌شود. فقط افزایش موجودی بعد از شروع مانیتور می‌تواند زمان خرید/انباشت مشاهده‌شده داشته باشد.'
  };
  topTraderIntelCache={at:Date.now(),data};return data;
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
    }).filter(x=>x.buyUsd>=100&&x.sellUsd<x.buyUsd&&x.currentHoldingUsd>0)
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
  const data={ok:true,generatedAt:new Date().toISOString(),refreshSeconds:300,source:'Solana RPC live + seed rankings from KOL Explorer/Solana Tracker + user supplied top traders',solPrice,wallets:publicWallets,tokens,topHoldings,marketTopHoldings,topNetBuys,consensus,
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
async function refreshTrackedWhaleSource(){
  try{
    await buildTrackedWallets();
    liveFomoState.updatedAt=new Date().toISOString();
    broadcastLiveState('market');
  }catch{}
}
setTimeout(refreshTrackedWhaleSource,1500);
setInterval(refreshTrackedWhaleSource,60000);

function trackedWhaleEvents(){
  const tw=trackedWalletCache?.data;
  if(!tw||!Array.isArray(tw.wallets))return [];

  const tokenMap=new Map((tw.tokens||[]).map(function(t){return [t.mint,t]}));
  const out=[],seen=new Set();

  for(const w of tw.wallets){
    for(const e of (w.events||[])){
      if(!e||!['BUY','SELL'].includes(String(e.side||'')))continue;
      const mint=String(e.mint||'');
      const ts=normalizeTs(e.ts||0);
      if(!mint||!ts)continue;

      const token=tokenMap.get(mint);
      const holder=(token?.holders||[]).find(function(h){
        return String(h.address||'')===String(w.address||'');
      });
      const positionValueUsd=num(holder?.valueUsd);

      const key=String(e.signature||'')+'|'+mint+'|'+String(w.address||'')+'|'+String(e.side||'');
      if(seen.has(key))continue;
      seen.add(key);

      out.push({
        eventId:'tracked:'+key,
        alertType:e.side==='BUY'?'buy':'sell',
        trader:w.name||w.address||'tracked-wallet',
        traderAddress:w.address||'',
        userId:null,
        tradeId:e.signature||null,
        token:e.symbol||token?.symbol||'?',
        tokenAddress:mint,
        tradeUsd:num(e.approxUsd),
        positionValueUsd,
        text:'Solana RPC tracked-wallet swap',
        ts,
        txHash:e.signature||null,
        trackedSmart:true,
        positionVerified:true,
        source:'tracked-wallet-onchain'
      });
    }
  }
  return out.sort(function(a,b){return b.ts-a.ts}).slice(0,200);
}

function liveSmartMoneyPayload(){
  const fomoEvents=liveFomoState.events.slice(0,120);
  const trackedEvents=trackedWhaleEvents();
  const merged=new Map();
  for(const e of [...fomoEvents,...trackedEvents]){
    const k=String(e.eventId||e.txHash||'')+'|'+String(e.tokenAddress||'')+'|'+String(e.alertType||'');
    if(!merged.has(k))merged.set(k,e);
  }
  const events=[...merged.values()].sort(function(a,b){return normalizeTs(b.ts)-normalizeTs(a.ts)}).slice(0,220);
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
  const exitClusters=[...byToken.values()]
    .map(x=>({...x,sellers:[...x.sellers],uniqueSellers:x.sellers.size,severity:x.sellers.size>=2?'MULTI-WALLET EXIT':x.knownSellUsd>=5000?'HEAVY SELL':'SELL STARTED'}))
    .sort((a,b)=>b.latestTs-a.latestTs);

  // Aggregate split buys by wallet+token. A whale often splits one position into
  // several smaller swaps, so a strict per-transaction $5k threshold misses them.
  const buyerAgg=new Map();
  for(const e of buys){
    const tokenKey=e.tokenAddress||e.token||'unknown';
    const traderKey=String(e.trader||'unknown');
    const k=tokenKey+'|'+traderKey;
    const a=buyerAgg.get(k)||{
      token:e.token||'',tokenAddress:e.tokenAddress||'',trader:e.trader||'',
      totalBuyUsd:0,buyCount:0,maxSingleBuyUsd:0,maxPositionValueUsd:0,latestTs:0,events:[]
    };
    a.totalBuyUsd+=num(e.tradeUsd);
    a.buyCount+=1;
    a.maxSingleBuyUsd=Math.max(a.maxSingleBuyUsd,num(e.tradeUsd));
    a.maxPositionValueUsd=Math.max(a.maxPositionValueUsd,num(e.positionValueUsd));
    a.latestTs=Math.max(a.latestTs,num(e.ts));
    a.events.push(e);
    buyerAgg.set(k,a);
  }

  const whaleWalletBuys=[...buyerAgg.values()].filter(a=>
    a.maxSingleBuyUsd>=5000 ||
    a.maxPositionValueUsd>=25000 ||
    a.totalBuyUsd>=5000 ||
    (a.buyCount>=3&&a.totalBuyUsd>=3500)
  ).sort((a,b)=>b.totalBuyUsd-a.totalBuyUsd);

  // Keep event-level rows for the UI, but include split-buy events that qualified
  // through cumulative wallet activity.
  const qualifiedKeys=new Set(whaleWalletBuys.map(a=>(a.tokenAddress||a.token||'unknown')+'|'+String(a.trader||'unknown')));
  const whaleBuys=buys.filter(e=>{
    const k=(e.tokenAddress||e.token||'unknown')+'|'+String(e.trader||'unknown');
    return qualifiedKeys.has(k);
  }).slice(0,100);

  const whaleSells=exits.filter(x=>num(x.tradeUsd)>=5000||num(x.positionValueUsd)>=25000).slice(0,100);

  const whaleAggMap=new Map();
  for(const w of whaleWalletBuys){
    const k=w.tokenAddress||w.token||'unknown';
    const a=whaleAggMap.get(k)||{
      token:w.token||'',tokenAddress:w.tokenAddress||'',totalBuyUsd:0,buyCount:0,
      traders:new Set(),latestTs:0,largestWalletBuyUsd:0,splitBuyerCount:0
    };
    a.totalBuyUsd+=num(w.totalBuyUsd);
    a.buyCount+=num(w.buyCount);
    if(w.trader)a.traders.add(String(w.trader));
    if(w.buyCount>=2)a.splitBuyerCount+=1;
    a.largestWalletBuyUsd=Math.max(a.largestWalletBuyUsd,num(w.totalBuyUsd));
    a.latestTs=Math.max(a.latestTs,num(w.latestTs));
    whaleAggMap.set(k,a);
  }

  const whaleByToken=[...whaleAggMap.values()].map(x=>({
    ...x,
    traders:[...x.traders],
    uniqueTraders:x.traders.size
  })).sort((a,b)=>
    (b.uniqueTraders-a.uniqueTraders)||
    (b.totalBuyUsd-a.totalBuyUsd)
  );

  const totalWhaleBuyUsd=whaleByToken.reduce((a,x)=>a+x.totalBuyUsd,0);

  const fifteenCutoff=Date.now()-15*60*1000;
  const coordinatedMap=new Map();
  for(const w of whaleWalletBuys.filter(x=>Number(x.latestTs||0)>=fifteenCutoff&&Number(x.totalBuyUsd||0)>=5000)){
    const k=w.tokenAddress||w.token||'unknown';
    const a=coordinatedMap.get(k)||{token:w.token||'',tokenAddress:w.tokenAddress||'',wallets:new Set(),totalBuyUsd:0,latestTs:0};
    if(w.trader)a.wallets.add(String(w.trader));
    a.totalBuyUsd+=Number(w.totalBuyUsd||0);
    a.latestTs=Math.max(a.latestTs,Number(w.latestTs||0));
    coordinatedMap.set(k,a);
  }
  const coordinatedBuys=[...coordinatedMap.values()].map(x=>({...x,wallets:[...x.wallets],walletCount:x.wallets.size}))
    .filter(x=>x.walletCount>=3)
    .sort((a,b)=>b.walletCount-a.walletCount||b.totalBuyUsd-a.totalBuyUsd);

  // Current large positions are useful even if the last buy was older than 30m.
  // They are shown separately and are never counted as a fresh buy unless a real BUY event exists.
  const tw=trackedWalletCache?.data;
  const whalePositions=(tw?.marketTopHoldings||[])
    .filter(function(x){return num(x.currentHoldingUsd)>=25000})
    .map(function(x){
      return {
        token:x.symbol||x.name||'?',
        tokenAddress:x.mint,
        currentHoldingUsd:num(x.currentHoldingUsd),
        holdingWallets:num(x.holdingWallets),
        holders:(x.holders||[]).slice(0,6),
        dexUrl:x.dexUrl||'',
        source:'tracked-wallet-onchain'
      };
    })
    .sort(function(a,b){return b.currentHoldingUsd-a.currentHoldingUsd})
    .slice(0,20);

  return {
    ok:true,
    connected:liveFomoState.connected,
    realtime:liveFomoState.realtime,
    delaySeconds:liveFomoState.delaySeconds,
    updatedAt:liveFomoState.updatedAt,
    lastError:liveFomoState.lastError,
    keyConfigured:!!process.env.FOMO_API_KEY,
    events,
    buys:buys.slice(0,40),
    exits:exits.slice(0,40),
    whaleBuys,
    whaleWalletBuys:whaleWalletBuys.slice(0,100),
    whaleSells,
    whaleByToken,
    coordinatedBuys,
    totalWhaleBuyUsd,
    whalePositions,
    sourceDiagnostics:{
      fomoEvents:fomoEvents.length,
      trackedOnchainEvents:trackedEvents.length,
      recent30m:recentEvents.length,
      fomoConnected:liveFomoState.connected,
      trackedCacheReady:!!trackedWalletCache?.data
    },
    exitClusters,
    whalePolicy:{
      singleBuyUsd:5000,
      positionValueUsd:25000,
      cumulative30mUsd:5000,
      splitBuyRule:'3+ buys and cumulative >= $3500'
    }
  };
}

async function buildSmartMoney(){
  const key=process.env.FOMO_API_KEY;

  // Fallback: build smart-money candidates from the radar's own tracked-wallet
  // on-chain data when the external FOMO API key is not configured.
  async function fallbackFromTracked(){
    const tw=await buildTrackedWallets();
    const rows=Array.isArray(tw?.tokens)?tw.tokens:[];
    const tokens=rows.map(function(x){
      const buyers1000=Array.isArray(x.convictionHolders)?x.convictionHolders:[];
      const score=
        Math.max(0,Number(x.netFlowUsd||0))/250+
        Number(x.uniqueBuyers||0)*8+
        buyers1000.length*14+
        Math.min(20,Number(x.currentHoldingUsd||0)/2500);

      return {
        address:x.mint,
        symbol:x.symbol||'?',
        name:x.name||'',
        smartMoneyCount:Number(x.uniqueBuyers||0),
        totalValueUsd:Number(x.currentHoldingUsd||0),
        netFlowUsd:Number(x.netFlowUsd||0),
        buyers100Count:buyers1000.length,
        buyers100Usd:buyers1000.reduce(function(a,h){return a+Number(h.buyUsd||0)},0),
        traders:(x.buyers||[]).map(function(name){return {handle:name,wallet:'',valueUsd:null,pnl7d:null,pnl30d:null}}),
        marketCap:Number(x.marketCap||0),
        liquidity:Number(x.liquidity||0),
        dexUrl:x.dexUrl||'',
        security:null,
        smartScore:Math.round(score),
        source:'tracked-wallets-onchain'
      };
    }).filter(function(x){
      return x.smartMoneyCount>0&&(
        x.netFlowUsd>0||
        x.buyers100Count>0||
        x.totalValueUsd>0
      );
    }).sort(function(a,b){
      return (b.buyers100Count-a.buyers100Count)||
        (b.netFlowUsd-a.netFlowUsd)||
        (b.totalValueUsd-a.totalValueUsd)||
        (b.smartMoneyCount-a.smartMoneyCount);
    }).slice(0,20);

    for(const t of tokens){
      try{t.security=await security(t.address)}catch{}
    }

    const traders=(tw?.wallets||[]).filter(function(w){
      return (Number(w.seedPnl30d||0)>=10000&&Number(w.seedWinRate||0)>=55&&w.highFrequencyRisk!==true)||Number(w.portfolioValueUsd||0)>0;
    }).sort(function(a,b){
      return Number(b.seedPnl30d||0)-Number(a.seedPnl30d||0);
    }).slice(0,10).map(function(w){
      return {
        id:w.address,
        handle:w.name||'',
        displayName:w.name||'',
        wallet:w.address,
        verified:false,
        pnl7d:0,
        pnl30d:Number(w.seedPnl30d||0),
        smartScore:Number(w.seedPnl30d||0)>0?Math.log10(1+Number(w.seedPnl30d||0))*20:0,
        source:w.source||'tracked-wallet',quality:(Number(w.seedPnl30d||0)>=10000&&Number(w.seedWinRate||0)>=55&&w.highFrequencyRisk!==true)?'PROFITABLE_SCREEN_PASS':'PORTFOLIO_ONLY'
      };
    });

    return {
      ok:true,
      configured:true,
      fallback:true,
      source:'tracked-wallets-onchain',
      generatedAt:new Date().toISOString(),
      cacheHours:0.08,
      traders,
      tokens,
      disclaimer:'اسمارت‌مانی fallback از کیف‌پول‌های ردیابی‌شده و جریان آن‌چین خود رادار ساخته می‌شود؛ تضمین سود آینده نیست.'
    };
  }

  if(!key){
    try{
      const data=await fallbackFromTracked();
      smartMoneyCache={at:Date.now(),data};
      return data;
    }catch(e){
      return {ok:false,configured:false,source:'tracked-wallets-onchain',message:'داده اسمارت‌مانی داخلی فعلاً در دسترس نیست',traders:[],tokens:[]};
    }
  }

  if(smartMoneyCache.data&&Date.now()-smartMoneyCache.at<SMART_MONEY_CACHE_MS)return smartMoneyCache.data;
  const auth={authorization:'Bearer '+key};
  try{
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
        const old=tokenMap.get(address)||{address,symbol:symbol||'?',name:h?.token?.name||'',smartMoneyCount:0,totalValueUsd:0,traders:[],change24h:num(h.change24h),marketCap:0,liquidity:0,security:null,source:'fomoapi'};
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
    const data={ok:true,configured:true,fallback:false,source:'fomoapi',generatedAt:new Date().toISOString(),cacheHours:6,traders,tokens,disclaimer:'Smart Money یعنی کیف‌پول‌های سودده/تأییدشده در leaderboard؛ تضمین سود آینده یا سالم بودن توکن نیست.'};
    smartMoneyCache={at:Date.now(),data};
    return data;
  }catch(e){
    // External provider failed: degrade gracefully to tracked-wallet fallback.
    try{
      const data=await fallbackFromTracked();
      data.providerError=String(e?.message||e);
      smartMoneyCache={at:Date.now(),data};
      return data;
    }catch{
      return {ok:false,configured:false,source:'fomoapi',message:'منبع خارجی و fallback داخلی هر دو فعلاً در دسترس نیستند',traders:[],tokens:[]};
    }
  }
}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let sourcesHealthCache={at:0,data:null},sourcesHealthInFlight=null;
async function sourcesHealth(){
  if(sourcesHealthCache.data&&Date.now()-sourcesHealthCache.at<300000)return sourcesHealthCache.data;
  if(sourcesHealthInFlight)return sourcesHealthInFlight;
  sourcesHealthInFlight=(async()=>{
    const mint=WSOL_MINT,jh=process.env.JUPITER_API_KEY?{'x-api-key':process.env.JUPITER_API_KEY}:{};
    const tasks=[
      ['dexscreener','DEXScreener',()=>jfetch('https://api.dexscreener.com/tokens/v1/solana/'+mint,{},7000).then(d=>Array.isArray(d)?{count:d.length}:Promise.reject(Error('shape')))],
      ['geckoterminal','GeckoTerminal',()=>jfetch('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',{headers:{accept:'application/json;version=20230203'}},7000).then(d=>Array.isArray(d?.data)?{count:d.data.length}:Promise.reject(Error('shape')))],
      ['jupiter','Jupiter Price',()=>pacedJupiterFetch('https://api.jup.ag/price/v3?ids='+mint,{headers:jh},7000).then(d=>num(d?.[mint]?.usdPrice)>0?{priceAvailable:true}:Promise.reject(Error('price missing')))],
      ['jupiterTokens','Jupiter Tokens',()=>pacedJupiterFetch('https://api.jup.ag/tokens/v2/search?query='+mint,{headers:jh},7000).then(d=>Array.isArray(d)?{holdersAvailable:d.some(t=>t.id===mint&&Number.isInteger(t.holderCount))}:Promise.reject(Error('shape')))],
      ['rpc','Solana RPC',()=>rpc('getSlot',[]).then(d=>Number.isFinite(d?.result)&&!d.error?{slotReturned:true}:Promise.reject(Error('RPC error')))],
      ['rugcheck','RugCheck',()=>jfetch('https://api.rugcheck.xyz/v1/tokens/'+mint+'/report/summary',{},7000).then(d=>d&&typeof d==='object'&&!d.error?{responseReceived:true}:Promise.reject(Error('shape')))],
      ['goplus','GoPlus',()=>jfetch('https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses='+mint,
        {headers:process.env.GOPLUS_ACCESS_TOKEN?{authorization:'Bearer '+process.env.GOPLUS_ACCESS_TOKEN}:{}},7000)
        .then(d=>d&&typeof d==='object'&&d.code!==0?{responseReceived:true}:Promise.reject(Error('shape')))]
    ];
    if(process.env.BIRDEYE_API_KEY)tasks.push(['birdeye','Birdeye',()=>jfetch('https://public-api.birdeye.so/defi/price?address='+mint,
      {headers:{'X-API-KEY':process.env.BIRDEYE_API_KEY,'x-chain':'solana'}},7000)
      .then(d=>d?.success!==false&&d?.data?{responseReceived:true}:Promise.reject(Error('shape')))]);
    const rows=await Promise.all(tasks.map(async([id,name,fn])=>{
      const start=Date.now();
      try{return {id,name,status:'ok',latencyMs:Date.now()-start,...await fn()}}
      catch(e){const raw=String(e?.message||'').slice(0,70),status=raw.match(/^(401|403|404|429|5\d\d)\b/);
        return {id,name,status:'error',latencyMs:Date.now()-start,reason:status?'HTTP '+status[1]:/abort/i.test(raw)?'timeout':'unavailable-or-invalid-response'}}
    }));
    const configured={X_BEARER_TOKEN:!!process.env.X_BEARER_TOKEN,
      JUPITER_API_KEY:!!process.env.JUPITER_API_KEY,BIRDEYE_API_KEY:!!process.env.BIRDEYE_API_KEY,
      SOLANA_RPC_URL:!!process.env.SOLANA_RPC_URL,PUMP_FUN_API_KEY:!!process.env.PUMP_FUN_API_KEY,
      GOPLUS_ACCESS_TOKEN:!!process.env.GOPLUS_ACCESS_TOKEN,FOMO_API_KEY:!!process.env.FOMO_API_KEY,
      YOUTUBE_API_KEY:!!process.env.YOUTUBE_API_KEY,REDDIT_CLIENT_ID:!!process.env.REDDIT_CLIENT_ID,
      X_FULL_ARCHIVE_SEARCH:process.env.X_FULL_ARCHIVE_SEARCH==='true'};
    if(!configured.BIRDEYE_API_KEY)rows.push({id:'birdeye',name:'Birdeye',status:'missing-key',requiredKey:'BIRDEYE_API_KEY'});
    const xs=xFamousCache?.data?.status||pumpXMonitorCache?.data?.status||null;
    rows.push({id:'x',name:'X public posts',status:!configured.X_BEARER_TOKEN?'missing-key':
      xs==='ok'||xs==='scanned'?'ok':xs==='api-error'||xs==='x-api-errors'?'error':'configured-not-tested',
      requiredKey:configured.X_BEARER_TOKEN?null:'X_BEARER_TOKEN',note:'X API calls may cost credits; no extra call made for this health probe.'});
    rows.push({id:'pumpfun',name:'Pump.fun',status:configured.PUMP_FUN_API_KEY?'configured-not-tested':'public-fallback',
      requiredKey:configured.PUMP_FUN_API_KEY?null:'PUMP_FUN_API_KEY'});
    rows.push({id:'solscan',name:'Solscan',status:'link-only',
      requiredKey:'SOLSCAN_API_KEY',note:'Explorer links only; Solscan Pro API not integrated.'});
    const result={ok:true,generatedAt:new Date().toISOString(),cacheSeconds:300,rows,configured,
      note:'No API secrets are returned. Connectivity is sampled; errors may reflect rate limits or upstream outages.'};
    sourcesHealthCache={at:Date.now(),data:result};return result;
  })();
  try{return await sourcesHealthInFlight}finally{sourcesHealthInFlight=null}
}

const html=()=>String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>رادار سولانا · live-v4</title>
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
.tabs{display:flex;gap:6px;overflow:auto;scrollbar-width:none;margin-bottom:10px}.tab{white-space:nowrap}.top-tabs{position:sticky;top:58px;z-index:18;background:rgba(7,16,29,.96);padding:8px 0 10px;margin-top:-2px;border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}
.tab.active{background:#193759;border-color:#3d709f;color:#c0e1ff}
.tabs,.tab,.accordion>summary,.detail-btn,#refresh{pointer-events:auto!important;touch-action:manipulation}
#radarUiAlert{display:none;background:#421a24;border:1px solid #743040;color:#ffb9c3;border-radius:10px;padding:9px 12px;margin-bottom:10px;font-size:12px}
#radarUiAlert.visible{display:block}
button:focus-visible,.accordion>summary:focus-visible{outline:2px solid #9bd4ff;outline-offset:2px}
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

.panel{display:none!important}.panel.active{display:block!important}

html,body,.shell,.panel,.list{overflow-anchor:none}

/* Radar Workspace 2026: intentional hierarchy, quiet surfaces, responsive navigation */
:root{--bg:#080e19;--panel:#101a2a;--line:#243047;--text:#edf4ff;--muted:#95a5be;--good:#61daa8;--warn:#efc778;--bad:#ff8c9a;--blue:#96bdff}
body{background:radial-gradient(ellipse at 95% 0%,rgba(44,77,124,.14),transparent 32%),var(--bg);line-height:1.58}
.head,.shell{max-width:1320px}
.head{min-height:72px;padding:12px 25px}
.shell{padding:20px 24px 64px}
header{background:rgba(9,16,28,.94);border-color:#23344b}
.brand{gap:13px}
.brand .logo{width:40px;height:40px;border:1px solid #40648b;background:linear-gradient(145deg,#22486d,#0f223a);border-radius:13px;color:#9ce8d3;font-size:21px;box-shadow:0 6px 25px #0004}
.brand b{font-size:17px;letter-spacing:-.3px}
.brand small{font-size:11px;color:#93a8c5}
#refresh{border-color:#345775;background:#17314a;color:#cbe0ff;font-size:12px;font-weight:800;padding:9px 14px}
#refresh:hover{background:#224663}
.workspace-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;padding:6px 2px 18px}
.workspace-eyebrow{display:block;font-size:10px;letter-spacing:.9px;font-weight:900;color:var(--good);margin-bottom:5px}
.workspace-intro h1{font-size:clamp(21px,2.6vw,31px);line-height:1.3;margin:0 0 5px;letter-spacing:-.6px;font-weight:900}
.workspace-intro p{margin:0;font-size:12px;color:var(--muted);max-width:640px}
.workspace-status{border:1px solid #2b485c;background:#111f2b;color:#9ad8c2;border-radius:999px;font-size:10px;font-weight:800;padding:6px 11px;white-space:nowrap;display:flex;gap:7px;align-items:center}
.workspace-dot{width:7px;height:7px;background:#63d9ab;border-radius:50%;box-shadow:0 0 9px #63d9ab70}
.top-tabs{position:sticky;top:71px;z-index:18;background:rgba(8,14,25,.96);backdrop-filter:blur(16px);padding:10px 0 13px;margin:0 0 18px;border-bottom:1px solid #243348;overflow:visible}
.tabs{gap:6px;align-items:center;flex-wrap:wrap}
.tab{background:transparent;color:#a6b4cb;border:1px solid transparent;font-size:12px;font-weight:800;padding:10px 13px;border-radius:10px;min-height:40px;white-space:nowrap;transition:background .15s,border-color .15s}
.tab:hover{background:#18283d;color:white}
.tab.active{background:#1a3249;border-color:#365b70;color:#a8e8da;box-shadow:inset 0 -2px #54c9a3}
.nav-more{margin-inline-start:auto;position:relative;min-width:140px}
.nav-more>summary{cursor:pointer;list-style:none;border:1px solid #2d3f56;background:#121f31;padding:10px 12px;border-radius:10px;color:#c7d5e9;font-size:12px;font-weight:800;display:flex;justify-content:space-between;gap:12px;align-items:center}
.nav-more>summary::-webkit-details-marker{display:none}
.nav-more[open]>summary{background:#1a2c40;border-color:#45627e}
.nav-more-items{display:grid;gap:4px;position:absolute;top:calc(100% + 9px);inset-inline-end:0;width:max-content;min-width:210px;padding:7px;border:1px solid #354b66;border-radius:13px;background:#111f30;box-shadow:0 24px 60px #0009;z-index:22}
.nav-more-items .tab{text-align:start;width:100%;display:block}
.nav-more.has-active>summary{color:#a8e8da;border-color:#397b70}
#sourcesHealthPanel{margin:0 0 16px;background:#0e1725;border-style:dashed}
#sourcesHealthPanel>summary{font-size:12px;padding:12px 15px;color:#a5b7cf;font-weight:700}
#sourcesHealthPanel .accordion-body{padding:0 16px 14px}
.panel>.accordion,.panel>.top-dashboard>.accordion,.panel>.featured-only-secondary>.accordion{margin-bottom:13px}
.accordion{background:linear-gradient(150deg,#111c2d,#0d1725);border-color:#24354b;border-radius:15px;box-shadow:0 5px 18px #00000012}
.accordion.highlight{background:linear-gradient(125deg,#11283a,#101b2d 65%);border-color:#31516a}
.accordion>summary{padding:16px 19px;font-size:14px;font-weight:800;line-height:1.7;min-height:52px}
.accordion>summary:after{font-size:18px}
.accordion-body{padding:0 18px 17px}
.accordion:not([open])>summary{color:#b9c8da}
.accordion:not([open]):hover{border-color:#3c5774}
.note,.accordion p.muted{line-height:1.75}
.row{background:#111e2d;border:1px solid #26374c;border-radius:12px;padding:13px 14px;gap:10px;transition:border-color .15s,background .15s}
.row:hover{border-color:#3b5874;background:#142337}
.asset b{font-size:13px;line-height:1.6}
.asset small{font-size:11px;margin-top:4px}
.cell small{font-size:10px}.cell b{font-size:13px}
.actions{flex-wrap:wrap}
.actions a,.actions button{background:#17283c;border:1px solid #324760;border-radius:9px;padding:8px 10px}
.actions a:hover,.actions button:hover{background:#234362;border-color:#53789c}
.champion{background:linear-gradient(135deg,#13372f,#0d2135);border-color:#32695a;border-radius:14px;padding:16px}
.kpis{gap:10px}
.kpi{background:#152236;border-color:#293d55;padding:15px;border-radius:14px}
.kpi small{font-size:11px}.kpi b{font-size:24px}
.badge{padding:4px 9px}
.empty{padding:28px 16px;border-color:#34455b;background:#111b29;line-height:1.8}
#radarUiAlert{border-radius:12px;margin-bottom:14px}
button:focus-visible,.accordion>summary:focus-visible,.nav-more>summary:focus-visible,.tab:focus-visible{outline:2px solid #98e6d8;outline-offset:3px}
@media(max-width:900px){.head{padding:12px 16px}.shell{padding:16px}.top-tabs{top:63px}}
@media(max-width:620px){
 .head{min-height:60px;padding:9px 11px}.shell{padding:13px 12px 48px}
 .brand b{font-size:14px}.brand .logo{width:34px;height:34px}
 #refresh{font-size:11px;padding:8px 9px}
 .workspace-intro{padding:5px 0 13px;align-items:center}
 .workspace-intro h1{font-size:21px}.workspace-intro p{font-size:11px}
 .workspace-status{font-size:0;padding:7px}.workspace-dot{width:8px;height:8px}
 .top-tabs{top:59px;gap:5px;padding:7px 0 10px;margin-bottom:13px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin}
 .tab{font-size:11px;padding:8px 9px;min-height:38px}
 .nav-more{min-width:114px;margin-inline-start:0;flex-shrink:0}
 .nav-more>summary{font-size:11px;padding:9px}
 .nav-more-items{position:fixed;top:150px;inset-inline-start:12px;inset-inline-end:12px;width:auto;min-width:0}
 .accordion>summary{font-size:12px;padding:14px 13px;min-height:48px}
 .accordion-body{padding:0 11px 12px}
 .row{padding:10px}.kpi{padding:10px}.kpi b{font-size:20px}
 .actions a,.actions button{min-height:34px}
}
@media(prefers-reduced-motion:reduce){.tab,.row{transition:none}}

/* Quiet subsections: the default view shows the most useful six rows. */
.panel .list:not(.show-all)> .row:nth-child(n+7){display:none}
.list-more{display:none;align-items:center;justify-content:center;gap:7px;margin:10px 0 2px;
  padding:8px 14px;border:1px solid #344e67;background:#15283e;color:#b9d5ec;
  font-size:11px;font-weight:800;border-radius:10px;cursor:pointer}
.panel .list:has(> .row:nth-child(7)) + .list-more{display:inline-flex}
.list-more:hover{background:#20405e;border-color:#527594;color:white}
.section-index{margin:0 0 16px;border:1px solid #293e55;background:linear-gradient(130deg,#132237,#0e1827);
  border-radius:14px;padding:0 14px;overflow:visible}
.section-index>summary{cursor:pointer;list-style:none;display:flex;gap:12px;align-items:center;
  justify-content:space-between;padding:13px 0;font-size:12px;color:#bcd3e8;font-weight:850}
.section-index>summary::-webkit-details-marker{display:none}
.section-index>summary:after{content:'⌄';color:#91a8c4;transition:transform .15s}
.section-index[open]>summary:after{transform:rotate(180deg)}
.section-index-content{display:flex;flex-wrap:wrap;gap:7px;padding:0 0 14px}
.section-index-btn{min-height:35px;max-width:100%;padding:8px 12px;background:#192d43;border:1px solid #304963;
  color:#d4e5f4;border-radius:9px;font-size:11px;text-align:start;line-height:1.5;cursor:pointer}
.section-index-btn:hover{background:#245071;border-color:#4b83a3;color:#fff}
.section-index-count{font-size:10px;font-weight:700;color:#829cba;margin-inline-start:8px}
.accordion>summary{gap:12px}
.accordion>summary::before{content:'';width:4px;min-width:4px;height:18px;border-radius:5px;background:#47637d}
.accordion.highlight>summary::before{background:#5ad2af}
.accordion[open]>summary{color:#ebf7ff}
.accordion:not([open])>summary{background:rgba(10,18,31,.16)}
.accordion .accordion{box-shadow:none;border-color:#2b4158;background:#101d2c;margin-bottom:7px}
.accordion .accordion>summary{font-size:12px;min-height:44px;padding:10px 13px}
.accordion .accordion>.accordion-body{padding:0 12px 12px}
@media(max-width:620px){
 .section-index{padding:0 11px;margin-bottom:12px}
 .section-index>summary{font-size:11px;padding:12px 0}
 .section-index-content{display:grid;grid-template-columns:1fr 1fr;gap:7px}
 .section-index-btn{font-size:10px;min-height:38px}
 .list-more{min-height:36px}
}


/* Independent cards and full content views: no expanding/collapsing subsections. */
.radar-page-catalog{padding:8px 0 22px}
.radar-catalog-heading{margin:0 0 17px;padding:4px 2px 1px}
.radar-catalog-heading h2{font-size:19px;margin:0 0 5px;letter-spacing:-.3px}
.radar-catalog-heading p{font-size:12px;color:var(--muted);margin:0}
.radar-page-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.radar-page-card{min-height:106px;text-align:start;display:flex;align-items:center;gap:13px;
  border:1px solid #31465e;border-radius:15px;background:linear-gradient(140deg,#15253a,#0e1a2a);
  color:#eaf2fd;padding:17px;box-shadow:0 6px 20px #00000015;
  transition:transform .16s ease,border-color .16s ease,background .16s ease}
.radar-page-card:hover{transform:translateY(-2px);border-color:#508eab;
  background:linear-gradient(140deg,#1b3852,#11263c)}
.radar-page-card:focus-visible,.radar-page-back:focus-visible{outline:2px solid #85e1cd;outline-offset:3px}
.radar-page-card-icon{display:flex;align-items:center;justify-content:center;flex:0 0 41px;
  width:41px;height:41px;border-radius:12px;border:1px solid #37536a;background:#1a344a;font-size:19px}
.radar-page-card-name{flex:1;font-weight:850;font-size:13px;line-height:1.9}
.radar-page-card-arrow{font-size:20px;color:#68d7b5}
.radar-page-stage{min-width:0;padding-bottom:34px}
.radar-page-back{border:1px solid #38546f;background:#142940;color:#bce8dc;
  padding:11px 16px;border-radius:11px;font-size:12px;font-weight:800;margin-bottom:18px;cursor:pointer}
.radar-page-back:hover{background:#1e4259}
.radar-page-title{font-size:clamp(18px,2.3vw,25px);letter-spacing:-.3px;margin:2px 0 18px;
  padding-bottom:15px;border-bottom:1px solid #293e55}
.radar-page{display:block;min-width:0}
.radar-page[hidden],.radar-page-catalog[hidden],.radar-page-stage[hidden]{display:none!important}
.radar-page-content .subfilters{margin-top:12px}
.radar-page-content .row{margin-bottom:2px}
.radar-page-content .note{max-width:100%}
@media(max-width:900px){.radar-page-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.radar-page-grid{grid-template-columns:1fr 1fr;gap:9px}
 .radar-page-card{padding:12px;min-height:95px;gap:8px;flex-wrap:wrap;align-content:space-between}
 .radar-page-card-icon{width:34px;height:34px;flex-basis:34px;font-size:17px}
 .radar-page-card-name{font-size:11px;line-height:1.65}
 .radar-page-card-arrow{font-size:15px}
 .radar-page-title{font-size:18px;margin-bottom:12px}
 .radar-page-back{margin-bottom:13px}}
@media(max-width:350px){.radar-page-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.radar-page-card{transition:none}}


/* Spotlight dashboard: evidence-first, readable, and lightweight. */
body{font-size:15px}
.brand b{font-size:19px}.brand small{font-size:12px}
.workspace-intro p,.spotlight-head p{font-size:13px}
.tab{font-size:14px;font-weight:800;padding:11px 14px;gap:8px;display:inline-flex;align-items:center}
.nav-icon{width:19px;height:19px;flex-shrink:0}
.nav-more .tab{width:100%}
.nav-more>summary{font-size:13px}
.accordion>summary{font-size:15px}
.accordion-body,.note,.row{font-size:14px}
.row .asset b,.cell b{font-size:14px}
.row .asset small,.cell small,.accordion p.muted{font-size:12px}
.radar-page-card-name{font-size:14px}
.radar-page-card-icon{font-size:21px}
.radar-page-back{font-size:13px}
.kpi small{font-size:12px}.kpi b{font-size:25px}
.radar-spotlight{background:linear-gradient(140deg,#14263a,#0c1726 70%);border:1px solid #34526a;
  border-radius:19px;margin:0 0 19px;padding:21px;box-shadow:0 15px 36px #00000024}
.spotlight-head{display:flex;align-items:start;justify-content:space-between;gap:14px;margin-bottom:17px}
.spotlight-kicker{display:inline-flex;border:1px solid #3a6d5e;color:#80eac4;background:#16382f;
  padding:4px 10px;border-radius:99px;font-size:12px;font-weight:850;margin-bottom:9px}
.spotlight-heading h2{margin:0 0 5px;font-size:clamp(19px,2.2vw,25px);line-height:1.45}
.spotlight-heading p{margin:0;color:#acc0d8;line-height:1.65}
.spotlight-freshness{font-size:11px;color:#adbed5;border:1px solid #344a63;padding:7px 10px;border-radius:99px;white-space:nowrap}
.spotlight-layout{display:grid;grid-template-columns:1fr 1fr;gap:13px}
.spotlight-group{min-width:0;border:1px solid #30475f;border-radius:14px;background:#101d2d;padding:15px}
.spotlight-group-title{display:flex;gap:12px;align-items:center;margin-bottom:13px}
.spotlight-group-icon{font-size:21px;background:#1c3248;width:43px;height:43px;
  border-radius:12px;display:grid;place-items:center;flex-shrink:0}
.spotlight-group-title h3{margin:0;font-size:16px;line-height:1.5}
.spotlight-group-title p{margin:2px 0 0;color:#94abc5;font-size:12px;line-height:1.6}
.spotlight-results{display:grid;gap:9px}
.spotlight-token{min-width:0;border:1px solid #30445c;border-radius:12px;
  background:#14263a;padding:12px;display:flex;flex-direction:column;gap:7px}
.spotlight-token-top{display:flex;justify-content:space-between;align-items:center;gap:9px}
.spotlight-token strong{font-size:16px;overflow-wrap:anywhere}
.spotlight-token small{font-size:12px;color:#acbdd2;line-height:1.65;overflow-wrap:anywhere}
.spotlight-token-tags{display:flex;flex-wrap:wrap;gap:5px}
.spotlight-token-tags .badge{font-size:11px}
.spotlight-token-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:2px}
.spotlight-token-actions a,.spotlight-token-actions button{border:1px solid #43617b;
  background:#1c3952;color:#d8ecfa;padding:7px 11px;border-radius:9px;
  font:inherit;font-size:12px;text-decoration:none;cursor:pointer}
.spotlight-token-actions a:hover,.spotlight-token-actions button:hover{background:#295276}
.spotlight-empty{border:1px dashed #3b526b;border-radius:12px;color:#aabbce;
  padding:21px 13px;line-height:1.9;font-size:13px}
.spotlight-disclaimer{font-size:12px;color:#a3b8ce;line-height:1.8;margin:14px 1px 0}
@media(max-width:900px){.spotlight-layout{grid-template-columns:1fr}}
@media(max-width:620px){
 body{font-size:14px}.tab{font-size:12px;padding:9px 11px;gap:6px}
 .nav-icon{width:17px;height:17px}
 .radar-spotlight{padding:14px;margin-bottom:13px;border-radius:15px}
 .spotlight-head{flex-direction:column;gap:7px}
 .spotlight-freshness{font-size:11px}
 .spotlight-group{padding:12px}
 .spotlight-group-title h3{font-size:15px}
 .radar-page-card-name{font-size:12px}
 .accordion>summary{font-size:14px}.row .asset b{font-size:13px}
}

</style>
</head>
<body>
<header>
<div class="head">
  <div class="brand"><div class="logo">S</div><div><b>رادار سولانا</b><small>میم‌کوین · نهنگ · اسمارت‌مانی</small></div></div>
  <div style="display:flex;align-items:center;gap:7px"><span class="muted status" id="updated">در حال راه‌اندازی داده زنده…</span><button class="primary" id="refresh">↻ بروزرسانی</button></div>
</div>
</header>

<main class="shell">
<div id="radarUiAlert" role="alert"></div>
<div class="workspace-intro">
  <div><span class="workspace-eyebrow">SOLANA / MARKET INTELLIGENCE</span>
    <h1 id="workspaceTitle">داشبورد فرصت‌ها</h1>
    <p id="workspaceDescription">پیشنهادهای قابل بررسی، وضعیت ورود و هشدارهای مهم؛ با اولویت امنیت و داده واقعی.</p>
  </div>
  <div class="workspace-status" title="در حال پایش بازار"><span class="workspace-dot"></span><span>پایش زنده بازار</span></div>
</div>
<section class="radar-spotlight" id="radarSpotlight" aria-labelledby="spotlightHeading">
  <div class="spotlight-head">
    <div class="spotlight-heading"><span class="spotlight-kicker">★ اولویت رادار</span>
      <h2 id="spotlightHeading">سیگنال‌های ویژه بازار و شبکه‌های اجتماعی</h2>
      <p>تطبیق ترند اجتماعی با خرید قابل‌رصد نهنگ‌ها و بررسی پست‌های مستند ۲۴ ساعت پیش از پامپ</p></div>
    <span class="spotlight-freshness" id="spotlightUpdated">در انتظار اولین اسکن…</span>
  </div>
  <div class="spotlight-layout">
    <article class="spotlight-group">
      <div class="spotlight-group-title"><span class="spotlight-group-icon">🐋</span><div>
        <h3>ترند اجتماعی + خرید نهنگ</h3><p>هم‌زمان در داده‌های فعلی رادار · سیگنال خرید قطعی نیست</p></div></div>
      <div class="spotlight-results" id="spotlightSocialWhale"><div class="spotlight-empty">در حال دریافت سیگنال‌های بازار…</div></div>
    </article>
    <article class="spotlight-group">
      <div class="spotlight-group-title"><span class="spotlight-group-icon">𝕏</span><div>
        <h3>پست‌های ۲۴ ساعت قبل از پامپ</h3><p>فقط شواهد زمانی و آدرس قرارداد مستند · رویدادهای تاریخی</p></div></div>
      <div class="spotlight-results" id="spotlightPrePump"><div class="spotlight-empty">در حال بررسی کندل‌ها و پست‌های X…</div></div>
    </article>
  </div>
  <p class="spotlight-disclaimer" id="spotlightCoverage">پوشش قابل‌بررسیِ زمان پست فعلاً از X است. اینستاگرام، یوتیوب، فیسبوک و سایر شبکه‌ها تنها در صورت دریافت زمان انتشار و شواهد مستقل به این بخش افزوده می‌شوند؛ نبود داده به معنی نبود ترند نیست.</p>
</section>
<nav class="tabs top-tabs" id="tabs" aria-label="بخش‌های رادار">
  <button type="button" class="tab active" data-tab="featured" aria-selected="true"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v10M7 12h10"/></svg> ◈ نمای کلی</button>
  <button type="button" class="tab" data-tab="tokens" aria-selected="false"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-9"/><path d="M16 6h5v5"/></svg> ◉ بازار و توکن‌ها</button>
  <button type="button" class="tab" data-tab="social" aria-selected="false"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.38 8.38 0 0 1 12.5 3h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> ◎ شبکه‌های اجتماعی</button>
  <button type="button" class="tab" data-tab="wallets" aria-selected="false"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M16 14h5M3 9h18"/><circle cx="16" cy="14" r="1"/></svg> ▣ کیف‌پول‌ها</button>
  <details class="nav-more" id="advancedMenu">
    <summary>ابزارهای پیشرفته <span aria-hidden="true">⌄</span></summary>
    <div class="nav-more-items">
      <button type="button" class="tab" data-tab="whales" aria-selected="false"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12c2-5 6-7 11-7 4 0 7 3 7 7 0 5-5 8-10 8-4 0-7-2-8-5"/><path d="M20 10l3-3M8 11h.01"/></svg> 🐋 ردیابی نهنگ‌ها</button>
      <button type="button" class="tab" data-tab="smart" aria-selected="false"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 22h4M9 13a5 5 0 0 1-2-4 5 5 0 0 1 10 0 5 5 0 0 1-2 4l-1 3h-4z"/></svg> 🧠 اسمارت‌مانی</button>
      <button type="button" class="tab" data-tab="prelaunch" aria-selected="false"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 16c-1-4 1-9 5-12l2-2 2 2c4 3 6 8 5 12l-7 4z"/><path d="M9 16l-3 5M15 16l3 5"/><circle cx="12" cy="9" r="2"/></svg> 🚀 پیش‌لانچ</button>
    </div>
  </details>
</nav>
<details class="accordion" id="sourcesHealthPanel">
  <summary>⚙️ تنظیمات و سلامت اتصال منابع داده (پیشرفته)</summary>
  <div class="accordion-body">
    <p class="muted" id="sourcesHealthStatus">در حال بررسی منبع‌های بازار...</p>
    <div class="list" id="sourcesHealthList"></div>
    <p class="muted" style="font-size:11px">وضعیت API هر پنج دقیقه بررسی می‌شود. خطای موقت یا سهمیه مصرف‌شده به معنی خرابی دائمی نیست. کلیدها نمایش داده نمی‌شوند.</p>
    <div class="actions"><a class="action" href="/api/v1/sources-health" target="_blank" rel="noopener">مشاهده پاسخ عیب‌یابی API</a></div>
  </div>
</details>
<section class="panel active" id="featuredPanel">
<details class="section-index" data-index-for="featured"><summary>راهنمای زیرمجموعه‌های این بخش <span class="section-index-count">مشاهده همه قسمت‌ها</span></summary><div class="section-index-content"></div></details>
<section class="top-dashboard">
  <details class="accordion highlight" open>
    <summary>🔥 پیشنهادهای ورود برتر</summary>
    <div class="accordion-body">
      <p class="muted" style="font-size:11px">پیشنهاد ویژه: HIGH/MAX با امنیت هسته‌ای تأییدشده و بدون ریسک قطعی Rug/Bot/PumpDump. ENTRY فعال بالاتر می‌آید؛ کاندید امنی که هنوز خریدار غالب نشده با برچسب «صبر / در انتظار ورود» نمایش داده می‌شود. UNKNOWN جانبی فقط اعتماد را کم می‌کند.</p>
      <div class="list" id="topFeaturedQuick"></div>
    </div>
  </details>


</section>
<details class="accordion">
    <summary>🔍 همه پیشنهادها و فیلترهای پیشرفته</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">منطق ورود متعادل: وقتی قدرت خریدار از فروشنده بیشتر باشد سیگنال ورود فعال می‌شود، مگر اینکه Bot/Wash پرریسک، ریسک امنیتی قطعی، نقض قطعی قانون هولدر یا فشار خروج زنده سنگین وجود داشته باشد. خریدار 100$+ و فیلتر مومنتوم DEX فقط قدرت سیگنال را بیشتر می‌کنند و دیگر شرط اجباری نیستند.</p><div class="subfilters">
<label>کوتاه‌مدت<select class="signal-filter" data-filter="short"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>میان‌مدت<select class="signal-filter" data-filter="medium"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>بلندمدت<select class="signal-filter" data-filter="long"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>امنیت<select class="signal-filter" data-filter="security"><option value="">همه</option><option value="MAX SECURITY">خیلی بالا</option><option value="HIGH">بالا</option><option value="REVIEW">نیاز به بررسی</option><option value="REJECT">رد</option></select></label>
<label>تعداد کل هولدرهای توکن<select class="signal-filter" data-filter="totalholders"><option value="" selected>همه توکن‌ها (بدون فیلتر هولدر)</option><option value="1000">حداقل ۱۰۰۰ هولدر</option><option value="2000">حداقل ۲۰۰۰ هولدر</option><option value="5000">حداقل ۵۰۰۰ هولدر</option></select></label>
</div><div class="list" id="featuredList"></div></div>
  </details>
<div class="featured-only-secondary">
<details class="accordion highlight" open>
  <summary>🏆 بهترین سیگنال کل رادار</summary>
  <div class="accordion-body" id="championBox"></div>
</details>

  <details class="accordion">
    <summary>💰 گزارش عملکرد سیگنال‌ها</summary>
    <div class="accordion-body">
      <p class="muted" style="font-size:11px">هر آیتم سه مقدار جدا دارد: 💵 قیمت ورود ثابت، ⚡ قیمت لحظه‌ای بازار، 💰 سود/ضرر لحظه‌ای. قیمت ورود بعد از ثبت تغییر نمی‌کند؛ قیمت لحظه‌ای تقریباً هر ۱ ثانیه تازه می‌شود.</p>
      <div id="recommendationPerformanceSummary"></div>
      <div id="entryFactorAnalysis" class="note"></div>
      <p class="muted" style="font-size:11px">این آمار عملکرد توکن از زمان صدور سیگنال است، نه PnL محقق‌شده معامله. برای برآیند خالص باید هزینه رفت‌وبرگشت، اسلیپیج و اجرای واقعی لحاظ شود.</p>
      <div class="list" id="recommendationPerformanceList"></div>
    </div>
  </details>

  <details class="accordion">
    <summary>📈 تغییر قیمت بازار در ۲۴ ساعت اخیر (نه بازده سیگنال)</summary>
    <div class="accordion-body">
      <p class="muted" style="font-size:11px">بازدهی بازار در ۲۴ ساعت اخیر برای توکن‌های امن و امتیازبالای فعلی رادار. برای توکن جوان‌تر از ۲۴ ساعت، تغییر از زمان ساخت تا اکنون نمایش داده می‌شود.</p>
      <div id="performance24Summary"></div>
      <div class="list" id="performance24List"></div>
    </div>
  </details>

<details class="accordion">
  <summary>📊 آمار کامل رادار</summary>
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



<details class="accordion">
  <summary>🔎 جستجو و فیلترها</summary>
  <div class="accordion-body"><div class="toolbar">
    <input id="search" placeholder="جستجو نام، نماد یا آدرس">
    <select id="securityFilter"><option value="">همه امنیت‌ها</option><option value="MAX SECURITY">امنیت خیلی بالا</option><option value="HIGH">امنیت بالا</option></select>
    <select id="activityFilter"><option value="">همه فعالیت‌ها</option><option value="PROBABLE ORGANIC">فعالیت طبیعی</option><option value="BOT RISK">ریسک ربات</option></select>
  </div></div>
</details>
</div>
</section>



<section class="panel" id="whalesPanel">
<details class="section-index" data-index-for="whales"><summary>راهنمای زیرمجموعه‌های این بخش <span class="section-index-count">مشاهده همه قسمت‌ها</span></summary><div class="section-index-content"></div></details>
  <details class="accordion highlight" open>
  <summary>🐋 پیشنهادهای نهنگ‌ها و همه خریدهای زنده</summary>
  <div class="accordion-body">
    <p class="muted" style="font-size:11px">خریدهای نهنگ از جریان زنده API و تجمیع چند خرید یک کیف‌پول در پنجره ۳۰ دقیقه‌ای ساخته می‌شوند؛ خریدهای خردشده هم اگر مجموعشان به حد نهنگ برسد شناسایی می‌شوند. این برچسب تضمین رشد یا سود نیست.</p>
    <div id="whaleTopSummary"></div>
    <div class="list" id="whaleTopList"></div>
  </div>
</details>
  <details class="accordion">
    <summary>🐋 خریدهای نهنگ</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">خرید بزرگ اخیر و هشدار خروج.</p><div id="whaleSummary"></div><div class="subfilters">
<label>کوتاه‌مدت<select class="signal-filter" data-filter="short"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>میان‌مدت<select class="signal-filter" data-filter="medium"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>بلندمدت<select class="signal-filter" data-filter="long"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>امنیت<select class="signal-filter" data-filter="security"><option value="">همه</option><option value="MAX SECURITY">خیلی بالا</option><option value="HIGH">بالا</option><option value="REVIEW">نیاز به بررسی</option><option value="REJECT">رد</option></select></label>
<label>تعداد کل هولدرهای توکن<select class="signal-filter" data-filter="totalholders"><option value="" selected>همه توکن‌ها (بدون فیلتر هولدر)</option><option value="1000">حداقل ۱۰۰۰ هولدر</option><option value="2000">حداقل ۲۰۰۰ هولدر</option><option value="5000">حداقل ۵۰۰۰ هولدر</option></select></label>
</div><div class="list" id="whaleList"></div></div>
  </details>
</section>

<section class="panel" id="smartPanel">
<details class="section-index" data-index-for="smart"><summary>راهنمای زیرمجموعه‌های این بخش <span class="section-index-count">مشاهده همه قسمت‌ها</span></summary><div class="section-index-content"></div></details>
  <details class="accordion" open>
    <summary>🧠 اسمارت‌مانی</summary>
    <div class="accordion-body"><p class="muted" id="smartStatus" style="font-size:11px">در حال دریافت…</p><div class="subfilters">
<label>کوتاه‌مدت<select class="signal-filter" data-filter="short"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>میان‌مدت<select class="signal-filter" data-filter="medium"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>بلندمدت<select class="signal-filter" data-filter="long"><option value="">همه</option><option value="STRONG">قوی</option><option value="POSITIVE">مثبت</option><option value="NEUTRAL">خنثی</option><option value="WAIT_DATA">داده ناکافی</option><option value="AVOID">ورود نکن</option><option value="BLOCKED">مسدود امنیتی</option></select></label>
<label>امنیت<select class="signal-filter" data-filter="security"><option value="">همه</option><option value="MAX SECURITY">خیلی بالا</option><option value="HIGH">بالا</option><option value="REVIEW">نیاز به بررسی</option><option value="REJECT">رد</option></select></label>
<label>تعداد کل هولدرهای توکن<select class="signal-filter" data-filter="totalholders"><option value="" selected>همه توکن‌ها (بدون فیلتر هولدر)</option><option value="1000">حداقل ۱۰۰۰ هولدر</option><option value="2000">حداقل ۲۰۰۰ هولدر</option><option value="5000">حداقل ۵۰۰۰ هولدر</option></select></label>
</div><div class="list" id="smartList"></div></div>
  </details>
</section>

<section class="panel" id="prelaunchPanel">
<details class="section-index" data-index-for="prelaunch"><summary>راهنمای زیرمجموعه‌های این بخش <span class="section-index-count">مشاهده همه قسمت‌ها</span></summary><div class="section-index-content"></div></details>
  <details class="accordion highlight" open>
    <summary>🚀 رادار پیش‌لانچ سولانا</summary>
    <div class="accordion-body">
      <p class="muted" id="prelaunchStatus" style="font-size:11px">در حال بررسی پروژه‌های قبل از TGE…</p>
      <div class="kpis">
        <div class="kpi"><small>کاندیدها</small><b id="kPrelaunch">—</b></div>
        <div class="kpi"><small>امتیاز 80+</small><b id="kPrelaunchStrong">—</b></div>
        <div class="kpi"><small>شواهد امنیتی</small><b id="kPrelaunchSecurity">—</b></div>
        <div class="kpi"><small>مدل</small><b style="font-size:12px">Evidence only</b></div>
      </div>
      <div class="note">قبل از لانچ، هولدر/Mint/Freeze قابل تأیید کامل نیست. امتیاز از ترند اجتماعی، تیم، Audit/Multisig، Vesting/Tokenomics، پشتیبان‌ها و شفافیت TGE ساخته می‌شود.</div>
      <details class="accordion highlight" open>
  <summary>⭐ پیشنهادهای پیش‌لانچ برای بررسی</summary>
  <div class="accordion-body">
    <p class="muted" style="font-size:11px">این لیست Watch است: پروژه‌های ترند/تیم‌دار که ریسک قطعی ندارند. فقط پروژه‌های دارای KYC + Audit + LP Lock تأییدشده در «امنیت بالا» قرار می‌گیرند.</p>
    <div class="list" id="prelaunchSuggestedList"></div>
  </div>
</details>
<details class="accordion highlight"><summary>🛡️ پیش‌لانچ با امنیت بالا</summary><div class="accordion-body"><div class="list" id="prelaunchHighList"></div></div></details>
<details class="accordion"><summary>⚖️ پیش‌لانچ با امنیت متوسط</summary><div class="accordion-body"><div class="list" id="prelaunchMediumList"></div></div></details>
<details class="accordion"><summary>⚠️ پیش‌لانچ با امنیت بسیار کم</summary><div class="accordion-body"><div class="list" id="prelaunchLowList"></div></div></details>
      <details class="accordion highlight">
        <summary>⚡ رادار Early Launch — مناسب برای بررسی خرید</summary>
        <div class="accordion-body">
          <p class="muted" style="font-size:11px">توکن‌های تازه‌لانچ‌شده از Pump.fun/DEXScreener با امتیاز ترکیبی امنیت، جریان خریدار، Social Heat، نهنگ/اسمارت‌مانی و—در صورت دسترسی—تریدرهای سودده Pump.fun. این لیست تضمین خرید نیست.</p>
          <div class="list" id="earlyLaunchList"></div>
        </div>
      </details>
      <details class="accordion highlight">
        <summary>🏆 هوش تریدرهای برتر Pump.fun</summary>
        <div class="accordion-body">
          <p class="muted" id="pumpTraderIntelStatus" style="font-size:11px">در حال دریافت Leaderboard و پوزیشن‌ها…</p>
          <div class="list" id="pumpTraderIntelList"></div>
        </div>
      </details>
      <details class="accordion">
        <summary>🛡️ هوش امنیت چندمنبعی</summary>
        <div class="accordion-body">
          <p class="muted" style="font-size:11px">SolidProof برای Audit/KYC/TrustNet؛ RugCheck + GoPlus برای قرارداد/هولدر/Rug/Honeypot؛ CertiK/TokenSniffer/Bubblemaps به‌عنوان شواهد تکمیلی و لینک تحقیق.</p>
          <div class="list" id="multiSourceSecurityList"></div>
        </div>
      </details>
      <details class="accordion highlight">
        <summary>📈 عملکرد پیشنهادهای پیش‌لانچ بعد از لانچ</summary>
        <div class="accordion-body">
          <p class="muted" style="font-size:11px">رشد/افت از اولین قیمت تاریخی قابل‌دریافت نزدیک زمان ساخت Pair تا قیمت فعلی. اگر قیمت شروع قابل‌تأیید نباشد، درصد نمایش داده نمی‌شود.</p>
          <div class="list" id="prelaunchPerformanceList"></div>
        </div>
      </details>
      <details class="accordion">
        <summary>🧭 منابع کشف و بررسی از راهنمای فایل</summary>
        <div class="accordion-body">
          <div class="list" id="prelaunchSources">
            <div class="row"><div class="asset"><b>PinkSale</b><small>کشف Presale/Upcoming؛ KYC/Audit/LP Lock را با مدرک اصلی تطبیق بده.</small></div><div class="actions"><a class="action" target="_blank" rel="noopener" href="https://www.pinksale.finance">باز کردن</a></div></div>
            <div class="row"><div class="asset"><b>Pump.fun</b><small>ورود بسیار زودهنگام سولانا؛ ریسک بالا و معمولاً بدون غربال امنیتی تیم.</small></div><div class="actions"><a class="action" target="_blank" rel="noopener" href="https://pump.fun">باز کردن</a></div></div>
            <div class="row"><div class="asset"><b>Polkastarter</b><small>پروژه‌های گزینش‌شده و عرضه اولیه ساختاریافته.</small></div><div class="actions"><a class="action" target="_blank" rel="noopener" href="https://polkastarter.com">باز کردن</a></div></div>
            <div class="row"><div class="asset"><b>Four.meme</b><small>میم‌کوین‌های BNB Chain؛ فقط برای مقایسه/کشف خارج از سولانا.</small></div><div class="actions"><a class="action" target="_blank" rel="noopener" href="https://four.meme">باز کردن</a></div></div>
            <div class="row"><div class="asset"><b>SolidProof / CertiK / RugCheck / TokenSniffer / GoPlus</b><small>بررسی Audit، KYC/تیم، قرارداد، مجوزها، Rug/Honeypot و ریسک‌های امنیتی.</small></div><div class="actions"><a class="action" target="_blank" rel="noopener" href="https://app.solidproof.io">SolidProof</a><a class="action" target="_blank" rel="noopener" href="https://skynet.certik.com">CertiK</a><a class="action" target="_blank" rel="noopener" href="https://rugcheck.xyz">RugCheck</a><a class="action" target="_blank" rel="noopener" href="https://tokensniffer.com">TokenSniffer</a><a class="action" target="_blank" rel="noopener" href="https://gopluslabs.io">GoPlus</a></div></div>
            <div class="row"><div class="asset"><b>Bubblemaps + DEXScreener</b><small>ارتباط کیف‌پول‌ها/تمرکز مالکیت و سپس نقدینگی، حجم و شروع بازار.</small></div><div class="actions"><a class="action" target="_blank" rel="noopener" href="https://bubblemaps.io">Bubblemaps</a><a class="action" target="_blank" rel="noopener" href="https://dexscreener.com">DEXScreener</a></div></div>
          </div>
        </div>
      </details>
    </div>
  </details>
  <details class="accordion">
    <summary>🧪 مدل امتیاز پیش‌لانچ</summary>
    <div class="accordion-body"><div class="note">Pre‑Launch Core: Social 20 · Team 15 · Team Verified 5 · KYC 10 · Audit 15 · LP Lock 15 · Tokenomics/Vesting 10 · Backing 10 · Launch 5. Early‑Launch رتبه جداگانه دارد: امنیت آن‌چین + Buyer Flow + Social + Liquidity + Whale/Smart Money + Pump Top Traders. ادعا یا وعده = امتیاز کامل نمی‌گیرد؛ مدرک مستقل لازم است.</div></div>
  </details>
</section>
<section class="panel" id="socialPanel">
<details class="section-index" data-index-for="social"><summary>راهنمای زیرمجموعه‌های این بخش <span class="section-index-count">مشاهده همه قسمت‌ها</span></summary><div class="section-index-content"></div></details>
  <details class="accordion highlight" open>
    <summary>🌟 رصد اکانت‌های مشهور X، به‌ویژه ایلان ماسک</summary>
    <div class="accordion-body">
      <p class="muted" id="famousXStatus">در حال بررسی فهرست حساب‌های عمومی...</p>
      <p class="muted" style="font-size:11px">این بخش اکانت‌ها را داخل رادار رصد می‌کند. برای Follow واقعی در حساب توییتر، لینک پروفایل را باز کرده و خودت Follow را بزن. پست بدون آدرس دقیق قرارداد، سیگنال خرید نیست. جستجوی X API ممکن است اعتبار مصرف کند؛ درخواست‌ها حداکثر ساعتی یک‌بار انجام می‌شوند.</p>
      <h3 style="font-size:13px">👤 حساب‌های رصدشده و لینک Follow</h3>
      <div id="famousXAccounts" class="list"></div>
      <h3 style="font-size:13px">🗣 تازه‌ترین پست‌های واقعی مرتبط با میم‌کوین</h3>
      <div id="famousXPosts" class="list"></div>
    </div>
  </details>
  <details class="accordion highlight">
    <summary>🕵️‍♂️ اکانت‌های X که ۲۴ ساعت قبل از پامپ، قرارداد ارز را معرفی کرده‌اند</summary>
    <div class="accordion-body">
      <p class="muted" id="pumpXStatus">در حال آماده‌سازی مقایسه قیمت تاریخی و پست‌های X...</p>
      <p class="muted" style="font-size:11px">پامپ با کندل تاریخی ۱۵ دقیقه‌ای و رشد حداقل ۵۰٪ در یک ساعت شناسایی می‌شود. پست‌ها باید شامل آدرس دقیق توکن، اشاره به ورود/خرید و تاریخ قبل از شروع پامپ باشند. اکانت‌ها داخل رادار ردیابی می‌شوند، نه در حساب X شما. سبز بودن به معنی تضمین یا احتمال عددی پامپ نیست.</p>
      <h3 style="font-size:13px">🟢 کاندیدهای اجتماعی با تطابق تأییدشده</h3>
      <div id="pumpXWatchlist" class="list"></div>
      <h3 style="font-size:13px">🕵️ بررسی کانترکت‌های ارسالی — ۲۴ ساعت قبل از پامپ</h3>
      <div id="pumpXSubmitted" class="list"></div>
      <h3 style="font-size:13px">👤 اکانت‌های زودهنگام ردیابی‌شده</h3>
      <div id="pumpXAccounts" class="list"></div>
      <h3 style="font-size:13px">📈 پامپ‌های تاریخی و پست‌های قبل از رشد</h3>
      <div id="pumpXHistory" class="list"></div>
    </div>
  </details>
  <details class="accordion">
    <summary>💰 عملکرد سیگنال‌های ترند اجتماعی از زمان معرفی</summary>
    <div class="accordion-body">
      <p class="muted" style="font-size:11px">فقط توکن‌های دارای منشن مستقل X/Bluesky یا ویدیوی قابل‌شمارش هنگام ثبت، ترند اجتماعی محسوب می‌شوند. سابقه‌های قبلی بدون این شواهد جدا نگهداری شده‌اند. بازده، تغییر قیمت است نه سود تضمین‌شده.</p>
      <div id="socialPerformanceSummary"></div>
      <div class="list" id="socialPerformanceList"></div>
    </div>
  </details>
  <details class="accordion">
    <summary>📣 داغ‌ترین توکن‌ها در شبکه‌های اجتماعی</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">امتیاز Social Heat به‌تنهایی سیگنال نیست. فقط با منشن شمارش‌شده مستقل نمایش داده می‌شود. امنیت و خطر تخلیه استخر همچنان شرط جداگانه ورود هستند.</p><div class="list" id="socialList"></div></div>
  </details>
</section>

<section class="panel" id="walletsPanel">
<details class="section-index" data-index-for="wallets"><summary>راهنمای زیرمجموعه‌های این بخش <span class="section-index-count">مشاهده همه قسمت‌ها</span></summary><div class="section-index-content"></div></details>
  <details class="accordion highlight" open>
    <summary>🏆 تریدرهای برتر — سرمایه‌گذاری مشترک و پیشنهاد رادار</summary>
    <div class="accordion-body">
      <p class="muted" id="topTraderStatus" style="font-size:11px">در حال اسکن آدرس‌های ارسالی…</p>
      <div id="topTraderBest"></div>
      <h3 style="font-size:13px">⚡ خریدهای مشترک مشاهده‌شده در ۲۴ ساعت اخیر</h3>
      <p class="muted" style="font-size:11px">✅ خرید تأییدشده = تراکنش Swap تأییدشده در RPC. 👁 افزایش موجودی = لزوماً خرید نیست. خریدهای مشترک فقط از زمان آغاز مانیتور قابل تشخیص‌اند.</p>
      <div class="list" id="topTraderSharedBuys"></div>
      <h3 style="font-size:13px">🤝 ارزهای مشترک در پرتفوی تریدرها (صرفاً نگهداری)</h3>
      <div class="list" id="topTraderShared"></div>
      <h3 style="font-size:13px">⚡ شروع خرید/انباشت مشاهده‌شده</h3>
      <div class="list" id="topTraderRecentBuys"></div>
    </div>
  </details>
  <details class="accordion">
    <summary>💼 پرتفوی تریدرهای برتر</summary>
    <div class="accordion-body"><div class="list" id="topTraderWallets"></div></div>
  </details>
  <details class="accordion">
    <summary>🏆 وضعیت کیف‌پول‌های برتر</summary>
    <div class="accordion-body"><p class="muted" id="walletStatus" style="font-size:11px">در حال اسکن آن‌چین…</p></div>
  </details>
  <details class="accordion">
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
  <details class="accordion">
    <summary>🧱 کیف‌پول‌های سودده با هولد ۷ روز+</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">فروش جزئی ممکن است رخ داده باشد؛ برای تأیید نهایی تاریخچه را بررسی کن.</p><div class="list" id="convictionList"></div></div>
  </details>
  <details class="accordion">
    <summary>👛 فهرست کیف‌پول‌ها و آخرین حرکت</summary>
    <div class="accordion-body"><div class="list" id="walletList"></div></div>
  </details>
</section>

<section class="panel" id="tokensPanel">
<details class="section-index" data-index-for="tokens"><summary>راهنمای زیرمجموعه‌های این بخش <span class="section-index-count">مشاهده همه قسمت‌ها</span></summary><div class="section-index-content"></div></details>
  <details class="accordion highlight" open>
    <summary>🪙 توکن‌های برتر رادار</summary>
    <div class="accordion-body">
      <p class="muted" style="font-size:11px">توکن‌های دارای بالاترین امتیاز فعلی رادار با امنیت، جریان خرید، حجم و وضعیت ورود.</p>
      <div class="list" id="topTokenQuick"></div>
    </div>
  </details>
  <details class="accordion highlight">
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
<label>تعداد کل هولدرهای توکن<select class="signal-filter" data-filter="totalholders"><option value="" selected>همه توکن‌ها (بدون فیلتر هولدر)</option><option value="1000">حداقل ۱۰۰۰ هولدر</option><option value="2000">حداقل ۲۰۰۰ هولدر</option><option value="5000">حداقل ۵۰۰۰ هولدر</option></select></label>
<label>هولدر ردیابی‌شده ۱۰۰۰$+<select class="signal-filter" data-filter="holders"><option value="">همه</option><option value="1">حداقل ۱ هولدر</option><option value="2">حداقل ۲ هولدر</option><option value="3">حداقل ۳ هولدر</option></select></label>
<label>خریدار ۵۰۰$+ بیشتر از فروشنده (فقط فیلتر نمایش)<select class="signal-filter" data-filter="bigbuyers"><option value="">همه</option><option value="yes">فقط خریدار غالب</option></select></label>
</div><p class="muted" style="font-size:11px">قانون اجباری هولدر: هولدر #1 باید کمتر از 10% باشد و تک‌تک هولدرهای #2 تا #10 کمتر از 5%. برای سیگنال ورود امن، هر 10 هولدر باید با مالک تجمیع‌شده قابل بررسی باشند؛ Mint/Freeze، Sellability، RugCheck، LP Lock/Burn، Dev/Insider و Token-2022 نیز باید بدون رد یا داده نامشخص بحرانی باشند.</p></div>
  </details>
  <details class="accordion highlight">
    <summary>💰 عملکرد توکن‌ها از اولین ورود به رادار</summary>
    <div class="accordion-body">
      <p class="muted" style="font-size:11px">هر آیتم سه مقدار جدا دارد: 💵 قیمت ورود ثابت، ⚡ قیمت لحظه‌ای بازار، 💰 سود/ضرر لحظه‌ای. مبنای ورود ثابت می‌ماند و در اختلال کوتاه آخرین قیمت معتبر حفظ می‌شود.</p>
      <div id="tokenRadarPerformanceSummary"></div>
      <div class="actions"><button type="button" id="exportSignalHistory" class="action">⬇ خروجی CSV تاریخچه کشف‌ها و سیگنال‌های ورود</button></div>
      <p class="muted" style="font-size:11px">خروجی شامل همان داده‌های ذخیره‌شده در همین مرورگر است؛ سابقه همه کاربران یا معاملات واقعی را شامل نمی‌شود.</p>
      <div class="list" id="tokenRadarPerformanceList"></div>
    </div>
  </details>
  <details class="accordion highlight" open>
    <summary>🛡️ توکن‌های با امنیت بالا</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">MAX SECURITY + عبور کامل از Anti-Rug و بدون بلاک امنیتی.</p><div class="list" id="highSecurityTokenList"></div></div>
  </details>
  <details class="accordion">
    <summary>⚖️ توکن‌های با امنیت متوسط</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">توکن‌های HIGH/REVIEW بدون رد امنیتی قطعی؛ بعضی شواهد هنوز کامل نیست.</p><div class="list" id="mediumSecurityTokenList"></div></div>
  </details>
  <details class="accordion">
    <summary>⚠️ توکن‌های با امنیت بسیار کم</summary>
    <div class="accordion-body"><p class="muted" style="font-size:11px">توکن‌های دارای رد امنیتی، ریسک Rug/Bot/Wash، هولدر نامناسب یا شواهد بحرانی ناقص.</p><div class="list" id="lowSecurityTokenList"></div></div>
  </details>
</section>


</main>

<dialog id="detailDialog">
  <div class="modal-head"><b id="detailTitle">جزئیات</b><button id="closeDetail">×</button></div>
  <div class="modal-body" id="detailBody"></div>
</dialog>

<script>
/* Minimal independent navigation: functional even if the heavy market script fails. */
(function(){
  function showUiError(msg){
    var el=document.getElementById('radarUiAlert');
    if(el){el.textContent=msg;el.classList.add('visible')}
  }
  window.radarShowUiError=showUiError;
  window.radarSwitchTab=function(name){
    if(!/^(featured|whales|tokens|smart|prelaunch|social|wallets)$/.test(name))return;
    var panel=document.getElementById(name+'Panel');
    if(!panel)return;
    document.querySelectorAll('#tabs .tab').forEach(function(btn){
      var active=btn.getAttribute('data-tab')===name;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-selected',active?'true':'false');
    });
    document.querySelectorAll('.panel').forEach(function(item){
      item.classList.toggle('active',item===panel);
    });
    window.activeTab=name;
    var titles={
      featured:['داشبورد فرصت‌ها','پیشنهادهای قابل بررسی، وضعیت ورود و هشدارهای مهم؛ با اولویت امنیت و داده واقعی.'],
      tokens:['بازار و توکن‌ها','کشف توکن‌های سولانا، قیمت لحظه‌ای، فیلتر امنیت و بررسی آدرس قرارداد.'],
      social:['رادار اجتماعی','رصد X و اکانت‌های مشهور، پست‌های پیش از پامپ و شواهد قابل بررسی.'],
      wallets:['ردیابی کیف‌پول‌ها','تریدرهای برتر، خریدهای مشترک، پوزیشن‌ها و عملکرد تخمینی.'],
      whales:['ردیابی نهنگ‌ها','ورود و خروج سرمایه بزرگ، جریان خرید و نشانه‌های هشدار.'],
      smart:['اسمارت‌مانی','رفتار کیف‌پول‌های منتخب و مقایسه سیگنال‌های سرمایه هوشمند.'],
      prelaunch:['رادار پیش‌لانچ','پروژه‌های پیش از عرضه و شواهد امنیتی؛ صرفاً برای بررسی.']
    };
    var info=titles[name],title=document.getElementById('workspaceTitle'),desc=document.getElementById('workspaceDescription');
    if(info&&title)title.textContent=info[0];
    if(info&&desc)desc.textContent=info[1];
    var menu=document.getElementById('advancedMenu');
    if(menu){menu.classList.toggle('has-active',['whales','smart','prelaunch'].includes(name));menu.open=false;}
    if(typeof window.radarRenderActivePanel==='function'){
      try{window.radarRenderActivePanel()}catch(err){
        showUiError('خطای بارگذاری تب: '+String(err&&err.message||err));
      }
    }
  };
  document.addEventListener('click',function(ev){
    var target=ev.target&&ev.target.closest?ev.target:null;
    if(!target)return;
    var tab=target.closest('#tabs [data-tab]');
    if(tab){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      window.radarSwitchTab(tab.getAttribute('data-tab'));
      return;
    }
  },true);

  // Standalone subsection pages. Every former accordion becomes an independent
  // card and a dedicated content view; no section is expanded as a dropdown.
  // Move DOM nodes instead of recreating HTML to preserve live market bindings.
  function setupSubsections(){
    document.querySelectorAll('.panel').forEach(function(panel){
      if(panel.classList.contains('subpages-ready'))return;
      var previous=panel.querySelector('.section-index');
      if(previous)previous.remove();
      var sections=[...panel.querySelectorAll('details.accordion')];
      if(!sections.length)return;
      var catalog=document.createElement('div');
      catalog.className='radar-page-catalog';
      var heading=document.createElement('div');
      heading.className='radar-catalog-heading';
      var headingTitle=document.createElement('h2');
      headingTitle.textContent='زیرمجموعه‌های این بخش';
      var headingMeta=document.createElement('p');
      headingMeta.textContent='برای مشاهده اطلاعات، روی کارت موردنظر بزن. هر کارت صفحه مستقل دارد.';
      heading.appendChild(headingTitle);
      heading.appendChild(headingMeta);
      var cards=document.createElement('div');
      cards.className='radar-page-grid';
      catalog.appendChild(heading);
      catalog.appendChild(cards);
      var stage=document.createElement('div');
      stage.className='radar-page-stage';
      stage.hidden=true;
      var back=document.createElement('button');
      back.type='button';
      back.className='radar-page-back';
      back.textContent='← بازگشت به زیرمجموعه‌ها';
      back.setAttribute('aria-label','بازگشت به فهرست زیرمجموعه‌ها');
      stage.appendChild(back);
      var title=document.createElement('h2');
      title.className='radar-page-title';
      stage.appendChild(title);
      var content=document.createElement('div');
      content.className='radar-page-content';
      stage.appendChild(content);
      // A nested detail is still included in the category list: it becomes
      // its own page rather than a hidden dropdown inside another page.
      sections.forEach(function(item,index){
        var summary=item.querySelector(':scope > summary');
        if(!summary)return;
        var label=String(summary.textContent||'').trim();
        var card=document.createElement('button');
        card.type='button';
        card.className='radar-page-card';
        card.setAttribute('aria-label','باز کردن '+label);
        var icon=document.createElement('span');
        icon.className='radar-page-card-icon';
        icon.textContent=label.match(/^[^\s]+/)?.[0]||'◈';
        var labelNode=document.createElement('span');
        labelNode.className='radar-page-card-name';
        labelNode.textContent=label;
        var arrow=document.createElement('span');
        arrow.className='radar-page-card-arrow';
        arrow.textContent='←';
        arrow.setAttribute('aria-hidden','true');
        card.appendChild(icon);card.appendChild(labelNode);card.appendChild(arrow);
        cards.appendChild(card);
        // Preserve the contents of a card, including existing live data IDs,
        // but replace its accordion shell with a standalone section.
        var page=document.createElement('section');
        page.className='radar-page';
        page.hidden=true;
        page.setAttribute('aria-label',label);
        var body=item.querySelector(':scope > .accordion-body');
        if(body){
          while(body.firstChild)page.appendChild(body.firstChild);
        }else{
          while(summary.nextSibling)page.appendChild(summary.nextSibling);
        }
        content.appendChild(page);
        item.remove();
        card.addEventListener('click',function(){
          content.querySelectorAll('.radar-page').forEach(function(p){p.hidden=true});
          page.hidden=false;
          title.textContent=label;
          catalog.hidden=true;
          stage.hidden=false;
          if(typeof panel.scrollIntoView==='function'){
            try{panel.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){panel.scrollIntoView()}
          }
        });
      });
      back.addEventListener('click',function(){
        stage.hidden=true;
        catalog.hidden=false;
        content.querySelectorAll('.radar-page').forEach(function(p){p.hidden=true});
        if(typeof panel.scrollIntoView==='function'){
          try{panel.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){panel.scrollIntoView()}
        }
      });
      // Remove former layout wrappers only when completely empty. These are
      // visual wrappers, not data sources.
      panel.querySelectorAll('.top-dashboard,.featured-only-secondary').forEach(function(wrap){
        if(!wrap.textContent.trim()&&!wrap.querySelector('*'))wrap.remove();
      });
      panel.prepend(stage);
      panel.prepend(catalog);
      panel.classList.add('subpages-ready');
      // Preserve a useful view for tabs that only have one subsection.
      if(cards.children.length===1)cards.firstElementChild.click();
    });
    document.querySelectorAll('.panel .list').forEach(function(list){
      if(list.nextElementSibling&&list.nextElementSibling.classList.contains('list-more'))return;
      var more=document.createElement('button');
      more.type='button';more.className='list-more';more.textContent='نمایش همه موارد';
      more.addEventListener('click',function(){
        var expanded=list.classList.toggle('show-all');
        more.textContent=expanded?'نمایش موارد کمتر':'نمایش همه موارد';
      });
      list.insertAdjacentElement('afterend',more);
    });
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',setupSubsections,{once:true});
  }else{setupSubsections()}

  window.addEventListener('error',function(e){
    showUiError('خطای رابط کاربری: '+String(e.message||'نامشخص')+' — تب‌ها همچنان قابل استفاده‌اند.');
  });
  window.addEventListener('unhandledrejection',function(e){
    showUiError('خطای اتصال داده: '+String(e.reason&&e.reason.message||e.reason||'نامشخص').slice(0,180));
  });
  setTimeout(function(){
    if(window.__radarMainStarted!==true){
      showUiError('اسکریپت اصلی رادار اجرا نشده؛ تب‌ها قابل بازشدن هستند، اما داده‌ها باید دوباره بارگذاری شوند.');
    }
  },3500);
})();
</script>
<script>

var sourcesHealthData=null,sourcesHealthBusy=false;
function renderSourcesHealth(){
  var d=sourcesHealthData,st=document.getElementById('sourcesHealthStatus'),
      out=document.getElementById('sourcesHealthList');
  if(!st||!out)return;
  if(!d){st.textContent='در انتظار اولین آزمایش منبع‌ها...';return}
  var rows=d.rows||[],good=rows.filter(r=>r.status==='ok').length;
  st.textContent='آزمایش زنده '+good+' از '+rows.length+' منبع · '+new Date(d.generatedAt).toLocaleString('fa-IR')+
    ' · خطای درخواست یا سهمیه، مساوی با فقدان همیشگی سرویس نیست.';
  var labels={ok:'✅ پاسخ معتبر',error:'⚠️ پاسخ ناموفق', 'missing-key':'🔑 کلید ندارد',
    'configured-not-tested':'🟡 کلید دارد، API تست نشده', 'public-fallback':'👁 نسخه عمومی جایگزین',
    'link-only':'🔗 فقط لینک وب'};
  out.innerHTML=rows.map(function(r){
    return '<div class="row"><div class="asset"><b>'+esc(r.name)+'</b><small>'+
      esc(labels[r.status]||r.status)+
      (r.reason?' · '+esc(r.reason):'')+
      (r.requiredKey?' · متغیر اختیاری: '+esc(r.requiredKey):'')+
      (Number.isFinite(r.latencyMs)?' · '+Number(r.latencyMs)+'ms':'')+
      '</small></div></div>';
  }).join('');
}
async function pollSourcesHealth(){
  if(sourcesHealthBusy)return;sourcesHealthBusy=true;
  try{
    var d=await safeJson('/api/v1/sources-health');
    if(d){sourcesHealthData=d;renderSourcesHealth()}
  }finally{sourcesHealthBusy=false}
}

var TOTAL_HOLDERS_MIN=1000;
var pumpXMonitor=null,pumpXBusy=false,famousXMonitor=null,famousXBusy=false;
var tokens=[],smart=null,live=null,tracked=null,conviction=null,prelaunch=null,prelaunchLive=null,topTraders=null,activeTab='featured',signalFilters={short:'',medium:'',long:'',security:'',holders:'',bigbuyers:'',totalholders:''};
try{
  if(localStorage.getItem('priceCacheSchemaV7')!=='dexscreener-primary-v7'){
    localStorage.removeItem('livePriceCache');
    localStorage.setItem('priceCacheSchemaV7','dexscreener-primary-v7');
  }
}catch(e){}
var livePriceCache=new Map();
var lastMarketLiveAt=0;
try{
  var savedLivePrices=JSON.parse(localStorage.getItem('livePriceCache')||'[]');
  if(Array.isArray(savedLivePrices))savedLivePrices.forEach(function(x){
    if(!x||!x[0]||!x[1])return;
    var v=x[1];
    if(Number(v.price||0)>0)livePriceCache.set(x[0],{price:Number(v.price),at:Number(v.at||0),source:v.source||'stored',pairAddress:String(v.pairAddress||'')});
  });
}catch(e){}
var livePriceSaveTimer=null;
function rememberLivePrice(mint,price,source,observedAt,pairAddress){
  price=Number(price||0);
  if(!mint||!(price>0))return;
  source=source||'live';
  observedAt=Number(observedAt||Date.now());
  pairAddress=String(pairAddress||'');

  var old=livePriceCache.get(mint);
  var oldAt=Number(old&&old.at||0);

  // Never let an older/slower full-scan snapshot overwrite a newer live market price.
  if(old&&oldAt>observedAt)return;
  if(old&&source==='snapshot'&&old.source==='live'&&Date.now()-oldAt<15000)return;

  livePriceCache.set(mint,{price:price,at:observedAt,source:source,pairAddress:pairAddress||(old&&old.pairAddress)||''});
  if(!livePriceSaveTimer){
    livePriceSaveTimer=setTimeout(function(){
      livePriceSaveTimer=null;
      saveLivePrices();
    },1000);
  }
}
function saveLivePrices(){
  try{localStorage.setItem('livePriceCache',JSON.stringify([...livePriceCache.entries()].slice(-600)))}catch(e){}
}
function currentPriceForMint(mint){
  var hit=livePriceCache.get(mint);
  var cached=hit&&Number(hit.price||0)>0?Number(hit.price):null;
  var cachedAt=Number(hit&&hit.at||0);
  var cachedPair=String(hit&&hit.pairAddress||'');

  var t=findToken(mint);
  var tokenPrice=Number(t&&t.priceUsd||0);
  var tokenPair=String(t&&t.pairAddress||'');

  // Exact DEXScreener lookup is authoritative even for historical rows that are no longer in the current token scan.
  if(cached&&hit&&['dexscreener-exact','jupiter-verified','geckoterminal-fallback','birdeye-fallback','pumpfun-fallback'].includes(hit.source)&&Date.now()-cachedAt<=15000)return cached;
  // Market-live cache is authoritative only for the same pinned pair.
  if(cached&&hit&&hit.source==='dexscreener'&&Date.now()-cachedAt<=5000&&(!tokenPair||!cachedPair||tokenPair===cachedPair))return cached;

  // Never treat a stale full scan as a fresh live quote.
  return null;
}

function livePnlPct(mint,base){
  var cur=currentPriceForMint(mint),b=Number(base||0);
  if(!(cur>0)||!(b>0))return null;
  return ((cur-b)/b)*100;
}
function updateLiveProfitDom(){
  document.querySelectorAll('[data-trader-pnl-mint]').forEach(function(el){
    var mint=el.getAttribute('data-trader-pnl-mint');
    var entry=Number(el.getAttribute('data-trader-entry-price')||0);
    var buyUsd=Number(el.getAttribute('data-trader-buy-usd')||0);
    var hit=livePriceCache.get(mint);
    // Never show stale prices as live trader PnL.
    var fresh=hit&&Number(hit.price)>0&&Date.now()-Number(hit.at||0)<15000&&
      ['dexscreener-exact','jupiter-verified','geckoterminal-fallback','birdeye-fallback','pumpfun-fallback'].includes(hit.source);
    var fallbackPrice=Number(el.getAttribute('data-trader-fallback-price')||0);
    var fallbackAt=Number(el.getAttribute('data-trader-fallback-at')||0);
    var fallbackMatched=el.getAttribute('data-trader-pair-matched')!=='false';
    var canFallback=!fresh&&fallbackMatched&&fallbackPrice>0&&
      fallbackAt>0&&Date.now()-fallbackAt<=60000;
    var current=fresh?Number(hit.price):canFallback?fallbackPrice:0;
    var ret=current>0&&entry>0?((current-entry)/entry)*100:null;
    var val=ret===null?null:buyUsd*ret/100;
    el.textContent=val===null?'قیمت تازه موجود نیست':((val>=0?'+':'')+money(val)+' ('+(ret>=0?'+':'')+ret.toFixed(2)+'%)')+
      (canFallback?' · آخرین اسکن':'');
    el.classList.remove('return-pos','return-neg','return-flat');
    el.classList.add(val===null?'return-flat':val>=0?'return-pos':'return-neg');
    el.title='تغییر ارزش تخمینی مبلغ مشاهده‌شده بر اساس قیمت فعلی؛ سود محقق‌نشده واقعی کیف‌پول یا PnL کل تریدر نیست';
  });
  document.querySelectorAll('[data-trader-position-mint]').forEach(function(el){
    var mint=el.getAttribute('data-trader-position-mint');
    var entry=Number(el.getAttribute('data-trader-position-entry')||0);
    var amount=Number(el.getAttribute('data-trader-position-amount')||0);
    var hit=livePriceCache.get(mint);
    var fresh=hit&&Number(hit.price)>0&&Date.now()-Number(hit.at||0)<15000&&
      ['dexscreener-exact','jupiter-verified','geckoterminal-fallback','birdeye-fallback','pumpfun-fallback'].includes(hit.source);
    var pnl=fresh&&entry>0&&amount>0?(Number(hit.price)-entry)*amount:null;
    el.textContent=pnl===null?'—':(pnl>=0?'+':'')+money(pnl);
    el.classList.remove('return-pos','return-neg','return-flat');
    el.classList.add(pnl===null?'return-flat':pnl>=0?'return-pos':'return-neg');
    el.title='تغییر ارزش پوزیشن فعلی از قیمت مرجع ردیابی؛ بدون درنظرگرفتن معاملات قبلی، و نه سود واقعی تریدر';
  });
  document.querySelectorAll('[data-live-profit-mint]').forEach(function(el){
    var mint=el.getAttribute('data-live-profit-mint');
    var base=Number(el.getAttribute('data-live-profit-base')||0);
    var p=livePnlPct(mint,base);
    el.textContent=p==null?'—':(p>=0?'+':'')+p.toFixed(2)+'%';
    el.classList.remove('return-pos','return-neg','return-flat');
    el.classList.add(p==null?'return-flat':p>=0?'return-pos':'return-neg');
  });
  document.querySelectorAll('[data-live-price-mint]').forEach(function(el){
    var cur=currentPriceForMint(el.getAttribute('data-live-price-mint'));
    el.textContent=cur?fmtPrice(cur):'—';
  });
}
setInterval(function(){updateLiveProfitDom()},500);

var stickyFeatured=new Map();
var recommendationHistory=new Map();
var socialSignalHistory=new Map();
var tokenRadarHistory=new Map();
try{
  var savedTokenRadarHistory=JSON.parse(localStorage.getItem('tokenRadarHistory')||'[]');
  if(Array.isArray(savedTokenRadarHistory))savedTokenRadarHistory.forEach(function(x){
    if(x&&x.mint)tokenRadarHistory.set(x.mint,x);
  });
}catch(e){}
function saveTokenRadarHistory(){
  try{localStorage.setItem('tokenRadarHistory',JSON.stringify([...tokenRadarHistory.values()].slice(-500)))}catch(e){}
}
function rememberTokenRadar(t){
  if(!t||!t.mint)return;
  var old=tokenRadarHistory.get(t.mint);
  if(!old){
    tokenRadarHistory.set(t.mint,{
      mint:t.mint,name:t.name||'',symbol:t.symbol||'',
      introducedAt:new Date().toISOString(),
      introducedPrice:Number(currentPriceForMint(t.mint)||0)||null,
      entrySignalAtIntroduction:tradePlan(t).status==='ENTRY',
      historicalClassification:'DISCOVERY_TRACKING',
      introducedSecurity:t.security?.tier||'',
      introducedScore:bucketScore(t,ageBucket(t)),
      dexUrl:t.dexUrl||''
    });
    saveTokenRadarHistory();
  }else{
    old.name=t.name||old.name;old.symbol=t.symbol||old.symbol;old.dexUrl=t.dexUrl||old.dexUrl;
    // A baseline is recorded only when a fresh validated quote exists.
    if(!(Number(old.introducedPrice)>0)){
      var first=currentPriceForMint(t.mint);
      if(first>0){old.introducedPrice=first;old.introducedAt=new Date().toISOString();old.baselineRepaired=true}
    }
    tokenRadarHistory.set(t.mint,old);
    if(old.baselineRepaired)saveTokenRadarHistory();
  }
}
function exportSignalAuditCsv(){
  var hist=[...tokenRadarHistory.values()].map(function(h){
    var t=findToken(h.mint),price=currentPriceForMint(h.mint),base=Number(h.introducedPrice||0);
    return {
      type:'discovered_token',mint:h.mint,symbol:h.symbol,name:h.name,
      introducedAt:h.introducedAt,basePrice:base||'',currentPrice:price||'',
      pnlPct:base>0&&price>0?((price-base)/base*100).toFixed(4):'',
      entryAtIntroduction:h.entrySignalAtIntroduction===true?'yes':h.entrySignalAtIntroduction===false?'no':'unknown',
      originalScore:h.introducedScore,security:h.introducedSecurity,
      strategy:'discovery_history_not_trade_signal',
      entrySnapshot:''
    };
  });
  var entries=[...recommendationHistory.values()].map(function(h){
    var price=currentPriceForMint(h.mint),base=Number(h.introducedPrice||0);
    return {
      type:'confirmed_entry',mint:h.mint,symbol:h.symbol,name:h.name,
      introducedAt:h.introducedAt,basePrice:base||'',currentPrice:price||'',
      pnlPct:base>0&&price>0?((price-base)/base*100).toFixed(4):'',
      entryAtIntroduction:'yes',originalScore:h.introducedScore,security:h.introducedSecurity,
      strategy:h.strategyVersion||'legacy_entry',entrySnapshot:JSON.stringify(h.entrySnapshot||{})
    };
  });
  var header=['type','mint','symbol','name','introducedAt','basePrice','currentPrice','pnlPct','entryAtIntroduction','originalScore','security','strategy','entrySnapshot'];
  var rows=hist.concat(entries);
  var csv=[header.join(',')].concat(rows.map(function(row){
    return header.map(function(key){
      var s=String(row[key]??'');
      // prevent spreadsheet formula injection in arbitrary token names
      if(/^[=+@\-\t\r]/.test(s))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    }).join(',');
  })).join('\r\n');
  var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='solana-radar-signal-audit-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(url)},1000);
}
function tokenRadarPerformanceRows(){
  return [...tokenRadarHistory.values()].map(function(h){
    var t=findToken(h.mint),current=currentPriceForMint(h.mint),base=Number(h.introducedPrice||0);
    var pnl=(current!=null&&current>0&&base>0)?((current-base)/base)*100:null;
    return {history:h,token:t,currentPrice:current,pnlPct:pnl};
  }).sort(function(a,b){
    return (b.pnlPct==null?-1e9:b.pnlPct)-(a.pnlPct==null?-1e9:a.pnlPct);
  });
}

try{
  var savedSocialHistory=JSON.parse(localStorage.getItem('socialSignalHistory')||'[]');
  if(Array.isArray(savedSocialHistory))savedSocialHistory.forEach(function(x){
    if(x&&x.mint)socialSignalHistory.set(x.mint,x);
  });
}catch(e){}

function saveSocialSignalHistory(){
  try{
    localStorage.setItem('socialSignalHistory',JSON.stringify([...socialSignalHistory.values()].slice(-300)));
  }catch(e){}
}
function corroboratedSocialMentions(t){
  if(!t)return false;
  const x=Number(t.xSocial?.posts2h||0),b=Number(t.bluesky?.mentions2h||0),
    y=Number(t.youtubeSocial?.videos24h||0);
  // Linked social profiles or a DEX boost are NOT evidence of live mentions.
  return Number(t.socialHeat?.score||0)>=20&&(x>=2||b>=2||y>=2);
}
function verifiedSocialHistory(h){
  if(!h)return false;
  // Preserve legacy history but never retroactively upgrade it without a
  // timestamped snapshot of actual social activity.
  return h.evidenceVerified===true &&
    (Number(h.xPosts2h||0)>=2||Number(h.youtubeVideos24h||0)>=2||Number(h.blueskyMentions2h||0)>=2);
}
function rememberSocialSignal(t){
  if(!t||!t.mint)return;
  var heat=Number(t.socialHeat?.score||0);
  if(!corroboratedSocialMentions(t))return;
  var old=socialSignalHistory.get(t.mint);
  var isEntry=tradePlan(t).status==='ENTRY';
  if(!old){
    socialSignalHistory.set(t.mint,{
      mint:t.mint,
      name:t.name||'',
      symbol:t.symbol||'',
      introducedAt:new Date().toISOString(),
      introducedPrice:Number(currentPriceForMint(t.mint)||0)||null,
      evidenceVerified:true,
      isEntrySignal:isEntry,signalClassification:isEntry?'CONFIRMED_ENTRY':'VERIFIED_SOCIAL_WATCH',
      introducedSocialHeat:heat,
      introducedSocialLabel:t.socialHeat?.label||'',
      introducedSecurity:t.security?.tier||'',
      xPosts2h:Number(t.socialHeat?.xPosts2h||0),
      youtubeVideos24h:Number(t.socialHeat?.youtubeVideos24h||0),
      blueskyMentions2h:Number(t.socialHeat?.blueskyMentions2h||0),
      dexUrl:t.dexUrl||''
    });
    saveSocialSignalHistory();
  }else{
    old.name=t.name||old.name;
    old.symbol=t.symbol||old.symbol;
    old.dexUrl=t.dexUrl||old.dexUrl;
    if(!(Number(old.introducedPrice)>0)){
      var first=currentPriceForMint(t.mint);
      if(first>0){old.introducedPrice=first;old.introducedAt=new Date().toISOString();old.baselineRepaired=true}
    }
    socialSignalHistory.set(t.mint,old);
    if(old.baselineRepaired)saveSocialSignalHistory();
  }
}
function socialSignalPerformanceRows(){
  return [...socialSignalHistory.values()].filter(verifiedSocialHistory).map(function(h){
    var t=findToken(h.mint);
    var current=currentPriceForMint(h.mint);
    var base=Number(h.introducedPrice||0);
    var pnl=(current!=null&&current>0&&base>0)?((current-base)/base)*100:null;
    return {history:h,token:t,currentPrice:current,pnlPct:pnl};
  }).sort(function(a,b){
    var av=a.pnlPct==null?-1e9:a.pnlPct,bv=b.pnlPct==null?-1e9:b.pnlPct;
    return bv-av;
  });
}

try{
  var savedHistory=JSON.parse(localStorage.getItem('recommendationHistory')||'[]');
  if(Array.isArray(savedHistory))savedHistory.forEach(function(x){
    if(x&&x.mint)recommendationHistory.set(x.mint,x);
  });
}catch(e){}

function saveRecommendationHistory(){
  try{
    localStorage.setItem('recommendationHistory',JSON.stringify([...recommendationHistory.values()].slice(-200)));
  }catch(e){}
}
function rememberRecommendation(t,score){
  if(!t||!t.mint)return;
  var old=recommendationHistory.get(t.mint);
  if(!old){
    recommendationHistory.set(t.mint,{
      mint:t.mint,
      name:t.name||'',
      symbol:t.symbol||'',
      introducedAt:new Date().toISOString(),
      introducedPrice:Number(currentPriceForMint(t.mint)||0)||null,
      introducedScore:Number(score||0),
      introducedSecurity:t.security?.tier||'',
      strategyVersion:'conservative-entry-v2',
      entrySnapshot:{
        holders:t.totalHolderCount,liquidity:t.liquidity,marketCap:t.marketCap,
        volume5m:t.volume5m,txns5m:t.txns5m,buys5m:t.buys5m,sells5m:t.sells5m,
        change5m:t.priceChange5m,change1h:t.priceChange1h,
        buyerPower:t.flow?.buyerPower,activity:t.activity?.label,
        security:t.security?.tier,confirmation:t.preSignalGuard?.status,
        socialHeat:t.socialHeat?.score,
        marketQuality:t.marketQuality?.score,poolHealth:t.poolHealth?.status,
        verifiedPriceAtEntry:currentPriceForMint(t.mint),
        entryGate:'conservative-v2'
      },
      dexUrl:t.dexUrl||''
    });
    saveRecommendationHistory();
  }else{
    old.name=t.name||old.name;
    old.symbol=t.symbol||old.symbol;
    old.dexUrl=t.dexUrl||old.dexUrl;
    recommendationHistory.set(t.mint,old);
  }
}
function entryFactorReport(rows){
  // Only entry-time snapshots qualify. Never use currently observed features
  // to explain why a historical trade succeeded (look-ahead bias).
  var records=rows.filter(function(r){
    return r&&r.history&&r.history.entrySnapshot&&
      r.pnlPct!=null&&Number.isFinite(r.pnlPct)&&
      Number(r.history.introducedPrice)>0;
  });
  var el=document.getElementById('entryFactorAnalysis');if(!el)return;
  if(records.length<8){
    el.textContent='تحلیل عوامل مثبت‌ها: '+records.length+
      ' سیگنال ورود با ویژگی‌های لحظه ورود و بازده قابل بررسی موجود است. برای مقایسه معتبرتر حداقل ۸ نمونه لازم است؛ داده تاریخی ۵۰۰ توکن فقط با خروجی CSV قابل بررسی است.';
    return;
  }
  var buckets=[
    {name:'قدرت خریدار ۶۰٪ به بالا',test:s=>Number(s.buyerPower)>=60},
    {name:'نقدینگی ۱۰۰ هزار دلار به بالا',test:s=>Number(s.liquidity)>=100000},
    {name:'حجم پنج‌دقیقه‌ای ۱۰ هزار دلار به بالا',test:s=>Number(s.volume5m)>=10000},
    {name:'تغییر ۵ دقیقه‌ای ۱٪ تا ۵٪',test:s=>Number(s.change5m)>=1&&Number(s.change5m)<=5},
    {name:'بیش از ۲۰۰۰ هولدر',test:s=>Number(s.holders)>=2000},
    {name:'امنیت MAX SECURITY',test:s=>s.security==='MAX SECURITY'},
    {name:'ترند اجتماعی ۵۵ به بالا',test:s=>Number(s.socialHeat)>=55}
  ];
  var eligible=records.filter(function(r){
    return Date.now()-Date.parse(r.history.introducedAt)>=60*60*1000;
  });
  var robust=eligible.filter(function(r){return r.pnlPct!=null});
  if(robust.length<8){
    el.textContent='داده‌های ورود ثبت شده‌اند؛ برای بررسی عوامل مثبت‌ها دست‌کم ۸ مورد با عمر یک‌ساعته و قیمت تازه نیاز است. فعلاً نتیجه‌ای از برنده‌ها استنباط نمی‌شود.';
    return;
  }
  var avg=rs=>rs.reduce((sum,r)=>sum+Number(r.pnlPct),0)/rs.length;
  var baselineWins=robust.filter(r=>r.pnlPct>0).length;
  var parts=buckets.map(function(b){
    var subset=robust.filter(r=>{try{return b.test(r.history.entrySnapshot||{})}catch(e){return false}});
    if(subset.length<8)return null;
    var wins=subset.filter(r=>r.pnlPct>0).length;
    return {name:b.name,n:subset.length,wins,rate:100*wins/subset.length,mean:avg(subset)};
  }).filter(Boolean).sort((a,b)=>b.rate-a.rate);
  el.innerHTML='<b>🔎 ویژگی‌های همراه با بازده مثبت (تحلیل اکتشافی)</b>'+
    '<div class="note">نمونه‌های واجد شرایط: '+robust.length+' · مثبت: '+baselineWins+
    ' · نرخ مثبت '+(100*baselineWins/robust.length).toFixed(1)+
    '٪ · مقایسه‌ها از ویژگی‌های هنگام ورود ساخته شده‌اند، نه داده آینده. بازه نگهداری یکسان و کارمزد واقعی نداریم؛ این ارتباط‌ها علت سود یا تضمین نتیجه نیستند.</div>'+
    (parts.length?parts.slice(0,7).map(function(x){
      return '<div class="mini-row"><span>'+esc(x.name)+' · '+x.n+' نمونه</span><b>'+
        x.rate.toFixed(1)+'٪ مثبت · میانگین '+(x.mean>=0?'+':'')+x.mean.toFixed(1)+'٪</b></div>';
    }).join(''):'<div class="note">در هیچ گروهی حداقل ۸ نمونه وجود ندارد؛ برای جلوگیری از نتیجه‌گیری بی‌پشتوانه تحلیل نمایش داده نشد.</div>');
}
function recommendationPerformanceRows(){
  return [...recommendationHistory.values()].map(function(h){
    var t=findToken(h.mint);
    var current=currentPriceForMint(h.mint);
    var base=Number(h.introducedPrice||0);
    var pnl=(current!=null&&current>0&&base>0)?((current-base)/base)*100:null;
    return {history:h,token:t,currentPrice:current,pnlPct:pnl};
  }).sort(function(a,b){
    var av=a.pnlPct==null?-1e9:a.pnlPct,bv=b.pnlPct==null?-1e9:b.pnlPct;
    return bv-av;
  });
}

try{
  var savedFeatured=JSON.parse(sessionStorage.getItem('stickyFeatured')||'[]');
  if(Array.isArray(savedFeatured))savedFeatured.forEach(function(x){
    if(x&&x.token&&x.token.mint)stickyFeatured.set(x.token.mint,x);
  });
}catch(e){}

function saveStickyFeatured(){
  try{
    sessionStorage.setItem('stickyFeatured',JSON.stringify([...stickyFeatured.values()].slice(0,12)));
  }catch(e){}
}

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
function holderPolicyOk(t){
  if(!t)return false;
  var sec=t.security||{};
  var holders=Array.isArray(sec.topHolders)?sec.topHolders:[];
  if(holders.length<10||sec.ownerAggregationComplete!==true)return false;
  var first=Number(sec.largestHolder!=null?sec.largestHolder:holders[0]?.pct);
  var maxOther=Number(sec.maxOtherHolder!=null?sec.maxOtherHolder:Math.max.apply(null,holders.slice(1,10).map(function(h){return Number(h&&h.pct||0)})));
  return sec.holderPolicyPassed===true&&first<10&&maxOther<5;
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
  if(wh.count)score+=3;if(t.kolTrend?.kolCount>=2)score+=Math.min(7,t.kolTrend.kolCount*2);else if(t.kolTrend?.kolCount===1)score+=2;if(t.kolTrend?.xMentionCount>0)score+=Math.min(5,t.kolTrend.xMentionCount*2);if(tr&&Number(tr.uniqueBuyers||0)>=2&&Number(tr.netFlowUsd||0)>0)score+=3;if(tr&&Number(tr.convictionHolderCount||0)>=1)score+=Math.min(5,Number(tr.convictionHolderCount||0)*2);if(sm)score+=2;
  if(exitFor(t.mint).length)score-=18;
  if(fl.sellerDominant)score-=8;
  if(fl.volumeLabel==='SUSPICIOUS')score-=12;
  score=Math.max(0,Math.min(100,Math.round(score)));if(trustGuard(t).status==='WAIT'||t.flow?.volumeLabel!=='STRONG'||tradePlan(t).status!=='ENTRY')score=Math.min(score,74);return score;
}
function bucketSignalLabel(score,t){
  if(t&&!rugcheckVerified(t))return 'Rugcheck تأیید نشده / سیگنال ورود ممنوع';
  if(t&&!(Number.isInteger(t.totalHolderCount)&&t.totalHolderCount>=1000))return 'حداقل ۱۰۰۰ هولدر تأیید نشده / ورود نکن';
  if(t&&!holderPolicyOk(t))return 'رد هولدر / ورود نکن';
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
  if(t&&!rugcheckVerified(t))return 'bad';
  if(t&&!(Number.isInteger(t.totalHolderCount)&&t.totalHolderCount>=1000))return 'bad';
  if(t&&!holderPolicyOk(t))return 'bad';
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
  return holderPolicyOk(t)&&tradePlan(t).status==='ENTRY'&&t.flow?.volumeLabel==='STRONG'&&trustGuard(t).status==='CONFIRMED'&&!gate.blocked&&!ac.blocked&&Number(ac.manual||0)===0&&Number(ac.unknown||0)===0&&Number(ac.fail||0)===0&&(sec.tier==='MAX SECURITY'||sec.tier==='HIGH');
}
function kolTrendScore(t){
  if(!t||!t.kolTrend)return 0;
  var k=t.kolTrend||{},base=Number(k.score||0);
  return Math.min(100,Math.round(base*.45+bucketScore(t,ageBucket(t))*.55));
}
function largeBuyerFlow(t){
  var tr=t?findTracked(t.mint):null;
  var buyers1000=tr&&Array.isArray(tr.convictionHolders)?tr.convictionHolders:[];
  return {
    buyers:Number(tr?.largeBuyer500Count||0),
    sellers:Number(tr?.netSellerWalletCount||0),
    buyerUsd:Number(tr?.largeBuyer500Usd||0),
    sellerUsd:Number(tr?.netSellerUsd||0),
    dominant:tr?.largeBuyer500Dominant===true,
    buyers100:buyers1000.length,
    buyers100Usd:buyers1000.reduce(function(a,x){return a+Number(x.buyUsd||0)},0)
  };
}
function passesSignalFilters(t){
  var any=signalFilters.short||signalFilters.medium||signalFilters.long||signalFilters.security||signalFilters.holders||signalFilters.bigbuyers||signalFilters.totalholders;
  if(!t)return !any;
  if(Number(signalFilters.totalholders||0)>0&&!(Number.isInteger(t.totalHolderCount)&&t.totalHolderCount>=Number(signalFilters.totalholders)))return false;
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
function socialMoneyFlow(t){
  if(!t)return {whale:{count:0,usd:0},smart:null,tracked:null};
  var wh=whaleFor(t.mint),sm=smartFor(t.mint),tr=findTracked(t.mint);
  return {whale:wh,smart:sm,tracked:tr};
}
function socialMoneyBadges(t){
  var f=socialMoneyFlow(t),rows=[];
  if(f.whale.count>0)rows.push('<span class="whale-buy-chip">🐋 ورود نهنگ · '+f.whale.count+' خرید · '+money(f.whale.usd)+'</span>');
  if(f.smart){
    var n=Number(f.smart.smartMoneyCount||f.smart.buyers||0);
    var usd=Number(f.smart.totalValueUsd||f.smart.netFlowUsd||f.smart.currentHoldingUsd||0);
    rows.push('<span class="badge good">🧠 اسمارت‌مانی · '+(n>0?n+' کیف‌پول': 'فعال')+(usd>0?' · '+money(usd):'')+'</span>');
  }else if(f.tracked&&Number(f.tracked.uniqueBuyers||0)>0&&Number(f.tracked.netFlowUsd||0)>0){
    rows.push('<span class="badge good">🧠 جریان کیف‌پول هوشمند · '+Number(f.tracked.uniqueBuyers||0)+' خریدار · '+money(f.tracked.netFlowUsd)+'</span>');
  }
  return rows.join('');
}

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
function momentumFilter(t){
  if(!t)return {ok:false,score:0,reasons:['توکن نامشخص']};
  var liq=Number(t.liquidity||0),mc=Number(t.marketCap||0),age=Number(t.ageMinutes||0);
  var v24=Number(t.volume24h||0),tx24=Number(t.txns24h||0);
  var v5=Number(t.volume5m||0),v1=Number(t.volume1h||0);
  var tx5=Number(t.txns5m||0),tx1=Number(t.txns1h||0);
  var pc5=Number(t.priceChange5m||0),pc1=Number(t.priceChange1h||0);
  var buys5=Number(t.buys5m||0),sells5=Number(t.sells5m||0);
  var countRatio=sells5>0?buys5/sells5:(buys5>0?99:0);

  var checks=[
    {key:'liquidity',ok:liq>=40000&&liq<=500000,label:'نقدینگی 40k–500k'},
    {key:'marketCap',ok:mc>=150000&&mc<=2000000,label:'مارکت‌کپ 150k–2m'},
    {key:'age',ok:age>=60&&age<=2880,label:'سن جفت 1–48h'},
    {key:'volume24h',ok:v24>=150000,label:'حجم 24h ≥150k'},
    {key:'tx24h',ok:tx24>=500,label:'تراکنش 24h ≥500'},
    {key:'volume5m',ok:v5>=8000&&v5<=80000,label:'حجم 5m: 8k–80k'},
    {key:'volume1h',ok:v1>=60000&&v1<=500000,label:'حجم 1h: 60k–500k'},
    {key:'tx5m',ok:tx5>=40,label:'تراکنش 5m ≥40'},
    {key:'tx1h',ok:tx1>=300,label:'تراکنش 1h ≥300'},
    {key:'price5m',ok:pc5>=1&&pc5<=8,label:'تغییر 5m: +1% تا +8%'},
    {key:'price1h',ok:pc1>=5&&pc1<=25,label:'تغییر 1h: +5% تا +25%'},
    {key:'buySellCount',ok:countRatio>=1.4,label:'نسبت تعداد خرید/فروش ≥1.4'}
  ];
  var passed=checks.filter(function(x){return x.ok}).length;
  return {
    ok:passed===checks.length,
    passed,total:checks.length,
    score:Math.round(passed/checks.length*100),
    checks,
    countRatio:+countRatio.toFixed(2),
    reasons:checks.filter(function(x){return !x.ok}).map(function(x){return x.label})
  };
}
function momentumChip(t){
  var m=momentumFilter(t);
  var cls=m.ok?'good':m.score>=70?'mid':'bad';
  return '<span class="badge '+cls+'">مومنتوم '+m.passed+'/'+m.total+'</span>';
}

function dexscreenerMomentumFilter(t){
  if(!t)return {ok:false,score:0,checks:[],reasons:['توکن نامشخص']};
  var liq=Number(t.liquidity||0),mc=Number(t.marketCap||0),age=Number(t.ageMinutes||0);
  var v5=Number(t.volume5m||0),v1=Number(t.volume1h||0),v24=Number(t.volume24h||0);
  var tx5=Number(t.txns5m||0),tx1=Number(t.txns1h||0),tx24=Number(t.txns24h||0);
  var pc5=Number(t.priceChange5m||0),pc1=Number(t.priceChange1h||0);
  var buys5=Number(t.buys5m||0),sells5=Number(t.sells5m||0);
  var buySell5=(buys5+1)/(sells5+1);

  var checks=[
    {key:'liq',name:'نقدینگی 40k تا 500k',ok:liq>=40000&&liq<=500000,value:liq},
    {key:'mc',name:'مارکت‌کپ 150k تا 2M',ok:mc>=150000&&mc<=2000000,value:mc},
    {key:'age',name:'سن جفت 1h تا 48h',ok:age>=60&&age<=2880,value:age},
    {key:'v24',name:'حجم 24h حداقل 150k',ok:v24>=150000,value:v24},
    {key:'tx24',name:'تراکنش 24h حداقل 500',ok:tx24>=500,value:tx24},
    {key:'v5',name:'حجم 5m بین 8k و 80k',ok:v5>=8000&&v5<=80000,value:v5},
    {key:'v1',name:'حجم 1h بین 60k و 500k',ok:v1>=60000&&v1<=500000,value:v1},
    {key:'tx5',name:'تراکنش 5m حداقل 40',ok:tx5>=40,value:tx5},
    {key:'tx1',name:'تراکنش 1h حداقل 300',ok:tx1>=300,value:tx1},
    {key:'pc5',name:'تغییر قیمت 5m بین +1% و +8%',ok:pc5>=1&&pc5<=8,value:pc5},
    {key:'pc1',name:'تغییر قیمت 1h بین +5% و +25%',ok:pc1>=5&&pc1<=25,value:pc1},
    {key:'bs5',name:'نسبت تعداد خرید/فروش 5m حداقل 1.4',ok:buySell5>=1.4,value:buySell5}
  ];

  var passed=checks.filter(function(x){return x.ok}).length;
  var score=Math.round(passed/checks.length*100);
  var required=['liq','mc','tx5','tx1','bs5'];
  var coreOk=required.every(function(k){var x=checks.find(function(v){return v.key===k});return x&&x.ok});
  return {
    ok:passed>=7,
    score,passed,total:checks.length,checks,
    reasons:checks.filter(function(x){return !x.ok}).map(function(x){return x.name}),
    buySell5:+buySell5.toFixed(2),
    unsupported:['Buy Volume / Sell Volume دلاری','Unique Makers 1H']
  };
}
function momentumChip(t){
  var m=dexscreenerMomentumFilter(t);
  var cls=m.ok?'good':m.score>=60?'mid':'bad';
  return '<span class="badge '+cls+'">مومنتوم DEX '+m.passed+'/'+m.total+'</span>';
}

function entryQualityGate(t){
  if(!t)return {ok:false,reasons:['توکن نامشخص']};
  var fl=t.flow||{},act=t.activity||{},tr=findTracked(t.mint),reasons=[];
  var momentum=dexscreenerMomentumFilter(t);

  var buyerPower=Number(fl.buyerPower||0);
  var sellerPower=Math.max(0,100-buyerPower);
  var buyerDominant=buyerPower>sellerPower;
  if(!buyerDominant)reasons.push('قدرت خریدار از فروشنده بیشتر نیست');

  // Only an explicit BOT RISK blocks entry. MIXED/unknown is allowed but lowers confidence.
  var botBlocked=act.label==='BOT RISK'||
    (act.flags||[]).some(function(x){return /wash محتمل|ربات|فرکانس بسیار بالا/i.test(String(x))});
  if(botBlocked)reasons.push('ریسک Bot/Wash بالا تشخیص داده شده');
  var totalHolders=Number(t.totalHolderCount);
  var holdersVerified=Number.isInteger(t.totalHolderCount)&&totalHolders>=TOTAL_HOLDERS_MIN;
  if(!holdersVerified)reasons.push(t.totalHolderCount==null?'تعداد کل هولدرها نامشخص؛ حداقل ۱۰۰۰ قابل تأیید نیست':'تعداد کل هولدرها کمتر از ۱۰۰۰ است');
  // Entry is withheld on a falling 5-minute candle, thin liquidity,
  // exhausted pump or weak organic transaction participation.
  var buys=Number(t.buys5m||0),sells=Number(t.sells5m||0);
  var pc5=Number(t.priceChange5m||0),pc1=Number(t.priceChange1h||0);
  var priceRisk=Number(t.liquidity||0)<25000||Number(t.volume5m||0)<2000||
    Number(t.txns5m||0)<15||buys<8||(buys+1)/(sells+1)<1.25||
    pc5<0||pc5>12||pc1>35||pc1< -12||
    t.chart?.pumpDumpRisk==='HIGH'||t.chart?.fomoRisk==='HIGH';
  if(priceRisk)reasons.push('حجم/مومنتوم نامناسب یا ریسک ورود پس از پامپ');

  // $100 tracked buyers are a confidence booster, not a hard requirement,
  // because tracked-wallet coverage is not complete for every token.
  var buyers100=tr&&Array.isArray(tr.convictionHolders)?tr.convictionHolders:[];
  var buyer100Ok=buyers100.length>=1;

  return {
    ok:buyerDominant&&!botBlocked&&!priceRisk&&holdersVerified,
    buyerDominant,botBlocked,priceRisk,holdersVerified,totalHolders:t.totalHolderCount,minimumTotalHolders:TOTAL_HOLDERS_MIN,buyer100Ok,
    buyers100Count:buyers100.length,
    buyers100Usd:buyers100.reduce(function(a,x){return a+Number(x.buyUsd||0)},0),
    momentum,
    buyerPower,sellerPower,
    reasons
  };
}

function antiRugGate(t){
  if(!t)return {ok:false,reasons:['توکن نامشخص']};
  var sec=t.security||{},ac=t.academy||{},reasons=[];

  var holdersComplete=Array.isArray(sec.topHolders)&&sec.topHolders.length>=10&&sec.ownerAggregationComplete===true;
  var holderOk=holdersComplete&&sec.holderPolicyPassed===true&&
    Number(sec.largestHolder||0)<10&&Number(sec.maxOtherHolder||0)<5;
  if(!holdersComplete)reasons.push('داده 10 هولدر بزرگ کامل نیست');
  else if(!holderOk)reasons.push('قانون هولدر رد شده');

  if(sec.mintDisabled!==true)reasons.push('Mint authority باید لغو شده باشد');
  if(sec.freezeDisabled!==true)reasons.push('Freeze authority باید غیرفعال باشد');
  if(sec.tokenExtensions?.hardFail===true)reasons.push('Token-2022 پرریسک');
  if(Number(t.liquidity||0)<25000)reasons.push('نقدینگی کمتر از ۲۵ هزار دلار');
  const lpCheck=Array.isArray(ac.checks)?ac.checks.find(x=>x.name==='Liquidity Lock/Burn خودکار'):null;
  if(lpCheck?.state!=='pass')reasons.push('قفل/سوزاندن حداقل ۹۰٪ LP تأیید نشده');
  if(t.poolHealth?.status!=='CLEAR')reasons.push(t.poolHealth?.reason||'پایداری نقدینگی استخر تأیید نشده');

  var criticalNames=[
    'Liquidity Lock/Burn خودکار',
    'Dev holding خودکار',
    'Bundle/Sniper/Insider خودکار',
    'Sellability / Honeypot خودکار',
    'RugCheck ریسک کلی',
    'Token-2022 extensionهای پرریسک',
    'سابقه سازنده / Rug history'
  ];
  var checks=Array.isArray(ac.checks)?ac.checks:[];
  var critical=criticalNames.map(function(name){
    return checks.find(function(x){return x.name===name})||{name:name,state:'unknown'};
  });

  var criticalFail=critical.filter(function(x){return x.state==='fail'}).map(function(x){return x.name});
  var criticalUnknown=critical.filter(function(x){return x.state==='unknown'}).map(function(x){return x.name});
  if(criticalFail.length)reasons.push('رد امنیتی: '+criticalFail.slice(0,2).join('، '));
  if(criticalUnknown.length)reasons.push('امنیت کامل نشده: '+criticalUnknown.slice(0,2).join('، '));

  if(t.activity?.label==='BOT RISK')reasons.push('ریسک Bot/Wash');
  if(t.chart?.pumpDumpRisk==='HIGH')reasons.push('ریسک Pump/Dump بالا');

  var ok=
    holderOk&&
    sec.mintDisabled===true&&
    sec.freezeDisabled===true&&
    sec.tokenExtensions?.hardFail!==true&&
    Number(t.liquidity||0)>=25000&&
    lpCheck?.state==='pass'&&
    t.poolHealth?.status==='CLEAR'&&
    criticalFail.length===0&&
    criticalUnknown.length===0&&
    t.activity?.label!=='BOT RISK'&&
    t.chart?.pumpDumpRisk!=='HIGH'&&
    ac.blocked!==true;

  return {ok,reasons,holderOk,holdersComplete,criticalFail,criticalUnknown,complete:criticalUnknown.length===0};
}

// Prospective conservative entry rules: reduces risky calls, not a claimed historical win-rate improvement.
function conservativeEntryCheck(t){
  var reasons=[],fl=t.flow||{},mq=t.marketQuality||{},sec=t.security||{};
  var pc5=Number(t.priceChange5m),pc1=Number(t.priceChange1h),
    pc6=Number(t.priceChange6h),pc24=Number(t.priceChange24h);
  var buys=Number(t.buys5m),sells=Number(t.sells5m),
    buyer=Number(fl.buyerPower),liq=Number(t.liquidity),
    vol=Number(t.volume5m),tx=Number(t.txns5m);
  if(!(Number.isFinite(liq)&&liq>=75000))reasons.push('نقدینگی حداقل ۷۵ هزار دلار');
  if(!(Number.isFinite(vol)&&vol>=8000&&liq>0&&vol/liq<=2))reasons.push('حجم معتبر و غیرجهشی نسبت به نقدینگی');
  if(!(Number.isFinite(tx)&&tx>=50&&Number.isFinite(buys)&&buys>=25&&
    Number.isFinite(sells)&&buys>=1.6*Math.max(1,sells)))reasons.push('مشارکت خریداران و نسبت خرید/فروش کافی نیست');
  if(!(Number.isFinite(buyer)&&buyer>=62))reasons.push('قدرت خرید کمتر از ۶۲٪');
  if(!(Number.isFinite(pc5)&&pc5>=1&&pc5<=6&&Number.isFinite(pc1)&&pc1>=2&&pc1<=18))
    reasons.push('مومنتوم پنج‌دقیقه/یک ساعت خارج از بازه محافظه‌کارانه');
  if((Number.isFinite(pc6)&&pc6>45)||(Number.isFinite(pc24)&&pc24>110))
    reasons.push('رشد شدید قبلی و ریسک ورود دیرهنگام');
  if(!(Number.isFinite(Number(mq.score))&&Number(mq.score)>=75))
    reasons.push('کیفیت بازار حداقل ۷۵ تأیید نشده');
  if(t.activity?.label!=='PROBABLE ORGANIC')reasons.push('فعالیت طبیعی هنوز تأیید نشده');
  if(fl.volumeLabel!=='GOOD'&&fl.volumeLabel!=='STRONG')reasons.push('کیفیت حجم معاملات کافی نیست');
  if(t.chart?.fomoRisk==='HIGH'||t.chart?.pumpDumpRisk==='HIGH')
    reasons.push('ریسک FOMO یا پامپ و دامپ');
  if(sec.tier!=='HIGH'&&sec.tier!=='MAX SECURITY')reasons.push('امنیت HIGH/MAX نیست');
  var ws=whaleSellsFor(t.mint),ex=exitFor(t.mint),tr=findTracked(t.mint);
  if(ws.count>0||ex.length>0||Number(tr?.netFlowUsd||0)<-250||
     Number(tr?.uniqueSellers||0)>=2)reasons.push('فروش نهنگ یا جریان منفی کیف‌پول‌های ردیابی‌شده');
  if(!(currentPriceForMint(t.mint)>0))reasons.push('قیمت زنده تأییدشده در دسترس نیست');
  return {ok:reasons.length===0,reasons};
}
function tradePlan(t){
  if(!t)return {status:'WAIT',entry:null,entryLow:null,entryHigh:null,stopLoss:null,takeProfit1:null,takeProfit2:null,takeProfit3:null,reason:'داده کافی نیست'};

  var sec=t.security||{},fl=t.flow||{},q=entryQualityGate(t),safe=antiRugGate(t);
  if(!rugcheckVerified(t)){
    const st=t.externalSecurity?.rugcheck?.state||'UNKNOWN';
    return {status:st==='REJECT'?'EXIT':'WAIT',entry:null,entryLow:null,entryHigh:null,
      stopLoss:null,takeProfit1:null,takeProfit2:null,takeProfit3:null,
      reason:'بررسی Rugcheck برای این قرارداد تأیید نشده: '+st};
  }
  var ws=whaleSellsFor(t.mint),ex=exitFor(t.mint);
  var p=Number(t.priceUsd||0);
  var buyerPower=Number(fl.buyerPower||0);
  var sellerPower=Math.max(0,100-buyerPower);

  // Dynamic risk: tighter for MAX SECURITY + deeper liquidity.
  var riskPct=(sec.tier==='MAX SECURITY'&&Number(t.liquidity||0)>=25000)?0.055:0.07;
  var stopLoss=p>0?p*(1-riskPct):null;
  var takeProfit1=p>0?p*(1+riskPct):null;      // 1R
  var takeProfit2=p>0?p*(1+riskPct*2):null;    // 2R
  var takeProfit3=p>0?p*(1+riskPct*3):null;    // 3R
  var entryLow=p>0?p*0.99:null,entryHigh=p>0?p*1.01:null;

  var heavyLiveExit=(ws.count>=2||Number(ws.usd||0)>=10000||ex.length>=2);

  if(!safe.ok||heavyLiveExit){
    return {
      status:'EXIT',entry:null,entryLow:null,entryHigh:null,
      stopLoss,takeProfit1,takeProfit2,takeProfit3,
      reason:!safe.ok?'رد امنیتی/ضد Rug: '+safe.reasons.slice(0,3).join(' • '):'فشار خروج زنده سنگین ثبت شده',
      riskPct:riskPct*100,buyerPower,sellerPower,quality:q,safety:safe
    };
  }

  if(!p){
    return {
      status:'WAIT',entry:null,entryLow:null,entryHigh:null,
      stopLoss:null,takeProfit1:null,takeProfit2:null,takeProfit3:null,
      reason:'قیمت معتبر هنوز دریافت نشده',
      riskPct:riskPct*100,buyerPower,sellerPower,quality:q,safety:safe
    };
  }

  if(!q.ok){
    return {
      status:buyerPower<sellerPower?'EXIT':'WAIT',
      entry:null,entryLow:null,entryHigh:null,
      stopLoss,takeProfit1,takeProfit2,takeProfit3,
      reason:q.reasons.slice(0,3).join(' • ')||'در انتظار برتری خریدار',
      riskPct:riskPct*100,buyerPower,sellerPower,quality:q,safety:safe
    };
  }

  var conservative=conservativeEntryCheck(t);
  if(!conservative.ok){
    return {status:'WAIT',entry:null,entryLow:null,entryHigh:null,
      stopLoss,takeProfit1,takeProfit2,takeProfit3,
      reason:'فیلتر محافظه‌کارانه: '+conservative.reasons.slice(0,3).join(' • '),
      riskPct:riskPct*100,buyerPower,sellerPower,quality:q,safety:safe};
  }

  // A single bullish snapshot often precedes a reversal. For new entry calls,
  // require independent on-chain holder stability and consecutive scan evidence.
  // Watch candidates still remain visible without pretending they are buy signals.
  var confirmation=t.preSignalGuard||{},guard=trustGuard(t);
  if(confirmation.status!=='CONFIRMED'||guard.status!=='CONFIRMED'){
    return {
      status:'WAIT',entry:null,entryLow:null,entryHigh:null,
      stopLoss,takeProfit1,takeProfit2,takeProfit3,
      reason:'منتظر تأیید حداقل دو اسکن متوالی، ۴۵ ثانیه پایداری و ثبات هولدرها',
      riskPct:riskPct*100,buyerPower,sellerPower,quality:q,safety:safe,
      confirmationStatus:confirmation.status||'UNKNOWN'
    };
  }
  // Prefer early, sustained momentum, not already-extended or collapsing candles.
  // These are initial safeguards, NOT thresholds learned from the 500 historical tokens.
  if(Number(t.priceChange5m)<1||Number(t.priceChange5m)>8||
     Number(t.priceChange1h)<1||Number(t.priceChange1h)>22||
     Number(t.liquidity||0)<40000||
     Number(t.volume5m||0)<5000||
     Number(t.txns5m||0)<35||
     (Number(t.buys5m||0)+1)/(Number(t.sells5m||0)+1)<1.4){
    return {
      status:'WAIT',entry:null,entryLow:null,entryHigh:null,
      stopLoss,takeProfit1,takeProfit2,takeProfit3,
      reason:'مومنتوم پایدار یا نقدینگی/حجم کافی برای ورود محافظه‌کارانه تأیید نشده',
      riskPct:riskPct*100,buyerPower,sellerPower,quality:q,safety:safe
    };
  }
  var momScore=Number(q.momentum?.score||0);
  var confidence='EARLY';
  if(buyerPower>=60&&q.buyer100Ok&&momScore>=65)confidence='HIGH';
  else if(buyerPower>=55&&(q.buyer100Ok||momScore>=55))confidence='MEDIUM';

  return {
    status:'ENTRY',confidence,
    entry:p,entryLow,entryHigh,
    stopLoss,takeProfit1,takeProfit2,takeProfit3,
    reason:(safe.complete?'امنیت ضد Rug کامل':'هسته امنیت پاس؛ بعضی منابع تکمیلی هنوز نامشخص')+' · حداقل ۱۰۰۰ هولدر تأییدشده · هولدر #1 زیر 10% · هولدرهای #2 تا #10 هرکدام زیر 5% · قدرت خریدار '+buyerPower+'% در برابر فروشنده '+sellerPower+'%',
    riskPct:riskPct*100,buyerPower,sellerPower,edge:buyerPower-sellerPower,quality:q,safety:safe
  };
}
function tradePlanChips(t){
  var p=tradePlan(t);
  if(p.status==='ENTRY'){
    var zone=(p.entryLow&&p.entryHigh)?fmtPrice(p.entryLow)+' تا '+fmtPrice(p.entryHigh):fmtPrice(p.entry);
    var label=p.confidence==='HIGH'?'🟢 ورود قوی':p.confidence==='MEDIUM'?'🟢 ورود فعال':'🟡 ورود زودهنگام';
    var liveNow=currentPriceForMint(t.mint)||Number(t.priceUsd||0);
    return rugcheckBadge(t)+'<span class="entry-chip entry-ready">'+label+' · '+zone+'</span>'+
      '<span class="entry-chip entry-ready">⚡ قیمت لحظه‌ای · <b data-live-price-mint="'+esc(t.mint)+'">'+fmtPrice(liveNow)+'</b></span>'+
      '<span class="entry-chip entry-exit">🛑 حد ضرر · '+fmtPrice(p.stopLoss)+'</span>'+
      '<span class="entry-chip entry-ready">🎯 سود 1 · '+fmtPrice(p.takeProfit1)+'</span>'+
      '<span class="entry-chip entry-ready">🎯 سود 2 · '+fmtPrice(p.takeProfit2)+'</span>'+
      '<span class="entry-chip entry-ready">🚀 سود 3 · '+fmtPrice(p.takeProfit3)+'</span>';
  }
  if(p.status==='EXIT')return rugcheckBadge(t)+'<span class="entry-chip entry-exit">🔴 ورود نکن / خروج'+(p.stopLoss?' · مرجع '+fmtPrice(p.stopLoss):'')+'</span>';
  return rugcheckBadge(t)+'<span class="entry-chip entry-wait">⏳ '+esc(p.reason||'در انتظار تأیید')+'</span>';
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
async function safeJson(u){try{var sep=u.includes('?')?'&':'?';var r=await fetch(u+sep+'_ts='+Date.now(),{cache:'no-store',headers:{'cache-control':'no-cache'}});if(!r.ok)throw 0;return await r.json()}catch(e){return null}}

function siteTrendSources(t){
  var src=Array.isArray(t&&t.discoverySources)?t.discoverySources:[];
  var out=[];
  if(src.some(function(x){return /DEXScreener/i.test(x)}))out.push('DEXScreener');
  if(src.some(function(x){return /GeckoTerminal Trending/i.test(x)}))out.push('GeckoTerminal Trending');
  if(src.some(function(x){return /GeckoTerminal New/i.test(x)}))out.push('GeckoTerminal New');
  if(src.some(function(x){return /KOL/i.test(x)}))out.push('KOL');
  if(src.some(function(x){return /Live whale/i.test(x)}))out.push('Live Whale');
  return [...new Set(out)];
}
function siteTrendScore(t){
  var src=siteTrendSources(t),s=0;
  if(src.includes('DEXScreener'))s+=25;
  if(src.includes('GeckoTerminal Trending'))s+=30;
  if(src.includes('GeckoTerminal New'))s+=12;
  if(src.includes('KOL'))s+=18;
  if(src.includes('Live Whale'))s+=20;
  if(t&&t.boostSeen)s+=Math.min(8,Math.log10(1+Number(t.boostTotal||0))*3);
  return Math.min(100,Math.round(s));
}
function siteTrendBadges(t){
  var src=siteTrendSources(t);
  if(!src.length)return '<span class="badge mid">ترند منبعی نامشخص</span>';
  return src.slice(0,4).map(function(x){
    var label=x==='DEXScreener'?'🔥 DEX':x==='GeckoTerminal Trending'?'🦎 Gecko ترند':x==='GeckoTerminal New'?'🆕 Gecko':x==='KOL'?'👑 KOL':'🐋 Whale';
    return '<span class="badge blue">'+label+'</span>';
  }).join('');
}
function highestSecurityTrendOk(t){
  if(!t)return false;
  var sec=t.security||{},rug=antiRugGate(t);
  return (sec.tier==='MAX SECURITY'||sec.tier==='HIGH')&&
    sec.mintDisabled===true&&sec.freezeDisabled===true&&
    sec.holderPolicyPassed===true&&
    sec.tokenExtensions?.hardFail!==true&&
    rug.ok===true&&
    t.activity?.label!=='BOT RISK'&&
    t.chart?.pumpDumpRisk!=='HIGH'&&
    Number(t.liquidity||0)>=10000&&
    siteTrendSources(t).length>=1;
}

function rugcheckVerified(t){
  const r=t?.externalSecurity?.rugcheck;
  if(!r||r.mint!==t.mint||r.state!=='PASS'||!r.reportAvailable)return false;
  const checked=Date.parse(r.checkedAt||'');
  return Number.isFinite(checked)&&Date.now()-checked<=15*60*1000;
}
function rugcheckBadge(t){
  if(!t?.mint)return '';
  const r=t.externalSecurity?.rugcheck,st=r?.state||'UNKNOWN';
  const color=st==='PASS'?'good':st==='REJECT'?'bad':'mid';
  const label=st==='PASS'?'Rugcheck: کم‌ریسک در بررسی':
    st==='REJECT'?'Rugcheck: ریسک بالا / رد':
    st==='REVIEW'?'Rugcheck: بررسی بیشتر':'Rugcheck: نامشخص';
  return '<a class="badge '+color+'" rel="noopener" target="_blank" href="https://rugcheck.xyz/tokens/'+
    encodeURIComponent(t.mint)+'">🛡️ '+label+'</a>';
}
function verifiedRecommendation(t){
  if(!t||!rugcheckVerified(t))return false;
  const s=t.security||{},lp=(t.academy?.checks||[]).find(x=>x.name==='Liquidity Lock/Burn خودکار');
  return (s.tier==='MAX SECURITY'||s.tier==='HIGH')&&
    s.mintDisabled===true&&s.freezeDisabled===true&&
    s.ownerAggregationComplete===true&&Array.isArray(s.topHolders)&&s.topHolders.length>=10&&
    s.holderPolicyPassed===true&&Number(s.largestHolder)<10&&Number(s.maxOtherHolder)<5&&
    lp?.state==='pass'&&t.poolHealth?.status==='CLEAR'&&
    Number(t.liquidity)>=25000&&antiRugGate(t).ok===true;
}
function featuredWatchOk(t){
  if(!t||!rugcheckVerified(t))return false;
  var sec=t.security||{},rug=antiRugGate(t),tp=tradePlan(t);
  return verifiedRecommendation(t)&&
    (sec.tier==='MAX SECURITY'||sec.tier==='HIGH')&&
    sec.mintDisabled===true&&sec.freezeDisabled===true&&
    sec.holderPolicyPassed===true&&
    sec.tokenExtensions?.hardFail!==true&&
    rug.ok===true&&
    t.activity?.label!=='BOT RISK'&&
    t.chart?.pumpDumpRisk!=='HIGH'&&
    Number(t.liquidity||0)>=10000&&
    siteTrendSources(t).length>=1&&
    tp.status!=='EXIT';
}

function featuredRows(){
  var fresh=tokens.map(function(t){
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
    var mom=momentumFilter(t);if(mom.ok){s+=18;w.push('فیلتر مومنتوم کامل')}else if(mom.score>=75){s+=8;w.push('مومنتوم نزدیک تأیید')}
    if(t.academy&&t.academy.blocked)s-=25;
    var sm=smartFor(t.mint);if(sm){s+=Math.min(10,5+Number(sm.smartMoneyCount||0)*2);w.push('اسمارت‌مانی')}
    var wh=whaleFor(t.mint);if(wh.count){s+=Math.min(14,7+wh.count*3);w.push('خرید نهنگ')}
    var tr=findTracked(t.mint);if(tr&&tr.uniqueBuyers>=2&&tr.netFlowUsd>0){s+=12;w.push('خرید همزمان کیف‌پول‌ها')}else if(tr&&tr.uniqueBuyers>=1&&tr.netFlowUsd>0)s+=5;
    if(tr&&tr.uniqueSellers>=2)s-=18;
    if(exitFor(t.mint).length)s-=28;
    s=Math.max(0,Math.min(100,Math.round(s)));
    var sts=siteTrendScore(t);if(sts){s=Math.min(100,s+Math.round(sts*.16));w.push('ترند چندمنبعی '+sts+'/100')}
    return {token:t,score:s,why:w,whale:wh,smart:sm,tracked:tr,lastSeen:Date.now(),sticky:false,siteTrendScore:sts};
  }).filter(function(x){
    return featuredWatchOk(x.token);
  }).sort(function(a,b){
    var at=tradePlan(a.token),bt=tradePlan(b.token);
    var ae=at.status==='ENTRY'?3:at.status==='WAIT'?1:0;
    var be=bt.status==='ENTRY'?3:bt.status==='WAIT'?1:0;
    var ac=at.confidence==='HIGH'?2:at.confidence==='MEDIUM'?1:0;
    var bc=bt.confidence==='HIGH'?2:bt.confidence==='MEDIUM'?1:0;
    return (be-ae)||(bc-ac)||(b.score-a.score);
  }).slice(0,8);

  // Add/update every current valid recommendation in the sticky list.
  fresh.forEach(function(x){
    stickyFeatured.set(x.token.mint,x);
    if(tradePlan(x.token).status==='ENTRY'&&currentPriceForMint(x.token.mint)>0)rememberRecommendation(x.token,x.score);
  });

  // Refresh sticky rows from current live token data when available.
  for(const [mint,old] of [...stickyFeatured.entries()]){
    var current=findToken(mint);
    if(current){
      var tp=tradePlan(current);
      // Keep safe WATCH/WAIT candidates visible; remove only if safety/trend is lost or EXIT is confirmed.
      if(!featuredWatchOk(current)||tp.status==='EXIT'){
        stickyFeatured.delete(mint);
        continue;
      }
      var newer=fresh.find(function(x){return x.token.mint===mint});
      if(newer){
        stickyFeatured.set(mint,newer);
      }else{
        // Keep the recommendation visible through temporary WAIT/ranking/discovery changes.
        stickyFeatured.set(mint,Object.assign({},old,{
          token:current,
          whale:whaleFor(mint),
          smart:smartFor(mint),
          tracked:findTracked(mint),
          sticky:true
        }));
      }
    }else{
      // Do not display a stale token as an active recommendation.
      stickyFeatured.delete(mint);
    }
  }

  saveStickyFeatured();

  return [...stickyFeatured.values()].filter(function(x){return x&&x.token&&featuredWatchOk(x.token)})
    .sort(function(a,b){
      var at=a.token?tradePlan(a.token):null,bt=b.token?tradePlan(b.token):null;
      var ac=at&&at.confidence==='HIGH'?2:at&&at.status==='ENTRY'?1:0;
      var bc=bt&&bt.confidence==='HIGH'?2:bt&&bt.status==='ENTRY'?1:0;
      return (bc-ac)||(Number(b.score||0)-Number(a.score||0))||(Number(b.lastSeen||0)-Number(a.lastSeen||0));
    })
    .slice(0,8);
}

function tokenRow(t,bucket){
  var s=t.security||{},sg=t.signals||{},sh=sg.short||{},md=sg.medium||{},lg=sg.long||{},fl=t.flow||{},bs=bucketScore(t,bucket||ageBucket(t));
  return '<div class="row">'+
  '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+rugcheckBadge(t)+'<span class="age-chip">'+esc(ageText(t))+'</span>'+(t.kolTrend?'<span class="age-chip">👑 '+Number(t.kolTrend.kolCount||0)+' KOL</span>':'')+siteTrendBadges(t)+whaleTrendBadge(t)+socialTrendBadges(t)+topTraderBadge(t)+momentumChip(t)+tradePlanChips(t)+'<small>'+esc(short(t.mint))+'</small>'+socialButtons(t)+'</div>'+
  '<div class="cell"><small>امتیاز گروه</small><b><span class="badge '+bucketSignalClass(bs,t)+'">'+bs+'/100</span></b></div>'+'<div class="cell"><small>ترند سایت‌ها</small><b><span class="badge '+(siteTrendScore(t)>=50?'good':siteTrendScore(t)>=20?'mid':'blue')+'">'+siteTrendScore(t)+'/100</span></b></div>'+
  '<div class="cell"><small>کوتاه / میان / بلند</small><b>'+Number(sh.score||0)+' / '+Number(md.score||0)+' / '+Number(lg.score||0)+'</b></div>'+
  '<div class="cell"><small>قدرت خریدار</small><b><span class="badge '+pressureClass(t)+'">'+(fl.buyerPower==null?'—':Number(fl.buyerPower)+'%')+'</span></b></div>'+
  '<div class="cell hide-sm"><small>امنیت</small><b><span class="badge '+secClass(s.tier)+'">'+esc(faSec(s.tier))+'</span></b></div>'+
  '<div class="cell hide-md"><small>خریدار $500+ / فروشنده</small><b><span class="badge '+(largeBuyerFlow(t).dominant?'good':'mid')+'">'+largeBuyerFlow(t).buyers+' / '+largeBuyerFlow(t).sellers+'</span></b></div>'+
  '<div class="cell"><small>Trust Guard</small><b><span class="badge '+trustClass(t)+'">'+esc(trustLabel(t))+'</span></b></div><div class="cell"><small>'+esc(return24Period(t))+'</small><b class="'+return24Class(t)+'">'+esc(return24Text(t))+'</b></div>'+
  '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
}

function beginnerDecision(t,overallScore){
  if(!t)return {label:'صبر کن',cls:'decision-wait',reason:'فعلاً توکن قابل‌ارزیابی وجود ندارد'};
  var tp=tradePlan(t);
  if(tp.status==='EXIT')return {label:'ورود نکن / خروج',cls:'decision-stop',reason:tp.reason};
  if(tp.status==='WAIT')return {label:'صبر کن',cls:'decision-wait',reason:tp.reason};
  if(tp.status==='ENTRY'){
    return {
      label:tp.confidence==='HIGH'?'نقطه ورود قوی':'نقطه ورود فعال',
      cls:'decision-buy',
      reason:tp.reason+' · امتیاز رتبه‌بندی '+Number(overallScore||0)+'/100'
    };
  }
  return {label:'صبر کن',cls:'decision-wait',reason:'داده کافی نیست'};
}
function overallCandidates(){
  return tokens.map(function(t){
    var tp=tradePlan(t);
    if(!featuredWatchOk(t))return null;

    var sec=t.security||{},fl=t.flow||{},mq=t.marketQuality||{},sg=t.signals||{};
    var score=0,reasons=[];
    var sts=siteTrendScore(t);score+=Math.min(15,Math.round(sts*.15));if(sts)reasons.push('ترند سایت‌ها '+sts+'/100');

    // Buyer/seller edge is the main ranking factor.
    score+=Math.min(38,Math.max(0,Number(tp.buyerPower||0)-50)*1.9);
    if(Number(tp.buyerPower||0)>=60){score+=10;reasons.push('قدرت خریدار 60%+')}
    else if(Number(tp.buyerPower||0)>=55){score+=7;reasons.push('قدرت خریدار 55%+')}
    else reasons.push('خریدار کمی غالب');

    // Safety and market quality improve ranking, but do not re-disable valid flow entries.
    if(sec.tier==='MAX SECURITY'){score+=18;reasons.push('امنیت خیلی بالا')}
    else if(sec.tier==='HIGH'){score+=14;reasons.push('امنیت بالا')}
    else if(sec.tier==='REVIEW')score+=6;

    if(Number(t.liquidity||0)>=25000){score+=9;reasons.push('نقدینگی خوب')}
    else if(Number(t.liquidity||0)>=10000)score+=6;
    else if(Number(t.liquidity||0)>=3000)score+=3;

    if(fl.volumeLabel==='STRONG'){score+=9;reasons.push('حجم قوی')}
    else if(fl.volumeLabel==='GOOD'){score+=7;reasons.push('حجم خوب')}
    else if(fl.volumeLabel==='MEDIUM')score+=4;

    score+=Math.min(7,Number(mq.score||0)*0.07);
    score+=Math.min(5,Number(t.socialHeat?.score||0)*0.05);

    var sm=smartFor(t.mint),wh=whaleFor(t.mint),tr=findTracked(t.mint);
    if(wh.count){score+=Math.min(8,3+wh.count*2);reasons.push('خرید نهنگ')}
    if(sm){score+=4;reasons.push('اسمارت‌مانی')}
    if(tr&&Number(tr.uniqueBuyers||0)>Number(tr.uniqueSellers||0)){score+=2;reasons.push('کیف‌پول‌های ردیابی‌شده خریدار غالب')}
    var tt=topTraderForMint(t.mint);
    if(tt&&Number(tt.holderCount||0)>=2){
      score+=Math.min(10,Number(tt.holderCount||0)*2);
      reasons.push('اجماع '+Number(tt.holderCount||0)+' تریدر برتر');
      if(Number(tt.recentBuyers||0)>0){score+=Math.min(5,Number(tt.recentBuyers||0)*2);reasons.push('خرید تازه تریدرهای برتر')}
    }

    var shortScore=Number(sg.short?.score||0),medScore=Number(sg.medium?.score||0);
    score+=Math.min(6,(shortScore+medScore)/40);

    return {t:t,score:Math.min(100,Math.round(score)),sm:sm,wh:wh,tr:tr,reasons:reasons,tp:tp};
  }).filter(Boolean).sort(function(a,b){
    return (Number(b.tp?.buyerPower||0)-Number(a.tp?.buyerPower||0))||
      (b.score-a.score)||
      (Number(b.t?.liquidity||0)-Number(a.t?.liquidity||0));
  });
}
function renderChampion(){
  var x=overallCandidates()[0],el=document.getElementById('championBox');
  if(!x){el.innerHTML='<div class="muted">فعلاً حتی کاندید HIGH/MAX با امنیت هسته‌ای سالم پیدا نشده؛ به محض پیدا شدن، ENTRY یا «در انتظار ورود» نمایش داده می‌شود.</div>';return}
  var t=x.t,sg=t.signals||{},d=beginnerDecision(t,x.score);
  el.innerHTML='<div class="decision-banner '+d.cls+'">'+esc(d.label)+'<div class="beginner-note">'+esc(d.reason)+' · تضمین سود نیست و اندازه پوزیشن باید کوچک بماند.</div></div><div class="champion-grid">'+
    '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+siteTrendBadges(t)+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>بدون هشدار خروج · امنیت '+esc(faSec(t.security?.tier))+'</small>'+socialButtons(t)+'</div>'+
    '<div><small class="muted">امتیاز کل</small><div class="score">'+x.score+'/100</div></div>'+
    '<div class="cell"><small>کوتاه</small><b>'+Number(sg.short?.score||0)+'</b></div>'+
    '<div class="cell"><small>میان</small><b>'+Number(sg.medium?.score||0)+'</b></div>'+
    '<div class="cell"><small>بلند</small><b>'+Number(sg.long?.score||0)+'</b></div><div class="cell"><small>قدرت خریدار</small><b><span class="badge '+pressureClass(t)+'">'+Number(t.flow?.buyerPower||0)+'%</span></b></div><div class="cell"><small>حجم</small><b><span class="badge '+volumeClass(t.flow?.volumeLabel)+'">'+esc(faVolume(t.flow?.volumeLabel))+'</span></b></div><div class="cell"><small>Social Heat</small><b><span class="badge '+socialHeatClass(t.socialHeat?.label)+'">'+esc(faSocialHeat(t.socialHeat?.label))+' '+Number(t.socialHeat?.score||0)+'</span></b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div>'+
  '</div></div>';
}

function renderTopQuick(){
  var f=document.getElementById('topFeaturedQuick');
  if(f){
    var rows=featuredRows().filter(function(x){return passesSignalFilters(x.token)}).slice(0,6);
    f.innerHTML=rows.length?
      '<div class="empty">🔎 گزینه‌های تحت بررسی؛ فقط «ورود فعال» سیگنال خرید است. وضعیت «صبر» پیشنهاد ورود نیست.</div>'+
      rows.map(function(x,i){
      var t=x.token,tp=tradePlan(t),sec=t.security||{};
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🔥 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+(x.sticky?'<span class="badge blue">📌 حفظ‌شده</span>':'')+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(x.why.slice(0,3).join(' • '))+'</small></div>'+
      '<div class="cell"><small>امتیاز</small><b>'+x.score+'/100</b></div>'+
      '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
      '<div class="cell"><small>خریدار</small><b>'+Number(t.flow?.buyerPower||0)+'%</b></div>'+
      '<div class="cell hide-sm"><small>حجم</small><b>'+esc(faVolume(t.flow?.volumeLabel))+'</b></div>'+
      '<div class="cell hide-md"><small>ورود</small><b>'+(tp.status==='ENTRY'?(tp.confidence==='HIGH'?'قوی':'قابل‌بررسی'):'صبر')+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
    }).join(''):'<div class="empty">فعلاً نقطه ورود تأییدشده‌ای پیدا نشده؛ توکن‌های پرریسک عمداً بالا نمی‌آیند.</div>';
  }

  var q=document.getElementById('topTokenQuick');
  if(q){
    var rows2=tokens.filter(verifiedRecommendation).sort(function(a,b){
      var sa=a.security?.tier==='MAX SECURITY'?3:a.security?.tier==='HIGH'?2:a.security?.tier==='REVIEW'?1:0;
      var sb=b.security?.tier==='MAX SECURITY'?3:b.security?.tier==='HIGH'?2:b.security?.tier==='REVIEW'?1:0;
      return (sb-sa)||(siteTrendScore(b)-siteTrendScore(a))||(bucketScore(b,ageBucket(b))-bucketScore(a,ageBucket(a)));
    }).slice(0,8);
    q.innerHTML=rows2.length?rows2.map(function(t,i){
      var sec=t.security||{},score=bucketScore(t,ageBucket(t));
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🪙 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+siteTrendBadges(t)+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(ageText(t))+' · '+esc(bucketSignalLabel(score,t))+'</small></div>'+
      '<div class="cell"><small>امتیاز</small><b>'+score+'/100</b></div>'+'<div class="cell"><small>ترند سایت‌ها</small><b>'+siteTrendScore(t)+'/100</b></div>'+
      '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
      '<div class="cell"><small>خریدار</small><b>'+Number(t.flow?.buyerPower||0)+'%</b></div>'+
      '<div class="cell hide-sm"><small>حجم</small><b>'+esc(faVolume(t.flow?.volumeLabel))+'</b></div>'+
      '<div class="cell hide-md"><small>نهنگ</small><b>'+whaleFor(t.mint).count+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
    }).join(''):'<div class="empty">فعلاً هیچ توکنی هم‌زمان قانون ۱۰ هولدر، قفل یا سوزاندن حداقل ۹۰٪ LP، نقدینگی ۲۵ هزار دلار و پایداری استخر را تأیید نکرده است. موارد ردشده فقط در بخش بررسی توکن‌ها قابل مشاهده‌اند.</div>';
  }
}

function renderFeatured(){
  var r=featuredRows().filter(function(x){
    var any=signalFilters.short||signalFilters.medium||signalFilters.long||signalFilters.security||signalFilters.holders||signalFilters.bigbuyers;
    return !any||passesSignalFilters(x.token);
  }).sort(function(a,b){return (b.score-a.score)||(tokenStrength(b.token)-tokenStrength(a.token))});document.getElementById('kFeatured').textContent=r.length;
  document.getElementById('featuredList').innerHTML=r.length?
    '<div class="empty">⚠️ این فهرست واچ‌لیست است، نه پیشنهاد خرید. صدور ورود نیازمند عبور از همه شروط امنیت، بازار و قیمت زنده است.</div>'+
    r.map(function(x){
    var t=x.token;
    return '<div class="row"><div class="asset"><b>🔥 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+(x.sticky?'<span class="badge blue">📌 حفظ‌شده</span>':'')+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(x.why.slice(0,3).join(' • '))+'</small>'+socialButtons(t)+'</div>'+
    '<div class="cell"><small>امتیاز</small><b><span class="badge good">'+x.score+'/100</span></b></div>'+
    '<div class="cell"><small>نهنگ</small><b>'+money(x.whale.usd)+'</b></div>'+
    '<div class="cell"><small>اسمارت</small><b>'+(x.smart?Number(x.smart.smartMoneyCount||0):0)+'</b></div>'+
    '<div class="cell hide-sm"><small>کیف‌پول برتر</small><b>'+(x.tracked?Number(x.tracked.uniqueBuyers||0):0)+'</b></div>'+
    '<div class="cell hide-md"><small>خریدار / حجم</small><b>'+Number(t.flow?.buyerPower||0)+'% · '+esc(faVolume(t.flow?.volumeLabel))+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً پیشنهاد فعالی ثبت نشده؛ پیشنهادهای ثبت‌شده در بروزرسانی‌های بعدی حفظ می‌شوند تا زمانی که خروج/ریسک جدی تأیید شود.</div>';
}
function whaleVerification(t){
  if(!t)return {score:0,passed:0,total:6,checks:[]};
  var s=t.security||{},act=t.activity||{},tr=findTracked(t.mint),wh=whaleFor(t.mint);
  var checks=[
    {name:'خرید واقعی/قابل رهگیری',ok:!!t.dexUrl||wh.count>0},
    {name:'کیف‌پول سودآور/ردیابی‌شده',ok:!!tr&&((Number(tr.netFlowUsd||0)>0)||(Number(tr.convictionHolderCount||0)>0))},
    {name:'اندازه خرید نسبت به نقدینگی معقول',ok:Number(t.liquidity||0)>0&&Number(wh.usd||0)<=Number(t.liquidity||0)*0.35},
    {name:'تمرکز هولدر قابل قبول',ok:holderPolicyOk(t)},
    {name:'Mint/Freeze امن',ok:s.mintDisabled===true&&s.freezeDisabled===true},
    {name:'بدون الگوی ربات/Wash',ok:act.label==='PROBABLE ORGANIC'}
  ];
  var passed=checks.filter(function(x){return x.ok}).length;
  return {score:Math.round(passed/checks.length*100),passed,total:checks.length,checks};
}
function whaleVerifyChip(t){
  var v=whaleVerification(t);
  var cls=v.passed>=5?'good':v.passed>=3?'mid':'bad';
  return '<span class="badge '+cls+'">تأیید نهنگ '+v.passed+'/'+v.total+'</span>';
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
      '<div class="whale-stat"><small>خرید هماهنگ 3+ کیف‌پول / 15m</small><b>'+Number(live&&live.coordinatedBuys?live.coordinatedBuys.length:0)+'</b></div>'+
    '</div>';
  })();

  var rankedHtml=agg.length?'<div class="list">'+agg.slice(0,12).map(function(a,i){
    var t=findToken(a.tokenAddress),sec=t&&t.security?t.security:{},tp=t?tradePlan(t):null;
    var strength=t?Math.round(tokenStrength(t)):0;
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🐋 '+esc(a.token||t&&t.symbol||'?')+'</b>'+whaleTrendBadge(t)+socialTrendBadges(t)+(t?whaleVerifyChip(t)+tradePlanChips(t):'')+
      '<small>'+Number(a.uniqueTraders||0)+' نهنگ · '+Number(a.buyCount||0)+' خرید · '+(Number(a.splitBuyerCount||0)?Number(a.splitBuyerCount||0)+' خریدار با خرید خردشده · ':'')+'منبع: Live whale API</small>'+socialButtons(t)+'</div>'+
      '<div class="cell"><small>کل خرید</small><b>'+money(a.totalBuyUsd)+'</b></div>'+
      '<div class="cell"><small>نهنگ یکتا</small><b>'+Number(a.uniqueTraders||0)+'</b></div>'+
      '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
      '<div class="cell hide-sm"><small>قدرت رادار</small><b>'+strength+'/100</b></div>'+
      '<div class="cell hide-md"><small>وضعیت</small><b>'+(tp?esc(tp.label||'بررسی'):'بررسی')+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(a.tokenAddress,t&&t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(a.tokenAddress)+'">جزئیات</button></div></div>';
  }).join('')+'</div>':'<div class="empty">فعلاً خرید نهنگ تازه‌ای در پنجره ۳۰ دقیقه‌ای ثبت نشده.</div>';

  var positions=live&&Array.isArray(live.whalePositions)?live.whalePositions:[];
  var positionsHtml=positions.length?'<div class="list">'+positions.slice(0,10).map(function(p,i){
    var t=findToken(p.tokenAddress),sec=t&&t.security?t.security:{};
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🐋 موقعیت بزرگ · '+esc(p.token||t&&t.symbol||'?')+'</b>'+
      '<small>'+Number(p.holdingWallets||0)+' کیف‌پول ردیابی‌شده · منبع: Solana RPC portfolio</small></div>'+
      '<div class="cell"><small>ارزش فعلی</small><b>'+money(p.currentHoldingUsd)+'</b></div>'+
      '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(p.tokenAddress,p.dexUrl||t&&t.dexUrl))+'">📈 چارت</a></div></div>';
  }).join('')+'</div>':'<div class="empty">فعلاً موقعیت فعلی بالای 25هزار دلار در کیف‌پول‌های ردیابی‌شده پیدا نشده.</div>';

  var topSummary=document.getElementById('whaleTopSummary');
  var topList=document.getElementById('whaleTopList');
  if(topSummary)topSummary.innerHTML=summaryHtml;
  if(topList)topList.innerHTML=rankedHtml+'<h3 style="font-size:13px;margin:12px 0 6px">🐋 موقعیت‌های بزرگ فعلی</h3>'+positionsHtml;

  var sum=document.getElementById('whaleSummary');
  if(sum)sum.innerHTML=summaryHtml+rankedHtml+'<h3 style="font-size:13px;margin:12px 0 6px">🐋 موقعیت‌های بزرگ فعلی</h3>'+positionsHtml;

  document.getElementById('kWhales').textContent=r.length||(live&&live.whalePositions?live.whalePositions.length:0);
  var filtered=r.filter(function(e){return passesSignalFilters(findToken(e.tokenAddress))});
  document.getElementById('whaleList').innerHTML=filtered.length?filtered.map(function(e){
    var t=findToken(e.tokenAddress),sec=t&&t.security?t.security:{};
    return '<div class="row"><div class="asset"><b>🐋 '+esc(e.token||t&&t.symbol||'?')+'</b>'+(t?whaleVerifyChip(t):'')+'<small>'+esc(short(e.tokenAddress))+' · '+esc(e.trader||'نامشخص')+' · FOMO / Solana RPC</small>'+socialButtons(t)+'</div>'+
    '<div class="cell"><small>خرید</small><b>'+money(e.tradeUsd)+'</b></div><div class="cell"><small>پوزیشن</small><b>'+money(e.positionValueUsd)+'</b></div>'+
    '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
    '<div class="cell hide-sm"><small>زمان</small><b>'+new Date(Number(e.ts||Date.now())).toLocaleTimeString('fa-IR')+'</b></div>'+
    '<div class="cell hide-md"><small>خروج</small><b>'+exitFor(e.tokenAddress).length+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(e.tokenAddress,t&&t.dexUrl))+'">📈 چارت</a><button class="detail-btn" data-mint="'+esc(e.tokenAddress)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">با فیلتر فعلی خرید نهنگ تازه‌ای نمایش داده نمی‌شود.</div>';
}
function prelaunchStateLabel(v){
  return v==='pass'?'تأیید':v==='fail'?'رد':v==='planned'?'ادعا/آینده':'نامشخص';
}
function prelaunchStateClass(v){
  return v==='pass'?'good':v==='fail'?'bad':v==='planned'?'mid':'blue';
}
function prelaunchSecurityBucket(x){
  if(!x)return 'low';
  if(x.fullVerified===true&&Number(x.score||0)>=80&&x.risk==='VERIFIED')return 'high';
  if((Number(x.corePassed||0)>=2&&x.risk!=='HIGH')||Number(x.score||0)>=55)return 'medium';
  return 'low';
}
function prelaunchSecurityBucketLabel(v){return v==='high'?'امنیت بالا':v==='medium'?'امنیت متوسط':'امنیت بسیار کم'}
function prelaunchSecurityBucketClass(v){return v==='high'?'good':v==='medium'?'mid':'bad'}

function renderPrelaunch(){
  var rows=prelaunch&&Array.isArray(prelaunch.projects)?prelaunch.projects:[];
  var status=document.getElementById('prelaunchStatus');
  var k=document.getElementById('kPrelaunch'),ks=document.getElementById('kPrelaunchStrong'),ksec=document.getElementById('kPrelaunchSecurity');
  var confirmedRows=rows.filter(function(x){return x.solanaConfirmed===true||/solana/i.test(String(x.ecosystem||''))});
  var high=confirmedRows.filter(function(x){return prelaunchSecurityBucket(x)==='high'});
  var medium=confirmedRows.filter(function(x){return prelaunchSecurityBucket(x)==='medium'});
  var low=confirmedRows.filter(function(x){return prelaunchSecurityBucket(x)==='low'});
  if(k)k.textContent=rows.length;
  if(ks)ks.textContent=high.length;
  if(ksec)ksec.textContent=rows.filter(function(x){return Number(x.corePassed||0)>=2}).length;
  if(status)status.textContent=rows.length?'پروژه‌های پیش‌لانچ در سه سطح امنیتی دسته‌بندی شده‌اند.':'فعلاً کاندید قابل‌تأیید پیدا نشده.';
  var earlyLaunch=prelaunch&&Array.isArray(prelaunch.earlyLaunch)?prelaunch.earlyLaunch:[];
  var earlyLaunchEl=document.getElementById('earlyLaunchList');
  if(earlyLaunchEl){
    earlyLaunchEl.innerHTML=earlyLaunch.length?earlyLaunch.map(function(x,i){
      var sec=x.security||{},fl=x.flow||{},ph=x.traderIntel,wh=x.whale,tr=x.tracked;
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' ⚡ '+esc(x.symbol||'?')+' · '+esc(x.name||'')+'</b>'+
        '<span class="badge '+(x.score>=75?'good':x.score>=55?'mid':'blue')+'">'+Number(x.score||0)+'/100 · '+esc(x.label||'Watch')+'</span>'+
        '<small>'+ageText({ageMinutes:x.ageMinutes})+' · Buyer '+Number(fl.buyerPower||0).toFixed(0)+'% · Social '+Number(x.socialHeat?.score||0)+'/100'+
        (ph?' · Pump Top Traders '+Number(ph.traders||0)+' / خرید اخیر '+Number(ph.buyingTraders||0):'')+
        (wh?' · 🐋 '+money(wh.totalBuyUsd):'')+
        (tr&&Number(tr.netFlowUsd||0)>0?' · 🧠 '+money(tr.netFlowUsd):'')+'</small></div>'+
        '<div class="cell"><small>قیمت</small><b data-live-price-mint="'+esc(x.mint)+'">'+fmtPrice(x.priceUsd)+'</b></div>'+
        '<div class="cell"><small>نقدینگی</small><b>'+money(x.liquidity)+'</b></div>'+
        '<div class="cell"><small>امنیت</small><b><span class="badge '+secClass(sec.tier)+'">'+esc(faSec(sec.tier))+'</span></b></div>'+
        '<div class="cell"><small>هولدر</small><b>'+(sec.holderPolicyPassed===true?'PASS':'—')+'</b></div>'+
        '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(x.mint,x.dexUrl))+'">DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(x.mint)+'">Pump</a></div></div>';
    }).join(''):'<div class="empty">فعلاً Early Launch واجد داده کافی پیدا نشده.</div>';
  }

  var pumpIntel=prelaunch&&prelaunch.pumpIntel?prelaunch.pumpIntel:{leaders:[]};
  var pumpStatus=document.getElementById('pumpTraderIntelStatus');
  if(pumpStatus)pumpStatus.textContent=pumpIntel.mode==='official-api'
    ?'Pump.fun API رسمی فعال: Leaderboard + Portfolio + Trades تریدرهای برتر.'
    :pumpIntel.leaders?.length?'Leaderboard عمومی Pump.fun فعال؛ برای Portfolio/Trades کامل، PUMP_FUN_API_KEY لازم است.':'داده Leaderboard Pump.fun در این اسکن در دسترس نیست؛ API رسمی نیازمند PUMP_FUN_API_KEY است.';
  var pumpEl=document.getElementById('pumpTraderIntelList');
  if(pumpEl){
    pumpEl.innerHTML=(pumpIntel.leaders||[]).length?(pumpIntel.leaders||[]).slice(0,12).map(function(t,i){
      var positions=(t.positions||[]).slice().sort(function(a,b){return Number(b.valueUsd||0)-Number(a.valueUsd||0)}).slice(0,3);
      var buys=(t.currentBuys||[]).slice(0,3);
      return '<div class="row"><div class="asset"><b>#'+Number(t.rank||i+1)+' 🏆 '+esc(t.username||'Trader')+'</b>'+
        '<small>Profit هفتگی: '+money(t.pnlUsd)+(t.wallet?' · '+esc(short(t.wallet)):(t.walletShort?' · '+esc(t.walletShort):''))+'</small>'+
        (positions.length?'<small>پوزیشن فعلی: '+esc(positions.map(p=>(p.symbol||short(p.mint))+' '+money(p.valueUsd)).join(' · '))+'</small>':'')+
        (buys.length?'<small>خریدهای اخیر: '+esc(buys.map(b=>(b.symbol||short(b.mint))+' '+money(b.usd)).join(' · '))+'</small>':'')+
        '</div><div class="cell"><small>سود</small><b class="return-pos">'+money(t.pnlUsd)+'</b></div>'+
        '<div class="cell"><small>پوزیشن باز</small><b>'+positions.length+'</b></div>'+
        '<div class="cell"><small>خرید اخیر</small><b>'+buys.length+'</b></div></div>';
    }).join(''):'<div class="empty">Leaderboard تریدرها فعلاً قابل‌دریافت نیست.</div>';
  }

  var secIntel=prelaunch&&prelaunch.solidProofIntel?prelaunch.solidProofIntel:{rows:[]};
  var secEl=document.getElementById('multiSourceSecurityList');
  if(secEl){
    secEl.innerHTML=(secIntel.rows||[]).length?(secIntel.rows||[]).slice(0,12).map(function(x,i){
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🛡️ '+esc(x.name)+'</b><small>'+esc(x.source||'SolidProof')+' · Solana</small></div>'+
        '<div class="cell"><small>Security Score</small><b>'+((x.score!=null)?Number(x.score).toFixed(2):'—')+'</b></div>'+
        '<div class="cell"><small>Audit</small><b>'+(x.audited?'✅':'—')+'</b></div>'+
        '<div class="cell"><small>KYC</small><b>'+(x.kyc?'✅':'—')+'</b></div>'+
        '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(x.url||'https://app.solidproof.io')+'">SolidProof</a></div></div>';
    }).join(''):'<div class="empty">فعلاً پروژه Solana دارای داده عمومی SolidProof در این اسکن پیدا نشده.</div>';
  }

  var suggested=prelaunch&&Array.isArray(prelaunch.suggested)?prelaunch.suggested:[];
  var sugEl=document.getElementById('prelaunchSuggestedList');
  if(sugEl){
    sugEl.innerHTML=suggested.length?suggested.map(function(x,i){
      var bucket=prelaunchSecurityBucket(x),cls=prelaunchSecurityBucketClass(bucket);
      var solOk=x.solanaConfirmed===true||/solana/i.test(String(x.ecosystem||''));
      var trust=!solOk?'Watch · Solana تأیید نشده':x.fullVerified?'تأیید قوی':Number(x.corePassed||0)>=2?'بررسی خوب':'Watch';
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' ⭐ '+esc(x.name||'?')+(x.symbol?' · '+esc(x.symbol):'')+'</b>'+
        '<span class="badge '+cls+'">'+trust+' · '+Number(x.score||0)+'/100</span>'+
        '<small>'+esc(x.source||'')+(x.launchpad?' · '+esc(x.launchpad):'')+(x.tge?' · TGE '+esc(x.tge):'')+'</small>'+
        '<small>Social '+Number(x.scoreBreakdown?.social||0)+' · Team '+Number(x.scoreBreakdown?.team||0)+' · Core '+Number(x.corePassed||0)+'/3</small></div>'+
        '<div class="cell"><small>KYC</small><b>'+esc(prelaunchStateLabel(x.kycState))+'</b></div>'+
        '<div class="cell"><small>Audit</small><b>'+esc(prelaunchStateLabel(x.auditState))+'</b></div>'+
        '<div class="cell"><small>LP Lock</small><b>'+esc(prelaunchStateLabel(x.lpLockState))+'</b></div>'+
        '<div class="actions">'+(x.sourceUrl?'<a class="action" target="_blank" rel="noopener" href="'+esc(x.sourceUrl)+'">منبع ↗</a>':'')+'</div></div>';
    }).join(''):'<div class="empty">فعلاً Watch Candidate قابل‌اتکایی پیدا نشده.</div>';
  }

  function rowHtml(x,i,bucket){
    var cls=prelaunchSecurityBucketClass(bucket);
    var evidence=[...(x.socialEvidence||[]),...(x.teamEvidence||[]),...(x.securityEvidence||[]),...(x.backingEvidence||[]),...(x.launchEvidence||[])].slice(0,6);
    var core=x.fullVerified?'✅ سه شرط اصلی تأیید':'⚠ '+Number(x.corePassed||0)+'/3 شرط اصلی تأیید';
    return '<div class="row"><div class="asset"><span class="badge '+cls+'">'+prelaunchSecurityBucketLabel(bucket)+'</span><b>#'+(i+1)+' 🚀 '+esc(x.name||'?')+(x.symbol?' · '+esc(x.symbol):'')+'</b>'+
      '<span class="badge '+cls+'">'+Number(x.score||0)+'/100</span><span class="badge '+(x.fullVerified?'good':'mid')+'">'+core+'</span>'+
      '<small>'+esc(x.ecosystem||'Solana')+' · '+esc(x.source||'')+(x.launchpad?' · '+esc(x.launchpad):'')+(x.tge?' · TGE '+esc(x.tge):'')+'</small>'+
      (evidence.length?'<small>'+esc(evidence.join(' • '))+'</small>':'<small>شواهد کافی هنوز جمع نشده.</small>')+
      '</div>'+
      '<div class="cell"><small>KYC</small><b><span class="badge '+prelaunchStateClass(x.kycState)+'">'+prelaunchStateLabel(x.kycState)+'</span></b></div>'+
      '<div class="cell"><small>Audit</small><b><span class="badge '+prelaunchStateClass(x.auditState)+'">'+prelaunchStateLabel(x.auditState)+'</span></b></div>'+
      '<div class="cell"><small>LP Lock</small><b><span class="badge '+prelaunchStateClass(x.lpLockState)+'">'+prelaunchStateLabel(x.lpLockState)+'</span></b></div>'+
      '<div class="cell hide-sm"><small>Tokenomics</small><b><span class="badge '+prelaunchStateClass(x.tokenomicsState)+'">'+prelaunchStateLabel(x.tokenomicsState)+'</span></b></div>'+
      '<div class="cell hide-md"><small>Social / Team</small><b>'+Number(x.scoreBreakdown?.social||0)+' / '+Number(x.scoreBreakdown?.team||0)+'</b></div>'+
      '<div class="actions">'+(x.sourceUrl?'<a class="action" target="_blank" rel="noopener" href="'+esc(x.sourceUrl)+'">منبع ↗</a>':'')+(x.lpLockProofUrl?'<a class="action" target="_blank" rel="noopener" href="'+esc(x.lpLockProofUrl)+'">اثبات LP</a>':'')+'</div></div>';
  }

  var h=document.getElementById('prelaunchHighList');if(h)h.innerHTML=high.length?high.map(function(x,i){return rowHtml(x,i,'high')}).join(''):'<div class="empty">فعلاً پروژه پیش‌لانچ با امنیت بالا پیدا نشده.</div>';
  var m=document.getElementById('prelaunchMediumList');if(m)m.innerHTML=medium.length?medium.map(function(x,i){return rowHtml(x,i,'medium')}).join(''):'<div class="empty">فعلاً پروژه‌ای در امنیت متوسط نیست.</div>';
  var l=document.getElementById('prelaunchLowList');if(l)l.innerHTML=low.length?low.map(function(x,i){return rowHtml(x,i,'low')}).join(''):'<div class="empty">فعلاً پروژه‌ای در امنیت بسیار کم نیست.</div>';

  var perfEl=document.getElementById('prelaunchPerformanceList');
  if(perfEl){
    var perf=prelaunch&&Array.isArray(prelaunch.launched)?prelaunch.launched:[];
    perfEl.innerHTML=perf.length?perf.map(function(x,i){
      var g=x.growthPct;
      var gText=g==null?'قیمت شروع تأیید نشده':((g>0?'+':'')+Number(g).toFixed(1)+'%');
      var gClass=g==null?'mid':g>=0?'good':'bad';
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' 📈 '+esc(x.symbol||'?')+' · '+esc(x.name||'')+'</b>'+
        '<span class="badge '+gClass+'">از لانچ '+esc(gText)+'</span>'+
        '<small>پیشنهاد پیش‌لانچ: '+Number(x.prelaunchScore||0)+'/100 · '+esc(x.prelaunchGrade||'WATCH')+
        (x.firstRecommendedAt?' · ثبت پیشنهاد '+new Date(x.firstRecommendedAt).toLocaleDateString('fa-IR'):'')+'</small></div>'+
        '<div class="cell"><small>قیمت شروع</small><b>'+(x.launchPrice?fmtPrice(x.launchPrice):'—')+'</b></div>'+
        '<div class="cell"><small>قیمت فعلی</small><b data-prelaunch-live-price="'+esc(x.mint)+'">'+fmtPrice(x.currentPrice)+'</b></div>'+
        '<div class="cell"><small>رشد از لانچ</small><b data-prelaunch-live-profit="'+esc(x.mint)+'" data-prelaunch-live-base="'+Number(x.launchPrice||0)+'" class="'+(g==null?'return-flat':g>=0?'return-pos':'return-neg')+'">'+esc(gText)+'</b></div>'+
        '<div class="cell hide-sm"><small>زمان لانچ</small><b>'+new Date(Number(x.createdAt||Date.now())).toLocaleDateString('fa-IR')+'</b></div>'+
        '<div class="actions">'+(x.dexUrl?'<a class="action" target="_blank" rel="noopener" href="'+esc(x.dexUrl)+'">📈 چارت</a>':'')+'</div></div>';
    }).join(''):'<div class="empty">هنوز هیچ پیشنهاد پیش‌لانچ رادار به Pair قابل‌ردیابی تبدیل نشده؛ بعد از لانچ، قیمت و بازده زنده خودکار فعال می‌شود.</div>';
  }
}

function renderSmart(){
  var r=smart&&smart.tokens?smart.tokens:[];
  r=r.filter(function(x){
    var base=findToken(x.address);
    return !base||passesSignalFilters(base);
  }).sort(function(a,b){
    var ba=findToken(a.address),bb=findToken(b.address);
    return tokenStrength(bb)-tokenStrength(ba)||(Number(b.netFlowUsd||0)-Number(a.netFlowUsd||0));
  });

  var status=document.getElementById('smartStatus');
  if(smart&&smart.fallback){
    status.textContent='فعال با داده داخلی رادار · کیف‌پول‌های ردیابی‌شده و جریان آن‌چین';
  }else if(smart&&smart.configured){
    status.textContent='فعال با منبع FOMO API + داده رادار';
  }else{
    status.textContent='داده اسمارت‌مانی فعلاً در دسترس نیست.';
  }

  document.getElementById('smartList').innerHTML=r.length?r.slice(0,20).map(function(t){
    var s=t.security||{},base=findToken(t.address);
    return '<div class="row"><div class="asset"><b>🧠 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+
      (base?tradePlanChips(base):'')+
      '<small>'+esc(short(t.address))+' · '+esc(t.source==='tracked-wallets-onchain'?'داده داخلی on-chain':'FOMO API')+'</small>'+socialButtons(base)+'</div>'+
    '<div class="cell"><small>کیف‌پول خریدار</small><b>'+Number(t.smartMoneyCount||0)+'</b></div>'+
    '<div class="cell"><small>ارزش پوزیشن</small><b>'+money(t.totalValueUsd)+'</b></div>'+
    '<div class="cell"><small>جریان خالص</small><b>'+money(t.netFlowUsd||0)+'</b></div>'+
    '<div class="cell hide-sm"><small>خریدار 1000$+</small><b>'+Number(t.buyers100Count||0)+'</b></div>'+
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



function renderFamousXMonitor(){
  var d=famousXMonitor||{},st=document.getElementById('famousXStatus'),
    accounts=document.getElementById('famousXAccounts'),
    posts=document.getElementById('famousXPosts');
  if(st)st.textContent=d.status==='ok'
    ?'X API متصل است · '+Number(d.posts?.length||0)+' پست مرتبط در آخرین جستجو · آخرین بررسی '+new Date(d.generatedAt).toLocaleString('fa-IR')
    :d.status==='api-error'?'جستجوی X API ناموفق: '+String(d.message||'خطای دسترسی یا اعتبار')
    :d.status==='not-configured'?'Bearer Token در سرویس رادار تنظیم نشده است.'
    :'در انتظار اولین درخواست؛ حساب‌ها در فهرست ردیابی رادار قرار دارند.';
  if(accounts)accounts.innerHTML=(d.accounts||[]).map(function(a){
    return '<div class="row"><div class="asset"><b>@'+esc(a.handle)+'</b><small>'+esc(a.name||'')+
      ' · '+esc(a.group||'')+' · رصد رادار (نه Follow شخصی)</small></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(a.url)+'">باز کردن X / Follow</a></div></div>';
  }).join('')||'<div class="empty">فهرست اکانت‌ها هنوز دریافت نشده است.</div>';
  if(posts)posts.innerHTML=(d.posts||[]).length?(d.posts||[]).map(function(p){
    var contracts=p.contractMints||[];
    return '<div class="row"><div class="asset"><b>@'+esc(p.handle)+
      ' · '+(contracts.length?'🔎 اشاره به آدرس قرارداد':'💬 اشاره عمومی به میم‌کوین')+'</b>'+
      '<small>'+new Date(p.createdAt).toLocaleString('fa-IR')+' · پسندیدن '+Number(p.likes||0)+'</small>'+
      '<small>'+esc(p.text||'')+'</small>'+
      (contracts.length?'<small>CA: '+esc(contracts.join(' · '))+'</small>':'')+
      '</div><div class="actions"><a class="action" href="'+esc(p.url)+'" target="_blank" rel="noopener">پست اصلی در X</a></div></div>';
  }).join(''):'<div class="empty">هنوز پست معتبر دریافت نشده است. نبود پست لزوماً به معنی سکوت اکانت‌ها نیست.</div>';
}
async function pollFamousXMonitor(){
  if(famousXBusy)return;famousXBusy=true;
  try{var d=await safeJson('/api/v1/famous-x-monitor');
    if(d){famousXMonitor=d;if(activeTab==='social')renderActivePanel()}
  }finally{famousXBusy=false}
}

function pumpXBadge(t){
  if(!pumpXMonitor||!Array.isArray(pumpXMonitor.watchlist)||!t)return '';
  var item=pumpXMonitor.watchlist.find(function(x){return x.mint===t.mint});
  if(!item)return '';
  return '<span class="badge '+(item.greenWatch?'good':'mid')+'">'+
    (item.greenWatch?'🟢 واچ اجتماعی تأییدشده':'🟡 ذکر توسط اکانت سابقه‌دار')+
    ' · '+Number(item.verifiedEarlyAccounts||0)+' اکانت</span>';
}
function renderPumpXMonitor(){
  var d=pumpXMonitor||{},st=document.getElementById('pumpXStatus');
  var watch=document.getElementById('pumpXWatchlist');
  var submitted=document.getElementById('pumpXSubmitted');
  var accounts=document.getElementById('pumpXAccounts');
  var history=document.getElementById('pumpXHistory');
  if(st)st.textContent=!d.configured
    ?'قیمت و زمان پامپ از GeckoTerminal قابل بررسی است، ولی X API فعال نیست؛ برای شناسایی واقعی اکانت‌های معرفی‌کننده X_BEARER_TOKEN لازم است. هیچ اکانتی تأیید یا دنبال نشده.'
    :d.status==='waiting-for-first-token-scan'?'داده توکن‌ها هنوز بارگذاری نشده؛ اسکن تاریخی پس از دریافت توکن‌ها شروع می‌شود.'
    :'منبع کندل: GeckoTerminal · منبع پست: X API · '+(d.status==='x-api-errors'?'خطا در دسترسی X API؛ اعتبار کلید و سهمیه را بررسی کنید · ':d.status==='archive-access-needed'?'دسترسی به آرشیو قدیمی X موردنیاز است · ':'')+
      'پامپ‌های دارای شواهد: '+Number(d.discoveredPumps?.length||0)+
      ' · اکانت‌های دارای حداقل ۲ سابقه مستقل: '+Number(d.trackedAccounts?.length||0)+
      ' · آخرین بررسی: '+(d.generatedAt?new Date(d.generatedAt).toLocaleString('fa-IR'):'—');
  if(submitted)submitted.innerHTML=(d.submittedCases||[]).map(function(x){
    var code=x.status==='not-configured'?'اتصال X API روی سرور تنظیم نشده':
      x.status==='api-error'?'خطای جستجوی X API':
      x.status==='full-archive-required'?'نیازمند دسترسی آرشیوی X':
      x.status==='ok'?'جستجوی X انجام شد':
      x.status==='needs-onset'?'در انتظار تعیین زمان شروع پامپ':'جستجو کامل نیست';
    var refs=(x.accounts||[]).map(function(a){
      return '<a class="action" target="_blank" rel="noopener" href="'+esc(a.postUrl)+'">'+
        '@'+esc(a.handle)+' · '+new Date(a.postAt).toLocaleString('fa-IR')+'</a>';
    }).join('');
    var contextual=(x.contextualAccounts||[]).map(function(a){
      return '<a class="action" target="_blank" rel="noopener" href="'+esc(a.postUrl)+'">@'+
        esc(a.handle)+' · فقط اشاره اجتماعی</a>';
    }).join('');
    return '<div class="row"><div class="asset"><b>🕵️ '+esc(x.symbol)+' · '+esc(x.name)+'</b>'+
      '<span class="badge mid">شروع پامپ تأیید نشده</span>'+
      '<small>CA: '+esc(x.mint)+'</small>'+
      (x.windowStart&&x.windowEnd?
        '<small>پنجره بررسی: '+new Date(x.windowStart).toLocaleString('fa-IR')+
        ' تا '+new Date(x.windowEnd).toLocaleString('fa-IR')+'</small>':
        '<small>زمان اوج گزارش‌شده: '+(x.contextualPeak?new Date(x.contextualPeak).toLocaleString('fa-IR'):'نامشخص')+
        ' · زمان آغاز رشد نامشخص است؛ بازه ۲۴ساعته دقیق هنوز تعیین نشده.</small>')+
      '<small>وضعیت: '+esc(code)+' · '+esc(x.note||'')+'</small>'+
      (x.historicalSecurityWarning?'<small style="color:#ffd18d">⚠️ '+esc(x.historicalSecurityWarning)+'</small>':'')+
      '<small>تعداد نویسنده‌های دارای پست مستند: '+Number(x.accounts?.length||0)+
      (x.partial?' · نتایج API ممکن است ناقص باشد':'')+'</small></div>'+
      '<div class="actions">'+refs+contextual+
      (x.contextualArticle?'<a class="action" href="'+esc(x.contextualArticle)+'" target="_blank" rel="noopener">گزارش زمینه‌ای</a>':'')+
      '<a class="action" target="_blank" rel="noopener" href="https://x.com/search?q='+encodeURIComponent(x.mint)+'&f=live">جستجوی دستی X</a>'+
      '<a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(x.mint,''))+'">چارت</a></div></div>';
  }).join('')||'<div class="empty">هنوز کانترکتی برای بررسی تاریخی ثبت نشده است.</div>';
  if(watch)watch.innerHTML=(d.watchlist||[]).length?(d.watchlist||[]).map(function(x){
    var green=x.greenWatch===true;
    var refs=(x.accounts||[]).map(function(a){
      return '<a class="action" target="_blank" rel="noopener" href="'+esc(a.postUrl)+'">@'+esc(a.handle)+' · '+Number(a.historicalPumps||0)+' پامپ قبلی</a>';
    }).join('');
    return '<div class="row" style="'+(green?'border-color:#34745e;background:#102b27':'')+'"><div class="asset"><b>'+
      (green?'🟢 واچ سبز با شواهد چندگانه':'🟡 نیازمند تأیید بیشتر')+
      ' · '+esc(x.symbol||'?')+'</b><small>CA: '+esc(x.mint)+' · '+Number(x.verifiedEarlyAccounts||0)+
      ' اکانت دارای سابقه پیش از پامپ</small></div>'+
      '<div class="cell"><small>هولدر</small><b>'+Number(x.holders||0)+'</b></div>'+
      '<div class="cell"><small>نقدینگی</small><b>'+money(x.liquidity)+'</b></div>'+
      '<div class="actions">'+refs+'<a class="action" href="'+esc(dexUrl(x.mint,''))+'" target="_blank" rel="noopener">DEX</a></div></div>';
  }).join(''):'<div class="empty">هنوز کاندید دارای پست مستند از اکانت‌های سابقه‌دار پیدا نشده. نبود نتیجه به معنی نبود پامپ احتمالی نیست.</div>';
  if(accounts)accounts.innerHTML=(d.trackedAccounts||[]).length?(d.trackedAccounts||[]).map(function(a){
    return '<div class="row"><div class="asset"><b>@'+esc(a.handle)+'</b><small>'+
      Number(a.documentedPumps||0)+' توکن متفاوت با پست مستند قبل از پامپ؛ این آمار نرخ موفقیت پیش‌بینی نیست.</small></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="https://x.com/'+encodeURIComponent(a.handle)+'">X</a>'+
      (a.calls||[]).slice(0,3).map(function(v){return '<a class="action" target="_blank" rel="noopener" href="'+esc(v.postUrl)+'">'+esc(v.symbol||'پست')+'</a>'}).join('')+'</div></div>';
  }).join(''):'<div class="empty">برای تأیید سابقه حداقل دو پامپ مجزا برای یک اکانت لازم است.</div>';
  if(history)history.innerHTML=(d.discoveredPumps||[]).length?(d.discoveredPumps||[]).map(function(x){
    return '<div class="row"><div class="asset"><b>📈 '+esc(x.symbol||'?')+'</b><small>CA: '+esc(x.mint)+
      ' · شروع پامپ: '+new Date(x.onsetAt).toLocaleString('fa-IR')+
      ' · رشد یک‌ساعته '+Number(x.growth1hPct||0).toFixed(1)+'٪</small></div>'+
      '<div class="cell"><small>اکانت‌های پیش از پامپ</small><b>'+Number(x.postCount||0)+'</b></div>'+
      '<div class="actions">'+(x.accounts||[]).slice(0,6).map(function(a){
        return '<a class="action" target="_blank" rel="noopener" href="'+esc(a.postUrl)+'">@'+esc(a.handle)+'</a>';
      }).join('')+'</div></div>';
  }).join(''):'<div class="empty">در نمونه استخرهای بررسی‌شده فعلاً پامپ دارای زمان و پست معتبر پیدا نشده.</div>';
}
async function pollPumpXMonitor(){
  if(pumpXBusy)return;pumpXBusy=true;
  try{
    var r=await safeJson('/api/v1/pump-x-monitor');
    if(r){pumpXMonitor=r;safeUiRender('شواهد ۲۴ ساعت قبل از پامپ',renderTopSpotlight);if(activeTab==='social')renderActivePanel()}
  }finally{pumpXBusy=false}
}
function renderSocialTrends(){
  var el=document.getElementById('socialList');
  var minHolders=Number(signalFilters.totalholders||0);
  // Keep fresh social introductions at the top without losing first-seen history.
  var candidates=tokens.slice()
    .filter(function(t){return corroboratedSocialMentions(t)&&(!minHolders||(Number.isInteger(t.totalHolderCount)&&t.totalHolderCount>=minHolders))})
    .sort(function(a,b){return Number(b.socialHeat?.score||0)-Number(a.socialHeat?.score||0)||tokenStrength(b)-tokenStrength(a)})
    .slice(0,40);
  candidates.forEach(rememberSocialSignal);
  var r=candidates.sort(function(a,b){
    var at=Date.parse(socialSignalHistory.get(a.mint)?.introducedAt||'')||0;
    var bt=Date.parse(socialSignalHistory.get(b.mint)?.introducedAt||'')||0;
    return bt-at||Number(b.socialHeat?.score||0)-Number(a.socialHeat?.score||0)||tokenStrength(b)-tokenStrength(a);
  }).slice(0,20);

  if(el){
    // When external X/Bluesky/YouTube signals are missing, keep market
    // discoveries visible WITHOUT representing them as verified social calls.
    if(!r.length){
      var marketCandidates=tokens.slice()
        .filter(function(t){return t&&t.mint&&Number(t.liquidity)>0&&Number(t.priceUsd)>0})
        .sort(function(a,b){return Number(b.trend?.score||0)-Number(a.trend?.score||0)||Number(a.ageMinutes||999999)-Number(b.ageMinutes||999999)})
        .slice(0,20);
      marketCandidates.forEach(rememberTokenRadar);
      el.innerHTML=marketCandidates.length?
        '<div class="empty" style="margin-bottom:12px">📡 فعلاً داده اجتماعی مستقلی برای تأیید وجود ندارد؛ توکن‌های زیر فقط <b>گزینه‌های رصد بازار</b> هستند، نه سیگنال اجتماعی یا توصیه خرید. برای تأیید باید منشن واقعی X/Bluesky/YouTube ثبت شود.</div>'+
        marketCandidates.map(function(t,i){
          var h=tokenRadarHistory.get(t.mint),price=currentPriceForMint(t.mint),seen=h&&h.introducedAt;
          return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🔎 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+
            '<span class="badge blue">در انتظار تأیید اجتماعی</span>'+
            '<small>شناسه: '+esc(t.mint)+' · اولین رصد: '+(seen?new Date(seen).toLocaleString('fa-IR'):'نامشخص')+'</small>'+
            '<small>امتیاز بازار '+Number(t.trend?.score||0).toFixed(0)+' · تعداد منشن تأییدشده: نامشخص</small></div>'+
            '<div class="cell"><small>نقدینگی</small><b>'+money(t.liquidity)+'</b></div>'+
            '<div class="cell"><small>حجم ۲۴ساعته</small><b>'+money(t.volume24h)+'</b></div>'+
            '<div class="cell"><small>قیمت بازار</small><b data-live-price-mint="'+esc(t.mint)+'">'+fmtPrice(price)+'</b></div>'+
            '<div class="cell"><small>امنیت</small><b>'+esc(faSec(t.security?.tier))+'</b></div>'+
            '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 نمودار DEX</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
        }).join(''):
        '<div class="empty">هنوز داده معتبر قیمت و نقدینگی برای نمایش توکن‌ها از منابع بازار دریافت نشده است. سلامت API را از بخش تنظیمات و سلامت اتصال منابع بررسی کن.</div>';
    }else{
    el.innerHTML=r.map(function(t,i){
      var h=t.socialHeat||{},s=t.security||{};
      var hist=socialSignalHistory.get(t.mint);
      var moneyFlow=socialMoneyFlow(t),wh=moneyFlow.whale,sm=moneyFlow.smart,trMoney=moneyFlow.tracked;
      var pnl=null;
      var liveNow=currentPriceForMint(t.mint);
      if(hist&&Number(hist.introducedPrice||0)>0&&Number(liveNow||0)>0){
        pnl=((Number(liveNow)-Number(hist.introducedPrice))/Number(hist.introducedPrice))*100;
      }
      var pnlText=pnl==null?'—':(pnl>0?'+':'')+pnl.toFixed(1)+'%';
      var pnlClass=pnl==null?'return-flat':pnl>=0?'return-pos':'return-neg';
      var introducedMs=Date.parse(hist?.introducedAt||'')||0;
      var isNew=introducedMs>0&&Date.now()-introducedMs>=0&&Date.now()-introducedMs<60*60*1000;
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' 📣 '+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b>'+(isNew?'<span class="badge good">🆕 تازه معرفی‌شده</span>':'')+socialMoneyBadges(t)+socialTrendBadges(t)+topTraderBadge(t)+pumpXBadge(t)+tradePlanChips(t)+
        '<small>'+esc((h.reasons||[]).slice(0,3).join(' • '))+'</small>'+
        (hist?'<small>اولین سیگنال اجتماعی: '+new Date(hist.introducedAt).toLocaleString('fa-IR')+' · قیمت '+fmtPrice(hist.introducedPrice)+'</small>':'')+
        socialButtons(t)+'</div>'+
        '<div class="cell"><small>Social Heat</small><b><span class="badge '+socialHeatClass(h.label)+'">'+esc(faSocialHeat(h.label))+' '+Number(h.score||0)+'</span></b></div>'+
        '<div class="cell"><small>👥 هولدر کل</small><b>'+(Number.isInteger(t.totalHolderCount)?Number(t.totalHolderCount).toLocaleString('fa-IR'):'نامشخص')+'</b></div>'+
        '<div class="cell"><small>💵 قیمت ورود</small><b>'+fmtPrice(hist&&hist.introducedPrice)+'</b></div>'+
        '<div class="cell"><small>⚡ قیمت لحظه‌ای</small><b data-live-price-mint="'+esc(t.mint)+'">'+(liveNow?fmtPrice(liveNow):'—')+'</b></div>'+
        '<div class="cell"><small>💰 سود لحظه‌ای</small><b data-live-profit-mint="'+esc(t.mint)+'" data-live-profit-base="'+Number(hist&&hist.introducedPrice||0)+'" class="'+pnlClass+'">'+pnlText+'</b></div>'+
        '<div class="cell"><small>🐋 نهنگ</small><b class="'+(wh.count>0?'return-pos':'return-flat')+'">'+(wh.count>0?wh.count+' خرید · '+money(wh.usd):'ندارد')+'</b></div>'+
        '<div class="cell"><small>🧠 اسمارت‌مانی</small><b class="'+(sm||(trMoney&&Number(trMoney.netFlowUsd||0)>0)?'return-pos':'return-flat')+'">'+
          (sm?((Number(sm.smartMoneyCount||sm.buyers||0)>0?Number(sm.smartMoneyCount||sm.buyers||0)+' کیف‌پول':'فعال')+(Number(sm.totalValueUsd||sm.netFlowUsd||sm.currentHoldingUsd||0)>0?' · '+money(sm.totalValueUsd||sm.netFlowUsd||sm.currentHoldingUsd):'')):
          (trMoney&&Number(trMoney.netFlowUsd||0)>0?Number(trMoney.uniqueBuyers||0)+' خریدار · '+money(trMoney.netFlowUsd):'ندارد'))+
        '</b></div>'+
        '<div class="cell"><small>X / 2h</small><b>'+Number(h.xPosts2h||0)+'</b></div>'+
        '<div class="cell hide-sm"><small>YouTube / 24h</small><b>'+Number(h.youtubeVideos24h||0)+'</b></div>'+
        '<div class="cell hide-md"><small>امنیت</small><b><span class="badge '+secClass(s.tier)+'">'+esc(faSec(s.tier))+'</span></b></div>'+
        '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
    }).join('');
    }
  }

  var perfList=document.getElementById('socialPerformanceList');
  var perfSum=document.getElementById('socialPerformanceSummary');
  if(perfList&&perfSum){
    var rows=socialSignalPerformanceRows();
    var archived=[...socialSignalHistory.values()].filter(function(h){return !verifiedSocialHistory(h)});
    var valid=rows.filter(function(x){return x.history.isEntrySignal===true&&x.pnlPct!=null});
    var wins=valid.filter(function(x){return x.pnlPct>0});
    var avg=valid.length?valid.reduce(function(a,x){return a+Number(x.pnlPct||0)},0)/valid.length:null;
    var best=valid.slice().sort(function(a,b){return b.pnlPct-a.pnlPct})[0]||null;
    perfSum.innerHTML='<div class="perf-summary">'+
      '<div class="perf-stat"><small>سیگنال‌های اجتماعی با شواهد هنگام ثبت</small><b>'+rows.length+'</b></div>'+
      '<div class="perf-stat"><small>آرشیو قدیمی فاقد شواهد کافی</small><b>'+archived.length+'</b></div>'+
      '<div class="perf-stat"><small>سیگنال ورود قابل‌ارزیابی</small><b>'+valid.length+'</b></div>'+
      '<div class="perf-stat"><small>در سود</small><b class="return-pos">'+wins.length+'</b></div>'+
      '<div class="perf-stat"><small>میانگین بازده</small><b class="'+(avg==null?'return-flat':avg>=0?'return-pos':'return-neg')+'">'+(avg==null?'—':(avg>0?'+':'')+avg.toFixed(1)+'%')+'</b></div>'+
      '<div class="perf-stat"><small>بهترین سیگنال</small><b class="return-pos">'+(best?esc(best.history.symbol||best.history.name)+' '+(best.pnlPct>0?'+':'')+best.pnlPct.toFixed(1)+'%':'—')+'</b></div>'+
    '</div>';

    perfList.innerHTML='<div class="empty">سودهای این بخش تغییر قیمت از زمان ثبت هستند، نه سود معامله انجام‌شده. فقط منشن‌های شمارش‌شده هنگام ثبت به‌عنوان ترند تأیید می‌شوند. رکوردهای قدیمی بدون سند در آمار سیگنال دخالت ندارند.</div>'+
      (rows.length?rows.map(function(x,i){
      var h=x.history,t=x.token,p=x.pnlPct;
      var currentFlow=t?socialMoneyFlow(t):{whale:{count:0,usd:0},smart:null,tracked:null};
      var cls=p==null?'return-flat':p>=0?'return-pos':'return-neg';
      var txt=p==null?'—':(p>0?'+':'')+p.toFixed(1)+'%';
      return '<div class="row" data-mint="'+esc(h.mint)+'"><div class="asset"><b>#'+(i+1)+' 📣 '+esc(h.symbol||'?')+' · '+esc(h.name||'')+'</b>'+
        '<span class="badge '+(h.isEntrySignal===true?'good':'blue')+'">'+(h.isEntrySignal===true?'ورود ثبت‌شده':'رصد اجتماعی؛ نه سیگنال خرید')+'</span>'+
        '<small>معرفی '+new Date(h.introducedAt).toLocaleString('fa-IR')+' · Social Heat اولیه '+Number(h.introducedSocialHeat||0)+' · امنیت '+esc(faSec(h.introducedSecurity))+'</small></div>'+
        '<div class="cell"><small>💵 قیمت ورود</small><b>'+fmtPrice(h.introducedPrice)+'</b></div>'+
        '<div class="cell"><small>⚡ قیمت لحظه‌ای</small><b data-live-price-mint="'+esc(h.mint)+'">'+(x.currentPrice?fmtPrice(x.currentPrice):'—')+'</b></div>'+
        '<div class="cell"><small>💰 سود لحظه‌ای</small><b data-live-profit-mint="'+esc(h.mint)+'" data-live-profit-base="'+Number(h.introducedPrice||0)+'" class="'+cls+'">'+txt+'</b></div>'+
        '<div class="cell hide-sm"><small>Heat اولیه</small><b>'+Number(h.introducedSocialHeat||0)+'/100</b></div>'+
        '<div class="cell"><small>🐋 نهنگ الان</small><b class="'+(currentFlow.whale.count>0?'return-pos':'return-flat')+'">'+(currentFlow.whale.count>0?currentFlow.whale.count+' · '+money(currentFlow.whale.usd):'ندارد')+'</b></div>'+
        '<div class="cell"><small>🧠 اسمارت‌مانی الان</small><b class="'+(currentFlow.smart||(currentFlow.tracked&&Number(currentFlow.tracked.netFlowUsd||0)>0)?'return-pos':'return-flat')+'">'+
          (currentFlow.smart?'فعال':currentFlow.tracked&&Number(currentFlow.tracked.netFlowUsd||0)>0?money(currentFlow.tracked.netFlowUsd):'ندارد')+'</b></div>'+
        '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(h.mint,h.dexUrl||t&&t.dexUrl))+'">📈 چارت</a></div></div>';
    }).join(''):'<div class="empty">هنوز سیگنال اجتماعی با شواهد معتبر هنگام ثبت وجود ندارد.</div>')+
      (archived.length?'<details class="accordion"><summary>🗂️ آرشیو موارد قدیمی بدون تأیید اجتماعی ('+archived.length+')</summary><div class="accordion-body"><p class="muted">این رکوردها پیش از سخت‌گیری جدید بر اساس امتیاز ضعیف یا لینک شبکه ثبت شده‌اند؛ سود و زیان آن‌ها عملکرد سیگنال معتبر محسوب نمی‌شود.</p><div class="list">'+
      archived.slice().sort(function(a,b){return Date.parse(b.introducedAt||'')-Date.parse(a.introducedAt||'')}).slice(0,300).map(function(h){
        return '<div class="row" data-mint="'+esc(h.mint)+'"><div class="asset"><b>'+esc(h.symbol||'?')+' · '+esc(h.name||'')+'</b>'+
          '<small>ثبت قدیمی: '+(h.introducedAt?new Date(h.introducedAt).toLocaleString('fa-IR'):'نامشخص')+
          ' · امتیاز '+Number(h.introducedSocialHeat||0)+'/100 · بدون مدرک کافی</small></div>'+
          '<div class="actions"><a class="action" href="'+esc(dexUrl(h.mint,h.dexUrl))+'" rel="noopener" target="_blank">چارت</a></div></div>';
      }).join('')+'</div></div></details>':'');
  }
}


function topTraderForMint(mint){
  return topTraders&&Array.isArray(topTraders.sharedHoldings)
    ?topTraders.sharedHoldings.find(function(x){return x.mint===mint})||null:null;
}
function topTraderBadge(t){
  if(!t)return '';
  var x=topTraderForMint(t.mint);
  if(!x||Number(x.holderCount||0)<2)return '';
  var cls=x.safe?'good':x.holderCount>=3?'mid':'blue';
  return '<span class="badge '+cls+'">🏆 '+Number(x.holderCount||0)+' تریدر · '+money(x.totalValueUsd)+(Number(x.recentBuyers||0)>0?' · ⚡ '+Number(x.recentBuyers)+' خریدار تازه':'')+'</span>';
}
function renderTopTraders(){
  var d=topTraders||{},wallets=Array.isArray(d.wallets)?d.wallets:[],shared=Array.isArray(d.sharedHoldings)?d.sharedHoldings:[],
      buys=Array.isArray(d.recentBuys)?d.recentBuys:[],sharedBuys=Array.isArray(d.sharedBuys)?d.sharedBuys:[],best=d.best||null;
  var st=document.getElementById('topTraderStatus');
  if(st)st.textContent=Number(d.walletCount||wallets.length)+' کیف‌پول · اسکن '+(d.generatedAt?new Date(d.generatedAt).toLocaleTimeString('fa-IR'):'—')+
    ' · اسکن موفق '+Number(d.scannedWalletCount||0)+' · خطای RPC '+Number(d.failedWalletCount||0)+
    ' · افزایش موجودی بدون تراکنش تأییدشده، خرید قطعی نیست · سود نمایش‌داده‌شده برآورد تغییر ارزش است';

  var be=document.getElementById('topTraderBest');
  if(be){
    be.innerHTML=best?'<div class="decision-banner decision-buy"><b>⭐ بهترین اجماع فعلی برای بررسی: '+esc(best.symbol||'?')+' · '+esc(best.name||'')+'</b>'+
      '<div class="beginner-note">'+Number(best.holderCount||0)+' تریدر مشترک · '+money(best.totalValueUsd)+' سرمایه فعلی · '+Number(best.recentBuyers||0)+' خریدار تازه · امتیاز '+Number(best.score||0)+'/100 · امنیت '+esc(faSec(best.radar?.security?.tier))+'</div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(best.mint,best.dexUrl))+'">DEX</a><button class="detail-btn" data-mint="'+esc(best.mint)+'">جزئیات</button></div></div>'
      :'<div class="note">فعلاً اجماع چندتریدر که همزمان فیلتر امنیتی HIGH/MAX را پاس کند پیدا نشده؛ موارد مشترک پایین به‌صورت Watch نمایش داده می‌شوند.</div>';
  }

  var sb=document.getElementById('topTraderSharedBuys');
  if(sb)sb.innerHTML=sharedBuys.slice(0,25).map(function(x,i){
    var verified=Number(x.verifiedTraderCount||0)>=2;
    var traders=(x.traders||[]).map(function(t){
      return '<div class="cell"><small>'+(t.verifiedSwap?'✅ خرید تأییدشده':'👁 افزایش موجودی')+' · '+esc(t.name||short(t.address))+
        '</small><b>'+money(t.usd)+'</b><small>'+new Date(t.lastBuyAt).toLocaleString('fa-IR')+'</small>'+
        '<a class="action" target="_blank" rel="noopener" href="https://solscan.io/account/'+esc(t.address)+'">کیف‌پول</a></div>';
    }).join('');
    var txs=(x.events||[]).filter(function(e){return e.verifiedSwap&&e.signature}).slice(0,5).map(function(e){
      return '<a class="action" target="_blank" rel="noopener" href="https://solscan.io/tx/'+esc(e.signature)+'">تراکنش '+esc(e.trader)+'</a>';
    }).join('');
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' '+(verified?'✅ خرید مشترک تأییدشده':'👁 انباشت مشترک مشاهده‌شده')+
      ' · '+esc(x.symbol||'?')+' · '+esc(x.name||'')+'</b><small>کانترکت: '+esc(short(x.mint))+
      ' · '+Number(x.traderCount||0)+' تریدر · '+Number(x.verifiedTraderCount||0)+' خریدار تأییدشده</small></div>'+
      '<div class="cell"><small>مجموع تغییر ارزش مشاهده‌شده</small><b>'+money(x.totalObservedUsd)+'</b></div>'+
      traders+'<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(x.mint,x.dexUrl))+'">DEX</a>'+txs+'</div></div>';
  }).join('')||'<div class="empty">در ۲۴ ساعت اخیر هنوز تغییر موجودی مرتبط با یک توکن برای حداقل دو تریدر ثبت نشده است؛ این به معنی نبودن خرید در بازار نیست.</div>';

  var se=document.getElementById('topTraderShared');
  if(se)se.innerHTML=shared.filter(x=>Number(x.holderCount||0)>=2).slice(0,20).map(function(x,i){
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🤝 '+esc(x.symbol||'?')+' · '+esc(x.name||'')+'</b>'+
      '<span class="badge '+(x.safe?'good':x.holderCount>=3?'mid':'blue')+'">'+Number(x.holderCount||0)+' تریدر مشترک</span>'+
      '<small>'+esc((x.holders||[]).slice(0,10).map(h=>h.name+' ('+short(h.address)+') '+money(h.valueUsd)).join(' · '))+'</small>'+
      '<small>این ردیف فقط نگهداری مشترک را نشان می‌دهد؛ زمان خرید تاریخی تأیید نشده است.</small></div>'+
      '<div class="cell"><small>سرمایه فعلی</small><b>'+money(x.totalValueUsd)+'</b></div>'+
      '<div class="cell"><small>خرید تازه 6h</small><b>'+Number(x.recentBuyers||0)+' · '+money(x.recentBuyUsd)+'</b></div>'+
      '<div class="cell"><small>امتیاز</small><b>'+Number(x.score||0)+'/100</b></div>'+
      '<div class="cell"><small>امنیت</small><b>'+(x.radar?esc(faSec(x.radar.security?.tier)):'خارج رادار')+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(x.mint,x.dexUrl))+'">DEX</a></div></div>';
  }).join('')||'<div class="empty">فعلاً پوزیشن مشترک بین حداقل دو تریدر پیدا نشده.</div>';

  var re=document.getElementById('topTraderRecentBuys');
  if(re)re.innerHTML=buys.slice(0,40).map(function(x){
    var verified=!!x.verifiedSwap;
    return '<div class="row"><div class="asset"><b>'+(verified?'✅ خرید تأییدشده':'👁 افزایش موجودی')+' · '+esc(x.trader)+' → '+esc(x.symbol||short(x.mint))+'</b>'+
      '<small>'+new Date(x.ts).toLocaleString('fa-IR')+' · '+(verified?'تراکنش در Solana RPC تأیید شده':'خرید قطعی نیست؛ تغییر موجودی در اسکن ثبت شده')+'</small>'+
      (x.signature?'<small>Tx: '+esc(short(x.signature))+'</small>':'')+'</div>'+
      '<div class="cell"><small>'+(verified?'ارزش تخمینی خرید':'ارزش افزایش موجودی')+'</small><b>'+money(x.usd)+'</b></div>'+
      '<div class="cell"><small>'+(verified&&x.priceBasis==='estimated on-chain execution cost'?'قیمت خرید تخمینی':'قیمت زمان مشاهده')+'</small><b>'+fmtPrice(x.price)+'</b></div>'+
      '<div class="cell"><small>قیمت الان</small><b data-live-price-mint="'+esc(x.mint)+'">'+fmtPrice(x.currentPriceUsd)+'</b></div>'+
      '<div class="cell"><small>'+(verified?'تغییر ارزش از خرید':'تغییر ارزش از مشاهده')+' (تقریبی)</small><b data-trader-pnl-mint="'+esc(x.mint)+'" data-trader-entry-price="'+Number(x.price||0)+'" data-trader-buy-usd="'+Number(x.usd||0)+'" data-trader-fallback-price="'+Number(x.currentPriceUsd||0)+'" data-trader-fallback-at="'+Number(x.currentPriceObservedAt||0)+'" data-trader-pair-matched="'+String(x.pricePairMatched!==false)+'">'+
      (x.pnlPct!=null&&Number.isFinite(Number(x.pnlPct))?((Number(x.pnlUsd)>=0?'+':'')+money(x.pnlUsd)+' ('+(Number(x.pnlPct)>=0?'+':'')+Number(x.pnlPct).toFixed(2)+'%)'):'در حال دریافت قیمت…')+'</b><small>بدون کارمزد، اسلیپیج و فروش‌های بعدی</small></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(x.mint,''))+'">DEX</a>'+
      (x.signature?'<a class="action" target="_blank" rel="noopener" href="https://solscan.io/tx/'+esc(x.signature)+'">Tx</a>':'')+'</div></div>';
  }).join('')||'<div class="empty">از زمان شروع مانیتور هنوز خرید یا افزایش موجودی جدیدی ثبت نشده است.</div>';
  updateLiveProfitDom();

  var we=document.getElementById('topTraderWallets');
  if(we)we.innerHTML=wallets.slice(0,50).map(function(w,i){
    var top=(w.portfolio||[])[0],ret=top&&top.returnPct;
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🏆 '+esc(w.name||'Top Trader')+'</b><small>'+esc(short(w.address))+'</small></div>'+
      '<div class="cell"><small>ارزش پرتفوی ردیابی‌شده</small><b>'+money(w.portfolioValueUsd)+'</b></div>'+
      '<div class="cell"><small>بزرگترین پوزیشن</small><b>'+(top?esc(top.symbol)+' · '+money(top.valueUsd):'—')+'</b></div>'+
      '<div class="cell"><small>بازده پوزیشن برتر</small><b class="'+(ret==null?'return-flat':ret>=0?'return-pos':'return-neg')+'">'+(ret==null?'—':(ret>=0?'+':'')+ret.toFixed(2)+'%')+'</b><small>'+(top?esc(top.returnBasis):'')+'</small></div>'+
      '<div class="cell"><small>تغییر ارزش زنده پوزیشن برتر (تخمینی)</small><b '+(top?'data-trader-position-mint="'+esc(top.mint)+'" data-trader-position-entry="'+Number(top.referencePrice||0)+'" data-trader-position-amount="'+Number(top.amount||0)+'"':'')+'>—</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="https://solscan.io/account/'+esc(w.address)+'">Solscan</a></div></div>';
  }).join('')||'<div class="empty">هنوز پرتفوی کیف‌پول‌ها دریافت نشده.</div>';
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
  var se=document.getElementById('search'),sfe=document.getElementById('securityFilter'),afe=document.getElementById('activityFilter');
  var q=se?String(se.value||'').toLowerCase().trim():'';
  var sf=sfe?String(sfe.value||''):'',af=afe?String(afe.value||''):'';
  return (Array.isArray(tokens)?tokens:[]).filter(function(t){
    try{
      var minHolders=Number(signalFilters.totalholders||0);
      if(minHolders>0&&!(Number.isInteger(t.totalHolderCount)&&t.totalHolderCount>=minHolders))return false;
      return (!q||[t.name,t.symbol,t.mint].join(' ').toLowerCase().includes(q))&&
        (!sf||(t.security&&t.security.tier===sf))&&
        (!af||(t.activity&&t.activity.label===af))&&
        passesSignalFilters(t);
    }catch(e){return true}
  }).sort(function(a,b){
    try{return tokenStrength(b)-tokenStrength(a)}catch(e){return 0}
  });
}
function renderBucketBest(id,rows,bucket,title){
  var el=document.getElementById(id);if(!el)return;
  if(!rows.length){el.innerHTML='<div class="empty">فعلاً توکنی در این بازه پیدا نشده.</div>';return}
  var candidates=rows.filter(verifiedRecommendation);
  if(!candidates.length){el.innerHTML='<div class="empty">در این بازه هیچ توکن واجد شرایط امنیتی برای معرفی وجود ندارد.</div>';return}
  var t=candidates[0],bs=bucketScore(t,bucket),sg=t.signals||{},fl=t.flow||{};
  el.innerHTML='<div class="bucket-best"><div class="bucket-best-title">🏆 بهترین توکن '+esc(title)+' — رتبه ۱ این گروه</div><div class="bucket-best-main">'+
    '<div class="asset"><b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><span class="age-chip">'+esc(ageText(t))+'</span>'+whaleTrendBadge(t)+socialTrendBadges(t)+tradePlanChips(t)+'<small>'+esc(bucketSignalLabel(bs,t))+'</small>'+socialButtons(t)+'</div>'+
    '<div><small class="muted">امتیاز نهایی</small><div class="bucket-score">'+bs+'/100</div></div>'+
    '<div class="cell"><small>قدرت خریدار</small><b>'+Number(fl.buyerPower||0)+'%</b></div>'+
    '<div class="cell"><small>حجم</small><b>'+esc(faVolume(fl.volumeLabel))+'</b></div>'+
    '<div class="cell"><small>امنیت</small><b>'+esc(faSec(t.security?.tier))+'</b></div><div class="cell"><small>Trust Guard</small><b><span class="badge '+trustClass(t)+'">'+esc(trustLabel(t))+'</span></b></div><div class="cell"><small>هولدر $1k+</small><b>'+qualifyingTrackedHolders(t).length+'</b></div>'+
    '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div>'+
  '</div></div>';
}
function renderRecommendationPerformance(){
  var list=document.getElementById('recommendationPerformanceList');
  var sum=document.getElementById('recommendationPerformanceSummary');
  if(!list||!sum)return;
  var rows=recommendationPerformanceRows();
  entryFactorReport(rows);
  var valid=rows.filter(function(x){return x.pnlPct!=null});
  var wins=valid.filter(function(x){return x.pnlPct>0});
  var avg=valid.length?valid.reduce(function(a,x){return a+Number(x.pnlPct||0)},0)/valid.length:null;
  var best=valid.slice().sort(function(a,b){return b.pnlPct-a.pnlPct})[0]||null;
  sum.innerHTML='<div class="perf-summary">'+
    '<div class="perf-stat"><small>سیگنال‌های ورود ثبت‌شده</small><b>'+rows.length+'</b></div>'+
    '<div class="perf-stat"><small>در سود</small><b class="return-pos">'+wins.length+'</b></div>'+
    '<div class="perf-stat"><small>در زیان (قیمت تازه)</small><b class="return-neg">'+valid.filter(function(x){return x.pnlPct<0}).length+'</b></div>'+
    '<div class="perf-stat"><small>نرخ مثبت (قیمت تازه)</small><b>'+(valid.length?(100*wins.length/valid.length).toFixed(1)+'٪':'—')+'</b></div>'+
    '<div class="perf-stat"><small>میانگین بازده ناخالص مشاهده‌شده</small><b class="'+(avg==null?'return-flat':avg>=0?'return-pos':'return-neg')+'">'+(avg==null?'—':(avg>0?'+':'')+avg.toFixed(1)+'%')+'</b></div>'+
    '<div class="perf-stat"><small>بهترین عملکرد</small><b class="return-pos">'+(best?esc(best.history.symbol||best.history.name)+' '+(best.pnlPct>0?'+':'')+best.pnlPct.toFixed(1)+'%':'—')+'</b></div>'+
  '</div>';
  list.innerHTML=rows.length?rows.map(function(x,i){
    var h=x.history,t=x.token,p=x.pnlPct;
    var cls=p==null?'return-flat':p>=0?'return-pos':'return-neg';
    var txt=p==null?'—':(p>0?'+':'')+p.toFixed(1)+'%';
    var current=currentPriceForMint(h.mint)||x.currentPrice||0;
    return '<div class="row"><div class="asset"><b>#'+(i+1)+' '+esc(h.symbol||'?')+' · '+esc(h.name||'')+'</b>'+
      '<small>زمان معرفی '+new Date(h.introducedAt).toLocaleString('fa-IR')+' · امنیت '+esc(faSec(h.introducedSecurity))+' · امتیاز '+Number(h.introducedScore||0)+'/100</small></div>'+
      '<div class="cell"><small>💵 قیمت ورود</small><b>'+fmtPrice(h.introducedPrice)+'</b></div>'+
      '<div class="cell"><small>⚡ قیمت لحظه‌ای</small><b data-live-price-mint="'+esc(h.mint)+'">'+(current?fmtPrice(current):'—')+'</b></div>'+
      '<div class="cell"><small>💰 سود لحظه‌ای</small><b data-live-profit-mint="'+esc(h.mint)+'" data-live-profit-base="'+Number(h.introducedPrice||0)+'" class="'+cls+'">'+txt+'</b></div>'+
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(h.mint,h.dexUrl||t&&t.dexUrl))+'">📈 چارت</a></div></div>';
  }).join(''):'<div class="empty">هنوز هیچ پیشنهاد ثبت‌شده‌ای برای محاسبه عملکرد وجود ندارد.</div>';
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
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
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
      '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a><button class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات</button></div></div>';
  }).join(''):'<div class="empty">فعلاً توکن KOL که همزمان امنیت HIGH/MAX را پاس کند پیدا نشده.</div>';
}

function tokenSecurityBucket(t){
  if(!t)return 'low';
  var sec=t.security||{},gate=t.securityGate||{},rug;
  try{rug=antiRugGate(t)}catch(e){rug={ok:false,reasons:['خطای ارزیابی امنیت']}}
  if(verifiedRecommendation(t)&&rug.ok===true&&sec.mintDisabled===true&&sec.freezeDisabled===true&&sec.holderPolicyPassed===true)return 'high';
  if(sec.tier==='REVIEW'&&gate.blocked!==true&&sec.holderPolicyPassed!==false&&sec.mintDisabled!==false&&sec.freezeDisabled!==false)return 'medium';
  return 'low';
}
function tokenSecurityBucketLabel(v){return v==='high'?'امنیت بالا':v==='medium'?'امنیت متوسط':'امنیت بسیار کم'}
function tokenSecurityBucketClass(v){return v==='high'?'good':v==='medium'?'mid':'bad'}

function renderTokens(){
  var r=filteredTokens();
  tokens.forEach(rememberTokenRadar);
  var top=document.getElementById('topTokenQuick');
  if(!tokens.length&&top){
    top.innerHTML='<div class="empty">در حال بازیابی توکن‌ها از DEXScreener/GeckoTerminal… اگر batch موقتاً ناقص باشد، lookup مستقیم Mint به‌صورت خودکار ادامه می‌یابد.</div>';
  }
  function sortRows(a,b){
    return (siteTrendScore(b)-siteTrendScore(a))||
      (tokenStrength(b)-tokenStrength(a))||
      (Number(b.flow?.buyerPower||0)-Number(a.flow?.buyerPower||0));
  }
  var high=r.filter(function(t){return tokenSecurityBucket(t)==='high'}).sort(sortRows);
  var medium=r.filter(function(t){return tokenSecurityBucket(t)==='medium'}).sort(sortRows);
  var low=r.filter(function(t){return tokenSecurityBucket(t)==='low'}).sort(sortRows);

  function rowsHtml(rows,bucket){
    return rows.length?rows.slice(0,30).map(function(t){
      var badge='<span class="badge '+tokenSecurityBucketClass(bucket)+'">'+tokenSecurityBucketLabel(bucket)+'</span>'+
        '<span class="badge '+(Number.isInteger(t.totalHolderCount)&&t.totalHolderCount>=1000?'good':'mid')+'">👥 کل هولدرها: '+(Number.isInteger(t.totalHolderCount)?Number(t.totalHolderCount).toLocaleString('fa-IR'):'نامشخص')+'</span>';
      try{
        var row=tokenRow(t,ageBucket(t));
        return row.replace('<div class="asset"><b>','<div class="asset">'+badge+'<b>');
      }catch(e){
        return '<div class="row"><div class="asset">'+badge+'<b>'+esc(t.symbol||'?')+' · '+esc(t.name||'')+'</b><small>'+esc(short(t.mint||''))+'</small></div>'+
          '<div class="cell"><small>قیمت</small><b data-live-price-mint="'+esc(t.mint||'')+'">'+fmtPrice(currentPriceForMint(t.mint)||t.priceUsd)+'</b></div>'+
          '<div class="cell"><small>امنیت</small><b>'+esc(faSec(t.security?.tier))+'</b></div>'+
          '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(t.mint,t.dexUrl))+'">📈 DEX</a><a class="action" target="_blank" rel="noopener" href="https://pump.fun/coin/'+esc(t.mint)+'">🟢 Pump</a></div></div>';
      }
    }).join(''):'<div class="empty">موردی در این سطح امنیت پیدا نشده.</div>';
  }

  var h=document.getElementById('highSecurityTokenList');if(h)h.innerHTML=rowsHtml(high,'high');
  var m=document.getElementById('mediumSecurityTokenList');if(m)m.innerHTML=rowsHtml(medium,'medium');
  var l=document.getElementById('lowSecurityTokenList');if(l)l.innerHTML=rowsHtml(low,'low');

  var perfList=document.getElementById('tokenRadarPerformanceList');
  var perfSum=document.getElementById('tokenRadarPerformanceSummary');
  if(perfList&&perfSum){
    var perfRows=tokenRadarPerformanceRows();
    var valid=perfRows.filter(function(x){return x.history.entrySignalAtIntroduction===true&&x.pnlPct!=null});
    var wins=valid.filter(function(x){return x.pnlPct>0});
    var avg=valid.length?valid.reduce(function(a,x){return a+Number(x.pnlPct||0)},0)/valid.length:null;
    var best=valid.slice().sort(function(a,b){return b.pnlPct-a.pnlPct})[0]||null;
    perfSum.innerHTML='<div class="perf-summary">'+
      '<div class="perf-stat"><small>سیگنال ورود قابل‌ارزیابی</small><b>'+valid.length+'</b></div>'+
      '<div class="perf-stat"><small>توکن‌های کشف‌شده (نه سیگنال خرید)</small><b>'+perfRows.length+'</b></div>'+
      '<div class="perf-stat"><small>در سود</small><b class="return-pos">'+wins.length+'</b></div>'+
      '<div class="perf-stat"><small>میانگین بازده</small><b class="'+(avg==null?'return-flat':avg>=0?'return-pos':'return-neg')+'">'+(avg==null?'—':(avg>0?'+':'')+avg.toFixed(1)+'%')+'</b></div>'+
      '<div class="perf-stat"><small>بهترین توکن</small><b class="return-pos">'+(best?esc(best.history.symbol||best.history.name)+' '+(best.pnlPct>0?'+':'')+best.pnlPct.toFixed(1)+'%':'—')+'</b></div>'+
    '</div>';
    perfList.innerHTML=perfRows.length?perfRows.map(function(x,i){
      var h=x.history,p=x.pnlPct,t=x.token;
      var cls=p==null?'return-flat':p>=0?'return-pos':'return-neg';
      var txt=p==null?'—':(p>0?'+':'')+p.toFixed(1)+'%';
      return '<div class="row"><div class="asset"><b>#'+(i+1)+' 🪙 '+esc(h.symbol||'?')+' · '+esc(h.name||'')+'</b>'+
        '<small>اولین ورود '+new Date(h.introducedAt).toLocaleString('fa-IR')+' · امنیت اولیه '+esc(faSec(h.introducedSecurity))+' · امتیاز '+Number(h.introducedScore||0)+'/100</small></div>'+
        '<div class="cell"><small>💵 قیمت ورود</small><b>'+fmtPrice(h.introducedPrice)+'</b></div>'+
        '<div class="cell"><small>⚡ قیمت لحظه‌ای</small><b data-live-price-mint="'+esc(h.mint)+'">'+(x.currentPrice?fmtPrice(x.currentPrice):'—')+'</b></div>'+
        '<div class="cell"><small>💰 سود لحظه‌ای</small><b data-live-profit-mint="'+esc(h.mint)+'" data-live-profit-base="'+Number(h.introducedPrice||0)+'" class="'+cls+'">'+txt+'</b></div>'+
        '<div class="actions"><a class="action" target="_blank" rel="noopener" href="'+esc(dexUrl(h.mint,h.dexUrl||t&&t.dexUrl))+'">📈 چارت</a></div></div>';
    }).join(''):'<div class="empty">هنوز سابقه‌ای برای عملکرد توکن‌ها ثبت نشده.</div>';
  }
}

function renderAlerts(){
  var c=live&&live.exitClusters?live.exitClusters.filter(function(x){return x.severity==='MULTI-WALLET EXIT'}).slice(0,3):[];
  document.getElementById('kExits').textContent=c.length;document.getElementById('alerts').innerHTML=c.map(function(x){return '<div class="alert">🚨 خروج همزمان چند کیف‌پول از <b>'+esc(x.token||short(x.tokenAddress))+'</b> · '+Number(x.uniqueSellers||0)+' فروشنده</div>'}).join('');
}

function spotlightSocialWhaleCandidates(rows,whaleLookup){
  return (Array.isArray(rows)?rows:[]).map(function(t){
    if(!t||!t.mint||!rugcheckVerified(t)||t.securityGate?.blocked===true||
       t.security?.tier==='REJECT'||t.security?.holderPolicyPassed===false||
       t.chart?.pumpDumpRisk==='HIGH')return null;
    var social=Number(t.socialHeat?.score||0),
        posts=Number(t.xSocial?.posts2h||0),
        videos=Number(t.youtubeSocial?.videos24h||0),
        bluesky=Number(t.bluesky?.mentions2h||0),
        kol=Number(t.kolTrend?.xMentionCount||0);
    if(!(social>=55||posts>=3||videos>=2||bluesky>=2||kol>=1))return null;
    var whale=whaleLookup(t.mint);
    if(!whale||!(Number(whale.count)>0)||!(Number(whale.usd)>0))return null;
    return {token:t,whale:whale,social:social,
      rank:social+Math.min(40,Math.log10(1+Number(whale.usd))*7)};
  }).filter(Boolean).sort(function(a,b){return b.rank-a.rank}).slice(0,3);
}
function spotlightVerifiedPrePump(rows){
  // These are HISTORICAL pumps, not predictions. Require timestamped, exact-CA
  // posts that precede the price breakout by no more than 24 hours.
  return (Array.isArray(rows)?rows:[]).map(function(p){
    var onset=Number(p?.onsetAt);
    if(!Number.isFinite(onset)||onset<=0||!p.mint)return null;
    var evidence=(Array.isArray(p.accounts)?p.accounts:[]).filter(function(a){
      var posted=Number(a?.postAt);
      return Number.isFinite(posted)&&posted>=onset-86400000&&posted<onset&&
        /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(String(a.postUrl||''));
    });
    if(!evidence.length)return null;
    return {symbol:p.symbol||'?',mint:p.mint,onsetAt:onset,
      growth1hPct:Number(p.growth1hPct||0),evidence:evidence};
  }).filter(Boolean).sort(function(a,b){return b.onsetAt-a.onsetAt}).slice(0,3);
}
function renderTopSpotlight(){
  var whaleBox=document.getElementById('spotlightSocialWhale'),
      historyBox=document.getElementById('spotlightPrePump'),
      timeBox=document.getElementById('spotlightUpdated');
  if(!whaleBox||!historyBox)return;
  var matches=spotlightSocialWhaleCandidates(tokens,whaleFor);
  whaleBox.innerHTML=matches.length?matches.map(function(x){
    var t=x.token,w=x.whale;
    var tags='<span class="badge good">🐋 '+Number(w.count)+' خرید نهنگ · '+money(w.usd)+'</span>'+
      '<span class="badge blue">📣 امتیاز اجتماعی '+Math.round(x.social)+'/100</span>';
    if(Number(t.xSocial?.posts2h||0)>=3)
      tags+='<span class="badge blue">X: '+Number(t.xSocial.posts2h)+' پست/۲ساعت</span>';
    if(Number(t.youtubeSocial?.videos24h||0)>=2)
      tags+='<span class="badge blue">YouTube: '+Number(t.youtubeSocial.videos24h)+' ویدیو/۲۴ساعت</span>';
    return '<div class="spotlight-token"><div class="spotlight-token-top"><strong>'+
      esc(t.symbol||'?')+' · '+esc(t.name||'')+'</strong><span class="badge '+
      secClass(t.security?.tier)+'">'+esc(faSec(t.security?.tier))+'</span></div>'+
      '<div class="spotlight-token-tags">'+tags+'</div>'+
      '<small>هم‌زمانی شاخص اجتماعی و خریدهای ردیابی‌شده؛ شواهد تاریخی قبل از پامپ جداگانه نمایش داده می‌شوند.</small>'+
      '<div class="spotlight-token-actions"><button type="button" class="detail-btn" data-mint="'+esc(t.mint)+'">جزئیات توکن</button>'+
      '<a href="'+esc(dexUrl(t.mint,t.dexUrl))+'" rel="noopener" target="_blank">چارت و قیمت</a></div></div>';
  }).join(''):'<div class="spotlight-empty">فعلاً توکنی که هم شاخص اجتماعی قابل‌رصد داشته باشد و هم خرید نهنگ در داده‌های فعلی ثبت شده باشد پیدا نشده است.</div>';

  var history=spotlightVerifiedPrePump(pumpXMonitor?.discoveredPumps);
  historyBox.innerHTML=history.length?history.map(function(p){
    var links=p.evidence.slice(0,3).map(function(a){
      return '<a href="'+esc(a.postUrl)+'" target="_blank" rel="noopener">پست @'+esc(a.handle||'X')+'</a>';
    }).join('');
    var first=p.evidence.slice().sort(function(a,b){return Number(a.postAt)-Number(b.postAt)})[0],
        aheadHours=Math.max(0,(p.onsetAt-Number(first.postAt))/3600000);
    return '<div class="spotlight-token"><div class="spotlight-token-top"><strong>'+
      esc(p.symbol)+'</strong><span class="badge blue">شاهد تاریخی X</span></div>'+
      '<div class="spotlight-token-tags"><span class="badge good">'+
      Number(p.evidence.length)+' پست مستند</span><span class="badge blue">'+
      aheadHours.toFixed(1)+' ساعت قبل از شروع رشد</span></div>'+
      '<small>زمان شروع رشد: '+new Date(p.onsetAt).toLocaleString('fa-IR')+
      ' · رشد یک‌ساعته: '+Number(p.growth1hPct).toFixed(1)+'٪</small>'+
      '<small>CA: '+esc(p.mint)+'</small>'+
      '<div class="spotlight-token-actions">'+links+
      '<a href="'+esc(dexUrl(p.mint,''))+'" target="_blank" rel="noopener">چارت توکن</a></div></div>';
  }).join(''):'<div class="spotlight-empty">هنوز پست مستندِ دارای آدرس قرارداد و زمان معتبر در بازه ۲۴ ساعت قبل از یک پامپ تاریخی پیدا نشده است. نتیجه‌ای برای Instagram، Facebook یا YouTube بدون شواهد زمانی نمایش داده نمی‌شود.</div>';
  if(timeBox)timeBox.textContent='آخرین نمایش: '+new Date().toLocaleTimeString('fa-IR');
}

function renderAll(){
  // Render only the currently visible section. Previously every full update
  // rebuilt ALL seven panels (including social, trader and prelaunch lists),
  // causing long main-thread blocks that made buttons appear unresponsive.
  var kt=document.getElementById('kTokens');if(kt)kt.textContent=tokens.length;
  safeUiRender('ویژه‌های بالای صفحه',renderTopSpotlight);
  safeUiRender('پنل فعال',renderActivePanel);
}
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
  if(t){var tp=tradePlan(t);h+='<div class="note"><b>🎯 برنامه ورود/خروج:</b> '+tradePlanChips(t)+'<div style="margin-top:5px">'+esc(tp.reason||'')+(tp.riskPct?' · فاصله ابطال تقریبی '+Number(tp.riskPct).toFixed(1)+'%':'')+'</div><div class="muted" style="margin-top:4px">Entry / Stop Loss / Take Profit سطوح مدیریت ریسک‌اند و تضمین اجرا، سود یا نبود کلاهبرداری نیستند.</div></div>';}
  if(t){var tg=trustGuard(t),hb=t.holderBehavior||{};h+='<div class="note"><b>🛡 Trust Guard:</b> <span class="'+trustClass(t)+'">'+esc(trustLabel(t))+'</span> · snapshot هولدر '+Number(hb.snapshots||0)+' · خروج هولدر '+Number(hb.outflowPct||0).toFixed(2)+'% · نسبت Sell/Buy '+Number(hb.sellBuyRatio||0).toFixed(2)+(tg.reasons&&tg.reasons.length?' · '+esc(tg.reasons.join(' • ')):'')+'</div>';}
  if(t&&t.kolTrend){var k=t.kolTrend;h+='<details class="accordion" open><summary>👑 شواهد KOL</summary><div class="accordion-body"><div class="note"><b>KOLها:</b> '+esc((k.kolNames||[]).join('، ')||'—')+' · معامله اخیر '+Number(k.recentCount||0)+' · هولد '+Number(k.holdingCount||0)+' · اشاره X '+Number(k.xMentionCount||0)+'</div>'+(k.evidence||[]).slice(0,8).map(function(e){return '<div class="check"><span>'+esc(e.kol||'KOL')+' · '+esc(e.type||'')+'</span><span class="manual">'+esc(e.label||'')+'</span></div>'}).join('')+'</div></details>';}
  if(tr){var bf=largeBuyerFlow(t);h+='<div class="note"><b>خریدارهای ردیابی‌شده ۵۰۰$+:</b> '+bf.buyers+' کیف‌پول ('+money(bf.buyerUsd)+') · <b>فروشنده خالص:</b> '+bf.sellers+' کیف‌پول ('+money(bf.sellerUsd)+') · '+(bf.dominant?'<span class="pass">✓ خریدارها بیشترند</span>':'<span class="manual">خریدارها بیشتر نیستند</span>')+'</div>';}
  if(tr&&tr.convictionHolders&&tr.convictionHolders.length)h+='<details class="accordion"><summary>💎 هولدرهای ردیابی‌شده با خرید ۱۰۰۰$+ و فروش کمتر</summary><div class="accordion-body">'+tr.convictionHolders.map(function(x){return '<div class="check"><span>'+esc(x.wallet)+' · خرید '+money(x.buyUsd)+' · فروش '+money(x.sellUsd)+'</span><span class="pass">هولد فعلی '+money(x.currentHoldingUsd)+'</span></div>'}).join('')+'<div class="note">بر اساس Swapهای قابل‌تشخیص ۴۸ ساعت اخیر کیف‌پول‌های تحت ردیابی؛ پوشش کل بازار نیست.</div></div></details>';
  if(sm)h+='<div class="note"><b>اسمارت‌مانی:</b> '+Number(sm.smartMoneyCount||0)+' کیف‌پول · '+money(sm.totalValueUsd)+' پوزیشن</div>';
  if(wh.count)h+='<div class="note"><b>نهنگ:</b> '+wh.count+' خرید بزرگ · '+money(wh.usd)+'</div>';
  var tt=topTraderForMint(m);
  if(tt)h+='<div class="note"><b>🏆 تریدرهای برتر:</b> '+Number(tt.holderCount||0)+' کیف‌پول مشترک · '+money(tt.totalValueUsd)+' سرمایه فعلی · '+Number(tt.recentBuyers||0)+' خریدار تازه</div>';
  if(t){
    var mm=momentumFilter(t);
    h+='<details class="accordion"><summary>📊 فیلتر مومنتوم DEXScreener · '+mm.passed+'/'+mm.total+'</summary><div class="accordion-body">'+
      mm.checks.map(function(x){return '<div class="check"><span>'+esc(x.label)+'</span><span class="'+(x.ok?'pass':'fail')+'">'+(x.ok?'✓ پاس':'✕ رد')+'</span></div>'}).join('')+
      '<div class="note">این معیارها غربالگری مومنتوم‌اند و تضمین سود نیستند.</div></div></details>';
    var wv=whaleVerification(t);
    h+='<details class="accordion"><summary>🐋 چک‌لیست تأیید هشدار نهنگ · '+wv.passed+'/'+wv.total+'</summary><div class="accordion-body">'+
      wv.checks.map(function(x){return '<div class="check"><span>'+esc(x.name)+'</span><span class="'+(x.ok?'pass':'fail')+'">'+(x.ok?'✓ پاس':'✕ رد/نامشخص')+'</span></div>'}).join('')+
      '<div class="note">این چک‌لیست برای تأیید چندمنبعی است و به‌تنهایی تضمین سود نیست.</div></div></details>';
    h+=socialButtons(t);
  }
  h+='<div class="links"><a target="_blank" rel="noopener" href="'+esc(dexUrl(m,t&&t.dexUrl))+'">📈 DexScreener</a><a target="_blank" rel="noopener" href="https://solscan.io/token/'+encodeURIComponent(m)+'">Solscan</a><a target="_blank" rel="noopener" href="https://gmgn.ai/sol/token/'+encodeURIComponent(m)+'">GMGN</a><a target="_blank" rel="noopener" href="https://v2.bubblemaps.io/map?address='+encodeURIComponent(m)+'&chain=solana&partnerId=regular">Bubblemaps</a><a target="_blank" rel="noopener" href="https://rugcheck.xyz/tokens/'+encodeURIComponent(m)+'">Rugcheck</a><a target="_blank" rel="noopener" href="https://skynet.certik.com">CertiK↗</a><a target="_blank" rel="noopener" href="https://tokensniffer.com">TokenSniffer↗</a><a target="_blank" rel="noopener" href="https://gopluslabs.io">GoPlus↗</a><a target="_blank" rel="noopener" href="https://www.solanatracker.io/tokens/'+encodeURIComponent(m)+'">Solana Tracker</a></div><div class="note">این رادار ابزار تحقیق است؛ هیچ امتیازی تضمین سود یا نبود کلاهبرداری نیست.</div>';
  document.getElementById('detailBody').innerHTML=h;document.getElementById('detailDialog').showModal();
}
var loadAllBusy=false,marketLiveBusy=false,marketLiveTimer=null;

function preserveViewport(fn){
  var x=window.scrollX,y=window.scrollY;
  var active=document.activeElement;
  var activeId=active&&active.id?active.id:null;
  fn();
  // Keep the exact viewport stable even when rows reorder or heights change.
  window.scrollTo(x,y);
  requestAnimationFrame(function(){
    window.scrollTo(x,y);
    if(activeId){
      var el=document.getElementById(activeId);
      if(el&&document.activeElement!==el){try{el.focus({preventScroll:true})}catch(e){}}
    }
  });
}

function safeUiRender(name,fn){
  try{return fn()}catch(e){
    var u=document.getElementById('updated');
    if(u)u.textContent='خطای '+name+': '+String(e&&e.message||e);
    return null;
  }
}

function renderActivePanel(){
  preserveViewport(function(){
    if(activeTab==='featured'){
      safeUiRender('پیشنهاد سریع',renderTopQuick);
      safeUiRender('پیشنهاد ویژه',renderChampion);
      safeUiRender('هشدار خروج',renderAlerts);
      safeUiRender('پیشنهادها',renderFeatured);
      safeUiRender('عملکرد پیشنهادها',renderRecommendationPerformance);
      safeUiRender('عملکرد 24ساعته',renderPerformance24);
    }else if(activeTab==='whales'){
      safeUiRender('نهنگ‌ها',renderWhales);
    }else if(activeTab==='tokens'){
      safeUiRender('توکن‌های برتر',renderTopQuick);
      safeUiRender('KOL',renderKolTrends);
      safeUiRender('لیست توکن‌ها',renderTokens);
      safeUiRender('قیمت زنده توکن‌ها',updateLiveProfitDom);
    }else if(activeTab==='smart'){
      safeUiRender('اسمارت‌مانی',renderSmart);
    }else if(activeTab==='prelaunch'){
      safeUiRender('پیش‌لانچ',renderPrelaunch);
    }else if(activeTab==='social'){
      safeUiRender('مشاهیر X',renderFamousXMonitor);
      safeUiRender('اکانت‌های پیش از پامپ',renderPumpXMonitor);
      safeUiRender('ترند اجتماعی',renderSocialTrends);
    }else if(activeTab==='wallets'){
      safeUiRender('کیف‌پول‌ها',renderWallets);
      safeUiRender('Conviction',renderConviction);
    }
  });
}

function mergeMarketLive(x){
  if(!x||!Array.isArray(x.tokens)||!x.tokens.length)return false;
  var byMint=new Map(x.tokens.map(function(p){
    if(!p||!p.mint||!(Number(p.priceUsd)>0))return [p&&p.mint||'',null];
    var t=findToken(p.mint);

    // If a token already has a DEXScreener pair pinned, only accept that exact pair.
    if(t&&t.pairAddress&&p.pairAddress&&String(t.pairAddress)!==String(p.pairAddress)){
      return [p.mint,null];
    }

    rememberLivePrice(
      p.mint,
      p.priceUsd,
      p.priceValidationStatus==='confirmed-by-jupiter'?'jupiter-verified':'dexscreener',
      Number(p.priceObservedAt||Date.now()),
      p.pairAddress||''
    );
    return [p.mint,p];
  }));

  var changed=false;
  tokens=tokens.map(function(t){
    var p=byMint.get(t.mint);
    if(!p)return t;
    changed=true;
    return Object.assign({},t,p,{flow:p.flow||t.flow});
  });
  return changed;
}

function mergePrelaunchLive(x){
  if(!x||!Array.isArray(x.tokens))return false;
  prelaunchLive=x;
  var by=new Map(x.tokens.map(function(v){return [v.mint,v]}));
  if(prelaunch&&Array.isArray(prelaunch.launched)){
    prelaunch.launched=prelaunch.launched.map(function(v){
      var p=by.get(v.mint);
      return p?Object.assign({},v,{currentPrice:p.currentPrice,growthPct:p.growthPct,dexUrl:p.dexUrl||v.dexUrl}):v;
    });
  }
  x.tokens.forEach(function(v){
    var pr=document.querySelector('[data-prelaunch-live-price="'+CSS.escape(v.mint)+'"]');
    if(pr&&Number(v.currentPrice||0)>0)pr.textContent=fmtPrice(v.currentPrice);
    var pnl=document.querySelector('[data-prelaunch-live-profit="'+CSS.escape(v.mint)+'"]');
    if(pnl){
      var base=Number(pnl.getAttribute('data-prelaunch-live-base')||0);
      var cur=Number(v.currentPrice||0);
      var g=cur>0&&base>0?((cur-base)/base)*100:null;
      pnl.textContent=g==null?'—':(g>0?'+':'')+g.toFixed(2)+'%';
      pnl.classList.remove('return-pos','return-neg','return-flat');
      pnl.classList.add(g==null?'return-flat':g>=0?'return-pos':'return-neg');
    }
  });
  return true;
}
async function pollPrelaunchLive(){
  try{
    var x=await safeJson('/api/v1/prelaunch-live');
    if(x)mergePrelaunchLive(x);
  }catch(e){}
}

async function loadAll(){
  if(loadAllBusy)return;
  loadAllBusy=true;
  var b=document.getElementById('refresh');
  if(b){b.disabled=true;b.textContent='در حال دریافت…'}
  var sx=window.scrollX,sy=window.scrollY;
  try{
    var r=await Promise.all([safeJson('/api/v1/tokens'),safeJson('/api/v1/smart-money'),safeJson('/api/v1/smart-money-live'),safeJson('/api/v1/tracked-wallets'),safeJson('/api/v1/conviction-wallets'),safeJson('/api/v1/prelaunch'),safeJson('/api/v1/top-traders')]);
    if(r[0]&&Array.isArray(r[0].tokens)){
      if(r[0].tokens.length){
        tokens=r[0].tokens;
        tokens.forEach(function(t){rememberLivePrice(t.mint,t.priceUsd,'snapshot',Date.now(),t.pairAddress||'')});
        saveLivePrices();
      }else if(tokens.length===0){
        // Keep UI explicit if the very first scan is empty, but never erase a valid list.
        var u=document.getElementById('updated');
        if(u)u.textContent='اسکن موقتاً توکن نداد؛ تلاش بعدی خودکار انجام می‌شود';
      }
    }
    if(r[1])smart=r[1];
    if(r[2])live=r[2];
    if(r[3])tracked=r[3];
    if(r[4])conviction=r[4];
    if(r[5])prelaunch=r[5];
    if(r[6])topTraders=r[6];
    document.getElementById('updated').textContent='آخرین اسکن کامل: '+new Date().toLocaleTimeString('fa-IR');
    preserveViewport(renderAll);
  }finally{
    window.scrollTo(sx,sy);
    loadAllBusy=false;
    if(b){b.disabled=false;b.textContent='↻ بروزرسانی'}
  }
}

var visibleDexPriceBusy=false;
async function pollVisibleDexPrices(){
  if(visibleDexPriceBusy)return;
  visibleDexPriceBusy=true;
  try{
    var els=[...document.querySelectorAll('[data-live-price-mint],[data-live-profit-mint],[data-trader-position-mint],[data-trader-pnl-mint]')];
    var mints=[...new Set(els.filter(function(el){
      var r=el.getBoundingClientRect();
      return r.bottom>=-120&&r.top<=window.innerHeight+120;
    }).map(function(el){
      return el.getAttribute('data-live-price-mint')||el.getAttribute('data-live-profit-mint')||el.getAttribute('data-trader-position-mint')||el.getAttribute('data-trader-pnl-mint')||'';
    }).filter(Boolean))].slice(0,12);

    var rows=await Promise.all(mints.map(async function(mint){
      return await safeJson('/api/v1/dex-price?mint='+encodeURIComponent(mint));
    }));

    var exactUpdated=0;
    rows.forEach(function(p){
      if(!p||!p.ok||!(Number(p.priceUsd)>0)||p.status==='price-source-disagreement')return;
      exactUpdated++;
      rememberLivePrice(
        p.mint,
        p.priceUsd,
        String(p.source||'').startsWith('Jupiter')?'jupiter-verified':String(p.source||'').startsWith('GeckoTerminal')?'geckoterminal-fallback':String(p.source||'').startsWith('Birdeye')?'birdeye-fallback':String(p.source||'').startsWith('DEXScreener')?'dexscreener-exact':'pumpfun-fallback',
        Number(p.observedAt||Date.now()),
        p.pairAddress||''
      );

      var t=findToken(p.mint);
      if(t){
        t.priceUsd=Number(p.priceUsd);
        t.livePriceSource=p.source||'';
        t.livePriceStatus=p.status||'';
        t.dexPriceUsd=p.dexPriceUsd;
        t.pumpPriceUsd=p.pumpPriceUsd;
        t.pairAddress=p.pairAddress||t.pairAddress||'';
        t.dexUrl=p.dexUrl||t.dexUrl||'';
        t.pumpUrl=p.pumpUrl||'';
      }
    });
    updateLiveProfitDom();
    if(exactUpdated>0){var u=document.getElementById('updated');if(u)u.textContent='قیمت زنده DEXScreener · Pump.fun فقط تأیید/fallback: '+new Date().toLocaleTimeString('fa-IR')}
  }finally{
    visibleDexPriceBusy=false;
  }
}

var topTraderPollBusy=false;
async function pollTopTraders(){
  if(topTraderPollBusy)return;
  topTraderPollBusy=true;
  try{
    var x=await safeJson('/api/v1/top-traders');
    if(x&&x.ok){
      topTraders=x;
      if(activeTab==='wallets'||activeTab==='tokens'||activeTab==='social')renderActivePanel();
    }
  }finally{topTraderPollBusy=false}
}

async function pollMarketLive(){
  if(marketLiveBusy)return;
  marketLiveBusy=true;
  try{
    var x=await safeJson('/api/v1/market-live');
    if(mergeMarketLive(x)){
      lastMarketLiveAt=Date.now();
      safeUiRender('تطبیق بازار و اجتماع',renderTopSpotlight);
      updateLiveProfitDom();
      document.getElementById('updated').textContent='بازار زنده: '+new Date().toLocaleTimeString('fa-IR');
    }
  }finally{marketLiveBusy=false}
}

var liveStream=null,liveStreamConnected=false,liveFallbackTimer=null,liveConnectTimeout=null;

function setLiveStatus(txt){
  var u=document.getElementById('updated');
  if(u)u.textContent=txt;
}

function applyLivePayload(x,label){
  if(!x)return;
  live=x;
  safeUiRender('ترند + خرید نهنگ',renderTopSpotlight);
  renderActivePanel();
  setLiveStatus((label||'زنده')+': '+new Date().toLocaleTimeString('fa-IR'));
}

async function pollLiveFallback(){
  if(liveStreamConnected)return;
  var x=await safeJson('/api/v1/smart-money-live');
  if(x){
    applyLivePayload(x,'اتصال جایگزین فعال');
  }else{
    setLiveStatus('داده بازار فعال · منبع نهنگ موقتاً در دسترس نیست');
  }
}

function enableLiveFallback(){
  liveStreamConnected=false;
  if(liveConnectTimeout){clearTimeout(liveConnectTimeout);liveConnectTimeout=null}
  if(!liveFallbackTimer){
    pollLiveFallback();
    liveFallbackTimer=setInterval(pollLiveFallback,1000);
  }
  setLiveStatus('اتصال جایگزین فعال · در حال دریافت داده زنده');
}

function startLivePush(){
  setLiveStatus('در حال اتصال زنده…');
  if(typeof EventSource==='undefined'){
    enableLiveFallback();
    return;
  }

  try{
    liveStream=new EventSource('/api/v1/live-stream?ts='+Date.now());

    var handler=function(ev){
      try{
        applyLivePayload(JSON.parse(ev.data),'Push زنده');
      }catch(e){}
    };

    liveStream.addEventListener('snapshot',handler);
    liveStream.addEventListener('market',handler);
    liveStream.addEventListener('position',handler);
    liveStream.addEventListener('status',handler);

    liveStream.onopen=function(){
      liveStreamConnected=true;
      if(liveConnectTimeout){clearTimeout(liveConnectTimeout);liveConnectTimeout=null}
      if(liveFallbackTimer){clearInterval(liveFallbackTimer);liveFallbackTimer=null}
      setLiveStatus('اتصال Push زنده برقرار');
    };

    liveStream.onerror=function(){
      try{liveStream.close()}catch(e){}
      enableLiveFallback();
    };

    // Some browsers/proxies leave EventSource in CONNECTING forever.
    // Fall back automatically instead of showing "connecting" indefinitely.
    liveConnectTimeout=setTimeout(function(){
      if(!liveStreamConnected){
        try{liveStream.close()}catch(e){}
        enableLiveFallback();
      }
    },3500);

  }catch(e){
    enableLiveFallback();
  }
}
document.addEventListener('click',function(e){var d=e.target.closest('.detail-btn');if(!d)return;openDetail(d.getAttribute('data-mint')||'')});
document.getElementById('exportSignalHistory').addEventListener('click',exportSignalAuditCsv);
// Tab navigation is delegated to the independent bootstrap above, so it cannot
// be lost because of a later exception in the main data-loading script.
document.addEventListener('change',function(e){var sfel=e.target.closest('.signal-filter');if(!sfel)return;signalFilters[sfel.dataset.filter]=sfel.value;document.querySelectorAll('.signal-filter[data-filter="'+sfel.dataset.filter+'"]').forEach(function(x){if(x!==sfel)x.value=sfel.value});renderChampion();renderFeatured();renderWhales();renderSmart();renderTokens();renderSocialTrends()});
var mintLookupTimer=null;
document.getElementById('search').addEventListener('input',function(e){
  renderTokens();
  clearTimeout(mintLookupTimer);
  var q=String(e.target.value||'').trim();
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q))return;
  mintLookupTimer=setTimeout(async function(){
    var x=await safeJson('/api/v1/token-lookup?mint='+encodeURIComponent(q));
    if(!x||!x.token)return;
    var idx=tokens.findIndex(function(t){return t.mint===x.token.mint});
    if(idx>=0)tokens[idx]=Object.assign({},tokens[idx],x.token);
    else tokens.unshift(x.token);
    renderActivePanel();
  },250);
});document.getElementById('securityFilter').addEventListener('change',renderTokens);document.getElementById('activityFilter').addEventListener('change',renderTokens);document.getElementById('refresh').addEventListener('click',async function(){try{await safeJson('/api/v1/force-refresh')}catch(e){}await loadAll()});document.getElementById('closeDetail').addEventListener('click',function(){document.getElementById('detailDialog').close()});document.getElementById('detailDialog').addEventListener('click',function(e){if(e.target===this)this.close()});
window.addEventListener('error',function(e){
  var u=document.getElementById('updated');
  if(u)u.textContent='خطای رابط: '+String(e.message||'JavaScript');
});
window.radarRenderActivePanel=renderActivePanel;
window.__radarMainStarted=true;
loadAll();startLivePush();marketLiveTimer=setInterval(pollMarketLive,1000);setTimeout(pollMarketLive,350);setInterval(pollTopTraders,12000);setTimeout(pollTopTraders,2500);setInterval(pollVisibleDexPrices,1000);setTimeout(pollVisibleDexPrices,250);setInterval(pollPrelaunchLive,1000);setTimeout(pollPrelaunchLive,500);setInterval(loadAll,20000);
setTimeout(pollSourcesHealth,1500);
setInterval(pollSourcesHealth,5*60*1000);
setTimeout(pollFamousXMonitor,3500);
setInterval(pollFamousXMonitor,60*60*1000);
setTimeout(pollPumpXMonitor,6000);
setInterval(pollPumpXMonitor,15*60*1000);
</script>
<script src="/radar-filters.js"></script>
</body>
</html>`;

createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(url.pathname==='/api/v1/sources-health'){
      const d=await sourcesHealth();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify(d));
    }
    if(url.pathname==='/api/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',...headers});return res.end(JSON.stringify({ok:true,time:new Date().toISOString(),version:'2026-11-11-ui-clickfix',uptimeSeconds:Math.floor(process.uptime()),marketCacheAgeMs:marketLiveCache.at?Date.now()-marketLiveCache.at:null,radarCacheAgeMs:cache.at?Date.now()-cache.at:null}))}
    if(url.pathname==='/api/v1/force-refresh'){
      cache={at:0,data:null};marketLiveCache={at:0,data:null};exactDexPriceCache.clear();contractPriceCache.clear();prelaunchCache={at:0,data:null};pumpTraderIntelCache={at:0,data:null};solidProofIntelCache={at:0,data:null};trackedWalletCache={at:0,data:null};topTraderIntelCache={at:0,data:null};smartMoneyCache={at:0,data:null};convictionCache={at:0,data:null};
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify({ok:true,clearedAt:new Date().toISOString()}));
    }
    if(url.pathname==='/api/v1/famous-x-monitor'){
      const data=await buildFamousXMonitor();
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify(data));
    }
    if(url.pathname==='/api/v1/pump-x-monitor'){
      const data=await buildPumpXMonitor();
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify(data));
    }
    if(url.pathname==='/api/v1/conviction-wallets'){const cw=await buildConvictionWallets();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(cw))}
    if(url.pathname==='/api/v1/top-traders'){
      const d=await buildUserTopTraderIntel();
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify(d))
    }
    if(url.pathname==='/api/v1/tracked-wallets'){const tw=await buildTrackedWallets();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(tw))}
    if(url.pathname==='/api/v1/prelaunch-live'){const pl=await buildPrelaunchLive();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(pl))}
    if(url.pathname==='/api/v1/launch-intelligence'){
      const [pumpIntel,solidProofIntel,pre]=await Promise.all([
        buildPumpTraderIntel().catch(()=>({leaders:[],hotMints:[]})),
        buildSolidProofIntel().catch(()=>({rows:[]})),
        buildPrelaunchRadar()
      ]);
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify({ok:true,generatedAt:new Date().toISOString(),pumpIntel,solidProofIntel,earlyLaunch:pre.earlyLaunch||[]}))
    }
    if(url.pathname==='/api/v1/prelaunch'){const pl=await buildPrelaunchRadar();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(pl))}
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
    if(url.pathname==='/api/v1/smart-money-live'){
      try{await buildTrackedWallets()}catch{}
      const sm=liveSmartMoneyPayload();
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify(sm))
    }
    if(url.pathname==='/api/v1/dex-price'){
      const mint=String(url.searchParams.get('mint')||'').trim();
      if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)){
        res.writeHead(400,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
        return res.end(JSON.stringify({ok:false,error:'invalid mint'}));
      }
      const px=await contractPrice(mint);
      if(!px||!px.ok){
        res.writeHead(px?.status==='price-source-disagreement'?409:404,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
        return res.end(JSON.stringify(px||{ok:false,error:'price not found'}));
      }
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify(px));
    }
    if(url.pathname==='/api/v1/market-live'){const ml=await buildMarketLive();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(ml))}
    if(url.pathname==='/api/v1/token-lookup'){
      const mint=String(url.searchParams.get('mint')||'').trim();
      if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)){res.writeHead(400,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify({ok:false,error:'invalid mint'}))}
      const p=await pairFor(mint);
      if(!p){res.writeHead(404,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify({ok:false,error:'pair not found'}))}
      const buys5m=num(p.txns?.m5?.buys),sells5m=num(p.txns?.m5?.sells);
      const t={
        name:p.baseToken?.name||'Unknown',symbol:p.baseToken?.symbol||'?',mint,
        dexId:p.dexId||'',dexUrl:p.url||'',pairAddress:p.pairAddress||'',quoteTokenAddress:p.quoteToken?.address||'',priceQuoteTrusted:true,image:p.info?.imageUrl||'',description:'',
        ageMinutes:Math.max(0,(Date.now()-num(p.pairCreatedAt))/60000),
        priceUsd:num(p.priceUsd),marketCap:num(p.marketCap||p.fdv),liquidity:num(p.liquidity?.usd),
        volume5m:num(p.volume?.m5),volume1h:num(p.volume?.h1),volume6h:num(p.volume?.h6),volume24h:num(p.volume?.h24),
        buys5m,sells5m,txns5m:buys5m+sells5m,
        buys1h:num(p.txns?.h1?.buys),sells1h:num(p.txns?.h1?.sells),txns1h:num(p.txns?.h1?.buys)+num(p.txns?.h1?.sells),
        buys6h:num(p.txns?.h6?.buys),sells6h:num(p.txns?.h6?.sells),txns6h:num(p.txns?.h6?.buys)+num(p.txns?.h6?.sells),
        buys24h:num(p.txns?.h24?.buys),sells24h:num(p.txns?.h24?.sells),txns24h:num(p.txns?.h24?.buys)+num(p.txns?.h24?.sells),
        priceChange5m:num(p.priceChange?.m5),priceChange1h:num(p.priceChange?.h1),priceChange6h:num(p.priceChange?.h6),priceChange24h:num(p.priceChange?.h24)
      };
      t.flow=flowQuality(t);
      const sec=await security(mint);t.security=sec;
      const holderCounts=await fetchTokenHolderCounts([mint]);
      t.totalHolderCount=holderCounts.has(mint)?holderCounts.get(mint):null;
      t.totalHolderCountSource=holderCounts.has(mint)?'Jupiter Token API V2':'unavailable';
      t.activity=activityScore(t);t.trend={score:0,reasons:[]};t.socialHeat={score:0,label:'LOW',reasons:[]};
      t.marketQuality=marketQualityScore(t);t.chart=chartDiscipline(t);t.externalSecurity=await externalSecurityAudit(t);
      t.poolHealth=poolLiquidityAudit(t);
      t.academy=academyGuard(t);t.holderBehavior=holderBehaviorAudit(t);t.preSignalGuard=preSignalConfirmation(t);
      t.signals=multiHorizonSignals(t);t.verdict=verdict(t);
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(JSON.stringify({ok:true,token:t}));
    }
    if(url.pathname==='/api/v1/tokens'||url.pathname==='/api/radar'||url.pathname==='/api/v1/trending'){
      const d=await build(); let body=d;
      if(url.pathname==='/api/v1/trending')body={...d,tokens:[...d.tokens].sort((a,b)=>b.trend.score-a.trend.score)};
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});return res.end(JSON.stringify(body));
    }
    if(url.pathname==='/radar-filters.js'){
      res.writeHead(200,{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store',...headers});
      return res.end(readFileSync(new URL('./radar-filters.js',import.meta.url),'utf8'));
    }
    if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store, no-cache, must-revalidate, max-age=0','pragma':'no-cache','expires':'0',...headers});return res.end(html())}
    res.writeHead(404,headers);res.end('Not found');
  }catch(e){res.writeHead(502,{'content-type':'application/json',...headers});res.end(JSON.stringify({ok:false,error:String(e?.message||e)}))}
}).listen(PORT,'0.0.0.0',()=>console.log('Solana Meme Radar v3 live on '+PORT));
