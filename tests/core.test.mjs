import test from 'node:test';
import assert from 'node:assert/strict';
import {entityKey,buildDevices,available,controllable,controlGroup,durationText,planAction,callAction,validateConfig} from '../src/core.mjs';
import {fixture} from './fixture.mjs';

function context(){const f=fixture();return {...f,models:buildDevices(f.hass,f.registry,f.devices)};}
test('discovers only Home Connect Local entities, independent of renamed entity_id',()=>{
  const f=fixture();f.registry.push({...f.registry[0],entity_id:'select.unrelated',platform:'home_connect',device_id:'cloud'});
  const result=buildDevices(f.hass,f.registry,f.devices);
  assert.equal(result.length,3);
  assert.equal(result.find(d=>d.id==='dishwasher-device').roles.program,'select.kitchen_choice_renamed');
  assert.equal(result.find(d=>d.id==='dishwasher-device').type,'Dishwasher');
});
test('unique_id suffix is used before custom translation keys',()=>{
  assert.equal(entityKey({unique_id:'123-456-789-binary_remote_start_allowed',translation_key:'other'}),'binary_remote_start_allowed');
  assert.equal(entityKey({translation_key:'select_program'}),'select_program');
});
test('disabled and hidden entities never become primary controls',()=>{
  const f=fixture();const entry=f.registry.find(e=>e.entity_id==='select.kitchen_choice_renamed');
  entry.disabled_by='user';
  let d=buildDevices(f.hass,f.registry,f.devices).find(d=>d.id==='dishwasher-device');
  assert.equal(d.roles.program,undefined);
  entry.disabled_by=null;entry.hidden_by='user';
  d=buildDevices(f.hass,f.registry,f.devices).find(d=>d.id==='dishwasher-device');assert.equal(d.roles.program,undefined);
  d=buildDevices(f.hass,f.registry,f.devices,{show_hidden:true}).find(d=>d.id==='dishwasher-device');assert.equal(d.roles.program,entry.entity_id);
});
test('device selection, custom naming and order use device IDs',()=>{
  const {hass,registry,devices}=fixture();
  const result=buildDevices(hass,registry,devices,{devices:['oven-device','dishwasher-device'],device_names:{'oven-device':'Моя духовка'}});
  assert.deepEqual(result.map(d=>d.id),['oven-device','dishwasher-device']);assert.equal(result[0].name,'Моя духовка');
});
test('button unknown is usable: HA buttons are unknown before their first press',()=>{
  const {hass,models}=context();const oven=models.find(d=>d.id==='oven-device');
  assert.equal(hass.states[oven.roles.start].state,'unknown');
  assert.equal(controllable(hass,oven.roles.start),true);
  assert.equal(planAction(hass,oven,'button',oven.roles.start).service,'press');
});
test('unknown current program does not prevent explicitly selecting a valid option',()=>{
  const {hass,models}=context();const d=models[0],id=d.roles.program;
  hass.states[id].state='unknown';const raw=hass.states[id].attributes.options[0];
  assert.equal(planAction(hass,d,'select',id,raw).data.option,raw);
});
test('readonly options and disconnected HA prevent all outgoing writes',async()=>{
  const {hass,models,calls}=context();const d=models.find(d=>d.id==='dishwasher-device');
  await assert.rejects(callAction(hass,d,'toggle','switch.hygiene_locked',false),/недоступны/);
  hass.connection.connected=false;
  await assert.rejects(callAction(hass,d,'toggle','switch.extra_dry',true),/недоступны/);
  assert.equal(calls.length,0);
});
test('unavailable control is rejected even when other device entities are online',()=>{
  const {hass,models}=context();const d=models.find(d=>d.id==='dishwasher-device');
  assert.equal(d.connected,true);assert.equal(available(hass,d.roles.start),false);
  assert.throws(()=>planAction(hass,d,'button',d.roles.start),/недоступны/);
});
test('program labels are never substituted into a select service payload',async()=>{
  const {hass,models,calls}=context();const d=models.find(d=>d.id==='dishwasher-device');
  await callAction(hass,d,'select',d.roles.program,'dishcare_dishwasher_program_auto2');
  assert.deepEqual(calls[0],['select','select_option',{option:'dishcare_dishwasher_program_auto2'},{entity_id:'select.kitchen_choice_renamed'}]);
  await assert.rejects(callAction(hass,d,'select',d.roles.program,'Авто 45–65°'),/не доступен/);
  assert.equal(calls.length,1);
});
test('numeric option bounds, finite values and step are checked using displayed HA units',()=>{
  const {hass,models}=context();const d=models.find(d=>d.id==='oven-device');
  assert.equal(planAction(hass,d,'number','number.oven_temperature',185).data.value,185);
  for(const bad of [181,26,260,NaN,Infinity,'180'])assert.throws(()=>planAction(hass,d,'number','number.oven_temperature',bad));
});
test('start respects Remote Start and uses button.press without guessed values',async()=>{
  const {hass,models,calls}=context();const d=models.find(d=>d.id==='oven-device');
  hass.states[d.roles.remote].state='off';await assert.rejects(callAction(hass,d,'button',d.roles.start),/панели/);
  hass.states[d.roles.remote].state='on';await callAction(hass,d,'button',d.roles.start);
  assert.deepEqual(calls,[['button','press',{}, {entity_id:'button.oven_start'}]]);
});
test('actions cannot target another appliance entity',()=>{
  const {hass,models}=context();const d=models.find(d=>d.id==='oven-device');
  assert.throws(()=>planAction(hass,d,'toggle','switch.extra_dry',true),/не относится/);
});
test('no optimistic state changes and no automatic retries on service errors',async()=>{
  const {hass,models}=context();const d=models.find(d=>d.id==='dishwasher-device');let calls=0;
  hass.callService=async()=>{calls++;throw Error('Timed out');};
  await assert.rejects(callAction(hass,d,'toggle','switch.extra_dry',true),/Timed out/);
  assert.equal(calls,1);assert.equal(hass.states['switch.extra_dry'].state,'off');
});
test('duration display honors h, min and s rather than assuming seconds',()=>{
  const make=(state,unit)=>({state,attributes:{unit_of_measurement:unit}});
  assert.equal(durationText(make('1.5','h')),'1 ч 30 мин');
  assert.equal(durationText(make('90','min')),'1 ч 30 мин');
  assert.equal(durationText(make('5400','s')),'1 ч 30 мин');
  assert.equal(durationText(make('unknown','h')),'—');
});
test('option/settings separation uses explicit readonly attribute and registry category',()=>{
  const {hass,models}=context();const d=models.find(d=>d.id==='dishwasher-device');
  assert.equal(controlGroup(hass,d.entries.find(e=>e.entity_id==='switch.extra_dry'),d),'options');
  assert.equal(controlGroup(hass,d.entries.find(e=>e.entity_id==='switch.kitchen_child_lock'),d),'settings');
});
test('manual overrides cannot steal registered entities from other devices or integrations',()=>{
  const {hass,registry,devices}=fixture();
  const result=buildDevices(hass,registry,devices,{entities:{'oven-device':{power:'switch.extra_dry'}}});
  assert.equal(result.find(d=>d.id==='oven-device').roles.power,'switch.oven_power');
});
test('explicit mappings work without registry permission, no name guessing',()=>{
  const {hass}=fixture();
  const models=buildDevices(hass,[],[],{entities:{custom:{power:'switch.extra_dry',program:'select.kitchen_choice_renamed'}},appliance_types:{custom:'Dishwasher'}});
  assert.equal(models[0].roles.program,'select.kitchen_choice_renamed');assert.equal(models[0].type,'Dishwasher');
});
test('light and fan controls use only HA supported capabilities',()=>{
  const {hass,models}=context();const d=models.find(d=>d.id==='oven-device');
  assert.deepEqual(planAction(hass,d,'brightness','light.oven_cavity',70),{domain:'light',service:'turn_on',data:{brightness_pct:70},target:{entity_id:'light.oven_cavity'}});
  assert.throws(()=>planAction(hass,d,'brightness','light.oven_cavity',110));
  d.entries.push({entity_id:'fan.hood'});hass.states['fan.hood']={state:'on',attributes:{supported_features:1,preset_modes:['auto']}};
  assert.equal(planAction(hass,d,'fan_percentage','fan.hood',50).service,'set_percentage');
  assert.equal(planAction(hass,d,'fan_preset','fan.hood','auto').data.preset_mode,'auto');
  assert.throws(()=>planAction(hass,d,'fan_preset','fan.hood','wrong'));
});
test('configuration shape is validated before rendering',()=>{
  assert.equal(validateConfig({type:'custom:homeconnect-control-card'}).title,'Моя техника');
  for(const config of [{devices:'device'},{devices:[42]},{entities:[]},{entities:{x:{program:'javascript:alert(1)'}}}])assert.throws(()=>validateConfig(config));
});
