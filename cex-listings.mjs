// Official-only CEX listing announcement monitor.
// Never predicts a listing date or equates derivatives/roadmaps with Spot.
const SOURCES=[
 {exchange:'Binance',url:'https://www.binance.com/en/support/announcement/list/48',origin:'https://www.binance.com',scope:'Spot and assorted announcements'},
 {exchange:'Bybit',url:'https://announcements.bybit.com/en/?category=new_crypto&page=1',origin:'https://announcements.bybit.com',scope:'New listings'},
 {exchange:'OKX',url:'https://www.okx.com/help/section/announcements-new-listings',origin:'https://www.okx.com',scope:'New listings'}
];
let cache={at:0,value:null};
const TTL=15*60*1000;
function plain(s){return String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/gi,'&').replace(/&nbsp;/gi,' ').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim()}
function validUrl(href,source){
 try{
   const u=new URL(href,source.url);
   if(u.protocol!=='https:'||u.hostname!==new URL(source.origin).hostname)return null;
   if(source.exchange==='Binance'&&!/\/support\/announcement\/[^/?#]+/.test(u.pathname))return null;
   if(source.exchange==='Bybit'&&!/\/article\/|\/help-center\/article\//.test(u.pathname))return null;
   if(source.exchange==='OKX'&&!/\/help\//.test(u.pathname))return null;
   return u.toString();
 }catch{return null}
}
function category(title){
 if(/\b(futures|perpetual|margin|options|pre.market|tradfi|loan|collateral|pre.ipo)\b/i.test(title))return 'DERIVATIVES_OR_OTHER';
 if(/\b(spot|will list|to list|new listing|lists? .*on spot|adds? .*on spot)\b/i.test(title))return 'SPOT_CANDIDATE';
 return 'UNCLASSIFIED';
}
function readArticles(html,source){
 const found=new Map();
 const re=/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
 let m;
 while((m=re.exec(html))!==null){
  const href=m[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
  if(!href)continue;
  const url=validUrl(href,source),title=plain(m[2]);
  if(!url||title.length<18||title.length>230)continue;
  if(!/(list|listing|launch|trading pair|will add|will open)/i.test(title))continue;
  if(!found.has(url))found.set(url,{exchange:source.exchange,title,url,market:category(title),official:true,listingAt:null});
  if(found.size>=30)break;
 }
 return [...found.values()];
}
async function request(url,timeout=9000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetch(url,{signal:controller.signal,headers:{accept:'text/html','user-agent':'SolanaRadar/1.0 monitoring public exchange announcements'}});
  if(!response.ok)throw Error('HTTP '+response.status);
  const body=await response.text();
  if(body.length>3_000_000)throw Error('page too large');
  return body;
 }finally{clearTimeout(timer)}
}
async function officialListingFeed(){
 const now=Date.now();
 if(cache.value&&now-cache.at<TTL)return cache.value;
 const status=[],announcements=[];
 const results=await Promise.allSettled(SOURCES.map(s=>request(s.url)));
 SOURCES.forEach((source,index)=>{
  const item=results[index];
  if(item.status==='fulfilled'){
   const articles=readArticles(item.value,source);
   status.push({exchange:source.exchange,url:source.url,status:articles.length?'ok':'no-verifiable-article-links',count:articles.length});
   announcements.push(...articles);
  }else status.push({exchange:source.exchange,url:source.url,status:'unavailable',count:0});
 });
 // Only announce countdowns if an official Spot article explicitly gives
 // a UTC trading-open time. Publication date is NOT the listing date.
 const spot=announcements.filter(a=>a.market==='SPOT_CANDIDATE').slice(0,5);
 const extra=await Promise.allSettled(spot.map(a=>request(a.url,7500)));
 spot.forEach((a,i)=>{
   if(extra[i].status!=='fulfilled')return;
   const html=plain(extra[i].value);
   const match=html.match(/(?:trading\s+will\s+(?:open|commence|start)|spot\s+trading\s+(?:opens|starts))[^.]{0,230}?(20\d{2})[-/]([01]\d)[-/]([0-3]\d)[,\s]+([0-2]\d):([0-5]\d)\s*(?:\(UTC\)|UTC)/i);
   if(!match)return;
   const when=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]));
   if(when>Date.now()&&when-Date.now()<=30*86400000)
     a.listingAt=new Date(when).toISOString();
 });
 const value={ok:true,checkedAt:new Date().toISOString(),sources:status,announcements:announcements.slice(0,60),
  notes:'Official links only. Articles and token contract identities require independent verification. No estimated listing dates. Futures ≠ Spot.'};
 cache={at:now,value};return value;
}
export {officialListingFeed};
