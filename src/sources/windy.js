const { WMO, CODIGOS_TEMPESTADE } = require('./wmoCodes');
const { classificarEstadoMar } = require('./marine');
const { classificarPm25 } = require('./airQuality');
const ENDPOINT = 'https://api.windy.com/api/point-forecast/v2';
const TTL = 600000;
const PERIODOS = { manha: ['Manhã', 6, 12], tarde: ['Tarde', 12, 18], noite: ['Noite', 18, 24] };
const TIPOS = {0:'Sem precipitação',1:'Chuva',3:'Chuva congelante',5:'Neve',7:'Chuva e neve',8:'Pellets de gelo'};
const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = x => finite(x) ? Math.round(x * 10) / 10 : null;
const valid = a => a.filter(finite);
const max = a => valid(a).length ? Math.max(...valid(a)) : null;
const min = a => valid(a).length ? Math.min(...valid(a)) : null;
const mean = a => valid(a).length ? valid(a).reduce((x,y)=>x+y,0)/valid(a).length : null;
function converter(value, unit, target) {
  if (!finite(value)) return null;
  const u = String(unit ?? '').replace(/μ/g,'µ');
  const factors = {speed:{'m*s-1':3.6,'m/s':3.6,'km/h':1,'km*h-1':1},length:{m:1,cm:.01,mm:.001},rain:{mm:1,m:1000,'kg*m-2':1},seconds:{s:1},degrees:{deg:1,'°':1,degrees:1},percent:{'%':1,'':100,'1':100},pm:{'µg*m-3':1,'µg/m³':1,'ug/m3':1,'kg*m-3':1e9}};
  if (target === 'temperature') return u === 'K' ? value-273.15 : ['°C','C','degC'].includes(u) ? value : null;
  const factor = factors[target]?.[u];
  return factor == null ? null : value * factor;
}
function cardinal(deg) { return finite(deg) ? ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((deg%360+360)%360)/22.5)%16] : '—'; }
function vetor(u,v) {
  if (!finite(u)||!finite(v)) return {velocidadeKmh:null,direcaoGraus:null};
  return {velocidadeKmh:Math.hypot(u,v),direcaoGraus:Math.hypot(u,v)<.01?null:(Math.atan2(-u,-v)*180/Math.PI+360)%360};
}
function circular(values) {
  const a=valid(values); if(!a.length) return null;
  const x=mean(a.map(d=>Math.cos(d*Math.PI/180))), y=mean(a.map(d=>Math.sin(d*Math.PI/180)));
  return Math.hypot(x,y)<1e-8?null:(Math.atan2(y,x)*180/Math.PI+360)%360;
}
function bounds(now) {
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  return Date.parse(`${date}T00:00:00-03:00`);
}
function condicao(row) {
  if (row.warning != null && WMO[row.warning]) return {condicao:WMO[row.warning].completa,codigo:row.warning};
  if (row.ptype > 0 && TIPOS[row.ptype]) return {condicao:TIPOS[row.ptype],codigo:row.ptype===1?61:row.ptype===3?66:71};
  const cloud=max(row.clouds); if(cloud==null) return null;
  return {condicao:cloud<10?'Céu limpo':cloud<30?'Poucas nuvens':cloud<65?'Parcialmente nublado':cloud<90?'Nublado':'Encoberto',codigo:cloud<10?0:cloud<30?1:cloud<65?2:3};
}
// Only sum complete, non-overlapping preceding-three-hour windows. Never prorate rain.
function chuva(rows,start,end) {
  const byEnd=new Map(rows.filter(r=>finite(r.rain)).map(r=>[r.ts,r.rain]));
  let sum=0;
  for(let t=start+10800000;t<=end;t+=10800000){if(!byEnd.has(t))return null;sum+=byEnd.get(t);}
  return round(sum);
}
function normalizeWindyPointForecast(json, grupo, modelo, now=new Date()) {
  if(!Array.isArray(json.ts)||!json.ts.length) throw new Error('Windy: resposta sem série temporal.');
  const read=(name,i,type)=>Object.hasOwn(json.units||{},name+'-surface')?converter(json[name+'-surface']?.[i],json.units[name+'-surface'],type):null;
  const raw=(name,i)=>finite(json[name+'-surface']?.[i])?json[name+'-surface'][i]:null;
  const rows=json.ts.map((ts,i)=>({ts,temp:read('temp',i,'temperature'),rh:read('rh',i,'percent'),u:read('wind_u',i,'speed'),v:read('wind_v',i,'speed'),gust:read('gust',i,'speed'),rain:read('past3hprecip',i,'rain'),clouds:['lclouds','mclouds','hclouds'].map(k=>read(k,i,'percent')),ptype:raw('ptype',i),warning:raw('weatherwarnings',i),height:read('waves_height',i,'length'),period:read('waves_period',i,'seconds'),direction:read('waves_direction',i,'degrees'),swell:read('swell1_height',i,'length'),swellPeriod:read('swell1_period',i,'seconds'),swellDirection:read('swell1_direction',i,'degrees'),pm:read('pm2p5',i,'pm'),aqi:raw('aqi_us',i)})).filter(r=>finite(r.ts)&&!Number.isNaN(new Date(r.ts).getTime())).sort((a,b)=>a.ts-b.ts);
  const start=bounds(now), day=rows.filter(r=>r.ts>=start&&r.ts<start+86400000);
  const fonte=`Windy (${modelo})`;
  const meta={fonte,modelo,url:ENDPOINT,amostras:day.length,inicio:day[0]?.ts??null,fim:day.at(-1)?.ts??null};
  if(grupo==='air') {
    const samples=day.filter(r=>finite(r.pm));
    // Daily classification uses 24-hour coverage, not a few future samples.
    const complete=samples.length>=8&&samples[0].ts===start&&samples.at(-1).ts>=start+75600000&&samples.every((r,i)=>!i||r.ts-samples[i-1].ts<=10800000);
    const pm25Medio=complete?round(mean(samples.map(r=>r.pm))):null;return {...meta,pm25Medio,pm25Classificacao:classificarPm25(pm25Medio),aqiUsMax:max(day.map(r=>r.aqi))};}
  if(grupo==='sea') {
    const periodos=Object.values(PERIODOS).map(([periodo,a,b])=>{const rr=day.filter(r=>r.ts>=start+a*3600000&&r.ts<start+b*3600000);const alturaMaxM=round(max(rr.map(r=>r.height)));return {periodo,alturaMaxM,alturaMediaM:round(mean(rr.map(r=>r.height))),periodoOndaS:round(mean(rr.map(r=>r.period))),direcaoOnda:cardinal(circular(rr.map(r=>r.direction))),marulhoMaxM:round(max(rr.map(r=>r.swell))),periodoMarulhoS:round(mean(rr.map(r=>r.swellPeriod))),direcaoMarulho:cardinal(circular(rr.map(r=>r.swellDirection))),estadoMar:alturaMaxM==null?null:classificarEstadoMar(alturaMaxM)};});
    const alturaMaxDiaM=round(max(day.map(r=>r.height)));return {...meta,alturaMaxDiaM,estadoMarDia:classificarEstadoMar(alturaMaxDiaM),periodos};
  }
  const periodos=Object.fromEntries(Object.entries(PERIODOS).map(([k,[periodo,a,b]])=>{
    const rr=day.filter(r=>r.ts>=start+a*3600000&&r.ts<start+b*3600000), winds=rr.map(r=>vetor(r.u,r.v));
    const speed=round(max(winds.map(v=>v.velocidadeKmh))), direction=cardinal(circular(winds.map(v=>v.direcaoGraus)));
    return [k,{periodo,direcao:direction==='—'?null:direction,intensidadeVento:speed==null?null:`até ${speed} km/h`,rajadaMaxKmh:round(max(rr.map(r=>r.gust))),precipitacaoMm:chuva(rows,start+a*3600000,start+b*3600000),tempestade:rr.some(r=>CODIGOS_TEMPESTADE.has(r.warning))}];
  }));
  const nearest=rows.filter(r=>Math.abs(r.ts-now.getTime())<=5400000&&r.temp!=null).sort((a,b)=>Math.abs(a.ts-now.getTime())-Math.abs(b.ts-now.getTime()))[0];
  const condition=nearest?condicao(nearest):null;
  return {...meta,condicaoGeral:condition?.condicao??null,tempMin:round(min(day.map(r=>r.temp))),tempMax:round(max(day.map(r=>r.temp))),umidadeMin:round(min(day.map(r=>r.rh))),umidadeMax:round(max(day.map(r=>r.rh))),rajadaMaxKmh:round(max(day.map(r=>r.gust))),precipitacaoTotalMm:chuva(rows,start,start+86400000),temTempestadeHoje:day.some(r=>CODIGOS_TEMPESTADE.has(r.warning)),periodos,atual:nearest&&condition?{temperaturaC:round(nearest.temp),...condition,horario:new Date(nearest.ts).toISOString(),fonte,previsao:true,dia:null}:null};
}
function criarCliente({fetchImpl=(...a)=>fetch(...a),timeoutMs=15000,clock=Date.now,log=console.warn}={}) {
  const cache=new Map(), pending=new Map();
  return async function consultar(lat,lon,grupo) {
    const key=process.env.WINDY_API_KEY?.trim();
    if(!key) return null;
    if(!finite(lat)||!finite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) throw new Error('Coordenadas não configuradas para esta base.');
    const model=grupo==='sea'?(process.env.WINDY_SEA_MODEL||process.env.WINDY_MODELO_MAR||'gfsWave'):grupo==='air'?(process.env.WINDY_AIR_MODEL||'cams'):(process.env.POINT_FORECAST_MODEL||process.env.WINDY_MODELO||'gfs');
    const parameters=grupo==='sea'?['waves','swell1']:grupo==='air'?['pm2p5','aqi']:['temp','rh','precip','wind','windGust','lclouds','mclouds','hclouds','ptype',...(['icon','iconD2','iconEu'].includes(model)?['weatherWarnings']:[])];
    const id=JSON.stringify([lat,lon,grupo,model,key]);
    const cached=cache.get(id);if(cached&&clock()-cached.time<TTL){if(cached.error)throw new Error(cached.error);return normalizeWindyPointForecast(cached.data,grupo,model);}
    if(pending.has(id))return pending.get(id);
    const promise=(async()=>{
      let status=null;
      try {
        const r=await fetchImpl(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat,lon,model,parameters,levels:['surface'],key}),signal:AbortSignal.timeout(timeoutMs)});status=r.status;
        const errors={204:'Modelo sem os parâmetros solicitados',400:'Requisição inválida; confira modelo e parâmetros',401:'Chave Point recusada',403:'Chave Point ou restrição recusada',429:'Limite de consultas atingido',500:'Serviço Windy indisponível'};
        if(!r.ok||status===204)throw new Error(`Windy: ${errors[status]||'Falha da API'} (HTTP ${status}).`);
        const data=await r.json();
        if(data.warning&&/test|shuffl|development/i.test(String(data.warning)))throw new Error('Windy: dados de teste embaralhados recusados. Ative um plano Point operacional.');
        const result=normalizeWindyPointForecast(data,grupo,model);
        if(cache.size>100)cache.clear();cache.set(id,{time:clock(),data});return result;
      }catch(e){
        const message=e.name==='TimeoutError'||e.name==='AbortError'?'Windy: tempo limite de consulta excedido.':e.message?.startsWith('Windy:')?e.message:'Windy: falha de conexão ou resposta inválida.';
        cache.set(id,{time:clock(),error:message});log('[Windy]',{grupo,modelo:model,status});throw new Error(message);
      }finally{pending.delete(id);}
    })();pending.set(id,promise);return promise;
  };
}
const consultar=criarCliente();
async function buscarPacoteWindy(cidade) {
  const avisos=[];if(!process.env.WINDY_API_KEY?.trim()) return {avisos:['Windy não configurado (WINDY_API_KEY); usando as fontes disponíveis.']};
  const ponto=cidade.pontoMar||cidade;
  const groups=[['weather',cidade],['air',cidade],...(cidade.costeira?[['sea',ponto]]:[])];
  const data=await Promise.all(groups.map(async([group,p])=>{try{return [group,await consultar(p.latitude,p.longitude,group)];}catch(e){avisos.push(e.message);return [group,null];}}));
  return {...Object.fromEntries(data),avisos};
}
module.exports={buscarPacoteWindy,criarCliente,normalizeWindyPointForecast,converter,vetor,cardinal,circular,chuva,temChave:()=>Boolean(process.env.WINDY_API_KEY?.trim()),buscarWindy:(a,b)=>consultar(a,b,'weather'),buscarMarWindy:(a,b)=>consultar(a,b,'sea')};
