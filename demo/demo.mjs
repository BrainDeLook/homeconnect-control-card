import '../dist/homeconnect-control-card.js?build=017final';
import { fixture } from '../tests/fixture.mjs';
const f=fixture();
if(new URLSearchParams(location.search).has('single')){f.registry.splice(0,f.registry.length,...f.registry.filter(e=>e.device_id==='dishwasher-device'));f.devices.splice(0,f.devices.length,...f.devices.filter(d=>d.id==='dishwasher-device'));}
const card=document.querySelector('homeconnect-control-card');
let hass=f.hass;
hass.services={homeconnect_ws:{start_program:{}}};
hass.states['sensor.kitchen_operation'].state='ready';
hass.states['sensor.kitchen_active'].state='unknown';
hass.states['sensor.kitchen_time'].state='2.5';
hass.states['button.kitchen_start'].state='unknown';
hass.states['button.kitchen_stop'].state='unavailable';
card.setConfig({type:'custom:homeconnect-control-card',title:'Ваш дом, ближе.'});
card.hass=hass;
const editorButton=document.createElement('button');editorButton.textContent='Редактор карточки';
document.querySelector('header').append(editorButton);
editorButton.onclick=()=>{
  let editor=document.querySelector('homeconnect-control-card-editor');
  if(editor){editor.remove();return;}
  editor=document.createElement('homeconnect-control-card-editor');
  editor.style.cssText='display:block;background:white;border:1px solid #dfe8ed;border-radius:10px;margin-bottom:20px';
  editor.setConfig({type:'custom:homeconnect-control-card',title:'Ваш дом, ближе.',show_summary:true});editor.hass=hass;
  editor.addEventListener('config-changed',event=>card.setConfig(event.detail.config));
  document.querySelector('.wrap').prepend(editor);
};
document.querySelector('#offline').onclick=event=>{
  hass.connection.connected=!hass.connection.connected;
  event.target.textContent=hass.connection.connected?'Отключить HA':'Подключить HA';
  card.hass={...hass};
};
document.querySelector('#theme').onclick=()=>document.body.classList.toggle('dark');
hass.callService=async(domain,service,data,target)=>{
  const li=document.createElement('li');li.textContent=JSON.stringify({domain,service,data,target});
  document.querySelector('#call-list').append(li);
  document.querySelector('#calls p').textContent='Только имитация API Home Assistant. Внешних запросов к технике нет.';
  if(domain==='homeconnect_ws'){hass.states['sensor.kitchen_operation']={...hass.states['sensor.kitchen_operation'],state:'delayedstart'};card.hass={...hass};return;}
  const id=target.entity_id,state=hass.states[id];
  let next=state.state;
  if(service==='select_option')next=data.option;
  if(service==='set_value')next=String(data.value);
  if(service==='turn_on')next='on';
  if(service==='turn_off')next='off';
  if(service==='press') {
    next=new Date().toISOString();
    const entry=f.registry.find(e=>e.entity_id===id);
    const forDevice=f.registry.filter(e=>e.device_id===entry.device_id);
    const operation=forDevice.find(e=>e.translation_key==='sensor_operation_state')?.entity_id;
    if(operation) {
      const op=entry.translation_key==='button_pause_program'?'pause':entry.translation_key==='button_abort_program'?'finished':'run';
      hass.states={...hass.states,[operation]:{...hass.states[operation],state:op}};
    }
  }
  hass.states={...hass.states,[id]:{...state,state:next,attributes:{...state.attributes,...(data.brightness_pct!==undefined?{brightness:Math.round(data.brightness_pct/100*255)}:{})}}};
  card.hass={...hass};
};
card.addEventListener('hass-more-info',event=>{
  const li=document.createElement('li');li.textContent='hass-more-info: '+event.detail.entityId;document.querySelector('#call-list').append(li);
});
