export const INTEGRATION = 'homeconnect_ws';
export const VERSION = '0.1.6';
export const ROLES = {
  program:['select_program'], active:['sensor_active_program'], operation:['sensor_operation_state'],
  progress:['sensor_program_progress'], remaining:['sensor_remaining_program_time'], elapsed:['sensor_elapsed_program_time'],
  door:['sensor_door_state','binary_sensor_door_state'], remote:['binary_remote_start_allowed','binary_sensor_remote_start_allowed'],
  start:['button_start_program'], stop:['button_abort_program'], pause:['button_pause_program'], resume:['button_resume_program'],
  power:['switch_power_state','select_power_state'], estimated:['sensor_estimated_remaining_program_time'],
  startIn:['number_start_in'],finishIn:['number_finish_in'],
};
export const TYPE_NAMES = {Dishwasher:'Посудомоечная машина',Washer:'Стиральная машина',WashingMachine:'Стиральная машина',WasherDryer:'Стирально-сушильная машина',Dryer:'Сушильная машина',Oven:'Духовой шкаф',Hob:'Варочная панель',Hood:'Вытяжка',Fridge:'Холодильник',FridgeFreezer:'Холодильник',Refrigerator:'Холодильник',Freezer:'Морозильник',CoffeeMaker:'Кофемашина',CoffeeMachine:'Кофемашина'};
export const VALUE_NAMES = {on:'Включено',off:'Выключено',standby:'Ожидание',run:'Выполняется',ready:'Готов к работе',inactive:'Неактивен',pause:'Пауза',finished:'Завершено',delayedstart:'Отложенный запуск',delayed_start:'Отложенный запуск',actionrequired:'Требуется действие',action_required:'Требуется действие',error:'Ошибка',aborting:'Остановка',open:'Открыта',closed:'Закрыта',locked:'Заблокирована',present:'Активно',confirmed:'Подтверждено',unknown:'Нет данных',unavailable:'Нет связи',mains_off:'Выключено'};
export const KEY_LABELS = {select_program:'Программа',sensor_active_program:'Активная программа',sensor_operation_state:'Состояние',sensor_program_progress:'Прогресс',sensor_remaining_program_time:'Осталось времени',sensor_elapsed_program_time:'Прошло времени',sensor_door_state:'Дверца',binary_sensor_door_state:'Дверца',binary_remote_start_allowed:'Разрешён удалённый запуск',button_start_program:'Запустить',button_abort_program:'Остановить',button_pause_program:'Пауза',button_resume_program:'Продолжить',switch_power_state:'Питание',select_power_state:'Питание',switch_extra_dry_option:'Экстра сушка',switch_extra_dry:'Экстра сушка',switch_hygiene_plus:'Гигиена Плюс',switch_intensiv_zone:'Интенсивная зона',switch_vario_speed_plus:'VarioSpeed Plus',switch_half_load:'Половинная загрузка',switch_child_lock:'Блокировка от детей',number_start_in:'Отложенный запуск',number_finish_in:'Завершить через',number_oven_setpoint_temperature:'Температура духовки',sensor_oven_current_temperature:'Текущая температура',sensor_rinse_aid:'Ополаскиватель',sensor_salt:'Соль',switch_refrigeration_super_mode:'Суперрежим'};
export const PROGRAM_NAMES = {eco50:'Эко 50°',auto1:'Авто 35–45°',auto2:'Авто 45–65°',auto3:'Авто 65–75°',intensiv70:'Интенсивная 70°',quick45:'Быстрая 45°',quick65:'Быстрая 65°',prerinse:'Ополаскивание',machinecare:'Уход за машиной',cotton:'Хлопок',easycare:'Синтетика',mix:'Смешанное бельё',delicatessilk:'Деликатная / шёлк',wool:'Шерсть',hotair:'Горячий воздух',topbottomheating:'Верхний / нижний жар',pizzasetting:'Пицца',grilllargearea:'Большой гриль'};

