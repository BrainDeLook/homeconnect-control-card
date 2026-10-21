import {controllable,planAction} from './core.mjs';

const UNITS={s:1,sec:1,seconds:1,min:60,minutes:60,h:3600,hr:3600,hours:3600};
export function secondsFromState(state){
  const unit=UNITS[state?.attributes?.unit_of_measurement||'s'];
  const n=Number(state?.state);
  return unit && state?.state!=='' && Number.isFinite(n) && n>0?n*unit:null;
}
export function programSeconds(hass,device){
  for(const role of ['remaining','estimated']) {
    const seconds=secondsFromState(hass.states[device.roles[role]]);
    if(seconds!==null)return seconds;
  }
  return null;
}
export function scheduleRange(hass,device,mode='finish'){
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
export function schedulePreview(hass,device,draft,now=Date.now()){
  const range=scheduleRange(hass,device,draft.mode);
  if(range.error)return range;
  const base=draft.base??now;
  const value=Number(draft.value??range.lower);
  const target=base+value*range.unit*1000;
  const start=draft.mode==='finish'?target-range.duration*1000:target;
  const end=draft.mode==='finish'?target:target+range.duration*1000;
  return {...range,value,start,end,target};
}
export function planScheduledStart(hass,device,draft,now=Date.now()){
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
