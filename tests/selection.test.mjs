import test from 'node:test';
import assert from 'node:assert/strict';
import {HomeConnectControlCard} from '../src/card.mjs';
import {buildDevices,selectedProgramDuration,immediateProgramSelection} from '../src/core.mjs';
import {fixture} from './fixture.mjs';

function context(){
  const f=fixture();
  const card=Object.create(HomeConnectControlCard.prototype);
  Object.assign(card,{_hass:f.hass,_config:{},_models:buildDevices(f.hass,f.registry,f.devices),_connection:f.hass.connection,_draftPrograms:new Map(),_draftValues:new Map(),_busy:false,_render(){},_notify(text,error){this.notice={text,error};}});
  return {...f,card,device:card._models.find(d=>d.id==='dishwasher-device')};
}
test('dishwasher click selects the raw HA option once, without start or local fake state',async()=>{
  const {card,device,calls,hass}=context();
  const state=hass.states[device.roles.program],option=state.attributes.options[1];
  const old=state.state;
  await card._chooseProgram(device,option);
  assert.deepEqual(calls,[['select','select_option',{option},{entity_id:device.roles.program}]]);
  assert.equal(state.state,old);
  assert.equal(card._program(device),old);
  hass.states[device.roles.program]={...state,state:option};
  assert.equal(card._program(device),option);
});
test('clicking the current program makes no request',async()=>{
  const {card,device,calls,hass}=context();
  await card._chooseProgram(device,hass.states[device.roles.program].state);
  assert.equal(calls.length,0);
});
test('start remains disabled until HA confirms the requested program',async()=>{
  const {card,device,hass}=context();
  hass.states[device.roles.start].state='unknown';
  const option=hass.states[device.roles.program].attributes.options[1];
  await card._chooseProgram(device,option);
  assert.match(card._programButtons(device),/data-role="start" disabled/);
  assert.doesNotMatch(card._programButtons(device),/data-apply-program/);
  hass.states[device.roles.program]={...hass.states[device.roles.program],state:option};
  card._entities=fixture().registry;card._devices=fixture().devices;
  card._updateModels();
  assert.equal(card._pendingPrograms.has(device.id),false);
  assert.doesNotMatch(card._programButtons(device),/data-role="start" disabled/);
});
test('busy and disconnected HA never queue selection requests',async()=>{
  const {card,device,calls,hass}=context();
  const option=hass.states[device.roles.program].attributes.options[1];
  card._busy=true;await card._chooseProgram(device,option);
  card._busy=false;hass.connection.connected=false;
  await card._chooseProgram(device,option);
  assert.equal(calls.length,0);assert.equal(card.notice.error,true);
});
test('selection error does not start or retry or leave a fake selected program',async()=>{
  const {card,device,hass}=context();let count=0;
  hass.callService=async()=>{count++;throw Error('Rejected');};
  const old=card._program(device);
  await card._chooseProgram(device,hass.states[device.roles.program].attributes.options[1]);
  assert.equal(count,1);assert.equal(card._program(device),old);assert.equal(card.notice.error,true);
});
test('legacy/other appliance flows keep confirmation, including dishwasher override',async()=>{
  const {card,device,calls,hass}=context();
  card._config={program_selection:'confirm'};
  const option=hass.states[device.roles.program].attributes.options[1];
  await card._chooseProgram(device,option);
  assert.equal(calls.length,0);assert.equal(card._program(device),option);
  assert.equal(immediateProgramSelection({...device,type:'Hood'}),false);
  assert.equal(immediateProgramSelection({...device,roles:{program:device.roles.program}}),false);
});
test('duration respects selected program and falls back to HA estimate without inventing a value',()=>{
  const {device,hass}=context();const program=hass.states[device.roles.program].state;
  assert.equal(selectedProgramDuration(hass,device,program),'1 ч 8 мин');
  assert.equal(selectedProgramDuration(hass,device,'another'),'—');
  hass.states[device.roles.remaining].state='unknown';
  device.roles.estimated='sensor.estimate';
  hass.states['sensor.estimate']={state:'125',attributes:{unit_of_measurement:'min'}};
  assert.equal(selectedProgramDuration(hass,device,program),'2 ч 5 мин');
  hass.states['sensor.estimate'].state='unavailable';
  assert.equal(selectedProgramDuration(hass,device,program),'—');
});
