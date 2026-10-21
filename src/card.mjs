import {updateCardDOM} from './dom.mjs';
import { INTEGRATION, VERSION, ROLES, TYPE_NAMES, entityDomain, buildDevices, entityLabel, available, controllable, isReadonly, formatState, durationText, shortProgram, immediateProgramSelection, selectedProgramDuration, controlGroup, validateConfig, callAction } from './core.mjs';
import { esc, icon, illustration, CSS, SCHEDULE_CSS } from './view.mjs';
import {scheduleRange,schedulePreview,planScheduledStart,programSeconds,preferredScheduleMode} from './schedule.mjs';

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

export class HomeConnectControlCard extends HTMLElementBase {
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
    this._schedules.set(device.id,{enabled:true,mode,base:Date.now(),value:Math.min(range.sliderMax,range.lower+range.sliderStep*Math.max(1,Math.ceil(3600/(range.unit*range.sliderStep)))),program:this._state(device.roles.program)?.state});
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
    const mode=draft?.mode||preferredScheduleMode(this._hass,device);
    const range=scheduleRange(this._hass,device,mode);
    const ready=['ready','inactive'].includes(this._operation(device));
    const supported=!!this._hass.services?.homeconnect_ws?.start_program&&!!device.roles.start&&ready&&!range.error;
    const disabled=this._busy||this._pendingPrograms?.has(device.id)||!supported;
    return `<section class="schedule-box"><div class="schedule-heading"><div><strong>Запустить ко времени</strong></div><button role="switch" aria-checked="${enabled}" aria-label="Запустить ко времени" data-schedule-toggle class="toggle ${enabled?'on':''}" ${!enabled&&disabled?'disabled':''}><i></i></button></div>${enabled?`<div data-schedule-times>${this._scheduleTimes(device)}</div>${!range.error?`<label class="schedule-slider-label">Выберите время начала мойки<input class="schedule-slider" type="range" data-schedule-slider min="${range.lower}" max="${range.sliderMax}" step="${range.sliderStep}" value="${draft.value}" aria-label="Время начала мойки" ${disabled?'disabled':''}></label><div class="schedule-range"><span>Раньше</span><span>Позже</span></div><div class="schedule-fine"><button class="button secondary" data-schedule-adjust="-1" aria-label="Выбрать время раньше" ${disabled?'disabled':''}>−</button><span>Шаг ${esc(durationText({state:String(range.sliderStep*range.unit),attributes:{unit_of_measurement:'s'}}))}</span><button class="button secondary" data-schedule-adjust="1" aria-label="Выбрать время позже" ${disabled?'disabled':''}>+</button></div>`:''}<p class="hint">Окончание приблизительное. Таймер применяется при запуске.</p>`:!supported?`<p class="hint">${esc(!ready?'Таймер настраивается до запуска программы.':range.error||'Для таймера нужно действие homeconnect_ws.start_program.')}</p>`:''}</section>`;
  }
  _adjustSchedule(direction){
    const device=this._device(),draft=this._schedule(device);
    if(!draft||this._busy||this._pendingPrograms?.has(device.id))return;
    const range=scheduleRange(this._hass,device,draft.mode);
    if(range.error)return;
    draft.value=Math.max(range.lower,Math.min(range.sliderMax,draft.value+direction*range.sliderStep));
    this._render(true);
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
    this._listen(root.querySelector('[data-schedule-toggle]'),'click',()=>{const d=this._device();if(this._schedule(d)?.enabled){this._schedules.delete(d.id);this._render(true);}else this._newSchedule(d,preferredScheduleMode(this._hass,d));});
    root.querySelectorAll('[data-schedule-adjust]').forEach(button=>button.onclick=()=>this._adjustSchedule(Number(button.dataset.scheduleAdjust)));
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

export class HomeConnectControlCardEditor extends HTMLElementBase {
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
