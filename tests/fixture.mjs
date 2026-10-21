export function fixture() {
  const devices=[
    {id:'dishwasher-device',name:'Bosch Dishwasher',manufacturer:'Bosch',model:'Dishwasher',model_id:'DEMO · Serie 6',identifiers:[['homeconnect_ws','123-456']]},
    {id:'oven-device',name:'Siemens Oven',manufacturer:'Siemens',model:'Oven',model_id:'DEMO · iQ700',identifiers:[['homeconnect_ws','222-333']]},
    {id:'washer-device',name:'Bosch Washer',manufacturer:'Bosch',model:'Washer',model_id:'DEMO · Serie 8',identifiers:[['homeconnect_ws','444-555']]},
  ];
  const registry=[],states={},calls=[];
  const add=(device_id,id,key,state,attrs={},extra={})=>{
    registry.push({entity_id:id,unique_id:`appliance-with-hyphens-${key}`,translation_key:key,platform:'homeconnect_ws',device_id,disabled_by:null,hidden_by:null,original_name:key,...extra});
    states[id]={entity_id:id,state,attributes:{friendly_name:key,...attrs},last_changed:'2026-10-21T09:00:00Z',last_updated:'2026-10-21T09:00:00Z'};
  };
  for(const [index,device] of devices.entries()) {
    const prefix=['kitchen','oven','washer'][index],type=['dishcare_dishwasher','cooking_oven','laundrycare_washer'][index];
    const options=index===0?['Eco50','Auto2','Intensiv70','Quick45','MachineCare']:index===1?['HotAir','TopBottomHeating','PizzaSetting','GrillLargeArea']:['Cotton','EasyCare','Mix','Wool'];
    const programs=options.map(name=>`${type}_program_${name.toLowerCase()}`);
    add(device.id,`select.${prefix}_choice_renamed`,'select_program',programs[0],{options:programs});
    add(device.id,`sensor.${prefix}_operation`,'sensor_operation_state',index===0?'run':'ready');
    add(device.id,`sensor.${prefix}_active`,'sensor_active_program',index===0?programs[0]:'unknown');
    add(device.id,`sensor.${prefix}_progress`,'sensor_program_progress',index===0?'42':'0',{unit_of_measurement:'%'});
    add(device.id,`sensor.${prefix}_time`,'sensor_remaining_program_time',index===0?'1.1333333333':'0',{unit_of_measurement:'h',device_class:'duration'});
    add(device.id,`binary_sensor.${prefix}_door`,'binary_sensor_door_state','off',{device_class:'door'});
    add(device.id,`binary_sensor.${prefix}_remote`,'binary_remote_start_allowed','on',{}, {entity_category:'diagnostic'});
    add(device.id,`switch.${prefix}_power`,'switch_power_state','on');
    add(device.id,`button.${prefix}_start`,'button_start_program',index===0?'unavailable':'unknown');
    add(device.id,`button.${prefix}_stop`,'button_abort_program',index===0?'unknown':'unavailable');
    add(device.id,`button.${prefix}_pause`,'button_pause_program',index===0?'unknown':'unavailable');
    add(device.id,`button.${prefix}_resume`,'button_resume_program','unavailable');
    if(index===0) {
      add(device.id,'switch.extra_dry','switch_extra_dry_option','off',{readonly:false});
      add(device.id,'switch.fast_mode','switch_vario_speed_plus','off',{readonly:false});
      add(device.id,'switch.hygiene_locked','switch_hygiene_plus','on',{readonly:true});
      add(device.id,'sensor.rinse_aid','sensor_rinse_aid','ok');
    }
    if(index===1) {
      add(device.id,'number.oven_temperature','number_oven_setpoint_temperature','180',{readonly:false,min:30,max:250,step:5,unit_of_measurement:'°C'});
      add(device.id,'light.oven_cavity','light_oven_cavity','on',{supported_color_modes:['brightness'],brightness:160});
    }
    if(index===2) {
      add(device.id,'select.washer_temp','select_washer_temperature','40',{readonly:false,options:['cold','30','40','60','90']});
      add(device.id,'number.washer_spin','number_spin_speed','1200',{readonly:false,min:0,max:1600,step:200,unit_of_measurement:'rpm'});
    }
    add(device.id,`switch.${prefix}_child_lock`,'switch_child_lock','off',{}, {entity_category:'config'});
  }
  const hass={states,connection:{connected:true,subscribeEvents:async()=>()=>{}},
    callWS:async message=>message.type==='config/entity_registry/list'?registry:message.type==='config/device_registry/list'?devices:Promise.reject(Error('Unexpected WS type')),
    callService:async (...args)=>{calls.push(args);},
    formatEntityState:state=>({on:'Включено',off:'Выключено',run:'Выполняется',ready:'Готов к работе',unknown:'Нет данных',unavailable:'Нет связи'}[state.state]||state.state),
  };
  return {hass,registry,devices,calls};
}