export function entityDomain(id) { return String(id || '').split('.')[0]; }
export function entityKey(entry) {
  // The integration sets unique_id = deviceID + '-' + entity_description.key.
  const raw = String(entry?.unique_id || '').match(/-((?:binary(?:_sensor)?|sensor|select|number|switch|button|light|fan)_[A-Za-z0-9_.]+)$/)?.[1];
  return raw || entry?.translation_key || '';
}
export function isReadonly(state) { return state?.attributes?.readonly === true || state?.attributes?.readonly === 'true'; }
export function available(hass, id) {
  return !!id && hass?.connection?.connected !== false && !!hass?.states?.[id] && hass.states[id].state !== 'unavailable';
}
export function controllable(hass, id) {
  const state = hass?.states?.[id];
  if (!available(hass,id) || isReadonly(state)) return false;
  if (['switch','light','fan'].includes(entityDomain(id)) && !['on','off'].includes(state.state)) return false;
  return true;
}
export function shortProgram(raw) {
  if (raw == null || raw === '' || ['unknown','unavailable'].includes(raw)) return 'Не выбрана';
  const tail = String(raw).split(/[._]/).filter(Boolean).pop();
  return PROGRAM_NAMES[tail?.toLowerCase()] || (String(raw).includes('.') || String(raw).startsWith('dishcare_') || String(raw).startsWith('laundrycare_') || String(raw).startsWith('cooking_') ? tail.replace(/([a-z])([A-Z])/g,'$1 $2') : String(raw));
}
export function immediateProgramSelection(device,config={}) {
  if(config.program_selection==='confirm')return false;
  if(config.program_selection==='immediate')return true;
  // The legacy select API does not expose per-program Execution metadata.
  // Enable the requested dishwasher flow only with a separate start entity.
  return device?.type==='Dishwasher' && !!device.roles.start;
}
export function selectedProgramDuration(hass,device,program) {
  if(program!==hass.states[device.roles.program]?.state)return '—';
  for(const role of ['remaining','estimated']) {
    const state=hass.states[device.roles[role]];
    if(state && Number.isFinite(Number(state.state)) && Number(state.state)>0)return durationText(state);
  }
  return '—';
}
export function guessType(device, entries) {
  if (TYPE_NAMES[device?.model]) return device.model;
  const keys = entries.map(entityKey).join(' ');
  if (/oven/.test(keys)) return 'Oven';
  if (/hob/.test(keys)) return 'Hob';
  if (/hood|fan_/.test(keys)) return 'Hood';
  if (/washer/.test(keys)) return 'Washer';
  if (/dryer/.test(keys)) return 'Dryer';
  if (/refriger|freezer|fridge/.test(keys)) return 'Fridge';
  if (/coffee/.test(keys)) return 'CoffeeMaker';
  if (/vario_speed|rinse_aid|half_load|intensiv_zone/.test(keys)) return 'Dishwasher';
  return 'HomeAppliance';
}
export function buildDevices(hass, registry, devices, config={}) {
  const allowed = config.devices?.length ? new Set(config.devices) : null;
  const groups = new Map();
  for (const entry of registry || []) {
    if (entry.platform !== INTEGRATION || !entry.device_id || entry.disabled_by || (!config.show_hidden && entry.hidden_by)) continue;
    if (allowed && !allowed.has(entry.device_id)) continue;
    if (!groups.has(entry.device_id)) groups.set(entry.device_id, []);
    groups.get(entry.device_id).push({...entry,key:entityKey(entry)});
  }
  // Explicit entity mapping is also usable when a restricted HA account cannot list registries.
  for (const [id, overrides] of Object.entries(config.entities || {})) {
    if (allowed && !allowed.has(id)) continue;
    if (!groups.has(id)) groups.set(id,[]);
    for (const entityId of Object.values(overrides)) {
      if (!groups.get(id).some(e => e.entity_id === entityId)) {
        const registered = (registry || []).find(e => e.entity_id === entityId);
        if (registered && (registered.platform !== INTEGRATION || registered.device_id !== id || registered.disabled_by)) continue;
        groups.get(id).push(registered ? {...registered,key:entityKey(registered)} : {entity_id:entityId,device_id:id,platform:INTEGRATION,key:'',explicit:true});
      }
    }
  }
  const deviceMap = new Map((devices || []).map(d => [d.id,d]));
  return [...groups].map(([id, entries]) => {
    const info = deviceMap.get(id) || {};
    const type = config.appliance_types?.[id] || guessType(info,entries);
    const roles = {};
    for (const [role, keys] of Object.entries(ROLES)) {
      const override = config.entities?.[id]?.[role];
      if (override && entries.some(e=>e.entity_id===override)) roles[role]=override;
      else roles[role]=keys.map(key=>entries.find(e=>e.key===key)?.entity_id).find(Boolean);
    }
    const primary = roles.operation || roles.program || roles.power || entries.find(e=>!e.entity_category)?.entity_id;
    const live = primary ? available(hass,primary) : entries.some(e=>available(hass,e.entity_id));
    return {id,info,type,entries,roles,name:config.device_names?.[id] || info.name_by_user || TYPE_NAMES[type] || info.name || 'Прибор Home Connect',brand:info.manufacturer || 'Home Connect',model:info.model_id || (TYPE_NAMES[info.model]?'':info.model) || '',connected:live};
  }).sort((a,b) => (allowed ? config.devices.indexOf(a.id)-config.devices.indexOf(b.id) : a.name.localeCompare(b.name,'ru')));
}
export function entityLabel(hass, entry) {
  return entry?.name || KEY_LABELS[entry?.key || entityKey(entry)] || entry?.original_name || hass?.states?.[entry?.entity_id]?.attributes?.friendly_name || entry?.entity_id || '';
}
export function formatState(hass, id) {
  const state = hass?.states?.[id];
  if (!state) return '—';
  if (entityDomain(id)==='binary_sensor' && state.attributes.device_class==='door') return state.state==='on'?'Открыта':state.state==='off'?'Закрыта':VALUE_NAMES[state.state]||state.state;
  const localized = hass.formatEntityState?.(state);
  if (localized && localized !== state.state && state.attributes.device_class!=='duration') return localized;
  const raw=VALUE_NAMES[state.state.toLowerCase()] || state.state;
  return state.attributes.unit_of_measurement ? `${raw} ${state.attributes.unit_of_measurement}` : raw;
}
export function durationText(state) {
  if (!state || ['unknown','unavailable'].includes(state.state) || !Number.isFinite(Number(state.state))) return '—';
  const units={s:1,sec:1,seconds:1,min:60,minutes:60,h:3600,hr:3600,hours:3600};
  const unit=state.attributes.unit_of_measurement || 's';
  if (!units[unit]) return `${state.state} ${unit}`;
  const minutes=Math.max(0,Math.ceil(Number(state.state)*units[unit]/60));
  return minutes>=60 ? `${Math.floor(minutes/60)} ч ${minutes%60} мин` : `${minutes} мин`;
}
export function controlGroup(hass, entry, device) {
  if (Object.values(device.roles).includes(entry.entity_id)) return 'primary';
  const key=entry.key||entityKey(entry);
  if(device.roles.power && ROLES.power.includes(key))return 'primary';
  if((device.roles.startIn||device.roles.finishIn) && /^(?:number|select)_(?:start|finish)_in$/.test(key))return 'primary';
  const domain=entityDomain(entry.entity_id);
  if (['sensor','binary_sensor'].includes(domain)) return 'status';
  if (domain==='button') return 'commands';
  if (entry.entity_category==='config') return 'settings';
  // This fork always exposes readonly (even false) on protocol Option entities.
  if (Object.hasOwn(hass.states[entry.entity_id]?.attributes || {},'readonly')) return 'options';
  if (entry.entity_category==='diagnostic') return 'status';
  return 'settings';
}
export function validateConfig(config) {
  if (!config || typeof config !== 'object') throw Error('Нужна конфигурация карточки');
  if(config.program_selection && !['immediate','confirm'].includes(config.program_selection))throw Error('program_selection: immediate или confirm');
  if (config.devices && (!Array.isArray(config.devices) || config.devices.some(id=>typeof id!=='string'))) throw Error('devices — список device_id из Home Assistant');
  for (const field of ['entities','device_names','appliance_types']) if (config[field] && (typeof config[field]!=='object'||Array.isArray(config[field]))) throw Error(`${field} — объект`);
  for (const mappings of Object.values(config.entities || {})) {
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings) || Object.entries(mappings).some(([role,id])=>!ROLES[role] || typeof id!=='string' || !/^[a-z_]+\.[a-z0-9_]+$/.test(id))) throw Error('Неверная привязка entities: укажите роль и entity_id');
  }
  return {title:'Моя техника',show_summary:true,show_hidden:false,...config};
}
export function planAction(hass, device, action, entityId, value) {
  if (!device?.entries.some(e=>e.entity_id===entityId)) throw Error('Сущность не относится к этому прибору');
  if (!controllable(hass,entityId)) throw Error('Прибор или функция сейчас недоступны для управления');
  const domain=entityDomain(entityId), state=hass.states[entityId], attrs=state.attributes || {};
  const result=(service,data={})=>({domain,service,data,target:{entity_id:entityId}});
  if(action==='button' && domain==='button') {
    if(entityId===device.roles.start) {
      if (device.roles.program && !available(hass,device.roles.program)) throw Error('Выбор программы сейчас недоступен');
      if (device.roles.remote && hass.states[device.roles.remote]?.state!=='on') throw Error('Разрешите удалённый запуск на панели прибора');
    }
    return result('press');
  }
  if(action==='select' && domain==='select') {
    if (!Array.isArray(attrs.options)||!attrs.options.includes(value)) throw Error('Этот вариант больше не доступен');
    return result('select_option',{option:value});
  }
  if(action==='number' && domain==='number') {
    if (typeof value!=='number' || !Number.isFinite(value)) throw Error('Введите число');
    const {min,max,step}=attrs;
    if (min!=null&&value<min || max!=null&&value>max) throw Error('Значение вне допустимого диапазона');
    if (step>0&&min!=null&&Math.abs((value-min)/step-Math.round((value-min)/step))>1e-5) throw Error('Значение не соответствует шагу');
    return result('set_value',{value});
  }
  if(action==='toggle' && ['switch','light','fan'].includes(domain) && typeof value==='boolean') return result(value?'turn_on':'turn_off');
  if(action==='brightness' && domain==='light') {
    if (!(attrs.supported_color_modes || []).some(mode=>!['onoff','unknown'].includes(mode))) throw Error('Яркость не поддерживается');
    if(!Number.isInteger(value)||value<0||value>100) throw Error('Яркость должна быть от 0 до 100%');
    return result('turn_on',{brightness_pct:value});
  }
  if(action==='fan_percentage' && domain==='fan') {
    if (!(Number(attrs.supported_features)&1)) throw Error('Скорость не поддерживается');
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100) throw Error('Скорость должна быть от 0 до 100%');
    return result('set_percentage',{percentage:value});
  }
  if(action==='fan_preset' && domain==='fan' && attrs.preset_modes?.includes(value)) return result('set_preset_mode',{preset_mode:value});
  throw Error('Неподдерживаемое действие');
}
export async function callAction(hass, device, action, entityId, value) {
  const plan=planAction(hass,device,action,entityId,value);
  // One request, no retry and no offline queue. Device state is never changed optimistically.
  await hass.callService(plan.domain,plan.service,plan.data,plan.target);
  return plan;
}
