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

const nav=[...rendered.matchAll(/data-tab="([^"]+)"/g)].map(x=>x[1]);
assert.deepEqual(nav,['featured','tokens','social','wallets','whales','smart','prelaunch'],
  'Modern navigation must keep all seven original panels accessible');
for(const id of nav)assert(rendered.includes('id="'+id+'Panel"'),'Missing section '+id);
assert(rendered.includes('id="advancedMenu"')&&rendered.includes('id="workspaceTitle"'),
  'Modern grouped navigation missing');
assert(rendered.includes('@media(max-width:620px)'), 'Mobile styles must be present');
assert(rendered.includes('id="sourcesHealthPanel"'), 'Data-source diagnostics must remain reachable');
assert(rendered.includes('id="detailDialog"'), 'Token detail dialog missing');

const elements={};
function makeEl(id){
  return elements[id]||(elements[id]={id,attrs:{},active:id==='featuredPanel',classList:{
    toggle(cls,on){if(cls==='active')elements[id].active=!!on}
  },getAttribute(k){return this.attrs[k]},setAttribute(k,v){this.attrs[k]=v},open:false});
}
const panels=nav.map(x=>makeEl(x+'Panel'));
const buttons=nav.map(x=>{
  const el=makeEl('button-'+x);
  el.attrs['data-tab']=x;
  return el;
});
makeEl('workspaceTitle');makeEl('workspaceDescription');makeEl('advancedMenu');
const simulatedDocument={
  getElementById(id){return elements[id]||null},
  querySelectorAll(sel){return sel==='#tabs .tab'?buttons:sel==='.panel'?panels:[]},
  addEventListener(){}
};
const simulatedWindow={addEventListener(){},radarRenderActivePanel(){this.rendered=true}};
new Function('window','document','setTimeout',scripts[0])(simulatedWindow,simulatedDocument,()=>{});
simulatedWindow.radarSwitchTab('social');
assert.equal(elements.socialPanel.active,true,'Social panel must be clickable');
assert.equal(elements.featuredPanel.active,false,'Inactive overview must be hidden');
assert.equal(elements.workspaceTitle.textContent,'رادار اجتماعی','Section heading must update');
simulatedWindow.radarSwitchTab('whales');
assert.equal(elements.whalesPanel.active,true,'Advanced whale panel must remain reachable');
assert.equal(elements['button-whales'].active,true,'Advanced menu item must become active');
assert.equal(simulatedWindow.rendered,true,'Tab navigation must trigger a render');

console.log('Rendered scripts + responsive grouped navigation + navigation state: PASS');
