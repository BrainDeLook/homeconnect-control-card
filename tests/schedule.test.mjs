import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {buildDevices} from '../src/core.mjs';
import {HomeConnectControlCard} from '../src/card.mjs';
import {scheduleRange,schedulePreview,planScheduledStart} from '../src/schedule.mjs';

const NOW=Date.parse('2026-10-21T20:30:00Z');
function context(){
  const f=fixture();const device=buildDevices(f.hass,f.registry,f.devices).find(d=>d.type==='Dishwasher');
  f.hass.services={homeconnect_ws:{start_program:{}}};
  f.hass.states[device.roles.operation].state='ready';
  f.hass.states[device.roles.start].state='unknown';
  f.hass.states[device.roles.remaining]={state:'120',attributes:{unit_of_measurement:'min'}};
  for(const [role,id] of [['startIn','number.start_delay'],['finishIn','number.finish_delay']]){
    device.roles[role]=id;device.entries.push({entity_id:id});
    f.hass.states[id]={state:'0',attributes:{readonly:false,min:0,max:86400,step:60,unit_of_measurement:'s'}};
  }
  const draft={enabled:true,mode:'finish',program:f.hass.states[device.roles.program].state,value:14400,base:NOW};
  return {...f,device,draft};
}
test('finish target computes start and end across midnight, with no service writes',()=>{
  const {hass,device,draft,calls}=context();const p=schedulePreview(hass,device,draft,NOW);
  assert.equal(new Date(p.start).toISOString(),'2026-10-21T22:30:00.000Z');
  assert.equal(new Date(p.end).toISOString(),'2026-10-22T00:30:00.000Z');
  assert.equal(calls.length,0);
});
test('start target honors converted HA hours and native min/step grid',()=>{
  const {hass,device,draft}=context();
  hass.states[device.roles.startIn].attributes={min:0.25,max:24,step:0.25,unit_of_measurement:'h'};
  draft.mode='start';draft.value=3;
  const p=schedulePreview(hass,device,draft,NOW);
  assert.equal(p.end-p.start,7200000);
  const plan=planScheduledStart(hass,device,draft,NOW);
  assert.deepEqual(plan.data,{device_id:device.id,start_in:{seconds:10800}});
});
test('scheduled start uses one integration start with one explicit time option',()=>{
  const {hass,device,draft}=context();
  assert.deepEqual(planScheduledStart(hass,device,draft,NOW),{domain:'homeconnect_ws',service:'start_program',data:{device_id:device.id,finish_in:{seconds:14400}},target:{}});
});
test('chosen wall clock target stays fixed while confirmation is open',()=>{
  const {hass,device,draft}=context();
  assert.equal(planScheduledStart(hass,device,draft,NOW+600000).data.finish_in.seconds,13800);
});
test('unknown duration, readonly timer, missing service and Remote Start block scheduling',()=>{
  for(const change of [
    ({hass,device})=>hass.states[device.roles.remaining].state='unknown',
    ({hass,device})=>hass.states[device.roles.finishIn].attributes.readonly=true,
    ({hass})=>delete hass.services.homeconnect_ws.start_program,
    ({hass,device})=>hass.states[device.roles.remote].state='off',
    ({hass,device})=>hass.states[device.roles.operation].state='run',
    ({hass})=>hass.connection.connected=false,
    ({draft})=>draft.program='another',
    ({draft})=>draft.mode='invalid',
  ]){const c=context();change(c);assert.throws(()=>planScheduledStart(c.hass,c.device,c.draft,NOW));}
});
test('too early, expired, NaN and off-grid targets are rejected',()=>{
  for(const value of [60,Number.NaN,100000,14401]){
    const {hass,device,draft}=context();draft.value=value;
    assert.throws(()=>planScheduledStart(hass,device,draft,NOW));
  }
  const {hass,device,draft}=context();
  assert.throws(()=>planScheduledStart(hass,device,draft,NOW+14400000));
});
test('slider range is capped and aligned with appliance min and step',()=>{
  const {hass,device}=context();
  hass.states[device.roles.startIn].attributes={min:300,max:999999,step:600,unit_of_measurement:'s'};
  const p=scheduleRange(hass,device,'start');
  assert.equal(p.lower,300);assert.ok(p.sliderMax<=172800);
  assert.equal((p.sliderMax-300)%600,0);assert.equal(p.sliderStep%600,0);
});
test('failed scheduled submission makes one request with no retry or button press',async()=>{
  const {hass,device,draft,calls}=context();draft.base=Date.now();
  hass.callService=async(...args)=>{calls.push(args);throw Error('appliance rejected');};
  const card=Object.create(HomeConnectControlCard.prototype);
  Object.assign(card,{_hass:hass,_config:{},_models:[device],_connection:hass.connection,_schedules:new Map([[device.id,draft]]),_render(){},_notify(text){this.notice=text;}});
  await card._runScheduled(device);
  assert.equal(calls.length,1);assert.equal(calls[0][0],'homeconnect_ws');assert.equal(calls[0][1],'start_program');
  assert.match(card.notice,/rejected/);assert.equal(card._busy,false);
});
test('main control tab includes settings and timer without brand header',()=>{
  const {hass,device}=context();
  const card=Object.create(HomeConnectControlCard.prototype);
  Object.assign(card,{_hass:hass,_config:{},_models:[device],_deviceId:device.id,_tab:'programs',_draftPrograms:new Map(),_draftValues:new Map(),_favorites:[]});
  assert.equal(card._header(),'');
  const html=card._detail();
  assert.match(html,/data-schedule-toggle/);assert.match(html,/data-toggle="switch.kitchen_child_lock"/);
  assert.match(html,/data-role="start"/);assert.match(html,/data-program=/);
});
