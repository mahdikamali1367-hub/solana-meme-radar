// Centralized exchange broad-market technical scanner.
// This is a technical research screen, NOT evidence of whale wallets or smart money.
const BINANCE='https://data-api.binance.vision';
const BYBIT='https://api.bybit.com';
const OKX='https://www.okx.com';
let cache={at:0,result:null},inFlight=null;
const TTL=5*60*1000;
const nowIso=()=>new Date().toISOString();
async function getJson(url,timeout=7500){
 const controller=new AbortController(),tid=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetch(url,{signal:controller.signal,headers:{accept:'application/json'}});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return await response.json();
 }finally{clearTimeout(tid)}
}
function ema(list,length){
 if(list.length<length)return null;
 let value=list.slice(0,length).reduce((a,b)=>a+b,0)/length;
 const k=2/(length+1);
 for(let i=length;i<list.length;i++)value=(list[i]-value)*k+value;
 return value;
}
function rsi(closes,n=14){
 if(closes.length<n+1)return null;
 let g=0,l=0;
 for(let i=1;i<=n;i++){
  const delta=closes[i]-closes[i-1];g+=Math.max(0,delta);l+=Math.max(0,-delta);
 }
 g/=n;l/=n;
 for(let i=n+1;i<closes.length;i++){
  const d=closes[i]-closes[i-1];
  g=(g*(n-1)+Math.max(0,d))/n;l=(l*(n-1)+Math.max(0,-d))/n;
 }
 return l===0?100:100-100/(1+g/l);
}
function atr(candles,n=14){
 if(candles.length<n+1)return null;
 const tr=[];
 for(let i=1;i<candles.length;i++){
  const p=candles[i-1].close,c=candles[i];
  tr.push(Math.max(c.high-c.low,Math.abs(c.high-p),Math.abs(c.low-p)));
 }
 let a=tr.slice(0,n).reduce((sum,v)=>sum+v,0)/n;
 for(let i=n;i<tr.length;i++)a=(a*(n-1)+tr[i])/n;
 return a;
}
function scanCandles(symbol,raw,ticker,exchange='Binance'){
 if(!Array.isArray(raw)||raw.length<55)return null;
 const now=Date.now();
 const candles=raw.map(k=>({
  t:Number(k[0]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),
  quote:Number(k[7]),
  takerBuyQuote:k[10]===null||k[10]===undefined?null:Number(k[10]),
  end:Number(k[6])
 })).filter(c=>Number.isFinite(c.t)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&
   Number.isFinite(c.close)&&Number.isFinite(c.quote)&&Number.isFinite(c.end)&&
   c.close>0&&c.high>=c.low&&c.end<now).sort((a,b)=>a.t-b.t);
 if(candles.length<53)return null;
 const closes=candles.map(c=>c.close),last=candles[candles.length-1];
 const e20=ema(closes,20),e50=ema(closes,50),r=rsi(closes),a=atr(candles);
 if(!e20||!e50||r==null||!a)return null;
 const hours=candles.slice(-12),quote=hours.reduce((sum,c)=>sum+c.quote,0),
  taker=hours.reduce((sum,c)=>sum+c.takerBuyQuote,0);
 const takerKnown=hours.every(c=>c.takerBuyQuote!==null&&Number.isFinite(c.takerBuyQuote));
 const buyer=quote>0&&takerKnown?100*taker/quote:null;
 const current=Number(ticker.lastPrice),volume24h=Number(ticker.quoteVolume);
 const trend=e20>e50?'UP':e20<e50?'DOWN':'FLAT';
 const gap=Math.abs(current-e20)/a,overextended=current>e20+1.8*a;
 const eligible=trend==='UP'&&current>e50&&r>=43&&r<=63&&
    buyer!=null&&buyer>=53&&volume24h>=2000000&&
    gap<=1.5&&!overextended&&
    Date.now()-last.end<=3*60*60*1000;
 const lower=e20-0.30*a,upper=e20+0.30*a,stop=e20-1.5*a;
 const risk=e20-stop;
 let score=35+(trend==='UP'?20:0)+
   (r>=45&&r<=60?12:0)+(buyer!=null&&buyer>=53?12:0)+
   (gap<=0.8?10:0)+(volume24h>=10000000?8:0)-
   (overextended?20:0);
 score=Math.max(0,Math.min(100,Math.round(score)));
 return {
  symbol,baseAsset:symbol.slice(0,-4),quoteAsset:'USDT',exchange,market:'SPOT',
  source:exchange+' Spot market data',
  link:exchange==='Binance'?'https://www.binance.com/en/trade/'+symbol.slice(0,-4)+'_USDT':
    exchange==='Bybit'?'https://www.bybit.com/trade/spot/'+symbol.slice(0,-4)+'/USDT':
    'https://www.okx.com/trade-spot/'+symbol.slice(0,-4).toLowerCase()+'-usdt',
  lastPrice:current,quoteVolume24h:volume24h,priceChange24h:Number(ticker.priceChangePercent),
  buyerPowerPct:buyer==null?null:Number(buyer.toFixed(1)),
  buyerPowerSource:buyer==null?'Unavailable: source provides no taker buy volume':
    'Spot taker-buy quote volume / total quote volume (last 12 closed 1h candles)',
  lastCandleAt:new Date(last.end).toISOString(),observedAt:nowIso(),rsi14:Number(r.toFixed(1)),
  ema20:e20,ema50:e50,atr14:a,trend,score,
  technicalStatus:eligible?'TECHNICAL_SETUP':'WAIT',
  entryZone:eligible?{low:lower,high:upper}:null,
  stopLoss:eligible?stop:null,
  target1:eligible?e20+2*risk:null,
  // Never infer wallet identity from centralized trade size or volume.
  whaleFlow:{status:'UNVERIFIED',reason:'معاملات صرافی مالک کیف‌پول نهنگ را مشخص نمی‌کند'},
  smartMoney:{status:'UNVERIFIED',reason:'اطلاعات کیف‌پول معتبر و قابل‌تطبیق با دارایی موجود نیست'},
  buySignal:false,
  signalReason:eligible?'موقعیت تکنیکال قابل رصد؛ بدون تأیید مستقل نهنگ و اسمارت‌مانی سیگنال ورود نیست':
    'شرایط روند/RSI/ATR/قدرت خریدار برای ورود هم‌زمان کامل نیست'
 };
}

