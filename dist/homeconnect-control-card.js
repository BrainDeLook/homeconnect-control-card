// Home Connect Control Card 0.1.6 — local UI for Home Assistant.
// Integration remains responsible for all appliance communication.
const INTEGRATION = 'homeconnect_ws';
const VERSION = '0.1.6';
const ROLES = {
  program:['select_program'], active:['sensor_active_program'], operation:['sensor_operation_state'],
  progress:['sensor_program_progress'], remaining:['sensor_remaining_program_time'], elapsed:['sensor_elapsed_program_time'],
  door:['sensor_door_state','binary_sensor_door_state'], remote:['binary_remote_start_allowed','binary_sensor_remote_start_allowed'],
  start:['button_start_program'], stop:['button_abort_program'], pause:['button_pause_program'], resume:['button_resume_program'],
  power:['switch_power_state','select_power_state'], estimated:['sensor_estimated_remaining_program_time'],
  startIn:['number_start_in'],finishIn:['number_finish_in'],
};
const TYPE_NAMES = {Dishwasher:'Посудомоечная машина',Washer:'Стиральная машина',WashingMachine:'Стиральная машина',WasherDryer:'Стирально-сушильная машина',Dryer:'Сушильная машина',Oven:'Духовой шкаф',Hob:'Варочная панель',Hood:'Вытяжка',Fridge:'Холодильник',FridgeFreezer:'Холодильник',Refrigerator:'Холодильник',Freezer:'Морозильник',CoffeeMaker:'Кофемашина',CoffeeMachine:'Кофемашина'};
const VALUE_NAMES = {on:'Включено',off:'Выключено',standby:'Ожидание',run:'Выполняется',ready:'Готов к работе',inactive:'Неактивен',pause:'Пауза',finished:'Завершено',delayedstart:'Отложенный запуск',delayed_start:'Отложенный запуск',actionrequired:'Требуется действие',action_required:'Требуется действие',error:'Ошибка',aborting:'Остановка',open:'Открыта',closed:'Закрыта',locked:'Заблокирована',present:'Активно',confirmed:'Подтверждено',unknown:'Нет данных',unavailable:'Нет связи',mains_off:'Выключено'};
const KEY_LABELS = {select_program:'Программа',sensor_active_program:'Активная программа',sensor_operation_state:'Состояние',sensor_program_progress:'Прогресс',sensor_remaining_program_time:'Осталось времени',sensor_elapsed_program_time:'Прошло времени',sensor_door_state:'Дверца',binary_sensor_door_state:'Дверца',binary_remote_start_allowed:'Разрешён удалённый запуск',button_start_program:'Запустить',button_abort_program:'Остановить',button_pause_program:'Пауза',button_resume_program:'Продолжить',switch_power_state:'Питание',select_power_state:'Питание',switch_extra_dry_option:'Экстра сушка',switch_extra_dry:'Экстра сушка',switch_hygiene_plus:'Гигиена Плюс',switch_intensiv_zone:'Интенсивная зона',switch_vario_speed_plus:'VarioSpeed Plus',switch_half_load:'Половинная загрузка',switch_child_lock:'Блокировка от детей',number_start_in:'Отложенный запуск',number_finish_in:'Завершить через',number_oven_setpoint_temperature:'Температура духовки',sensor_oven_current_temperature:'Текущая температура',sensor_rinse_aid:'Ополаскиватель',sensor_salt:'Соль',switch_refrigeration_super_mode:'Суперрежим'};
const PROGRAM_NAMES = {eco50:'Эко 50°',auto1:'Авто 35–45°',auto2:'Авто 45–65°',auto3:'Авто 65–75°',intensiv70:'Интенсивная 70°',quick45:'Быстрая 45°',quick65:'Быстрая 65°',prerinse:'Ополаскивание',machinecare:'Уход за машиной',cotton:'Хлопок',easycare:'Синтетика',mix:'Смешанное бельё',delicatessilk:'Деликатная / шёлк',wool:'Шерсть',hotair:'Горячий воздух',topbottomheating:'Верхний / нижний жар',pizzasetting:'Пицца',grilllargearea:'Большой гриль'};

