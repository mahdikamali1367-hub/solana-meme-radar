/* Advanced signal filters. Loaded after the main radar client. */
(function(){
  'use strict';
  const KEY='radar:filters:v6'; // keep existing confirmed filters
  const defaults={q:'',from:'',to:'',minPnl:'',maxPnl:'',minScore:'',minLiquidity:'',minVolume:'',minHolders:'',security:'',entry:'',whales:'',smart:'',sort:'default'};
  let state={...defaults};
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');if(saved&&typeof saved==='object')state={...state,...saved}}catch(_){}
  let draft={...state};
  const fields=[
    ['q','نام / کانترکت','search'],
    ['from','تاریخ شمسی از','jalali'],['to','تاریخ شمسی تا','jalali'],
    ['minPnl','حداقل سود/زیان ٪','number'],['maxPnl','حداکثر سود/زیان ٪','number'],
    ['minScore','حداقل امتیاز اجتماعی','number'],
    ['minLiquidity','حداقل نقدینگی دلاری','number'],['minVolume','حداقل حجم ۲۴ ساعت دلاری','number'],
    ['minHolders','حداقل هولدر','number'],
    ['security','سطح امنیت','select',[['','همه'],['MAX','حداکثر'],['HIGH','بالا'],['MEDIUM','متوسط'],['LOW','کم']]],
    ['entry','وضعیت ورود','select',[['','همه'],['ENTRY','ورود فعال'],['OTHER','بدون ورود فعال']]],
    ['whales','خرید نهنگ','select',[['','همه'],['yes','دارد'],['no','ندارد']]],
    ['smart','اسمارت‌مانی','select',[['','همه'],['yes','دارد'],['no','ندارد']]],
    ['sort','مرتب‌سازی','select',[['default','پیش‌فرض'],['new','جدیدترین'],['old','قدیمی‌ترین'],['pnlDown','بیشترین سود'],['pnlUp','کمترین سود'],['scoreDown','بیشترین امتیاز']]]
  ];
  const css='.signal-filters{border:1px solid #405b77;border-radius:12px;background:#132238;padding:13px;margin:12px 0;color:#ecf4ff;direction:rtl}.signal-filters h3{font-size:14px;margin:0 0 11px}.signal-filters-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:8px}.signal-filters-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px}.signal-filters-grid input,.signal-filters-grid select{width:100%;min-width:0;box-sizing:border-box;padding:8px;border:1px solid #4b6b8c;border-radius:7px;background:#0a172b;color:white}.signal-filters-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}.signal-filters button{background:#264b6b;color:white;border:1px solid #4a7195;border-radius:8px;padding:7px 12px;cursor:pointer}.signal-filter-hide{display:none!important}.signal-filter-date-error{font-size:12px;color:#ffc681;margin-top:8px}.signal-filters small{display:block;margin-top:9px;color:#b9d5ee}';
  const extraCss='.jalali-wrap{display:flex;gap:5px;align-items:center;position:relative}.jalali-wrap input{flex:1}.jalali-open{flex:none;padding:8px!important;min-width:38px}.jalali-popover{position:absolute;right:0;top:calc(100% + 4px);z-index:500;background:#15283e;border:1px solid #6583a3;box-shadow:0 12px 28px #000a;border-radius:12px;width:min(310px,84vw);padding:12px;direction:rtl}.jalali-toolbar{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-bottom:10px}.jalali-toolbar button{padding:5px 9px}.jalali-days,.jalali-weekdays{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}.jalali-weekdays span{font-size:11px;color:#b5cadf;padding:5px 0}.jalali-days button{padding:7px 0;border-radius:7px;background:#203651;border:1px solid transparent}.jalali-days button.jalali-selected{background:#226f8a;border-color:#8be7ff}.jalali-days button.jalali-today{border-color:#d3b064}.jalali-days button:focus-visible{outline:2px solid #fff}.jalali-actions{display:flex;justify-content:space-between;margin-top:9px}.signal-filter-apply{background:#1d826e!important;font-weight:800}.signal-filter-pending{font-size:12px;color:#ffe2a4;margin:7px 0}.signal-filter-date-error{min-height:16px}';
  const sty=document.createElement('style');sty.textContent=css+extraCss;document.head.appendChild(sty);
  const number=(v)=>{if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
  const western=v=>String(v??'').replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632));
  const jalaliParts=new Intl.DateTimeFormat('en-US-u-ca-persian',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'});
  function jalaliDay(ms){
    if(!Number.isFinite(ms))return null;
    const p=jalaliParts.formatToParts(new Date(ms));
    const part=k=>Number(p.find(x=>x.type===k)?.value);
    const y=part('year'),m=part('month'),d=part('day');
    return y*10000+m*100+d;
  }
  function jalaliInput(value){
    const v=western(value).trim().replace(/[-.]/g,'/');
    if(!v)return null;
    const m=v.match(/^(1[34][0-9]{2})\/([0-9]{1,2})\/([0-9]{1,2})$/);
    if(!m)return null;
    const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
    if(mo<1||mo>12||d<1||d>31||(mo>6&&d>30))return null;
    return y*10000+mo*100+d;
  }
  const months=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const weekdays=['ش','ی','د','س','چ','پ','ج'];
  const persianNumber=n=>String(n).replace(/[0-9]/g,c=>'۰۱۲۳۴۵۶۷۸۹'[Number(c)]);
  const fmtJalali=(y,m,d)=>persianNumber(y+'/'+String(m).padStart(2,'0')+'/'+String(d).padStart(2,'0'));
  function monthCells(y,m){
    // Locate Persian month boundaries using the browser's Persian calendar.
    // Approximate Iranian new year near March 20, then find the exact day.
    const approx=Date.UTC(y+621,2,20)+((m<=7?(m-1)*31:186+(m-7)*30))*86400000;
    let start=null;
    for(let offset=-5;offset<=5;offset++){
      const day=approx+offset*86400000;
      if(jalaliDay(day)===y*10000+m*100+1){start=day;break}
    }
    if(start===null)return {start:0,days:[]};
    const days=[];
    for(let i=0;i<31;i++){
      const ms=start+i*86400000,code=jalaliDay(ms);
      if(Math.floor(code/100)!==y*100+m)break;
      days.push({date:code,day:i+1});
    }
    return {start,days};
  }
  function monthShift(y,m,step){
    const n=y*12+(m-1)+step;
    return {y:Math.floor(n/12),m:((n%12)+12)%12+1};
  }
  let calendar=null;
  function closeCalendar(){
    if(calendar){calendar.remove();calendar=null}
  }
  function openCalendar(key,anchor){
    closeCalendar();
    const base=jalaliInput(draft[key])||jalaliDay(Date.now());
    let y=Math.floor(base/10000),m=Math.floor(base/100)%100;
    const pop=document.createElement('div');
    pop.className='jalali-popover';
    pop.setAttribute('role','dialog');pop.setAttribute('aria-label','تقویم شمسی '+(key==='from'?'از تاریخ':'تا تاریخ'));
    pop.addEventListener('click',e=>e.stopPropagation());
    anchor.appendChild(pop);calendar=pop;
    function draw(){
      pop.replaceChildren();
      const toolbar=document.createElement('div');toolbar.className='jalali-toolbar';
      const prev=document.createElement('button');prev.type='button';prev.textContent='ماه قبل ❯';prev.onclick=()=>{({y,m}=monthShift(y,m,-1));draw()};
      const title=document.createElement('b');title.textContent=months[m-1]+' '+persianNumber(y);
      const next=document.createElement('button');next.type='button';next.textContent='❮ ماه بعد';next.onclick=()=>{({y,m}=monthShift(y,m,1));draw()};
      toolbar.append(prev,title,next);pop.appendChild(toolbar);
      const heads=document.createElement('div');heads.className='jalali-weekdays';
      weekdays.forEach(x=>{const h=document.createElement('span');h.textContent=x;heads.appendChild(h)});pop.appendChild(heads);
      const daysEl=document.createElement('div');daysEl.className='jalali-days';
      const data=monthCells(y,m),offset=(new Date(data.start).getUTCDay()+1)%7;
      for(let i=0;i<offset;i++)daysEl.appendChild(document.createElement('span'));
      data.days.forEach(({date,day})=>{
        const b=document.createElement('button');b.type='button';b.textContent=persianNumber(day);
        if(date===jalaliInput(draft[key]))b.classList.add('jalali-selected');
        if(date===jalaliDay(Date.now()))b.classList.add('jalali-today');
        b.setAttribute('aria-label',fmtJalali(y,m,day));
        b.onclick=()=>{
          draft[key]=fmtJalali(y,m,day);
          sync();markPending();closeCalendar();
        };
        daysEl.appendChild(b);
      });
      pop.appendChild(daysEl);
      const actions=document.createElement('div');actions.className='jalali-actions';
      const today=document.createElement('button');today.type='button';today.textContent='امروز';
      today.onclick=()=>{const code=jalaliDay(Date.now());draft[key]=fmtJalali(Math.floor(code/10000),Math.floor(code/100)%100,code%100);sync();markPending();closeCalendar()};
      const clear=document.createElement('button');clear.type='button';clear.textContent='پاک کردن تاریخ';
      clear.onclick=()=>{draft[key]='';sync();markPending();closeCalendar()};
      actions.append(today,clear);pop.appendChild(actions);
    }
    draw();
  }
  function markPending(){
    document.querySelectorAll('.signal-filter-pending').forEach(el=>el.textContent=JSON.stringify(draft)===JSON.stringify(state)?'':'تغییرات انتخاب شده‌اند؛ برای اعمال، «تأیید و نمایش نتایج» را بزن.');
  }
  function tokenInfo(mint){try{return (typeof tokens!=='undefined'&&Array.isArray(tokens)?tokens:[]).find(t=>t&&t.mint===mint)||null}catch(_){return null}}
  function recordFor(mint){try{return (typeof socialSignalHistory!=='undefined'&&socialSignalHistory.get(mint))||(typeof tokenRadarHistory!=='undefined'&&tokenRadarHistory.get(mint))||null}catch(_){return null}}
  function facts(row){
    const node=row.hasAttribute('data-mint')?row:row.querySelector('[data-mint]'),mint=node?node.getAttribute('data-mint'):'';
    const t=tokenInfo(mint),h=recordFor(mint);
    const when=h&&h.introducedAt?Date.parse(h.introducedAt):NaN;
    const day=jalaliDay(when);
    let pnl=null;
    try{
      const current=typeof currentPriceForMint==='function'?number(currentPriceForMint(mint)):null;
      const base=h?number(h.introducedPrice):null;
      if(current>0&&base>0)pnl=(current/base-1)*100;
    }catch(_){}
    let whale=null,smart=null,entry=null;
    try{if(t&&typeof whaleFor==='function')whale=number(whaleFor(mint)?.count)>0}catch(_){}
    try{if(t&&typeof smartFor==='function')smart=!!smartFor(mint)}catch(_){}
    try{if(t&&typeof tradePlan==='function')entry=tradePlan(t).status==='ENTRY'}catch(_){}
    const sec=String(t?.security?.tier||'').toUpperCase();
    return {mint,text:(row.textContent||'').toLowerCase(),when,day,pnl,
      score:t?number(t.socialHeat?.score):null,liq:t?number(t.liquidity):null,
      volume:t?number(t.volume24h):null,holders:t?number(t.totalHolderCount):null,
      security:sec,whale,smart,entry};
  }
  function pass(d){
    if(state.q&&!d.text.includes(state.q.toLowerCase())&&!d.mint.toLowerCase().includes(state.q.toLowerCase()))return false;
    const from=jalaliInput(state.from),to=jalaliInput(state.to);
    if(from!==null&&(d.day===null||d.day<from))return false;
    if(to!==null&&(d.day===null||d.day>to))return false;
    for(const [key,metric,side] of [['minPnl','pnl','min'],['maxPnl','pnl','max'],['minScore','score','min'],['minLiquidity','liq','min'],['minVolume','volume','min'],['minHolders','holders','min']]){
      if(state[key]===''||state[key]==null)continue;
      const threshold=number(state[key]),actual=d[metric];
      if(threshold===null||actual===null||!Number.isFinite(actual)||(side==='min'?actual<threshold:actual>threshold))return false;
    }
    if(state.security&&!d.security.includes(state.security))return false;
    if(state.entry&& (d.entry===null||(state.entry==='ENTRY'?!d.entry:d.entry)))return false;
    if(state.whales&&(d.whale===null||(state.whales==='yes'?!d.whale:d.whale)))return false;
    if(state.smart&&(d.smart===null||(state.smart==='yes'?!d.smart:d.smart)))return false;
    return true;
  }
  function activePanel(){
    try{return document.getElementById(activeTab+'Panel')}catch(_){return null}
  }
  function ensure(){
    const panel=activePanel();if(!panel)return null;
    let bar=panel.querySelector(':scope > .signal-filters');
    if(bar)return bar;
    bar=document.createElement('section');bar.className='signal-filters';
    const title=document.createElement('h3');title.textContent='🔎 فیلتر پیشرفته سیگنال‌ها';bar.appendChild(title);
    const grid=document.createElement('div');grid.className='signal-filters-grid';
    fields.forEach(([key,label,type,options])=>{
      const wrap=document.createElement('label');wrap.textContent=label;
      const ctrl=document.createElement(type==='select'?'select':'input');
      ctrl.dataset.filterKey=key;
      if(type==='select')options.forEach(([val,title])=>{const op=document.createElement('option');op.value=val;op.textContent=title;ctrl.appendChild(op)});
      else {ctrl.type=type==='jalali'?'text':type;if(type==='number')ctrl.step='any';if(type==='jalali'){ctrl.placeholder='۱۴۰۵/۰۸/۲۱';ctrl.inputMode='numeric';ctrl.dir='ltr';ctrl.maxLength=10;}}
      ctrl.value=draft[key]??'';
      if(type==='jalali'){
        const group=document.createElement('span');group.className='jalali-wrap';
        const trigger=document.createElement('button');trigger.type='button';trigger.className='jalali-open';
        trigger.textContent='📅';trigger.setAttribute('aria-label','باز کردن تقویم شمسی '+label);
        trigger.onclick=e=>{e.stopPropagation();if(calendar&&calendar.parentElement===group)closeCalendar();else openCalendar(key,group)};
        group.append(ctrl,trigger);wrap.appendChild(group);
      }else wrap.appendChild(ctrl);
      grid.appendChild(wrap);
    });
    bar.appendChild(grid);
    const dateHelp=document.createElement('small');dateHelp.textContent='تاریخ به شمسی (مثلاً ۱۴۰۵/۰۸/۲۱). فیلتر تاریخ روی زمان ثبت سیگنال اعمال می‌شود؛ سیگنال بدون تاریخ معتبر فقط هنگام فعال بودن فیلتر تاریخ حذف می‌شود.';bar.appendChild(dateHelp);
    const validation=document.createElement('div');validation.className='signal-filter-date-error';validation.setAttribute('role','status');bar.appendChild(validation);
    const pending=document.createElement('div');pending.className='signal-filter-pending';bar.appendChild(pending);
    const foot=document.createElement('div');foot.className='signal-filters-foot';
    const count=document.createElement('span');count.className='signal-filter-count';count.setAttribute('aria-live','polite');foot.appendChild(count);
    const btns=document.createElement('div');btns.style.display='flex';btns.style.gap='7px';
    const applyButton=document.createElement('button');applyButton.type='button';applyButton.className='signal-filter-apply';
    applyButton.textContent='✓ تأیید و نمایش نتایج';applyButton.dataset.filterApply='1';btns.appendChild(applyButton);
    const reset=document.createElement('button');reset.type='button';reset.textContent='پاک‌کردن فیلترها';reset.dataset.filterReset='1';btns.appendChild(reset);
    foot.appendChild(btns);
    bar.appendChild(foot);
    panel.insertBefore(bar,panel.firstChild);markPending();return bar;
  }
  function apply(){
    const panel=activePanel();if(!panel)return;
    const bar=ensure();if(!bar)return;
    const badDates=['from','to'].filter(k=>state[k]&&jalaliInput(state[k])===null);
    const warning=bar.querySelector('.signal-filter-date-error');
    if(warning)warning.textContent=badDates.length?'تاریخ شمسی معتبر وارد کن (مثل ۱۴۰۵/۰۸/۲۱). تا اصلاح تاریخ، این شرط اعمال نمی‌شود.':'';
    let count=0,visible=0;
    panel.querySelectorAll('.list').forEach(list=>{
      // Only filter actual token/signal cards, never X-profile cards, status
      // messages, or other rows without a contract address.
      const children=Array.from(list.children).filter(el=>el.classList?.contains('row'));
      children.filter(el=>!el.hasAttribute('data-mint')&&!el.querySelector('[data-mint]')).forEach(el=>el.classList.remove('signal-filter-hide'));
      if(list.closest('details:not([open])'))return;
      const rows=children.filter(el=>el.hasAttribute('data-mint')||el.querySelector('[data-mint]')).map((el,i)=>({el,i,d:facts(el)}));
      if(state.sort!=='default'){
        const ascending=state.sort==='old'||state.sort==='pnlUp';
        const field=state.sort==='old'||state.sort==='new'?'when':state.sort==='scoreDown'?'score':'pnl';
        rows.sort((a,b)=>{
          const x=a.d[field],y=b.d[field],validX=x!==null&&Number.isFinite(x),validY=y!==null&&Number.isFinite(y);
          if(!validX&&!validY)return a.i-b.i;
          if(!validX)return 1;if(!validY)return -1;
          return (ascending?x-y:y-x)||a.i-b.i;
        });
        rows.forEach(r=>list.appendChild(r.el));
      }
      rows.forEach(r=>{count++;const show=pass(r.d);r.el.classList.toggle('signal-filter-hide',!show);if(show)visible++});
    });
    const tally=bar.querySelector('.signal-filter-count');if(tally)tally.textContent='نمایش '+visible+' از '+count+' ردیف دارای کانترکت'+(count===0?' — برای نمایش لیست، زیرمجموعه را باز کن یا داده بازار را بررسی کن':'');
    let empty=bar.querySelector('.signal-filter-empty');
    if(count>0&&visible===0){
      if(!empty){empty=document.createElement('p');empty.className='signal-filter-empty';empty.style.margin='9px 0 0';bar.appendChild(empty)}
      empty.textContent='با فیلترهای فعلی نتیجه‌ای پیدا نشد؛ «پاک‌کردن فیلترها» را بزن تا همه سیگنال‌ها بازگردند.';
    }else if(empty)empty.remove();
  }
  function sync(){
    document.querySelectorAll('[data-filter-key]').forEach(ctrl=>{if(ctrl.value!==(draft[ctrl.dataset.filterKey]??''))ctrl.value=draft[ctrl.dataset.filterKey]??''});
  }
  document.addEventListener('input',e=>{
    const c=e.target.closest('[data-filter-key]');if(!c)return;
    draft[c.dataset.filterKey]=c.value;
    markPending();
  });
  document.addEventListener('change',e=>{
    const c=e.target.closest('[data-filter-key]');if(!c)return;
    draft[c.dataset.filterKey]=c.value;
    markPending();
  });
  document.addEventListener('click',e=>{
    if(calendar&&!e.target.closest('.jalali-popover,.jalali-open'))closeCalendar();
    if(e.target.closest('[data-filter-apply]')){
      const bad=['from','to'].filter(k=>draft[k]&&jalaliInput(draft[k])===null);
      const panel=activePanel(),warning=panel?.querySelector('.signal-filter-date-error');
      if(bad.length){if(warning)warning.textContent='تاریخ شمسی واردشده معتبر نیست. نمونه: ۱۴۰۵/۰۸/۲۱';return}
      const from=jalaliInput(draft.from),to=jalaliInput(draft.to);
      if(from&&to&&from>to){if(warning)warning.textContent='تاریخ شروع باید قبل از تاریخ پایان باشد.';return}
      state={...draft};
      try{localStorage.setItem(KEY,JSON.stringify(state))}catch(_){}
      if(warning)warning.textContent='';
      closeCalendar();markPending();apply();
      return;
    }
    if(e.target.closest('[data-filter-reset]')){
      state={...defaults};draft={...defaults};
      try{localStorage.setItem(KEY,JSON.stringify(state))}catch(_){}
      closeCalendar();sync();markPending();apply();
    }
  });
  if(typeof renderActivePanel==='function'){
    const previous=renderActivePanel;
    renderActivePanel=function(){const result=previous.apply(this,arguments);apply();return result};
  }
  document.addEventListener('toggle',function(e){if(e.target.tagName==='DETAILS')apply()},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);else apply();
})();
