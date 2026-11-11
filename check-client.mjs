import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const code=readFileSync(new URL('./serve.mjs',import.meta.url),'utf8');
const start=code.indexOf('const html=()=>String.raw`');
const end=code.indexOf('</html>`;',start);
assert(start>=0&&end>start,'HTML template must preserve client JavaScript escapes with String.raw');
const expr=code.slice(start+'const html='.length,end+'</html>`'.length);
const rendered=new Function('return ('+expr+')')()();
const scripts=[...rendered.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
assert(scripts.length>=2,'Expected separate resilient navigation and main dashboard scripts');
scripts.forEach((script,index)=>{
  try{new Function(script)}
  catch(error){throw new Error('Rendered browser script '+(index+1)+' has invalid JavaScript: '+error.message,{cause:error})}
});
assert(rendered.includes('id="tabs"')&&rendered.includes('id="socialPanel"'),'Navigation elements missing');
console.log('Rendered HTML and '+scripts.length+' browser scripts: syntax OK');
