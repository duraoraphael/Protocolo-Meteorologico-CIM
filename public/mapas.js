(() => {
  'use strict';
  const baseEl=document.getElementById('cim-map-base'),layerEl=document.getElementById('cim-map-layer'),statusEl=document.getElementById('cim-map-status'),centerEl=document.getElementById('cim-map-center'),pickerEl=document.getElementById('cim-map-picker');
  let config, api, starting=false, disposed=false, marker, initTimer;
  const listeners=[], scripts=new Map();
  const desktop=()=>matchMedia('(pointer:fine)').matches;
  const status=text=>{statusEl.textContent=text;};
  const base=()=>config?.bases.find(b=>b.chave===baseEl.value);
  const coordinates=b=>b&&Number.isFinite(b.latitude)&&Number.isFinite(b.longitude)&&Math.abs(b.latitude)<=90&&Math.abs(b.longitude)<=180;
  const names={wind:'Vento',rain:'Chuva (acumulado)',temp:'Temperatura',clouds:'Nuvens',waves:'Ondas',radar:'Radar'};
  function listen(target,event,fn){target.on(event,fn);listeners.push(()=>target.off(event,fn));}
  function load(src){
    if(scripts.has(src))return scripts.get(src);
    const promise=new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.async=true;const timer=setTimeout(()=>reject(new Error('Tempo limite ao carregar a biblioteca do mapa.')),20000);el.onload=()=>{clearTimeout(timer);resolve();};el.onerror=()=>{clearTimeout(timer);reject(new Error('Não foi possível carregar a biblioteca do mapa. Verifique a conexão.'));};document.head.append(el);});
    scripts.set(src,promise);return promise;
  }
  function changeBase(){
    const b=base();if(!coordinates(b)){status('Coordenadas não configuradas para esta base.');centerEl.disabled=true;pickerEl.disabled=true;return;}
    const url=new URL(location.href);url.searchParams.set('cidade',b.chave);history.replaceState({},'',url);document.getElementById('cim-map-home').href=`/?cidade=${encodeURIComponent(b.chave)}`;
    if(!api)return;
    api.picker.close();api.map.setView([b.latitude,b.longitude],9);marker?.remove();marker=L.marker([b.latitude,b.longitude]).addTo(api.map);const text=document.createElement('span');text.textContent=`${b.nome} — ${b.uf}`;marker.bindPopup(text);
    centerEl.disabled=false;pickerEl.disabled=!desktop();status(`Mapa centrado em ${b.nome} — ${b.uf}.`);
  }
  function layerOptions(){
    const allowed=api.store.getAllowed('overlay');const set=new Set(Array.isArray(allowed)?allowed:Object.keys(allowed||{}));
    layerEl.replaceChildren();for(const [id,label] of Object.entries(names))if(set.has(id))layerEl.add(new Option(label,id));
    layerEl.disabled=!layerEl.options.length;
    if(set.has(api.store.get('overlay')))layerEl.value=api.store.get('overlay');
    if(!layerEl.value&&layerEl.options.length){layerEl.selectedIndex=0;api.store.set('overlay',layerEl.value);}
  }
  async function start(){
    if(starting)return;starting=true;
    try{
      const r=await fetch('/api/windy/map-config',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Configuração do mapa indisponível.');config=await r.json();
      for(const b of config.bases)baseEl.add(new Option(`${b.nome} — ${b.uf}`,b.chave));baseEl.disabled=false;
      const selected=new URLSearchParams(location.search).get('cidade');baseEl.value=config.bases.some(b=>b.chave===selected)?selected:config.ativa;changeBase();
      if(!config.configurado){status(config.mensagem);return;}
      if(!coordinates(base())){status('Coordenadas não configuradas para esta base.');return;}
      status('Carregando mapa Windy…');
      await load('https://unpkg.com/leaflet@1.4.0/dist/leaflet.js');await load('https://api.windy.com/assets/map-forecast/libBoot.js');
      if(disposed)return;
      initTimer=setTimeout(()=>status('O Windy não concluiu a inicialização. Confira a chave Map, o plano e as restrições de domínio no painel Windy.'),25000);
      windyInit({key:config.key,lat:base().latitude,lon:base().longitude,zoom:9,verbose:false},instance=>{
        clearTimeout(initTimer);if(disposed)return;api=instance;changeBase();layerOptions();
        listen(api.store,'overlay',value=>{layerEl.value=value;status(`Camada: ${names[value]||'selecionada no Windy'}.`);});
        listen(api.store,'product',layerOptions);
        listen(api.map,'click',event=>{if(desktop())api.picker.open({lat:event.latlng.lat,lon:event.latlng.lng});});
        listen(api.picker,'pickerOpened',()=>status('Consulta do ponto aberta no mapa Windy.'));
        listen(api.picker,'pickerClosed',()=>status('Consulta do ponto encerrada.'));
        api.map.invalidateSize();
      });
    }catch(e){status(e.message==='Configuração do mapa indisponível.'?e.message:'Mapa indisponível. Verifique a conexão, a chave Map Forecast e as restrições de domínio no Windy.');}
  }
  baseEl.addEventListener('change',changeBase);centerEl.addEventListener('click',changeBase);
  layerEl.addEventListener('change',()=>{try{api.store.set('overlay',layerEl.value);}catch{status('Camada não disponível nesta configuração do Windy.');}});
  pickerEl.addEventListener('click',()=>{const b=base();if(api&&coordinates(b)&&desktop())api.picker.open({lat:b.latitude,lon:b.longitude});});
  const resize=()=>{api?.map.invalidateSize();pickerEl.disabled=!api||!desktop();};window.addEventListener('resize',resize);
  window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;clearTimeout(initTimer);listeners.splice(0).forEach(off=>off());api?.picker.close();marker?.remove();api?.map.remove();window.removeEventListener('resize',resize);});
  window.addEventListener('pageshow',event=>{if(event.persisted)resize();});
  start();
})();