function entityDomain(id) { return String(id || '').split('.')[0]; }
function entityKey(entry) {
  // The integration sets unique_id = deviceID + '-' + entity_description.key.
  const raw = String(entry?.unique_id || '').match(/-((?:binary(?:_sensor)?|sensor|select|number|switch|button|light|fan)_[A-Za-z0-9_.]+)$/)?.[1];
  return raw || entry?.translation_key || '';
}
function isReadonly(state) { return state?.attributes?.readonly === true || state?.attributes?.readonly === 'true'; }
function available(hass, id) {
  return !!id && hass?.connection?.connected !== false && !!hass?.states?.[id] && hass.states[id].state !== 'unavailable';
}
function controllable(hass, id) {
  const state = hass?.states?.[id];
  if (!available(hass,id) || isReadonly(state)) return false;
  if (['switch','light','fan'].includes(entityDomain(id)) && !['on','off'].includes(state.state)) return false;
  return true;
}
function shortProgram(raw) {
  if (raw == null || raw === '' || ['unknown','unavailable'].includes(raw)) return 'Не выбрана';
  const tail = String(raw).split(/[._]/).filter(Boolean).pop();
  return PROGRAM_NAMES[tail?.toLowerCase()] || (String(raw).includes('.') || String(raw).startsWith('dishcare_') || String(raw).startsWith('laundrycare_') || String(raw).startsWith('cooking_') ? tail.replace(/([a-z])([A-Z])/g,'$1 $2') : String(raw));
}
function immediateProgramSelection(device,config={}) {
  if(config.program_selection==='confirm')return false;
  if(config.program_selection==='immediate')return true;
  // The legacy select API does not expose per-program Execution metadata.
  // Enable the requested dishwasher flow only with a separate start entity.
  return device?.type==='Dishwasher' && !!device.roles.start;
}
function selectedProgramDuration(hass,device,program) {
  if(program!==hass.states[device.roles.program]?.state)return '—';
  for(const role of ['remaining','estimated']) {
    const state=hass.states[device.roles[role]];
    if(state && Number.isFinite(Number(state.state)) && Number(state.state)>0)return durationText(state);
  }
  return '—';
}
function guessType(device, entries) {
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
function buildDevices(hass, registry, devices, config={}) {
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
function entityLabel(hass, entry) {
  return entry?.name || KEY_LABELS[entry?.key || entityKey(entry)] || entry?.original_name || hass?.states?.[entry?.entity_id]?.attributes?.friendly_name || entry?.entity_id || '';
}
function formatState(hass, id) {
  const state = hass?.states?.[id];
  if (!state) return '—';
  if (entityDomain(id)==='binary_sensor' && state.attributes.device_class==='door') return state.state==='on'?'Открыта':state.state==='off'?'Закрыта':VALUE_NAMES[state.state]||state.state;
  const localized = hass.formatEntityState?.(state);
  if (localized && localized !== state.state && state.attributes.device_class!=='duration') return localized;
  const raw=VALUE_NAMES[state.state.toLowerCase()] || state.state;
  return state.attributes.unit_of_measurement ? `${raw} ${state.attributes.unit_of_measurement}` : raw;
}
function durationText(state) {
  if (!state || ['unknown','unavailable'].includes(state.state) || !Number.isFinite(Number(state.state))) return '—';
  const units={s:1,sec:1,seconds:1,min:60,minutes:60,h:3600,hr:3600,hours:3600};
  const unit=state.attributes.unit_of_measurement || 's';
  if (!units[unit]) return `${state.state} ${unit}`;
  const minutes=Math.max(0,Math.ceil(Number(state.state)*units[unit]/60));
  return minutes>=60 ? `${Math.floor(minutes/60)} ч ${minutes%60} мин` : `${minutes} мин`;
}
function controlGroup(hass, entry, device) {
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
function validateConfig(config) {
  if (!config || typeof config !== 'object') throw Error('Нужна конфигурация карточки');
  if(config.program_selection && !['immediate','confirm'].includes(config.program_selection))throw Error('program_selection: immediate или confirm');
  if (config.devices && (!Array.isArray(config.devices) || config.devices.some(id=>typeof id!=='string'))) throw Error('devices — список device_id из Home Assistant');
  for (const field of ['entities','device_names','appliance_types']) if (config[field] && (typeof config[field]!=='object'||Array.isArray(config[field]))) throw Error(`${field} — объект`);
  for (const mappings of Object.values(config.entities || {})) {
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings) || Object.entries(mappings).some(([role,id])=>!ROLES[role] || typeof id!=='string' || !/^[a-z_]+\.[a-z0-9_]+$/.test(id))) throw Error('Неверная привязка entities: укажите роль и entity_id');
  }
  return {title:'Моя техника',show_summary:true,show_hidden:false,...config};
}
function planAction(hass, device, action, entityId, value) {
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
async function callAction(hass, device, action, entityId, value) {
  const plan=planAction(hass,device,action,entityId,value);
  // One request, no retry and no offline queue. Device state is never changed optimistically.
  await hass.callService(plan.domain,plan.service,plan.data,plan.target);
  return plan;
}


const UNITS={s:1,sec:1,seconds:1,min:60,minutes:60,h:3600,hr:3600,hours:3600};
function secondsFromState(state){
  const unit=UNITS[state?.attributes?.unit_of_measurement||'s'];
  const n=Number(state?.state);
  return unit && state?.state!=='' && Number.isFinite(n) && n>0?n*unit:null;
}
function programSeconds(hass,device){
  for(const role of ['remaining','estimated']) {
    const seconds=secondsFromState(hass.states[device.roles[role]]);
    if(seconds!==null)return seconds;
  }
  return null;
}
function scheduleRange(hass,device,mode='finish'){
  const id=device.roles[mode==='finish'?'finishIn':'startIn'];
  if(!id||!controllable(hass,id))return {error:mode==='finish'?'Завершение ко времени недоступно в интеграции.':'Отложенный старт недоступен в интеграции.'};
  const attrs=hass.states[id].attributes||{},unit=UNITS[attrs.unit_of_measurement||'s'];
  if(!unit)return {error:'Неизвестная единица времени отложенного запуска.'};
  const min=Number(attrs.min),max=Number(attrs.max),step=Number(attrs.step||1);
  if(!Number.isFinite(min)||!Number.isFinite(max)||!Number.isFinite(step)||step<=0||max<min)return {error:'Интеграция не передала допустимый диапазон времени.'};
  const duration=programSeconds(hass,device);
  if(duration===null)return {error:'Для расчёта начала и окончания нужна длительность выбранной программы от прибора.'};
  const floor=mode==='finish'?Math.max(min,duration/unit):Math.max(min,0);
  const lower=min+Math.ceil((floor-min)/step-1e-9)*step;
  // Limit this control to the next 48 hours; preserve the appliance's step grid.
  const upper=min+Math.floor((Math.min(max,172800/unit)-min)/step+1e-9)*step;
  if(lower>upper)return {error:'Длительность программы выходит за доступный диапазон таймера.'};
  const sliderStep=step*Math.max(1,Math.ceil(900/(unit*step)));
  const sliderMax=lower+Math.floor((upper-lower)/sliderStep+1e-9)*sliderStep;
  return {id,mode,unit,min,max,step,lower,upper,sliderStep,sliderMax,duration};
}
function schedulePreview(hass,device,draft,now=Date.now()){
  const range=scheduleRange(hass,device,draft.mode);
  if(range.error)return range;
  const base=draft.base??now;
  const value=Number(draft.value??range.lower);
  const target=base+value*range.unit*1000;
  const start=draft.mode==='finish'?target-range.duration*1000:target;
  const end=draft.mode==='finish'?target:target+range.duration*1000;
  return {...range,value,start,end,target};
}
function planScheduledStart(hass,device,draft,now=Date.now()){
  if(!['start','finish'].includes(draft.mode))throw Error('Неизвестный режим таймера.');
  // Revalidate the same start, ownership, Remote Start and availability guards.
  planAction(hass,device,'button',device.roles.start);
  if(!hass.services?.homeconnect_ws?.start_program)throw Error('Действие homeconnect_ws.start_program недоступно.');
  const operation=hass.states[device.roles.operation]?.state;
  if(!['ready','inactive'].includes(operation))throw Error('Отложенный запуск доступен, когда прибор готов и программа ещё не выполняется.');
  const actual=hass.states[device.roles.program]?.state;
  if(!actual||['unknown','unavailable'].includes(actual)||actual!==draft.program)throw Error('Программа изменилась. Выберите время заново.');
  const preview=schedulePreview(hass,device,draft,now);
  if(preview.error)throw Error(preview.error);
  if(!Number.isFinite(preview.value)||preview.value<preview.lower||preview.value>preview.upper||Math.abs((preview.value-preview.min)/preview.step-Math.round((preview.value-preview.min)/preview.step))>1e-5)throw Error('Выбранное время вне диапазона прибора.');
  const relative=(preview.target-now)/1000/preview.unit;
  // Round up on the native grid: never start/finish earlier than requested.
  const value=preview.min+Math.ceil((relative-preview.min)/preview.step-1e-9)*preview.step;
  const minimum=draft.mode==='finish'?Math.max(preview.min,preview.duration/preview.unit):Math.max(0,preview.min);
  if(value<minimum||value>preview.max)throw Error('Выбранное время уже слишком близко или прошло. Передвиньте ползунок.');
  const seconds=Math.round(value*preview.unit);
  if(seconds<0||seconds>172800)throw Error('Выберите время в пределах следующих 48 часов.');
  return {domain:'homeconnect_ws',service:'start_program',data:{device_id:device.id,[draft.mode==='finish'?'finish_in':'start_in']:{seconds}},target:{}};
}

// Update existing nodes so HA's scroll container never sees an empty card.
function renderKey(node){
  if(node.nodeType!==1)return String(node.nodeType);
  for(const name of ['id','data-device','data-fav-device','data-program','data-role','data-input','data-toggle','data-save','data-extra-input','data-extra-save','data-button','data-page','data-tab','data-schedule-mode']){
    if(node.hasAttribute(name))return `${node.nodeName}:${name}:${node.getAttribute(name)}:${node.getAttribute('data-kind')||''}`;
  }
  if(node.nodeName==='OPTION')return `OPTION:${node.getAttribute('value')}`;
  return `${node.nodeName}:${[...node.classList].filter(c=>!['on','selected','active','saved','disabled','error'].includes(c)).join('.')}`;
}
function syncNode(current,next){
  if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
  for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
  for(const attr of next.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
  patchChildren(current,next);
  const focused=current.getRootNode().activeElement===current;
  if(['INPUT','TEXTAREA','SELECT'].includes(current.nodeName)&&(!focused||current.type==='range')&&current.value!==next.value)current.value=next.value;
  if(current.nodeName==='INPUT'&&current.checked!==next.checked)current.checked=next.checked;
}
function patchChildren(parent,next){
  const old=[...parent.childNodes],used=new Set();
  let index=0;
  for(const child of next.childNodes){
    const key=renderKey(child);
    const current=old.find(node=>!used.has(node)&&node.nodeType===child.nodeType&&node.nodeName===child.nodeName&&renderKey(node)===key);
    const result=current||child.cloneNode(true);
    if(current){used.add(current);syncNode(current,child);}
    if(parent.childNodes[index]!==result)parent.insertBefore(result,parent.childNodes[index]||null);
    index++;
  }
  for(const child of old)if(!used.has(child)&&child.parentNode===parent)parent.removeChild(child);
}
function updateCardDOM(root,html){
  const template=root.ownerDocument.createElement('template');template.innerHTML=html;
  // Preserve HA scrollers across shadow roots, as well as the page scroller.
  const positions=[];const seen=new Set();let node=root.host;
  while(node){
    if(!seen.has(node)){seen.add(node);positions.push([node,node.scrollLeft,node.scrollTop]);}
    node=node.parentElement||node.getRootNode()?.host;
  }
  const page=root.ownerDocument.scrollingElement;
  if(page&&!seen.has(page))positions.push([page,page.scrollLeft,page.scrollTop]);
  patchChildren(root,template.content);
  for(const [element,left,top] of positions){
    if(element.scrollLeft!==left)element.scrollLeft=left;
    if(element.scrollTop!==top)element.scrollTop=top;
  }
}

const SCHEDULE_CSS = `
.body{padding:16px 18px}.back{margin-bottom:10px}.page-heading{margin-bottom:14px}.device-head{margin-bottom:10px}.device-head h1{font-size:22px;margin:4px 0}.device-head p,.device-head .eyebrow{display:none}.hero{display:block;margin-bottom:12px}.hero-art{display:none}.live{padding:12px 16px}.live-top,.live-note{display:none}.live-center{gap:16px;padding:0}.ring{width:58px;height:58px;padding:3px}.ring strong svg{width:20px;height:20px}.ring span{display:none}.ring strong{font-size:16px}.ring small{font-size:10px}.live-program{display:flex;align-items:center;gap:18px;flex:1;flex-wrap:wrap}.live-program>.muted{display:inline-block;font-size:11px;color:var(--hc-accent);max-width:100%}.live-program h2{font-size:16px;margin:0;flex:1}.metrics{margin:0;gap:18px}.metrics strong{font-size:13px}.metrics svg{width:17px;height:17px}.tabs{margin-bottom:12px}.tabs button{padding:10px 13px;font-size:12px}.program-layout{grid-template-columns:minmax(240px,.8fr) minmax(0,1.4fr);gap:14px}.panel-title{padding:12px 16px}.panel-title h2{font-size:13px}.pad{padding:12px 16px}.control-row{padding:11px 16px;min-height:48px;gap:10px}.control-name label{font-size:12px}.control-name small{margin-top:3px}.program-row>button:first-child{padding:10px 14px;gap:10px}.program-row small{margin-top:2px}.program-row .program-glyph{width:29px;height:29px}.program-row .favorite{padding:10px}.button{padding:11px 14px;font-size:12px;min-height:40px}.hint{line-height:1.55;margin:6px 0 10px}.footer{padding:8px}.footer button{padding:6px 12px}.main-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.main-controls .control-row{min-width:0;padding:10px 12px}.main-controls .control-name{min-width:0}.main-controls .control-name label{overflow-wrap:anywhere}.program-mobile{display:none}.schedule-box{margin:10px 0 12px!important;padding:12px!important}.schedule-modes{margin:12px 0!important}.schedule-times{padding-bottom:10px!important}.schedule-track{padding-bottom:12px!important}
@media(max-width:700px){.program-layout>section:nth-child(2)>.panel-title{display:none}.hero .ring,.hero .live-program h2{display:none}.hero .live-program{display:flex;flex-wrap:nowrap;justify-content:space-between}.hero .metrics{gap:10px}.hero .live-program>.muted{max-width:85px}.hero .live-center{min-height:50px}.main-controls{display:block}.body{padding:12px}.program-layout{grid-template-columns:minmax(0,1fr);gap:10px}.program-desktop{display:none}.program-mobile{display:block;padding:10px 12px}.program-mobile select{width:100%;max-width:100%;font:inherit;font-size:14px;min-height:44px;padding:8px 12px;color:var(--hc-ink);background:var(--hc-surface);border:1px solid var(--hc-line);border-radius:8px}.hero{margin-bottom:10px}.live{padding:10px 12px}.live-center{gap:10px}.live-program{gap:8px}.live-program h2{font-size:14px;flex-basis:100%}.metrics{gap:14px}.metrics strong{font-size:12px}.ring{width:48px;height:48px}.device-head h1{font-size:19px}.tabs button{padding:9px 10px;font-size:11px}.control-row{padding:10px 12px}.control-name label{font-size:12px}.control-end{gap:7px}.control-row input[type=number]{width:78px}.panel-title{padding:10px 12px}.pad{padding:10px 12px}.schedule-heading strong{font-size:13px}.footer button{font-size:10px}.metrics>div{gap:6px}}

.compact-refresh{display:inline-flex!important;position:static!important;vertical-align:middle;margin:0 0 4px 10px!important;width:32px!important;height:32px!important;padding:7px!important}.page-heading h1{display:inline-block}.schedule-box{border:1px solid var(--hc-line);border-radius:14px;padding:18px;margin:14px 0 20px;background:var(--hc-surface)}.schedule-heading{display:flex;align-items:center;gap:16px;justify-content:space-between}.schedule-heading strong{font-size:14px}.schedule-heading p{font-size:11px;color:var(--hc-muted);margin:6px 0;line-height:1.5}.schedule-heading .toggle{flex-shrink:0}.schedule-modes{display:flex;gap:6px;background:var(--hc-bg);padding:5px;border-radius:10px;margin:20px 0}.schedule-modes button{flex:1;padding:11px 6px;background:transparent;border:0;border-radius:7px;color:var(--hc-muted);font:inherit;font-size:12px;cursor:pointer}.schedule-modes button.active{background:var(--hc-surface);color:var(--hc-accent);box-shadow:0 1px 5px #0001}.schedule-times{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0 15px}.schedule-times>div{display:flex;flex-direction:column;gap:7px}.schedule-times>div:last-child{text-align:right}.schedule-times span{font-size:11px;color:var(--hc-muted)}.schedule-times strong{font-size:17px;line-height:1.4}.schedule-arrow{font-size:22px!important;color:var(--hc-accent)!important}.schedule-track{display:flex;align-items:center;gap:9px;color:var(--hc-muted);font-size:10px;padding:0 0 18px}.schedule-track i{height:5px;flex:1;border-radius:5px;background:linear-gradient(90deg,var(--hc-line) 35%,var(--hc-accent) 35%)}.schedule-slider-label{display:block;font-size:11px;color:var(--hc-muted)}input.schedule-slider{display:block!important;appearance:auto!important;accent-color:var(--hc-accent);width:100%!important;min-width:0!important;height:28px!important;margin:10px 0 0!important;padding:0!important;border:0!important;cursor:ew-resize;background:transparent!important}.schedule-range{display:flex;justify-content:space-between;color:var(--hc-muted);font-size:10px;margin:3px 0 12px}.schedule-box .hint{margin:10px 0 0}.schedule-modes button:disabled{opacity:.35;cursor:default}@media(max-width:600px){.schedule-box{padding:14px}.schedule-times strong{font-size:14px}.schedule-times span{font-size:10px}.schedule-track{gap:6px}.schedule-heading p{font-size:10px}}
.hint:empty{display:none}.schedule-heading p{display:none}.schedule-modes{padding:3px;margin:8px 0!important}.schedule-modes button{padding:7px 5px}.schedule-times{padding:5px 0 7px!important}.schedule-times strong{font-size:15px}.schedule-times>div{gap:3px}.schedule-track{padding-bottom:7px!important}.schedule-slider-label{font-size:10px}input.schedule-slider{height:23px!important;margin:3px 0 0!important}.schedule-range{margin:0 0 5px}.schedule-box .hint{font-size:10px;line-height:1.4;margin:5px 0 0}.schedule-box{border-radius:10px}
:host{container-type:inline-size}@container(max-width:700px){.program-layout>section:nth-child(2)>.panel-title{display:none}.hero .ring,.hero .live-program h2{display:none}.hero .live-program{display:flex;flex-wrap:nowrap;justify-content:space-between}.hero .metrics{gap:10px}.hero .live-program>.muted{max-width:85px}.hero .live-center{min-height:50px}.main-controls{display:block}.body{padding:12px}.program-layout{grid-template-columns:minmax(0,1fr);gap:10px}.program-desktop{display:none}.program-mobile{display:block;padding:10px 12px}.program-mobile select{width:100%;max-width:100%;font:inherit;font-size:14px;min-height:44px;padding:8px 12px;color:var(--hc-ink);background:var(--hc-surface);border:1px solid var(--hc-line);border-radius:8px}.hero{margin-bottom:10px}.live{padding:10px 12px}.live-center{gap:10px}.live-program{gap:8px}.live-program h2{font-size:14px;flex-basis:100%}.metrics{gap:14px}.metrics strong{font-size:12px}.ring{width:48px;height:48px}.device-head h1{font-size:19px}.tabs button{padding:9px 10px;font-size:11px}.control-row{padding:10px 12px}.control-name label{font-size:12px}.control-end{gap:7px}.control-row input[type=number]{width:78px}.panel-title{padding:10px 12px}.pad{padding:10px 12px}.schedule-heading strong{font-size:13px}.footer button{font-size:10px}.metrics>div{gap:6px}}
.ordered-controls .program-choice{grid-column:1;grid-row:1 / span 2}.ordered-controls .program-parameters{grid-column:2;grid-row:1}.ordered-controls .program-order{grid-column:2;grid-row:2}.ordered-controls>section.panel>.panel-title{display:flex!important}.program-duration{display:flex;gap:8px;align-items:center;padding:12px 14px;font-size:12px;color:var(--hc-muted);border-top:1px solid var(--hc-line)}.program-duration svg{width:18px;height:18px}.program-duration strong{color:var(--hc-ink);margin-left:6px}.order-program{display:flex;justify-content:space-between;gap:12px;font-size:14px;margin-bottom:12px}.order-program>span{white-space:nowrap;color:var(--hc-muted);font-size:12px}.order-options{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.order-options>span{padding:5px 8px;background:var(--hc-surface);background:color-mix(in srgb,var(--hc-accent) 12%,var(--hc-surface));color:var(--hc-ink);border:1px solid var(--hc-line);border-radius:6px;font-size:11px}.order-time{display:flex;flex-wrap:wrap;gap:5px 18px;font-size:11px;color:var(--hc-muted);line-height:1.6;margin-bottom:14px}.extra-settings summary{padding:12px 14px;cursor:pointer;font-size:12px;color:var(--hc-muted);border-top:1px solid var(--hc-line)}.program-parameters .schedule-box{margin:0!important}.program-parameters .pad{padding-bottom:12px}.program-order .schedule-times{margin-bottom:8px}.program-order{min-width:0}@media(max-width:700px){.ordered-controls>section{grid-column:1!important;grid-row:auto!important}.order-program{font-size:13px}.program-duration{padding:10px 12px}}@container(max-width:700px){.ordered-controls>section{grid-column:1!important;grid-row:auto!important}.order-program{font-size:13px}.program-duration{padding:10px 12px}}
@media(max-width:700px){.hero.idle{display:none}}@container(max-width:700px){.hero.idle{display:none}}
@media(max-width:700px){
.frame{--hc-accent:#347fe2;--hc-soft:color-mix(in srgb,var(--hc-accent) 10%,var(--hc-surface))}.body{padding:16px}.panel{border-radius:16px;box-shadow:0 2px 8px #142d4b08}.ordered-controls .panel-title{padding:15px 16px}.ordered-controls .panel-title h2{font-size:18px;line-height:1.35;font-weight:650}.program-mobile{padding:12px 14px}.program-mobile select{font-size:17px;min-height:52px;border-radius:12px;padding:12px}.program-duration{font-size:15px;padding:12px 16px;line-height:1.5}.program-duration strong{font-size:16px}.control-row,.main-controls .control-row{padding:13px 16px;min-height:68px}.control-name label,.main-controls .control-name label{font-size:16px;line-height:1.4;font-weight:550}.control-name small{font-size:13px;line-height:1.45}.control-name{min-width:0}.control-end{flex-shrink:0}.control-row .more{font-size:22px;min-width:40px;min-height:44px}.control-row input[type=number],.control-row select{font-size:16px;min-height:46px}.toggle{width:58px;height:44px;border-radius:22px;touch-action:manipulation;background:color-mix(in srgb,var(--hc-muted) 55%,var(--hc-surface))}.toggle:before{width:28px;height:28px;top:8px;left:5px}.toggle.on:before{left:25px}.toggle:disabled{opacity:.55}.schedule-heading strong{font-size:16px;line-height:1.4}.schedule-box{padding:14px!important;border-radius:12px;background:var(--hc-bg)}.schedule-heading{gap:12px}.schedule-modes{gap:4px;margin:12px 0!important}.schedule-modes button{font-size:15px;min-height:46px;padding:10px 6px}.schedule-times strong{font-size:17px;line-height:1.4}.schedule-times span{font-size:13px}.schedule-slider-label{font-size:14px;line-height:1.5}input.schedule-slider{height:44px!important;margin-top:6px!important;touch-action:pan-y}.schedule-range{font-size:12px;line-height:1.5}.schedule-box .hint{font-size:13px;line-height:1.5}.order-program{font-size:18px;line-height:1.4}.order-program>span{font-size:15px}.order-options>span{font-size:14px;padding:7px 10px;line-height:1.35}.order-time{font-size:14px;line-height:1.6}.ordered-controls .button{font-size:16px;min-height:52px;border-radius:12px;line-height:1.3}.program-order .button.primary{font-size:18px;font-weight:650;background:var(--hc-accent);box-shadow:0 3px 9px #347fe224}.hint,.notice{font-size:14px;line-height:1.5}.extra-settings summary{font-size:15px;min-height:48px;padding:14px 16px}.tabs button{font-size:14px;min-height:46px;padding:11px 10px}.footer button{font-size:13px;min-height:48px}.device-head h1{font-size:22px;line-height:1.3}.device-head .button{min-width:48px;min-height:48px}.program-order .pad{padding:16px}.program-order .actions{gap:10px}.hero:not(.idle) .live{background:linear-gradient(115deg,#224870,#347fe2);color:#fff;border:0;border-radius:16px;padding:16px}.hero:not(.idle) .live-program{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}.hero:not(.idle) .live-program>.muted{grid-column:1 / -1;max-width:none;color:#fff;font-size:14px}.hero:not(.idle) .live-program h2{display:block;font-size:19px;color:#fff;margin:0}.hero:not(.idle) .metrics{gap:6px;margin:0}.hero:not(.idle) .metrics strong{font-size:22px;color:#fff;line-height:1.4}.hero:not(.idle) .metrics span{color:#e8f1ff;font-size:13px}.hero:not(.idle) .metrics>div:nth-child(2){display:none}.hero:not(.idle) .metrics svg{display:none}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--hc-accent);outline-offset:3px}
}@container(max-width:700px){
.frame{--hc-accent:#347fe2;--hc-soft:color-mix(in srgb,var(--hc-accent) 10%,var(--hc-surface))}.body{padding:16px}.panel{border-radius:16px;box-shadow:0 2px 8px #142d4b08}.ordered-controls .panel-title{padding:15px 16px}.ordered-controls .panel-title h2{font-size:18px;line-height:1.35;font-weight:650}.program-mobile{padding:12px 14px}.program-mobile select{font-size:17px;min-height:52px;border-radius:12px;padding:12px}.program-duration{font-size:15px;padding:12px 16px;line-height:1.5}.program-duration strong{font-size:16px}.control-row,.main-controls .control-row{padding:13px 16px;min-height:68px}.control-name label,.main-controls .control-name label{font-size:16px;line-height:1.4;font-weight:550}.control-name small{font-size:13px;line-height:1.45}.control-name{min-width:0}.control-end{flex-shrink:0}.control-row .more{font-size:22px;min-width:40px;min-height:44px}.control-row input[type=number],.control-row select{font-size:16px;min-height:46px}.toggle{width:58px;height:44px;border-radius:22px;touch-action:manipulation;background:color-mix(in srgb,var(--hc-muted) 55%,var(--hc-surface))}.toggle:before{width:28px;height:28px;top:8px;left:5px}.toggle.on:before{left:25px}.toggle:disabled{opacity:.55}.schedule-heading strong{font-size:16px;line-height:1.4}.schedule-box{padding:14px!important;border-radius:12px;background:var(--hc-bg)}.schedule-heading{gap:12px}.schedule-modes{gap:4px;margin:12px 0!important}.schedule-modes button{font-size:15px;min-height:46px;padding:10px 6px}.schedule-times strong{font-size:17px;line-height:1.4}.schedule-times span{font-size:13px}.schedule-slider-label{font-size:14px;line-height:1.5}input.schedule-slider{height:44px!important;margin-top:6px!important;touch-action:pan-y}.schedule-range{font-size:12px;line-height:1.5}.schedule-box .hint{font-size:13px;line-height:1.5}.order-program{font-size:18px;line-height:1.4}.order-program>span{font-size:15px}.order-options>span{font-size:14px;padding:7px 10px;line-height:1.35}.order-time{font-size:14px;line-height:1.6}.ordered-controls .button{font-size:16px;min-height:52px;border-radius:12px;line-height:1.3}.program-order .button.primary{font-size:18px;font-weight:650;background:var(--hc-accent);box-shadow:0 3px 9px #347fe224}.hint,.notice{font-size:14px;line-height:1.5}.extra-settings summary{font-size:15px;min-height:48px;padding:14px 16px}.tabs button{font-size:14px;min-height:46px;padding:11px 10px}.footer button{font-size:13px;min-height:48px}.device-head h1{font-size:22px;line-height:1.3}.device-head .button{min-width:48px;min-height:48px}.program-order .pad{padding:16px}.program-order .actions{gap:10px}.hero:not(.idle) .live{background:linear-gradient(115deg,#224870,#347fe2);color:#fff;border:0;border-radius:16px;padding:16px}.hero:not(.idle) .live-program{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center}.hero:not(.idle) .live-program>.muted{grid-column:1 / -1;max-width:none;color:#fff;font-size:14px}.hero:not(.idle) .live-program h2{display:block;font-size:19px;color:#fff;margin:0}.hero:not(.idle) .metrics{gap:6px;margin:0}.hero:not(.idle) .metrics strong{font-size:22px;color:#fff;line-height:1.4}.hero:not(.idle) .metrics span{color:#e8f1ff;font-size:13px}.hero:not(.idle) .metrics>div:nth-child(2){display:none}.hero:not(.idle) .metrics svg{display:none}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--hc-accent);outline-offset:3px}
}
@media(max-width:700px){.device-head .compact-refresh{display:none!important}.device-head h1{font-size:20px}.tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0}.tabs button{min-width:0;padding:12px 3px;font-size:14px;text-align:center}}@container(max-width:700px){.device-head .compact-refresh{display:none!important}.device-head h1{font-size:20px}.tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0}.tabs button{min-width:0;padding:12px 3px;font-size:14px;text-align:center}}
`;
const icons = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  settings:'<path d="m9 3-.7 3-2.7 1L3 6l-2 4 2.5 2L3 15l-1 2 3 3 3-1 3 .5 1 2.5 4-1 .2-3 2.3-2 3 .5 1-4-2.7-1.5-1-3 1-2.5-3-2-2 2-3-.5L13 3Z" transform="translate(1 0) scale(.9)"/><circle cx="12" cy="12" r="3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>', back:'<path d="m15 5-7 7 7 7"/>',
  wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0"/><circle cx="12" cy="19" r=".8"/>',
  shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  star:'<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1 6.4-5.6-3-5.6 3 1-6.4-4.6-4.5 6.4-.9Z"/>',
  play:'<path d="m8 4 12 8-12 8Z"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  power:'<path d="M12 2v10M6 5a9 9 0 1 0 12 0"/>',
  check:'<path d="m5 12 4 4L20 5"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>', download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  link:'<path d="m10 13 4-4m-7 6-2 2a3 3 0 0 0 4 4l5-5a3 3 0 0 0 0-4m-4 0a3 3 0 0 0 0-4l5-5a3 3 0 0 1 4 4l-2 2"/>'
};
function esc(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const CSS = `
:host{display:block;container-type:inline-size;--hc-accent:#009eb4;--hc-soft:#eaf6f8;--hc-ink:var(--primary-text-color,#243f50);--hc-muted:var(--secondary-text-color,#8399a7);--hc-surface:var(--ha-card-background,var(--card-background-color,#fff));--hc-bg:var(--primary-background-color,#f4f7f9);--hc-line:var(--divider-color,#e4ebef);color:var(--hc-ink);font-family:var(--paper-font-body1_-_font-family,"Segoe UI",Arial,sans-serif)}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;color:inherit}button:disabled,input:disabled,select:disabled{opacity:.4;cursor:not-allowed}button:focus-visible,a:focus-visible{outline:3px solid var(--hc-accent);outline-offset:3px}button,input,select,a{-webkit-tap-highlight-color:transparent}ha-card{display:block;border-radius:var(--ha-card-border-radius,16px);overflow:hidden;background:var(--hc-bg);color:var(--hc-ink)}.frame{min-height:360px}.icon{width:21px;height:21px;vertical-align:middle;flex-shrink:0}.brandbar{padding:24px 28px;background:var(--hc-surface);border-bottom:1px solid var(--hc-line);display:flex;align-items:center;gap:15px}.brand{display:flex;align-items:center;gap:10px;font-size:20px;letter-spacing:-.7px;font-weight:600}.brand>svg{color:var(--hc-accent);width:26px;height:26px}.brand small{font-size:8px;letter-spacing:1.5px;color:var(--hc-accent);margin-left:4px;font-weight:700}.local-pill{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:10px;color:var(--hc-muted)}.local-pill .icon{color:var(--hc-accent);width:16px;height:16px}.refresh{border:0;background:none;padding:7px;color:var(--hc-muted);display:grid;place-items:center}.refresh .icon{width:18px;height:18px}.body{padding:30px 28px}.page-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:27px}h1{font-size:29px;letter-spacing:-1px;font-weight:650;line-height:1.2;margin:8px 0 10px}h2{font-size:16px;letter-spacing:-.3px;font-weight:600;margin:0}h3{font-size:15px;letter-spacing:-.2px;font-weight:600;margin:0}.eyebrow{color:var(--hc-accent);font-size:9px;font-weight:650;letter-spacing:1.8px}.page-heading p{font-size:12px;color:var(--hc-muted);margin:0;line-height:1.7}p{font-size:12px;line-height:1.8}.button{display:inline-flex;gap:8px;align-items:center;justify-content:center;text-decoration:none;border:1px solid transparent;border-radius:8px;padding:12px 16px;min-height:42px;font-size:12px;font-weight:600;color:var(--hc-ink);background:var(--hc-surface)}.button .icon{width:17px;height:17px}.button.primary{background:var(--hc-accent);color:#fff}.button.secondary{border-color:var(--hc-line)}.button.danger{color:#bc665b;border-color:#bc665b44}.button.compact{padding:8px 12px;min-height:34px;font-size:11px}.button.wide{width:100%}.button.ghost{background:none;color:var(--hc-muted)}.summary{display:flex;gap:25px;align-items:center;background:var(--hc-surface);border:1px solid var(--hc-line);border-radius:10px;padding:18px 22px;margin-bottom:29px}.summary>span{display:flex;gap:9px;align-items:center;font-size:11px;color:var(--hc-muted)}.summary strong{font-size:16px;color:var(--hc-ink);font-weight:550}.summary .icon{width:18px;height:18px;color:#89a5b4}.summary .local-summary{margin-left:auto;font-size:10px;color:#6f9992}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.grid.single{grid-template-columns:minmax(0,420px)}.device-card{background:var(--hc-surface);border:1px solid var(--hc-line);border-radius:12px;overflow:hidden;text-align:left;padding:0;transition:transform .18s,box-shadow .18s}.device-card:hover{transform:translateY(-3px);box-shadow:0 10px 20px #183e5010}.card-top{padding:19px 20px 0;display:flex;align-items:center;justify-content:space-between;color:var(--hc-muted);font-size:9px;letter-spacing:1.8px}.online-dot{width:6px;height:6px;border-radius:50%;background:#b2c1c9;display:inline-block;flex-shrink:0}.online-dot.online{background:#18ad9b;box-shadow:0 0 0 4px #1aaf9616}.art-stage{height:190px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 80%,#8199b014,transparent 70%)}.appliance-art{height:100%;max-width:100%;display:block}.card-body{padding:17px 20px 20px}.model{display:block;font-size:10px;color:var(--hc-muted);margin-top:6px;min-height:12px}.state-line{font-size:11px;display:flex;align-items:center;gap:7px;margin:21px 0 15px;color:var(--hc-muted)}.state-line.running{color:var(--hc-accent)}.state-line .icon{width:14px;height:14px;margin-left:auto}.state-line>i{width:5px;height:5px;border-radius:50%;background:currentColor}.progress{height:3px;background:#88a2b21c;border-radius:3px;overflow:hidden;margin-bottom:11px}.progress i{height:100%;background:var(--hc-accent);width:var(--value);display:block}.card-foot{display:flex;justify-content:space-between;gap:5px;color:var(--hc-muted);font-size:9px;min-height:13px}.card-foot span:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:72%}.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.section-title>span{font-size:10px;color:var(--hc-muted)}.section-title h2>span{font-size:10px;background:#91a6b21b;color:var(--hc-muted);padding:3px 7px;border-radius:4px;margin-left:7px}.banner{display:flex;align-items:center;gap:15px;padding:22px;background:var(--hc-surface);border:1px solid var(--hc-line);border-radius:10px;margin-top:25px}.banner>.icon{color:var(--hc-accent);width:25px;height:25px}.banner strong{font-size:12px;font-weight:600}.banner p{font-size:10px;color:var(--hc-muted);margin:5px 0 0}.empty{padding:40px 25px;background:var(--hc-surface);border-radius:10px;border:1px solid var(--hc-line);text-align:center;color:var(--hc-muted);font-size:12px;line-height:1.9}.empty h2{color:var(--hc-ink);margin:10px 0}.empty>.icon{color:var(--hc-accent);width:35px;height:35px;margin-bottom:12px}.empty .button{margin-top:12px}.notice{padding:12px 15px;border-radius:8px;background:#b9814014;color:#ad784c;font-size:11px;line-height:1.7;margin-bottom:20px}.notice.info{background:#008fa510;color:var(--hc-muted)}.footer{display:flex;justify-content:center;gap:35px;border-top:1px solid var(--hc-line);padding:12px;background:var(--hc-surface)}.footer button{display:flex;align-items:center;gap:8px;background:none;border:0;font-size:11px;padding:9px;color:var(--hc-muted)}.footer button.active{color:var(--hc-accent)}.footer .icon{width:18px;height:18px}.back{display:inline-flex;align-items:center;gap:4px;background:none;border:0;padding:0;font-size:11px;color:var(--hc-muted);margin-bottom:23px}.back .icon{width:15px;height:15px}.device-head{margin-bottom:22px}.device-head h1{font-size:27px}.device-head .eyebrow span{color:var(--hc-muted);margin-left:9px;letter-spacing:.5px}.hero{display:grid;grid-template-columns:.85fr 1.3fr;gap:20px;margin-bottom:24px}.hero-art{display:flex;align-items:center;justify-content:center;min-height:250px;background:linear-gradient(140deg,#91adc21b,#6d9cab12);border:1px solid var(--hc-line);border-radius:12px}.hero-art .appliance-art{height:235px}.live{background:var(--hc-surface);border:1px solid var(--hc-line);border-radius:12px;padding:22px 25px;display:flex;flex-direction:column}.live-top{display:flex;justify-content:space-between;align-items:center}.live-top>.eyebrow{color:var(--hc-muted);font-size:8px}.status-badge{font-size:10px;border-radius:20px;padding:6px 10px;background:#9db3c016;color:var(--hc-muted);display:inline-flex;align-items:center;gap:6px}.status-badge .online-dot{width:5px;height:5px;box-shadow:none}.live-center{display:flex;gap:25px;align-items:center;flex:1;padding:23px 0}.ring{width:120px;height:120px;background:conic-gradient(var(--hc-accent) var(--progress),#91a6b21b 0);padding:5px;border-radius:50%;flex-shrink:0}.ring>div{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border-radius:50%;height:100%;background:var(--hc-surface)}.ring strong{font-size:29px;font-weight:500;letter-spacing:-1px}.ring small{font-size:13px;margin-left:2px}.ring .icon{width:30px;height:30px;color:#8da8b8}.ring span{font-size:9px;color:var(--hc-muted)}.live-program>.muted{font-size:10px}.muted{color:var(--hc-muted)}.live-program h2{font-size:18px;margin:8px 0 19px}.metrics{display:flex;gap:22px}.metrics>div{display:flex;align-items:center;gap:7px}.metrics .icon{width:17px;height:17px;color:#8aa6b7}.metrics span{font-size:9px;color:var(--hc-muted)}.metrics strong{display:block;font-size:12px;color:var(--hc-ink);font-weight:550;margin-top:5px}.live-note{font-size:9px;color:var(--hc-muted);padding-top:12px;border-top:1px solid var(--hc-line)}.tabs{display:flex;gap:30px;border-bottom:1px solid var(--hc-line);margin-bottom:23px}.tabs button{border:0;border-bottom:2px solid transparent;padding:13px 1px;background:none;color:var(--hc-muted);font-size:12px;margin-bottom:-1px}.tabs button.active{color:var(--hc-accent);border-bottom-color:var(--hc-accent);font-weight:600}.program-layout{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}.panel{background:var(--hc-surface);border:1px solid var(--hc-line);border-radius:11px;overflow:hidden}.panel-title{padding:21px 22px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--hc-line)}.panel-title h2{font-size:14px}.panel-title small{color:var(--hc-muted);font-size:9px}.program-row{display:flex;align-items:center;border-bottom:1px solid var(--hc-line)}.program-row:last-child{border-bottom:0}.program-row.selected{background:#00a5b50a}.program-row>button:first-child{display:flex;align-items:center;gap:13px;flex:1;min-width:0;border:0;background:none;text-align:left;padding:17px 20px}.program-glyph{width:34px;height:34px;border-radius:8px;background:#8ea8b112;display:grid;place-items:center;color:#90a6b2;flex-shrink:0}.selected .program-glyph{color:var(--hc-accent);background:#00a5b510}.program-glyph .icon{width:18px;height:18px}.program-row strong{font-size:12px;font-weight:550;display:block;line-height:1.5;overflow-wrap:anywhere}.program-row small{font-size:9px;color:var(--hc-muted);display:block;margin-top:5px}.radio{margin-left:auto;border:1.5px solid #a7b8c6;width:15px;height:15px;border-radius:50%;display:grid;place-items:center;flex-shrink:0}.selected .radio{border-color:var(--hc-accent)}.radio i{width:7px;height:7px;border-radius:50%;background:var(--hc-accent)}.favorite{border:0;background:none;color:#aebfc9;padding:10px 16px 10px 0}.favorite .icon{width:16px;height:16px}.favorite.saved{color:#cfac61}.favorite.saved .icon{fill:#cfa3511c}.pad{padding:20px 22px}.pad>.hint:first-child{margin-top:0}.hint{font-size:10px;line-height:1.8;color:var(--hc-muted);margin:15px 0}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions .primary{flex:1}.actions .button{font-size:11px}.actions.stacked{display:grid;margin-top:19px}.control-row{padding:17px 22px;border-bottom:1px solid var(--hc-line);display:flex;gap:15px;align-items:center;justify-content:space-between}.control-row:last-child{border-bottom:0}.control-name{min-width:0;flex:1}.control-name label{font-size:12px;font-weight:500;display:block;line-height:1.5}.control-name small{font-size:9px;color:var(--hc-muted);display:block;margin-top:5px}.control-end{display:flex;align-items:center;gap:7px;max-width:54%;flex-shrink:0}select,input:not([type=checkbox]){border:1px solid var(--hc-line);background:var(--hc-surface);color:var(--hc-ink);border-radius:6px;padding:9px;font-size:12px;max-width:100%;min-width:0}select{max-width:185px}input[type=number]{width:104px}input:focus,select:focus{outline:2px solid var(--hc-accent);outline-offset:2px}.icon-button{border:1px solid var(--hc-line);border-radius:6px;background:var(--hc-surface);color:#7b9caa;padding:7px;display:grid;place-items:center}.icon-button .icon{width:16px;height:16px}.toggle{width:37px;height:22px;border:0;border-radius:15px;background:#b0c1cc;position:relative;padding:0}.toggle:before{content:'';width:16px;height:16px;border-radius:50%;background:#fff;position:absolute;left:3px;top:3px;box-shadow:0 1px 3px #0002}.toggle.on{background:var(--hc-accent)}.toggle.on:before{left:18px}.more{background:none;border:0;color:var(--hc-muted);font-size:16px;padding:6px 4px}.readonly{display:inline-flex;align-items:center;gap:4px;color:var(--hc-muted);font-size:9px}.readonly .icon{width:12px;height:12px}.status-value{font-size:12px;text-align:right;max-width:46%;overflow-wrap:anywhere}.list-heading{font-size:13px;padding:20px 22px;border-bottom:1px solid var(--hc-line)}.status-row{display:flex;gap:15px;align-items:center;padding:17px 22px;border-bottom:1px solid var(--hc-line)}.status-row>div:first-child{flex:1;min-width:0}.status-row strong{font-size:12px;font-weight:500}.status-row small{display:block;color:var(--hc-muted);font-size:9px;margin-top:5px;overflow-wrap:anywhere}.search{width:100%;margin-bottom:17px}.empty-inline{font-size:12px;padding:25px;color:var(--hc-muted);line-height:1.8}.favorite-card{border:1px solid var(--hc-line);background:var(--hc-surface);border-radius:11px;padding:24px;text-align:left}.favorite-card>.icon{color:#cdab64;margin-bottom:19px}.favorite-card h3{font-size:15px}.favorite-card p{font-size:11px;color:var(--hc-muted);margin:10px 0 20px}.favorite-card>span{font-size:10px;color:var(--hc-accent)}.favorite-card>span .icon{width:12px;height:12px}.toast{margin:0 28px 20px;border-radius:8px;background:#1b6b7a;color:#fff;font-size:12px;line-height:1.8;padding:12px 16px}.toast.error{background:#a86054}.overlay{position:fixed;inset:0;background:#132e4766;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)}.modal{width:420px;max-width:100%;background:var(--hc-surface);border:1px solid var(--hc-line);border-radius:14px;padding:25px;box-shadow:0 25px 70px #122d4930}.modal h2{font-size:19px;margin-bottom:15px}.modal p{font-size:12px;color:var(--hc-muted);line-height:1.9}.modal .actions{justify-content:flex-end;margin-top:23px}.modal .actions .primary{flex:0}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.info-grid>.panel{padding:25px}.info-grid h2{font-size:15px;margin-bottom:13px}.info-grid p{color:var(--hc-muted);font-size:12px;margin:8px 0}.version{margin-top:22px;text-align:center;color:var(--hc-muted);font-size:10px}.editor{display:grid;gap:18px;padding:14px}.editor label{display:grid;gap:7px;font-size:13px}.editor label>input,.editor label>select{width:100%;max-width:none}.editor small{font-size:11px;color:var(--hc-muted);line-height:1.7}.editor .device-checkbox{display:flex;align-items:center;gap:9px;font-size:12px;margin:9px 0}.editor input[type=checkbox]{accent-color:var(--hc-accent)}.editor fieldset{border:1px solid var(--hc-line);border-radius:7px;padding:12px}.editor legend{font-size:12px;padding:0 7px}
@container(max-width:800px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.summary .local-summary{display:none}.live-center{gap:17px}.live{padding:20px}.ring{width:106px;height:106px}.hero{grid-template-columns:.75fr 1.3fr}.live-program h2{font-size:16px}.metrics{gap:15px}.program-layout{grid-template-columns:1fr}.control-end select{max-width:240px}}@container(max-width:550px){.brandbar{padding:19px 19px}.brand{font-size:17px;gap:8px}.brand>svg{width:24px;height:24px}.brand small{font-size:7px}.local-pill>span{display:none}.local-pill{gap:0}.body{padding:25px 18px}.page-heading{gap:10px;margin-bottom:22px}h1{font-size:27px}.page-heading p{font-size:11px}.page-heading>.button{font-size:0;padding:11px;min-width:40px;gap:0}.page-heading>.button .icon{width:19px;height:19px}.summary{padding:15px;gap:0;justify-content:space-between;margin-bottom:25px}.summary>span{font-size:9px;gap:6px}.summary strong{font-size:14px}.summary .icon{width:15px;height:15px}.section-title>span{font-size:9px}.section-title h2{font-size:15px}.grid{gap:12px}.card-top{padding:15px 13px 0;font-size:8px;letter-spacing:1px}.art-stage{height:155px}.card-body{padding:12px 13px 16px}.card-body h3{font-size:12px;line-height:1.5;min-height:36px}.model{font-size:9px;margin-top:3px}.state-line{font-size:9px;margin:16px 0 12px;gap:5px}.card-foot{font-size:8px;gap:5px}.card-foot>span:first-child{max-width:63%}.banner{padding:18px 15px;gap:12px;margin-top:20px}.banner strong{font-size:12px}.banner p{font-size:10px}.footer{gap:18px;padding:8px}.footer button{font-size:10px;gap:6px}.footer .icon{width:17px;height:17px}.device-head h1{font-size:24px}.device-head .eyebrow{font-size:8px}.hero{grid-template-columns:1fr;gap:14px}.hero-art{min-height:200px;max-height:210px}.hero-art .appliance-art{height:200px}.live-center{gap:21px;padding:21px 0}.live-program h2{font-size:17px}.ring{width:110px;height:110px}.metrics{gap:18px}.tabs{justify-content:space-between;gap:8px;margin-bottom:19px}.tabs button{font-size:11px}.program-row>button:first-child{padding:16px 17px;gap:11px}.program-row strong{font-size:11px}.panel-title{padding:19px}.panel-title h2{font-size:13px}.panel-title small{font-size:8px}.control-row,.status-row{padding:16px 18px;gap:10px}.control-name label,.status-row strong{font-size:11px}.control-end select{max-width:150px;font-size:11px}.control-end input{font-size:11px;width:85px}.control-name small{font-size:8px}.status-value{font-size:11px}.pad{padding:18px}.actions .button{font-size:10px;padding:11px 12px}.toast{margin:0 18px 18px;font-size:11px}.info-grid{grid-template-columns:1fr}.info-grid>.panel{padding:20px}.local-pill{margin-left:auto}.brandbar{gap:8px}.favorite-card{padding:21px}.favorite-card h3{font-size:13px}.favorite-card p{font-size:10px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
function icon(name, cls='') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`; }

function illustration(type, uid='a') {
  const base=`<defs><linearGradient id="steel-${uid}" x1="0" y1="0" x2="1" y2=".3"><stop stop-color="#d5dce1"/><stop offset=".5" stop-color="#f5f7f8"/><stop offset="1" stop-color="#c4cdd5"/></linearGradient><linearGradient id="glass-${uid}" x2=".8" y2="1"><stop stop-color="#203340"/><stop offset="1" stop-color="#0b1721"/></linearGradient></defs><ellipse cx="140" cy="220" rx="80" ry="9" fill="#102e44" opacity=".09"/>`;
  let shape;
  if(/^(Washer|WashingMachine|WasherDryer|Dryer)$/i.test(type)) shape=`<rect x="74" y="24" width="132" height="190" rx="7" fill="url(#steel-${uid})" stroke="#aab8c2"/><path d="M75 64h130" stroke="#aab8c2"/><rect x="88" y="39" width="36" height="11" rx="2" fill="#b5c1c9"/><circle cx="147" cy="45" r="11" fill="#f6f9fb" stroke="#a3b0ba"/><rect x="169" y="38" width="25" height="14" rx="2" fill="#182a36"/><circle cx="140" cy="132" r="50" fill="#b6c2cb" stroke="#95a6b2"/><circle cx="140" cy="132" r="41" fill="url(#glass-${uid})"/><path d="M115 115c35-23 60 13 28 40-11 9-31 0-28-16" fill="#507285" opacity=".45"/><path d="M102 131a38 38 0 0 1 44-37" fill="none" stroke="#fff" opacity=".4" stroke-width="3"/><rect x="84" y="196" width="28" height="8" rx="3" fill="#bcc8d0"/>`;
  else if(/oven/i.test(type)) shape=`<rect x="64" y="37" width="152" height="176" rx="5" fill="url(#steel-${uid})" stroke="#aab8c2"/><rect x="67" y="40" width="146" height="40" fill="#192c38"/><circle cx="87" cy="59" r="9" fill="#bec9d1"/><circle cx="193" cy="59" r="9" fill="#bec9d1"/><rect x="113" y="51" width="53" height="16" rx="2" fill="#0b1822"/><text x="139" y="63" text-anchor="middle" font-family="monospace" font-size="10" fill="#c3e4ee">180°</text><rect x="76" y="91" width="128" height="111" rx="3" fill="url(#glass-${uid})"/><rect x="76" y="86" width="128" height="7" rx="3" fill="#9baab5"/><path d="M92 147h96m-96 13h96m-96 13h96" stroke="#6c818c" opacity=".5"/><path d="m84 102 105 87" stroke="#fff" opacity=".05" stroke-width="24"/>`;
  else if(/fridge|freezer|refrigerator/i.test(type)) shape=`<rect x="89" y="9" width="102" height="205" rx="5" fill="url(#steel-${uid})" stroke="#aab8c2"/><path d="M89 147h102" stroke="#a3b1ba"/><rect x="104" y="74" width="4" height="46" rx="2" fill="#899da9"/><rect x="104" y="161" width="4" height="28" rx="2" fill="#899da9"/><rect x="132" y="43" width="25" height="15" rx="2" fill="#263e4b"/>`;
  else if(/hob/i.test(type)) shape=`<path d="m49 64 159-12 25 123-173 14Z" fill="url(#glass-${uid})" stroke="#8196a2"/><g fill="none" stroke="#536d7c" stroke-width="2"><ellipse cx="94" cy="95" rx="22" ry="19"/><ellipse cx="169" cy="91" rx="23" ry="19"/><ellipse cx="106" cy="150" rx="25" ry="22"/><ellipse cx="183" cy="146" rx="25" ry="22"/></g>`;
  else if(/coffee/i.test(type)) shape=`<rect x="80" y="36" width="120" height="178" rx="7" fill="url(#steel-${uid})"/><rect x="91" y="47" width="98" height="145" rx="3" fill="#203541"/><rect x="111" y="61" width="58" height="26" rx="3" fill="#0b1822"/><rect x="129" y="103" width="23" height="37" fill="#a1b4bf"/><path d="M116 163h49l-5 25h-38Z" fill="#e8eef1"/><path d="M164 165h9v14h-11" fill="none" stroke="#e8eef1" stroke-width="4"/>`;
  else if(/hood/i.test(type)) shape=`<rect x="119" y="17" width="42" height="99" fill="url(#steel-${uid})"/><path d="m118 110-68 54v15h180v-15l-68-54Z" fill="url(#steel-${uid})" stroke="#9caeb8"/><path d="M57 173h166" stroke="#526d7d"/><circle cx="188" cy="167" r="2" fill="#00a7bc"/>`;
  else shape=`<rect x="71" y="23" width="138" height="191" rx="5" fill="url(#steel-${uid})" stroke="#aab8c2"/><rect x="74" y="27" width="132" height="32" rx="2" fill="#d5dde3"/><path d="M74 63h132" stroke="#afbdc7"/><rect x="91" y="70" width="98" height="8" rx="3" fill="#91a4b1"/><rect x="157" y="36" width="37" height="14" rx="2" fill="#1b303e"/><text x="175" y="46" text-anchor="middle" font-family="monospace" font-size="8" fill="#d5eef4">2:30</text><circle cx="89" cy="43" r="3" fill="#00a7b8"/><path d="M78 198h124" stroke="#c0cbd3"/><path d="M80 82v109" stroke="#fff" opacity=".65"/>`;
  return `<svg class="appliance-art" viewBox="0 0 280 240" aria-hidden="true">${base}${shape}</svg>`;
}


const REGISTRY_CACHE = new WeakMap();
async function registries(hass, force=false) {
  const connection=hass.connection || hass;
  if(force) REGISTRY_CACHE.delete(connection);
  if(!REGISTRY_CACHE.has(connection)) {
    const promise=Promise.all([
      hass.callWS({type:'config/entity_registry/list'}),
      hass.callWS({type:'config/device_registry/list'}),
    ]).then(([entities,devices])=>({entities,devices})).catch(error=>{REGISTRY_CACHE.delete(connection);throw error;});
    REGISTRY_CACHE.set(connection,promise);
  }
  return REGISTRY_CACHE.get(connection);
}
const HTMLElementBase=globalThis.HTMLElement || class {};

class HomeConnectControlCard extends HTMLElementBase {
  constructor() {
    super();this.attachShadow({mode:'open'});
    this._config={title:'Моя техника',show_summary:true};this._page='home';this._tab='programs';
    this._entities=[];this._devices=[];this._models=[];this._draftPrograms=new Map();this._draftValues=new Map();this._pendingPrograms=new Map();
    this._subscriptions=[];this._busy=false;this._message=null;this._registryError='';this._favorites=[];
    this._signature='';this._connection=null;this._registryReady=false;this._loading=null;
    try {this._favorites=JSON.parse(localStorage.getItem('homeconnect-control-favorites')||'[]');if(!Array.isArray(this._favorites))this._favorites=[];}catch{this._favorites=[];}
  }
  setConfig(config) {this._config=validateConfig(config);this._signature='';this._updateModels();this._render();}
  set hass(value) {
    const changed=this._hass?.connection!==value.connection;
    this._hass=value;
    if(changed){this._connection=null;this._loading=null;this._unsubscribe();}
    this._updateModels();
    if(this.isConnected)this._ensureRegistry();
    this._render();
  }
  connectedCallback() {this._ensureRegistry();this._render();}
  disconnectedCallback() {this._binding?.abort();this._unsubscribe();clearTimeout(this._registryTimer);clearTimeout(this._messageTimer);}
  _unsubscribe(){for(const unsubscribe of this._subscriptions.splice(0))unsubscribe();}
  async _ensureRegistry(force=false) {
    if(!this._hass || !this.isConnected || this._hass.connection?.connected===false)return;
    const connection=this._hass.connection || this._hass;
    if(!force && (this._loading || this._connection===connection))return;
    this._loading=connection;
    try {
      const data=await registries(this._hass,force);
      if(!this.isConnected || (this._hass.connection||this._hass)!==connection)return;
      this._entities=data.entities;this._devices=data.devices;this._connection=connection;
      this._registryError='';this._registryReady=true;this._updateModels();this._signature='';this._render();
      if(!this._subscriptions.length && connection.subscribeEvents) {
        for(const type of ['entity_registry_updated','device_registry_updated']) {
          const unsubscribe=await connection.subscribeEvents(()=>{
            clearTimeout(this._registryTimer);this._registryTimer=setTimeout(()=>this._ensureRegistry(true),300);
          },type);
          if(!this.isConnected || (this._hass.connection||this._hass)!==connection)unsubscribe();else this._subscriptions.push(unsubscribe);
        }
      }
    }catch {this._connection=connection;this._registryReady=true;this._registryError='Не удалось прочитать реестр устройств Home Assistant. Нажмите обновление или укажите привязки сущностей в YAML карточки.';this._signature='';this._render();}
    finally {if(this._loading===connection)this._loading=null;}
  }
  _updateModels() {
    if(!this._hass)return;
    this._models=buildDevices(this._hass,this._entities,this._devices,this._config);
    this._syncDevicePage();
    for(const device of this._models) {
      if(this._pendingPrograms?.get(device.id)===this._state(device.roles.program)?.state)this._pendingPrograms.delete(device.id);
      const options=this._state(device.roles.program)?.attributes.options || [];
      if(this._draftPrograms.has(device.id)&&!options.includes(this._draftPrograms.get(device.id)))this._draftPrograms.delete(device.id);
    }
  }
  _syncDevicePage(){
    if(this._models.length===1 && this._page==='home'){
      this._page='device';this._deviceId=this._models[0].id;this._tab='programs';
    }else if(this._page==='device'&&!this._models.some(d=>d.id===this._deviceId)){
      if(this._models.length===1){this._deviceId=this._models[0].id;this._tab='programs';}
      else{this._page='home';this._deviceId=null;}
    }
  }
  _state(id){return this._hass?.states?.[id];}
  _device(){return this._models.find(d=>d.id===this._deviceId);}
  _navigate(page,id=null){this._page=page;this._deviceId=id;this._tab='programs';this._syncDevicePage();this._signature='';this._render(true);this.scrollIntoView?.({behavior:'smooth',block:'start'});}
  _notify(text,error=false){this._message={text,error};this._signature='';this._render(true);clearTimeout(this._messageTimer);this._messageTimer=setTimeout(()=>{this._message=null;this._signature='';this._render();},7000);}
  _operation(device){return this._state(device.roles.operation)?.state || '';}
  _program(device){return this._draftPrograms.get(device.id)??this._state(device.roles.program)?.state;}
  _schedule(device){return this._schedules?.get(device.id);}
  _newSchedule(device,mode){
    const range=scheduleRange(this._hass,device,mode);
    if(range.error)return this._notify(range.error,true);
    this._schedules??=new Map();
    this._schedules.set(device.id,{enabled:true,mode,base:Date.now(),value:Math.min(range.sliderMax,range.lower+range.sliderStep*4),program:this._state(device.roles.program)?.state});
    this._render(true);
  }
  _scheduleClock(timestamp){
    const date=new Date(timestamp);
    return date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+' · '+date.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
  }
  _scheduleTimes(device){
    const draft=this._schedule(device);
    if(!draft?.enabled)return '';
    const p=schedulePreview(this._hass,device,draft);
    if(p.error)return `<p class="hint">${esc(p.error)}</p>`;
    return `<div class="schedule-times"><div><span>Начало мойки</span><strong>${esc(this._scheduleClock(p.start))}</strong></div><span class="schedule-arrow">→</span><div><span>Окончание мойки ≈</span><strong>${esc(this._scheduleClock(p.end))}</strong></div></div>`;
  }
  _schedulePanel(device){
    if(!device.roles.startIn&&!device.roles.finishIn)return '';
    const draft=this._schedule(device),enabled=!!draft?.enabled;
    const mode=draft?.mode||(!scheduleRange(this._hass,device,'finish').error?'finish':'start');
    const range=scheduleRange(this._hass,device,mode);
    const ready=['ready','inactive'].includes(this._operation(device));
    const supported=!!this._hass.services?.homeconnect_ws?.start_program&&!!device.roles.start&&ready&&!range.error;
    const disabled=this._busy||this._pendingPrograms?.has(device.id)||!supported;
    return `<section class="schedule-box"><div class="schedule-heading"><div><strong>Запустить ко времени</strong><p>Начать в удобное время или закончить к сроку</p></div><button role="switch" aria-checked="${enabled}" aria-label="Запустить ко времени" data-schedule-toggle class="toggle ${enabled?'on':''}" ${!enabled&&disabled?'disabled':''}><i></i></button></div>${enabled?`<div class="schedule-modes">${[['start','Начать в'],['finish','Закончить к']].map(([value,label])=>`<button data-schedule-mode="${value}" class="${mode===value?'active':''}" ${this._busy||scheduleRange(this._hass,device,value).error?'disabled':''}>${label}</button>`).join('')}</div><div data-schedule-times>${this._scheduleTimes(device)}</div>${!range.error?`<label class="schedule-slider-label">${mode==='finish'?'Время окончания':'Время начала'}<input class="schedule-slider" type="range" data-schedule-slider min="${range.lower}" max="${range.sliderMax}" step="${range.sliderStep}" value="${draft.value}" aria-label="${mode==='finish'?'Время окончания':'Время начала'} мойки" ${disabled?'disabled':''}></label><div class="schedule-range"><span>Раньше</span><span>Позже · до ${esc(durationText({state:String(range.sliderMax*range.unit),attributes:{unit_of_measurement:'s'}}))}</span></div>`:''}<p class="hint">Окончание приблизительное. Таймер применяется при запуске.</p>`:!supported?`<p class="hint">${esc(!ready?'Таймер настраивается до запуска программы.':range.error||'Для таймера нужно действие homeconnect_ws.start_program.')}</p>`:''}</section>`;
  }
  async _runScheduled(device){
    if(this._busy||this._pendingPrograms?.has(device.id))return;
    try {
      if(this._connection!==(this._hass.connection||this._hass)&&!this._config.entities)throw Error('Подождите загрузки реестра Home Assistant');
      const current=this._models.find(d=>d.id===device.id);
      const plan=planScheduledStart(this._hass,current,this._schedule(device));
      this._busy=true;this._render(true);
      await this._hass.callService(plan.domain,plan.service,plan.data,plan.target);
      this._schedules.delete(device.id);
      this._notify('Запрос отложенного запуска передан Home Assistant. Проверьте состояние прибора.');
    }catch(error){this._notify(error?.message||'Не удалось передать таймер прибору',true);}
    finally{this._busy=false;this._render(true);}
  }
  async _chooseProgram(device,program) {
    if(this._busy || !device)return;
    this._draftValues.clear();
    if(this._state(device.roles.program)?.state!==program)this._schedules?.delete(device.id);
    if(!immediateProgramSelection(device,this._config)) {
      this._draftPrograms.set(device.id,program);this._render(true);return;
    }
    this._draftPrograms.delete(device.id);
    if(this._state(device.roles.program)?.state===program){this._pendingPrograms?.delete(device.id);this._render(true);return;}
    this._pendingPrograms??=new Map();this._pendingPrograms.set(device.id,program);
    const ok=await this._run('select',device.roles.program,program);
    if(!ok)this._pendingPrograms.delete(device.id);
    this._render(true);
  }
  _progress(device){const raw=this._state(device.roles.progress)?.state;return raw==null||['unknown','unavailable'].includes(raw)?null:Math.max(0,Math.min(100,Number(raw)||0));}
  _favoriteKey(device,program){return JSON.stringify([device.id,program]);}
  _favorite(device,program){const key=this._favoriteKey(device,program);this._favorites=this._favorites.includes(key)?this._favorites.filter(v=>v!==key):[...this._favorites,key];try{localStorage.setItem('homeconnect-control-favorites',JSON.stringify(this._favorites));}catch{}this._render(true);}
  _moreInfo(entityId){if(entityId)this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId},bubbles:true,composed:true}));}
  _header(){return '';}
  _footer(){return `<nav class="footer" aria-label="Навигация карточки">${[['home','home','Мой дом'],['favorites','star','Избранное'],['info','settings','О карточке']].map(([page,ico,name])=>`<button class="${this._page===page||this._page==='device'&&page==='home'?'active':''}" data-page="${page}">${icon(ico)}${name}</button>`).join('')}</nav>`;}
  _overview(){
    const running=this._models.filter(d=>this._operation(d)==='run').length;
    return `<section class="page-heading"><div><span class="eyebrow">ВСЁ ПОД КОНТРОЛЕМ</span><h1>${esc(this._config.title)}</h1><button class="refresh compact-refresh" data-refresh aria-label="Обновить список приборов" title="Обновить список">${icon('link')}</button><p>Любимая техника. Всё необходимое — под рукой.</p></div><a class="button secondary" href="/config/integrations/integration/homeconnect_ws" aria-label="Открыть интеграцию Home Connect Local">${icon('plus')}Добавить прибор</a></section>${this._config.show_summary?`<div class="summary"><span>${icon('grid')}Приборов <strong>${this._models.length}</strong></span><span>${icon('wifi')}<strong>${this._models.filter(d=>d.connected).length}</strong> в сети</span><span>${icon('clock')}<strong>${running}</strong> работают</span><span class="local-summary">${icon('shield')} Через Home Assistant</span></div>`:''}<div class="section-title"><h2>Моя техника <span>${this._models.length}</span></h2><span>Home Connect Local</span></div>${this._models.length?`<div class="grid ${this._models.length===1?'single':''}">${this._models.map((d,i)=>this._deviceCard(d,i)).join('')}</div>`:`<div class="empty">${icon('link')}<h2>${this._registryReady?'Начнём с подключения':'Ищем вашу технику'}</h2><p>${this._registryReady?'Добавьте приборы в интеграцию Home Connect Local.<br>Карточка автоматически найдёт их сущности.':'Читаем реестр устройств Home Assistant…'}</p><a class="button primary" href="/config/integrations/integration/homeconnect_ws">Открыть интеграцию</a></div>`}<div class="banner">${icon('shield')}<div><strong>Ваш дом. Ваша сеть.</strong><p>Карточка использует сущности и действия Home Assistant. Связь с техникой обеспечивает Home Connect Local.</p></div></div>`;
  }
  _deviceCard(device,index) {
    const op=this._operation(device),progress=this._progress(device);
    const active=this._state(device.roles.active)?.state;
    return `<button class="device-card" data-device="${esc(device.id)}"><div class="card-top"><span>${esc(device.brand.toUpperCase())}</span><i class="online-dot ${device.connected?'online':''}" title="${device.connected?'В сети':'Нет связи'}"></i></div><div class="art-stage">${illustration(device.type,'ha'+index)}</div><div class="card-body"><h3>${esc(device.name)}</h3><span class="model">${esc(device.model||TYPE_NAMES[device.type]||'Home Connect')}</span><div class="state-line ${op==='run'?'running':''}"><i></i>${esc(device.connected?device.roles.operation?formatState(this._hass,device.roles.operation):'Подключён':'Нет связи')}${icon('arrow')}</div>${op==='run'&&progress!==null?`<div class="progress"><i style="--value:${progress}%"></i></div>`:''}<div class="card-foot"><span>${esc(shortProgram(active&&!['unknown','unavailable','none'].includes(active)?active:this._state(device.roles.program)?.state))}</span><span>${esc(durationText(this._state(device.roles.remaining)))}</span></div></div></button>`;
  }
  _programButtons(device) {
    const selected=this._program(device),actual=this._state(device.roles.program)?.state;
    const chosen=selected && !['unknown','unavailable'].includes(selected);
    const canChoose=chosen&&controllable(this._hass,device.roles.program)&&!this._busy;
    const remoteBlocked=device.roles.remote&&this._state(device.roles.remote)?.state!=='on';
    let canStart=device.roles.start&&controllable(this._hass,device.roles.start)&&!this._busy&&!this._pendingPrograms?.has(device.id)&&!remoteBlocked&&(!device.roles.operation||['ready','inactive'].includes(this._operation(device)))&&(!device.roles.program||chosen&&selected===actual);
    if(canStart&&this._schedule(device)?.enabled){try{planScheduledStart(this._hass,device,this._schedule(device));}catch{canStart=false;}}
    const button=(role,text,ico,cls='secondary')=>device.roles[role]?`<button class="button ${cls}" data-role="${role}" ${this._busy||!controllable(this._hass,device.roles[role])?'disabled':''}>${icon(ico)}${text}</button>`:'';
    return `${this._pendingPrograms?.has(device.id)?'<p class="hint">Ожидаем подтверждения выбранной программы от прибора…</p>':''}<div class="actions stacked">${device.roles.program&&!immediateProgramSelection(device,this._config)?`<button class="button secondary" data-apply-program ${canChoose?'':'disabled'}>Применить программу</button>`:''}${device.roles.start?`<button class="button primary" data-role="start" ${canStart?'':'disabled'}>${icon('play')}Запустить программу</button>`:''}</div><div class="actions" style="margin-top:12px">${button('pause','Пауза','clock')}${button('resume','Продолжить','play')}${button('stop','Остановить','close','danger')}</div>${remoteBlocked?'<p class="hint">Для запуска разрешите Remote Start на панели прибора.</p>':''}${selected!==actual&&device.roles.start?'<p class="hint">Сначала примените программу и дождитесь её появления в состоянии прибора.</p>':''}`;
  }
  _detail(){
    const device=this._device();if(!device){this._page='home';return this._overview();}
    const roles=device.roles,progress=this._progress(device),op=this._operation(device);
    const actual=this._state(roles.program)?.state,active=this._state(roles.active)?.state;
    const selected=this._program(device);
    const programs=this._state(roles.program)?.attributes.options || [];
    const options=device.entries.filter(e=>controlGroup(this._hass,e,device)==='options');
    const settings=device.entries.filter(e=>controlGroup(this._hass,e,device)==='settings');
    const commands=device.entries.filter(e=>entityDomain(e.entity_id)==='button'&&!['start','stop','pause','resume'].some(r=>roles[r]===e.entity_id));
    return `${this._models.length>1?`<button class="back" data-page="home">${icon('back')}Моя техника</button>`:''}<section class="page-heading device-head"><div><span class="eyebrow">${esc(device.brand)}<span>${esc(device.model)}</span></span><h1>${esc(device.name)}</h1><button class="refresh compact-refresh" data-refresh aria-label="Обновить список приборов" title="Обновить список">${icon('link')}</button><p>${device.connected?'Состояния обновляются через Home Assistant':'Нет связи с прибором'}</p></div>${roles.power?this._powerButton(device):''}</section><section class="hero ${['ready','inactive'].includes(op)?'idle':''}"><div class="hero-art">${illustration(device.type,'detail')}</div><div class="live"><div class="live-top"><span class="status-badge"><i class="online-dot ${device.connected?'online':''}"></i>${device.connected?'В сети':'Нет связи'}</span><span class="eyebrow">СЕЙЧАС</span></div><div class="live-center"><div class="ring" style="--progress:${progress===null?0:progress*3.6}deg"><div><strong>${op==='run'&&progress!==null?`${progress}<small>%</small>`:icon(op==='finished'?'check':'power')}</strong><span>${esc(device.connected?roles.operation?formatState(this._hass,roles.operation):'Подключён':'Нет связи')}</span></div></div><div class="live-program"><span class="muted">${esc(roles.operation?formatState(this._hass,roles.operation):'Подключён')}</span><h2>${esc(shortProgram(active&&!['unknown','unavailable','none'].includes(active)?active:actual))}</h2><div class="metrics"><div>${icon('clock')}<span>${op==='run'?'Осталось':'Длительность'}<strong>${esc(durationText(this._state(roles.remaining)))}</strong></span></div><div>${icon('info')}<span>Дверца<strong>${esc(roles.door?formatState(this._hass,roles.door):'—')}</strong></span></div></div></div></div><div class="live-note">${icon('shield')} Управление через вашу интеграцию Home Connect Local.</div></div></section><nav class="tabs">${[['programs','Управление'],['settings','Настройки'],['status','Состояние'],['commands','Действия']].map(([id,name])=>`<button data-tab="${id}" class="${this._tab===id?'active':''}">${name}</button>`).join('')}</nav>${this._tab==='programs'?this._mainControls(device,programs,selected,actual,active,options,settings):this._tab==='settings'?`<section class="panel"><div class="panel-title"><h2>Настройки прибора</h2></div>${settings.map(e=>this._control(e,device)).join('')||'<div class="empty-inline">Настройки не предоставлены интеграцией.</div>'}</section>`:this._tab==='commands'?`<section class="panel"><div class="panel-title"><h2>Действия</h2></div>${commands.map(e=>this._control(e,device)).join('')||'<div class="empty-inline">Других действий нет.</div>'}</section>`:`<section class="panel"><div class="panel-title"><h2>Состояния и показания</h2><small>${device.entries.filter(e=>['sensor','binary_sensor'].includes(entityDomain(e.entity_id))).length}</small></div>${device.entries.filter(e=>['sensor','binary_sensor'].includes(entityDomain(e.entity_id))).map(e=>`<div class="status-row"><div><strong>${esc(entityLabel(this._hass,e))}</strong><small>${esc(e.entity_id)}</small></div><span class="status-value">${esc(e.entity_id===roles.active?shortProgram(this._state(e.entity_id)?.state):formatState(this._hass,e.entity_id))}</span><button class="more" data-more="${esc(e.entity_id)}" aria-label="Подробнее ${esc(entityLabel(this._hass,e))}">⋯</button></div>`).join('')}</section>`}`;
  }
  _summaryTimes(device){
    if(this._schedule(device)?.enabled)return this._scheduleTimes(device);
    const seconds=programSeconds(this._hass,device);
    return `<div class="order-time"><span>Начало: после нажатия «Запустить»</span>${seconds?`<span>Окончание ≈ ${esc(this._scheduleClock(Date.now()+seconds*1000))}</span>`:''}</div>`;
  }
  _mainControls(device,programs,selected,actual,active,options,settings){
    const locked=selected!==actual||this._pendingPrograms?.has(device.id);
    const duration=selectedProgramDuration(this._hass,device,selected);
    const chosenOptions=options.filter(e=>{
      const state=this._state(e.entity_id)?.state;
      return state!=null&&!['off','unknown','unavailable','0','none'].includes(state);
    });
    return `<div class="program-layout ordered-controls"><section class="panel program-choice"><div class="panel-title"><h2>Выберите программу</h2></div>${this._programPicker(device,programs,selected,actual,active)}<div class="program-duration">${icon('clock')}<span>Время мойки <strong>${esc(duration)}</strong></span></div></section><section class="panel program-parameters"><div class="panel-title"><h2>${device.type==='Dishwasher'?'Настройте мойку':'Настройте программу'}</h2></div>${device.roles.startIn||device.roles.finishIn?`<div class="pad">${this._schedulePanel(device)}</div>`:''}<div class="main-controls">${options.map(e=>this._control(e,device,locked)).join('')}</div>${settings.length?`<details class="extra-settings"><summary>Настройки прибора</summary>${settings.map(e=>this._control(e,device)).join('')}</details>`:''}</section><section class="panel program-order"><div class="panel-title"><h2>Проверьте и запускайте</h2></div><div class="pad"><div class="order-program"><strong>${esc(shortProgram(selected))}</strong><span>${esc(duration)}</span></div>${chosenOptions.length?`<div class="order-options">${chosenOptions.map(e=>`<span>${esc(entityLabel(this._hass,e))}${this._state(e.entity_id)?.state==='on'?'':`: ${esc(formatState(this._hass,e.entity_id))}`}</span>`).join('')}</div>`:''}${locked?'<p class="hint">Ожидаем подтверждения выбора программы от прибора.</p>':''}<div data-order-summary-times>${this._summaryTimes(device)}</div>${this._programButtons(device)}</div></section></div>`;
  }
  _programPicker(device,programs,selected,actual,active){
    if(!programs.length)return '<div class="empty-inline">Выбор программ недоступен.</div>';
    const disabled=this._busy||!controllable(this._hass,device.roles.program);
    return `<div class="program-mobile"><select data-program-select aria-label="Программа мойки" ${disabled?'disabled':''}>${programs.map(program=>`<option value="${esc(program)}" ${selected===program?'selected':''}>${esc(shortProgram(program))}</option>`).join('')}</select></div><div class="program-desktop">${programs.map(program=>`<div class="program-row ${selected===program?'selected':''}"><button data-program="${esc(program)}" ${disabled?'disabled':''}><span class="program-glyph">${icon(/eco/i.test(program)?'shield':/quick|short/i.test(program)?'clock':'grid')}</span><span><strong>${esc(shortProgram(program))}</strong><small>${program===active?'Выполняется':program===actual?'Выбрана на приборе':immediateProgramSelection(device,this._config)?'Выбрать':'Просмотр'}</small></span><span class="radio">${selected===program?'<i></i>':''}</span></button><button class="favorite ${this._favorites.includes(this._favoriteKey(device,program))?'saved':''}" data-favorite="${esc(program)}" aria-label="В избранное">${icon('star')}</button></div>`).join('')}</div>`;
  }
  _powerButton(device) {
    const id=device.roles.power,domain=entityDomain(id),state=this._state(id);
    if(domain!=='switch')return `<button class="button secondary" data-more="${esc(id)}">${icon('power')}Питание</button>`;
    return `<button class="button secondary" data-toggle="${esc(id)}" data-next="${state?.state!=='on'}" ${!controllable(this._hass,id)||this._busy?'disabled':''}>${icon('power')}${state?.state==='on'?'Выключить':'Включить'}</button>`;
  }
  _control(entry,device,locked=false) {
    const id=entry.entity_id,domain=entityDomain(id),state=this._state(id),attrs=state?.attributes||{};
    const disabled=locked||!controllable(this._hass,id)||this._busy;
    const draftKey=device.id+':'+id;
    const value=this._draftValues.has(draftKey)?this._draftValues.get(draftKey):state?.state;
    const label=entityLabel(this._hass,entry);
    let widget='';
    const disabledAttr=disabled?'disabled':'';
    if(domain==='select') widget=`<select data-input="${esc(id)}" ${disabledAttr} aria-label="${esc(label)}"><option value="" disabled ${value==null||value==='unknown'?'selected':''}>Выберите…</option>${(attrs.options||[]).map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(this._optionLabel(state,v))}</option>`).join('')}</select><button class="icon-button" data-save="${esc(id)}" data-action="select" ${disabledAttr} aria-label="Применить ${esc(label)}">${icon('check')}</button>`;
    else if(domain==='number') widget=`<input type="number" data-input="${esc(id)}" value="${value==null||['unknown','unavailable'].includes(value)?'':esc(value)}" min="${esc(attrs.min??0)}" max="${esc(attrs.max??100)}" step="${esc(attrs.step||'any')}" ${disabledAttr} aria-label="${esc(label)}"><button class="icon-button" data-save="${esc(id)}" data-action="number" ${disabledAttr} aria-label="Применить ${esc(label)}">${icon('check')}</button>`;
    else if(['switch','light','fan'].includes(domain)) widget=`<button class="toggle ${state?.state==='on'?'on':''}" role="switch" aria-checked="${state?.state==='on'}" aria-label="${esc(label)}" data-toggle="${esc(id)}" data-next="${state?.state!=='on'}" ${disabledAttr}></button>`;
    else if(domain==='button') widget=`<button class="button secondary compact" data-button="${esc(id)}" ${disabledAttr}>Выполнить</button>`;
    else widget=`<span class="status-value">${esc(formatState(this._hass,id))}</span>`;
    let extra='';
    if(domain==='light'&&(attrs.supported_color_modes||[]).some(m=>!['onoff','unknown'].includes(m))) extra=`<div class="control-row"><div class="control-name"><label>Яркость</label><small>%</small></div><div class="control-end"><input type="number" min="0" max="100" step="1" value="${Math.round((attrs.brightness??0)/255*100)}" data-extra-input="${esc(id)}" data-kind="brightness" ${disabledAttr} aria-label="Яркость ${esc(label)}"><button class="icon-button" data-extra-save="${esc(id)}" data-kind="brightness" ${disabledAttr} aria-label="Применить яркость">${icon('check')}</button></div></div>`;
    if(domain==='fan') {
      if(Number(attrs.supported_features)&1) extra+=`<div class="control-row"><div class="control-name"><label>Скорость вытяжки</label><small>%</small></div><div class="control-end"><input type="number" min="0" max="100" step="${esc(attrs.percentage_step||1)}" value="${esc(attrs.percentage??0)}" data-extra-input="${esc(id)}" data-kind="fan_percentage" ${disabledAttr} aria-label="Скорость ${esc(label)}"><button class="icon-button" data-extra-save="${esc(id)}" data-kind="fan_percentage" ${disabledAttr} aria-label="Применить скорость">${icon('check')}</button></div></div>`;
      if(attrs.preset_modes?.length) extra+=`<div class="control-row"><div class="control-name"><label>Режим вытяжки</label></div><div class="control-end"><select data-extra-input="${esc(id)}" data-kind="fan_preset" ${disabledAttr} aria-label="Режим ${esc(label)}">${attrs.preset_modes.map(v=>`<option value="${esc(v)}" ${v===attrs.preset_mode?'selected':''}>${esc(v)}</option>`).join('')}</select><button class="icon-button" data-extra-save="${esc(id)}" data-kind="fan_preset" ${disabledAttr} aria-label="Применить режим">${icon('check')}</button></div></div>`;
    }
    return `<div class="control-row"><div class="control-name"><label>${esc(label)}</label>${isReadonly(state)?'<small class="readonly">Только чтение</small>':!state||state.state==='unavailable'?'<small>Сейчас недоступно</small>':attrs.unit_of_measurement?`<small>${esc(attrs.unit_of_measurement)}</small>`:''}</div><div class="control-end">${widget}<button class="more" data-more="${esc(id)}" aria-label="Подробнее ${esc(label)}">⋯</button></div></div>${extra}`;
  }
  _optionLabel(state,value){
    try {return this._hass.formatEntityState?.({...state,state:value})||value;}catch{return value;}
  }
  _favoritesPage(){
    const cards=[];
    for(const device of this._models)for(const program of this._state(device.roles.program)?.attributes.options||[])if(this._favorites.includes(this._favoriteKey(device,program)))cards.push(`<button class="favorite-card" data-fav-device="${esc(device.id)}" data-program-name="${esc(program)}">${icon('star')}<h3>${esc(shortProgram(program))}</h3><p>${esc(device.name)}</p><span>Открыть программу ${icon('arrow')}</span></button>`);
    return `<section class="page-heading"><div><span class="eyebrow">БЫСТРЫЙ ДОСТУП</span><h1>Избранное</h1><p>Программы, которыми вы пользуетесь чаще всего.</p></div></section>${cards.length?`<div class="grid">${cards.join('')}</div>`:'<div class="empty">Отметьте звёздочкой программу на странице прибора — она появится здесь.</div>'}`;
  }
  _info(){return `<section class="page-heading"><div><span class="eyebrow">HOME CONNECT В HOME ASSISTANT</span><h1>Ваш локальный дом</h1><p>Все приборы — в одном интерфейсе.</p></div></section><div class="info-grid"><section class="panel"><h2>Подключение</h2><p>Связью с техникой управляет Home Connect Local. Профили и ключи остаются в интеграции.</p><p>Карточка находит приборы по реестру Home Assistant. Имена сущностей можно менять.</p><a class="button secondary" href="/config/integrations/integration/homeconnect_ws">Настройки интеграции</a></section><section class="panel"><h2>На телефоне</h2><p>Откройте эту панель в приложении Home Assistant или добавьте Home Assistant на главный экран телефона.</p><p>После настройки интеграции управление в LAN не требует интернета. Телефон должен иметь доступ к вашему Home Assistant.</p></section></div><div class="version">Home Connect Control Card · ${VERSION} · Независимый интерфейс</div>`;}
  _render(force=false) {
    if(!this.shadowRoot || !this._hass)return;
    const active=this.shadowRoot.activeElement;
    if(!force&&(this.shadowRoot.querySelector('dialog[open]') || active?.matches('input,select,textarea')))return;
    const signature=JSON.stringify([this._models.map(d=>[d.id,d.name,d.model,d.connected,d.entries.map(e=>[e.entity_id,this._state(e.entity_id)])]),this._page,this._deviceId,this._tab,[...this._draftPrograms],this._busy,this._message,this._registryError,this._config,this._hass.connection?.connected]);
    if(!force&&signature===this._signature)return;
    this._signature=signature;
    const content=this._page==='device'?this._detail():this._page==='favorites'?this._favoritesPage():this._page==='info'?this._info():this._overview();
    updateCardDOM(this.shadowRoot,`<style>${CSS}${SCHEDULE_CSS} dialog{border:1px solid var(--hc-line);border-radius:14px;padding:25px;background:var(--hc-surface);color:var(--hc-ink);width:420px;max-width:calc(100vw - 28px)}dialog::backdrop{background:#122c4666;backdrop-filter:blur(3px)}dialog h2{margin:0 0 15px;font-size:19px}dialog p{font-size:12px;color:var(--hc-muted);line-height:1.9}dialog .actions{margin-top:22px;justify-content:flex-end}dialog .actions>.primary{flex:0}</style><ha-card><div class="frame">${this._header()}<main class="body">${this._hass.connection?.connected===false?'<div class="notice">Нет связи с Home Assistant. Команды недоступны и не сохраняются на потом.</div>':''}${this._registryError?`<div class="notice">${esc(this._registryError)}</div>`:''}${content}</main>${this._message?`<div class="toast ${this._message.error?'error':''}" role="status">${esc(this._message.text)}</div>`:''}${this._footer()}</div></ha-card>`);
    this._bind();
  }
  _listen(element,type,callback){element?.addEventListener(type,callback,{signal:this._binding.signal});}
  _bind(){
    this._binding?.abort();this._binding=new AbortController();
    const root=this.shadowRoot;
    this._listen(root.querySelector('[data-refresh]'),'click',()=>this._ensureRegistry(true));
    this._listen(root.querySelector('[data-schedule-toggle]'),'click',()=>{const d=this._device();if(this._schedule(d)?.enabled){this._schedules.delete(d.id);this._render(true);}else this._newSchedule(d,!scheduleRange(this._hass,d,'finish').error?'finish':'start');});
    root.querySelectorAll('[data-schedule-mode]').forEach(b=>b.onclick=()=>this._newSchedule(this._device(),b.dataset.scheduleMode));
    this._listen(root.querySelector('[data-schedule-slider]'),'input',event=>{const d=this._device(),draft=this._schedule(d);if(!draft)return;draft.value=Number(event.target.value);root.querySelector('[data-schedule-times]').innerHTML=this._scheduleTimes(d);const summary=root.querySelector('[data-order-summary-times]');if(summary)summary.innerHTML=this._summaryTimes(d);});
    this._listen(root.querySelector('[data-schedule-slider]'),'change',()=>this._render(true));
    root.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>this._navigate(b.dataset.page));
    root.querySelectorAll('[data-device]').forEach(b=>b.onclick=()=>this._navigate('device',b.dataset.device));
    root.querySelectorAll('[data-fav-device]').forEach(b=>b.onclick=()=>{this._navigate('device',b.dataset.favDevice);this._chooseProgram(this._device(),b.dataset.programName);});
    root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{this._tab=b.dataset.tab;this._render(true);});
    this._listen(root.querySelector('[data-program-select]'),'change',event=>{const value=event.target.value;event.target.blur();this._chooseProgram(this._device(),value);});
    root.querySelectorAll('[data-program]').forEach(b=>b.onclick=()=>this._chooseProgram(this._device(),b.dataset.program));
    root.querySelectorAll('[data-favorite]').forEach(b=>b.onclick=()=>this._favorite(this._device(),b.dataset.favorite));
    root.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>this._moreInfo(b.dataset.more));
    root.querySelectorAll('[data-input]').forEach(input=>input.oninput=()=>this._draftValues.set(this._deviceId+':'+input.dataset.input,input.value));
    root.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>this._run('toggle',b.dataset.toggle,b.dataset.next==='true'));
    root.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{const input=root.querySelector(`[data-input="${b.dataset.save}"]`);if(input.value===''||!input.reportValidity())return this._notify('Проверьте значение параметра',true);this._run(b.dataset.action,b.dataset.save,b.dataset.action==='number'?Number(input.value):input.value);});
    root.querySelectorAll('[data-extra-save]').forEach(b=>b.onclick=()=>{const input=root.querySelector(`[data-extra-input="${b.dataset.extraSave}"][data-kind="${b.dataset.kind}"]`);if(input.value===''||!input.reportValidity())return this._notify('Проверьте значение параметра',true);this._run(b.dataset.kind,b.dataset.extraSave,b.dataset.kind==='fan_preset'?input.value:Number(input.value));});
    root.querySelectorAll('[data-button]').forEach(b=>b.onclick=()=>{const d=this._device();const e=d.entries.find(e=>e.entity_id===b.dataset.button);this._confirm(entityLabel(this._hass,e),`Выполнить действие «${entityLabel(this._hass,e)}» на приборе «${d.name}»?`,()=>this._run('button',b.dataset.button));});
    this._listen(root.querySelector('[data-apply-program]'),'click',()=>{const d=this._device(),program=this._program(d);this._confirm('Применить программу?',`${shortProgram(program)} · ${d.name}. Прибор может начать работу сразу после выбора программы.`,()=>this._run('select',d.roles.program,program));});
    root.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{
      const d=this._device(),role=b.dataset.role,id=d.roles[role],actual=this._state(d.roles.program)?.state;
      if(role==='start'&&this._schedule(d)?.enabled){const p=schedulePreview(this._hass,d,this._schedule(d));if(p.error)return this._notify(p.error,true);return this._confirm('Запустить программу?',`${d.name} · ${shortProgram(actual)}. Начало ${this._scheduleClock(p.start)}, окончание примерно ${this._scheduleClock(p.end)}.`,()=>this._runScheduled(d));}
      const text={start:'Запустить выбранную программу?',stop:'Остановить выполняющуюся программу?',pause:'Приостановить программу?',resume:'Продолжить программу?'}[role];
      this._confirm(text,`${d.name}${role==='start'?` · ${shortProgram(actual)}. Убедитесь, что прибор подготовлен к работе.`:''}`,()=>{
        if(role==='start'&&d.roles.program&&this._state(d.roles.program)?.state!==actual)return this._notify('Программа на приборе изменилась. Проверьте выбор перед запуском',true);
        this._run('button',id);
      });
    });
  }
  _confirm(title,text,callback){
    if(this._busy)return;
    const dialog=document.createElement('dialog');dialog.setAttribute('aria-label',title);
    dialog.innerHTML=`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button class="button secondary" data-cancel>Отмена</button><button class="button primary" data-confirm>Подтвердить</button></div>`;
    this.shadowRoot.append(dialog);
    const dismiss=()=>{dialog.close();dialog.remove();this._signature='';this._render();};
    dialog.querySelector('[data-cancel]').onclick=dismiss;
    dialog.querySelector('[data-confirm]').onclick=()=>{dismiss();callback();};
    dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
    dialog.showModal();
  }
  async _run(action,id,value){
    if(this._busy)return;
    if(this._connection!==(this._hass.connection||this._hass)&&!this._config.entities)return this._notify('Подождите загрузки реестра Home Assistant',true);
    const d=this._models.find(d=>d.entries.some(e=>e.entity_id===id));
    if(!d)return this._notify('Прибор больше не доступен',true);
    this._busy=true;this._render(true);
    try {
      await callAction(this._hass,d,action,id,value);
      this._draftValues.delete(d.id+':'+id);
      this._notify('Запрос выполнен Home Assistant. Ожидаем состояния от прибора');
      return true;
    }catch(error){this._notify(error?.message||'Home Assistant отклонил действие. Проверьте состояние прибора',true);return false;}
    finally{this._busy=false;this._signature='';this._render(true);}
  }
  getCardSize(){return 10;}
  getGridOptions(){return {columns:'full',rows:'auto',min_columns:6};}
  static getConfigElement(){return document.createElement('homeconnect-control-card-editor');}
  static getStubConfig(){return {type:'custom:homeconnect-control-card',title:'Моя техника',show_summary:true};}
}

