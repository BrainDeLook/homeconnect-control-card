import '../dist/homeconnect-control-card.js?regression=015';
import {fixture} from '../tests/fixture.mjs';
const output=document.querySelector('#result');
const results=[];
const check=(name,ok,details='')=>{results.push({name,ok,details});if(!ok)throw Error(name+': '+details);};
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
try{
  const f=fixture(),hass=f.hass;
  f.registry.splice(0,f.registry.length,...f.registry.filter(e=>e.device_id==='dishwasher-device'));
  f.devices.splice(0,f.devices.length,...f.devices.filter(d=>d.id==='dishwasher-device'));
  hass.services={homeconnect_ws:{start_program:{}}};
  hass.states['sensor.kitchen_operation'].state='ready';
  hass.states['sensor.kitchen_time'].state='2.5';
  hass.states['button.kitchen_start'].state='unknown';
  const shadow=document.querySelector('#shell').attachShadow({mode:'open'});
  shadow.innerHTML='<div id="scroll" style="height:560px;overflow:auto;overflow-anchor:auto"><div style="height:350px"></div><homeconnect-control-card></homeconnect-control-card><div style="height:600px"></div></div>';
  const card=shadow.querySelector('homeconnect-control-card'),scroller=shadow.querySelector('#scroll');
  hass.callService=async(...args)=>{
    f.calls.push(args);
    const [domain,service,data,target]=args;
    if(domain==='switch')hass.states={...hass.states,[target.entity_id]:{...hass.states[target.entity_id],state:service==='turn_on'?'on':'off'}};
    card.hass={...hass};
  };
  card.setConfig({type:'custom:homeconnect-control-card'});card.hass=hass;
  await frame();await frame();
  const root=card.shadowRoot;
  root.querySelector('[data-schedule-toggle]').click();await frame();
  const slider=root.querySelector('[data-schedule-slider]'),haCard=root.querySelector('ha-card');
  scroller.scrollTop=scroller.scrollTop+slider.getBoundingClientRect().top-scroller.getBoundingClientRect().top-160;
  window.scrollTo(0,170);await frame();
  slider.focus({preventScroll:true});
  const before={inner:scroller.scrollTop,page:document.scrollingElement.scrollTop};
  for(let n=0;n<8;n++){
    slider.value=String(Number(slider.min)+(n+2)*Number(slider.step));
    slider.dispatchEvent(new Event('input',{bubbles:true}));
    slider.dispatchEvent(new Event('change',{bubbles:true}));
    await frame();
  }
  check('Сам ползунок и ha-card сохраняются',root.querySelector('[data-schedule-slider]')===slider&&root.querySelector('ha-card')===haCard);
  check('Фокус остаётся на ползунке',root.activeElement===slider);
  check('Позиция вложенного HA-скроллера не сбрасывается',Math.abs(scroller.scrollTop-before.inner)<=1,`${before.inner} → ${scroller.scrollTop}`);
  check('Позиция страницы не сбрасывается',Math.abs(document.scrollingElement.scrollTop-before.page)<=1,`${before.page} → ${document.scrollingElement.scrollTop}`);
  check('Ползунок не отправляет команды',f.calls.length===0);
  const sliderValue=slider.value;
  slider.blur();
  const toggle=root.querySelector('[data-toggle="switch.extra_dry"]');
  toggle.focus({preventScroll:true});
  const toggleScroll=scroller.scrollTop;
  toggle.click();await frame();await frame();
  check('Переключатель вызывает ровно одну команду после повторных рендеров',f.calls.length===1,JSON.stringify(f.calls));
  check('Переключатель сохраняется вместе с прокруткой',root.querySelector('[data-toggle="switch.extra_dry"]')===toggle&&Math.abs(scroller.scrollTop-toggleScroll)<=1);
  check('Значение времени не теряется',root.querySelector('[data-schedule-slider]').value===sliderValue);
  output.dataset.status='passed';
  output.textContent=results.map(r=>'PASS: '+r.name+(r.details?' ('+r.details+')':'')).join('\n');
}catch(error){output.dataset.status='failed';output.textContent=results.map(r=>(r.ok?'PASS: ':'FAIL: ')+r.name+' '+r.details).join('\n')+'\n'+error.stack;}