function normalizeBybitKline(row){
 const t=Number(row[0]);
 // Bybit: start, open, high, low, close, volume, turnover.
 return [t,row[1],row[2],row[3],row[4],row[5],
   t+3600000-1,row[6],null,null,null,null];
}
function normalizeOkxKline(row){
 const t=Number(row[0]);
 // OKX: ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm.
 if(String(row[8])!=='1')return null;
 return [t,row[1],row[2],row[3],row[4],row[5],
   t+3600000-1,row[7],null,null,null,null];
}
async function fromBinance(statuses){
 const hosts=['https://data-api.binance.vision','https://api.binance.com','https://api1.binance.com'];
 let lastError='No response';
 for(const host of hosts){
  try{
   const [info,tickers]=await Promise.all([
     getJson(host+'/api/v3/exchangeInfo',6500),
     getJson(host+'/api/v3/ticker/24hr',6500)
   ]);
   const trading=new Set((info.symbols||[]).filter(x=>x.status==='TRADING'&&
     x.isSpotTradingAllowed!==false&&x.quoteAsset==='USDT').map(x=>x.symbol));
   const sorted=(Array.isArray(tickers)?tickers:[]).filter(x=>
     trading.has(x.symbol)&&Number(x.quoteVolume)>=2000000&&Number(x.lastPrice)>0)
      .sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume));
   if(!trading.size||!sorted.length)throw Error('Missing active Spot USDT tickers');
   const selection=sorted.slice(0,36),outputs=[];
   for(let i=0;i<selection.length;i+=9){
    const chunk=selection.slice(i,i+9);
    const results=await Promise.allSettled(chunk.map(t=>getJson(
      host+'/api/v3/klines?symbol='+encodeURIComponent(t.symbol)+'&interval=1h&limit=85',8500)));
    results.forEach((v,j)=>{
      if(v.status!=='fulfilled')return;
      const asset=scanCandles(chunk[j].symbol,v.value,chunk[j],'Binance');
      if(asset){asset.cexListings=['Binance'];outputs.push(asset)}
    });
   }
   if(!outputs.length)throw Error('No usable closed-hour Binance candles');
   statuses.push({exchange:'Binance',status:'ok',pairs:trading.size,provider:host});
   return {assets:outputs,spotPairs:trading.size,eligiblePairs:sorted.length,scanned:selection.length};
  }catch(e){lastError=String(e.message||e)}
 }
 statuses.push({exchange:'Binance',status:'unavailable',error:lastError});
 return null;
}
async function fromBybit(statuses){
 try{
  const [instruments,ticks]=await Promise.all([
   getJson(BYBIT+'/v5/market/instruments-info?category=spot&limit=1000',9500),
   getJson(BYBIT+'/v5/market/tickers?category=spot',9500)
  ]);
  if(instruments?.retCode!==0||ticks?.retCode!==0)throw Error('Invalid Bybit Spot response');
  const active=new Set((instruments.result?.list||[]).filter(x=>x.status==='Trading'&&
    x.quoteCoin==='USDT').map(x=>x.symbol));
  const sorted=(ticks.result?.list||[]).filter(t=>active.has(t.symbol)&&
    Number(t.turnover24h)>=2000000&&Number(t.lastPrice)>0)
      .sort((a,b)=>Number(b.turnover24h)-Number(a.turnover24h));
  if(!sorted.length)throw Error('No eligible Bybit Spot tickers');
  const selection=sorted.slice(0,36),outputs=[];
  for(let i=0;i<selection.length;i+=9){
   const chunk=selection.slice(i,i+9);
   const results=await Promise.allSettled(chunk.map(t=>getJson(
     BYBIT+'/v5/market/kline?category=spot&symbol='+encodeURIComponent(t.symbol)+'&interval=60&limit=85',8500)));
   results.forEach((v,j)=>{
    if(v.status!=='fulfilled'||v.value?.retCode!==0)return;
    const klines=(v.value.result?.list||[]).map(normalizeBybitKline);
    const t=chunk[j];
    const asset=scanCandles(t.symbol,klines,{
      lastPrice:t.lastPrice,quoteVolume:t.turnover24h,
      priceChangePercent:Number(t.price24hPcnt)*100
    },'Bybit');
    if(asset){asset.cexListings=['Bybit'];outputs.push(asset)}
   });
  }
  if(!outputs.length)throw Error('No usable Bybit Spot candles');
  statuses.push({exchange:'Bybit',status:'ok',pairs:active.size});
  return {assets:outputs,spotPairs:active.size,eligiblePairs:sorted.length,scanned:selection.length};
 }catch(e){
  statuses.push({exchange:'Bybit',status:'unavailable',error:String(e.message||e)});
  return null;
 }
}
async function fromOkx(statuses){
 try{
  const [instruments,ticks]=await Promise.all([
    getJson(OKX+'/api/v5/public/instruments?instType=SPOT',9500),
    getJson(OKX+'/api/v5/market/tickers?instType=SPOT',9500)
  ]);
  if(instruments?.code!=='0'||ticks?.code!=='0')throw Error('Invalid OKX Spot response');
  const active=new Set((instruments.data||[]).filter(x=>x.state==='live'&&
    x.quoteCcy==='USDT').map(x=>x.instId));
  const sorted=(ticks.data||[]).filter(t=>active.has(t.instId)&&
    Number(t.volCcy24h)*Number(t.last)>=2000000&&Number(t.last)>0)
    .sort((a,b)=>Number(b.volCcy24h)*Number(b.last)-Number(a.volCcy24h)*Number(a.last));
  const selection=sorted.slice(0,36),outputs=[];
  for(let i=0;i<selection.length;i+=9){
   const chunk=selection.slice(i,i+9);
   const results=await Promise.allSettled(chunk.map(t=>getJson(
     OKX+'/api/v5/market/history-candles?instId='+encodeURIComponent(t.instId)+'&bar=1H&limit=85',8500)));
   results.forEach((v,j)=>{
    if(v.status!=='fulfilled'||v.value?.code!=='0')return;
    const t=chunk[j],symbol=t.instId.replace('-','');
    const klines=(v.value.data||[]).map(normalizeOkxKline).filter(Boolean);
    const asset=scanCandles(symbol,klines,{
      lastPrice:t.last,quoteVolume:Number(t.volCcy24h)*Number(t.last),
      priceChangePercent:Number(t.open24h)>0?(Number(t.last)/Number(t.open24h)-1)*100:0
    },'OKX');
    if(asset){asset.cexListings=['OKX'];outputs.push(asset)}
   });
  }
  if(!outputs.length)throw Error('No usable OKX Spot candles');
  statuses.push({exchange:'OKX',status:'ok',pairs:active.size});
  return {assets:outputs,spotPairs:active.size,eligiblePairs:sorted.length,scanned:selection.length};
 }catch(e){
  statuses.push({exchange:'OKX',status:'unavailable',error:String(e.message||e)});
  return null;
 }
}
async function scan(){
 const statuses=[],started=nowIso();
 // Each fallback is independent; inaccessible exchanges must not blank the
 // entire radar. Never synthesize price or a buy-pressure signal.
 let result=await fromBinance(statuses);
 if(!result)result=await fromBybit(statuses);
 if(!result)result=await fromOkx(statuses);
 if(!result)return {
   ok:false,partial:true,generatedAt:nowIso(),sources:statuses,
   assets:[],totalSpotPairs:0,candlePairsScanned:0,candlePairsWithAnalysis:0,
   error:'All three public CEX market APIs were unavailable or returned no usable candles'
 };
 const outputs=result.assets;
 outputs.sort((a,b)=>Number(b.technicalStatus==='TECHNICAL_SETUP')-
   Number(a.technicalStatus==='TECHNICAL_SETUP')||b.score-a.score||
   b.quoteVolume24h-a.quoteVolume24h);
 return {
  ok:true,partial:outputs.length<result.scanned,
  generatedAt:nowIso(),startedAt:started,sources:statuses,
  primaryExchange:outputs[0]?.exchange||null,
  totalSpotPairs:result.spotPairs,highVolumePairs:result.eligiblePairs,
  candlePairsScanned:result.scanned,candlePairsWithAnalysis:outputs.length,
  notes:'Up to 36 highest volume USDT Spot pairs from the first accessible exchange. Missing buyer power or wallet identities do not become trade signals.',
  assets:outputs
 };
}
async function broadCexScanner(){
 const now=Date.now();
 if(cache.result&&now-cache.at<(cache.result.ok?TTL:30000))return {...cache.result,scanning:!!inFlight};
 if(!inFlight){
  inFlight=scan().then(r=>{cache={at:Date.now(),result:r};return r})
    .catch(e=>{const r={ok:false,generatedAt:nowIso(),assets:[],sources:[],
      error:String(e.message||e)};cache={at:Date.now(),result:r};return r})
    .finally(()=>{inFlight=null});
 }
 if(cache.result)return {...cache.result,scanning:true};
 return {ok:true,scanning:true,partial:true,generatedAt:nowIso(),
   assets:[],sources:[],notes:'Initial technical scan in progress; do not infer any signals.'};
}
export {broadCexScanner,scanCandles,ema,rsi,atr};