class HomeConnectControlCardEditor extends HTMLElementBase {
  constructor(){super();this.attachShadow({mode:'open'});this._config={};this._registry=null;}
  setConfig(config){this._config={...config};this._render();}
  set hass(hass){this._hass=hass;if(!this._registry && !this._loading){this._loading=true;registries(hass).then(data=>{this._registry=data;this._render();}).catch(()=>{this._registry={entities:[],devices:[]};this._render();});}this._render();}
  _change(update){this._config={...this._config,...update};this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));}
  _render(){
    if(!this.shadowRoot)return;
    if(this.shadowRoot.activeElement?.matches('input,select,textarea'))return;
    const devices=this._hass&&this._registry?buildDevices(this._hass,this._registry.entities,this._registry.devices,{show_hidden:true}):[];
    this.shadowRoot.innerHTML=`<style>${CSS}${SCHEDULE_CSS}</style><div class="editor"><label>Заголовок<input id="title" value="${esc(this._config.title??'Моя техника')}"></label><label class="device-checkbox"><input id="summary" type="checkbox" ${this._config.show_summary!==false?'checked':''}>Показывать сводку</label><label class="device-checkbox"><input id="hidden" type="checkbox" ${this._config.show_hidden?'checked':''}>Показывать скрытые в HA сущности</label><fieldset><legend>Приборы</legend><small>Пустой выбор означает все приборы Home Connect Local.</small>${devices.map(d=>`<label class="device-checkbox"><input type="checkbox" data-device="${esc(d.id)}" ${this._config.devices?.includes(d.id)?'checked':''}>${esc(d.name)} · ${esc(d.brand)} ${esc(d.model)}</label>`).join('')||'<p>Список появится после подключения техники к интеграции.</p>'}</fieldset><small>Дополнительные привязки и названия доступны в YAML: entities, device_names, appliance_types. Интеграция не изменяется.</small></div>`;
    const titleChanged=e=>{if(e.target.value!==this._config.title)this._change({title:e.target.value});};
    this.shadowRoot.querySelector('#title').oninput=titleChanged;
    this.shadowRoot.querySelector('#title').onchange=titleChanged;
    this.shadowRoot.querySelector('#summary').onchange=e=>this._change({show_summary:e.target.checked});
    this.shadowRoot.querySelector('#hidden').onchange=e=>this._change({show_hidden:e.target.checked});
    this.shadowRoot.querySelectorAll('[data-device]').forEach(input=>input.onchange=()=>this._change({devices:[...this.shadowRoot.querySelectorAll('[data-device]:checked')].map(e=>e.dataset.device)}));
  }
}

if(globalThis.customElements) {
  if(!customElements.get('homeconnect-control-card'))customElements.define('homeconnect-control-card',HomeConnectControlCard);
  if(!customElements.get('homeconnect-control-card-editor'))customElements.define('homeconnect-control-card-editor',HomeConnectControlCardEditor);
  window.customCards=window.customCards||[];
  if(!window.customCards.some(c=>c.type==='homeconnect-control-card'))window.customCards.push({type:'homeconnect-control-card',name:'Home Connect Control',description:'Ваша техника Home Connect Local в одном интерфейсе',preview:true});
  console.info(`%c HOME CONNECT CONTROL %c ${VERSION} `,'background:#009eb4;color:#fff;padding:4px;font-weight:bold','background:#eef6f7;color:#446575;padding:4px');
}

