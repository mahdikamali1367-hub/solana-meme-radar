// Centralized exchange broad-market technical scanner.
// This is a technical research screen, NOT evidence of whale wallets or smart money.
const BINANCE='https://data-api.binance.vision';
const BYBIT='https://api.bybit.com';
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
function scanCandles(symbol,raw,ticker){
 if(!Array.isArray(raw)||raw.length<55)return null;
 const now=Date.now();
 const candles=raw.map(k=>({
  t:Number(k[0]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),
  quote:Number(k[7]),takerBuyQuote:Number(k[10]),end:Number(k[6])
 })).filter(c=>Object.values(c).every(Number.isFinite)&&c.close>0&&c.high>=c.low&&c.end<now);
 if(candles.length<53)return null;
 const closes=candles.map(c=>c.close),last=candles[candles.length-1];
 const e20=ema(closes,20),e50=ema(closes,50),r=rsi(closes),a=atr(candles);
 if(!e20||!e50||r==null||!a)return null;
 const hours=candles.slice(-12),quote=hours.reduce((sum,c)=>sum+c.quote,0),
  taker=hours.reduce((sum,c)=>sum+c.takerBuyQuote,0);
 const buyer=quote>0?100*taker/quote:null;
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
  symbol,baseAsset:symbol.slice(0,-4),quoteAsset:'USDT',exchange:'Binance',market:'SPOT',
  source:'Binance Spot market data',link:'https://www.binance.com/en/trade/'+symbol.slice(0,-4)+'_USDT',
  lastPrice:current,quoteVolume24h:volume24h,priceChange24h:Number(ticker.priceChangePercent),
  buyerPowerPct:buyer==null?null:Number(buyer.toFixed(1)),
  buyerPowerSource:'Binance Spot taker-buy quote volume / total quote volume (last 12 closed 1h candles)',
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
async function scan(){
 const statuses=[],started=nowIso();
 let info,tickers;
 try{
  [info,tickers]=await Promise.all([
    getJson(BINANCE+'/api/v3/exchangeInfo',11000),
    getJson(BINANCE+'/api/v3/ticker/24hr',11000)
  ]);
  statuses.push({exchange:'Binance',status:'ok'});
 }catch(e){
  statuses.push({exchange:'Binance',status:'unavailable',error:String(e.message||e)});
  return {ok:false,partial:true,generatedAt:nowIso(),sources:statuses,assets:[],totalSpotPairs:0,error:'Binance Spot API unavailable'};
 }
 let bybitSymbols=new Set();
 try{
  const res=await getJson(BYBIT+'/v5/market/instruments-info?category=spot',9000);
  if(res?.retCode===0&&Array.isArray(res.result?.list)){
    bybitSymbols=new Set(res.result.list.filter(x=>x.status==='Trading').map(x=>x.symbol));
    statuses.push({exchange:'Bybit',status:'ok',pairs:bybitSymbols.size});
  }else statuses.push({exchange:'Bybit',status:'unavailable'});
 }catch(e){statuses.push({exchange:'Bybit',status:'unavailable',error:String(e.message||e)})}
 const trading=new Set((info.symbols||[]).filter(x=>x.status==='TRADING'&&x.isSpotTradingAllowed!==false&&
   x.quoteAsset==='USDT').map(x=>x.symbol));
 const sorted=(Array.isArray(tickers)?tickers:[]).filter(t=>
   trading.has(t.symbol)&&Number(t.quoteVolume)>=2000000&&Number(t.lastPrice)>0)
  .sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume));
 const selection=sorted.slice(0,36);
 const outputs=[];
 for(let i=0;i<selection.length;i+=6){
  const chunk=selection.slice(i,i+6);
  const result=await Promise.allSettled(chunk.map(t=>getJson(
    BINANCE+'/api/v3/klines?symbol='+encodeURIComponent(t.symbol)+'&interval=1h&limit=85',8500)));
  result.forEach((item,j)=>{
    if(item.status!=='fulfilled')return;
    const p=scanCandles(chunk[j].symbol,item.value,chunk[j]);
    if(p){p.cexListings=['Binance',...(bybitSymbols.has(p.symbol)?['Bybit']:[])];outputs.push(p)}
  });
 }
 outputs.sort((a,b)=>Number(b.technicalStatus==='TECHNICAL_SETUP')-Number(a.technicalStatus==='TECHNICAL_SETUP')||
   b.score-a.score||b.quoteVolume24h-a.quoteVolume24h);
 return {
  ok:true,partial:outputs.length<selection.length,
  generatedAt:nowIso(),startedAt:started,
  sources:statuses,totalSpotPairs:trading.size,highVolumePairs:sorted.length,
  candlePairsScanned:selection.length,candlePairsWithAnalysis:outputs.length,
  notes:'Up to 36 largest USDT Spot pairs by 24h quote volume; not every cryptocurrency. Technical setups are NOT wallet-confirmed trade signals.',
  assets:outputs
 };
}
async function broadCexScanner(){
 const now=Date.now();
 if(cache.result&&now-cache.at<TTL)return {...cache.result,scanning:!!inFlight};
 if(!inFlight){
  inFlight=scan().then(r=>{cache={at:Date.now(),result:r};return r}).finally(()=>{inFlight=null});
 }
 if(cache.result)return {...cache.result,scanning:true};
 return {ok:true,scanning:true,partial:true,generatedAt:nowIso(),
   assets:[],sources:[],notes:'Initial technical scan in progress; do not infer any signals.'};
}
export {broadCexScanner,scanCandles,ema,rsi,atr};
