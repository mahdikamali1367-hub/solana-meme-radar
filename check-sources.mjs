import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('./serve.mjs',import.meta.url),'utf8');
function between(start,end){
  const a=code.indexOf(start),b=code.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'Missing marker '+start);
  return code.slice(a,b);
}
const mint='So11111111111111111111111111111111111111112';
const monitor=between('let sourcesHealthCache=','const html=()=>String.raw');
function mockSourceHealth(env,failed=''){
  const req=async(url)=>{
    if(failed&&url.includes(failed))throw new Error('429 rate limited');
    if(url.includes('dexscreener'))return [{}];
    if(url.includes('geckoterminal'))return {data:[{}]};
    if(url.includes('/price/v3'))return {[mint]:{usdPrice:101}};
    if(url.includes('/tokens/v2'))return [{id:mint,holderCount:10000}];
    if(url.includes('rugcheck'))return {score:1};
    if(url.includes('goplus'))return {code:1,result:{}};
    if(url.includes('birdeye'))return {success:true,data:{value:101}};
    throw new Error('Unexpected fixture endpoint');
  };
  const factory=new Function('jfetch','rpc','process','num','WSOL_MINT','xFamousCache','pumpXMonitorCache',
    monitor+'return sourcesHealth;');
  return factory(req,async()=>({result:300000000}),{env},x=>Number(x||0),
    mint,{data:null},{data:null});
}
const good=await mockSourceHealth({JUPITER_API_KEY:'SECRET_TEST_VALUE',
  X_BEARER_TOKEN:'SECRET_TEST_VALUE',BIRDEYE_API_KEY:'SECRET_TEST_VALUE'})();
assert.equal(good.rows.find(x=>x.id==='birdeye').status,'ok');
assert.equal(good.rows.find(x=>x.id==='x').status,'configured-not-tested');
assert.equal(good.rows.find(x=>x.id==='dexscreener').status,'ok');
assert(!JSON.stringify(good).includes('SECRET_TEST_VALUE'),'Secret leaked into health JSON');
const noKeys=await mockSourceHealth({})();
assert.equal(noKeys.rows.find(x=>x.id==='birdeye').status,'missing-key');
assert.equal(noKeys.rows.find(x=>x.id==='x').status,'missing-key');
assert.equal(noKeys.rows.find(x=>x.id==='pumpfun').status,'public-fallback');
const rateLimited=await mockSourceHealth({},'dexscreener')();
assert.equal(rateLimited.rows.find(x=>x.id==='dexscreener').status,'error');
assert.equal(rateLimited.rows.find(x=>x.id==='dexscreener').reason,'HTTP 429');

const providers=between('const secondaryPriceCache=','let prelaunchCache=');
let now=100000;
const clock={now:()=>now};
const providerCalls=[];
const providerFactory=new Function('jfetch','process','num','PUMP_X_MINT_RE','Date',
  providers+'return {geckoTokenPrice,birdeyeTokenPrice};');
const price=providerFactory(async(url)=>{
  providerCalls.push(url);
  if(url.includes('geckoterminal'))return {data:{attributes:{token_prices:{[mint]:'101.5'}}}};
  if(url.includes('birdeye'))return {success:true,data:{value:102}};
  throw new Error('Unknown mocked provider');
},{env:{BIRDEYE_API_KEY:'SECRET_TEST_VALUE'}},x=>Number(x||0),
/^[1-9A-HJ-NP-Za-km-z]{32,44}$/,clock);
assert.equal((await price.geckoTokenPrice(mint))?.priceUsd,101.5);
assert.equal((await price.birdeyeTokenPrice(mint))?.priceUsd,102);
assert.equal((await price.geckoTokenPrice(mint))?.priceUsd,101.5);
assert.equal(providerCalls.length,2,'Secondary quotes must be cached');
console.log('Source health, keyless fallback, rate limits, and secret protection: PASS');
