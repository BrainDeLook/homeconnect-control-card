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
export function updateCardDOM(root,html){
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
