const form = document.getElementById('consulta');
const base = document.getElementById('base');
const localInput = document.getElementById('local');
const statusEl = document.getElementById('status');
const results = document.getElementById('resultados');
const localFilter = document.getElementById('local-retornado');
let areas = [], response = null, controller = null;
const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value = v => v == null || v === '' ? '—' : typeof v === 'number' ? new Intl.NumberFormat('pt-BR',{maximumFractionDigits:8}).format(v) : escape(v);
function clearResults() {
 controller?.abort();controller=null;response=null;results.hidden=true;
 document.getElementById('consultar').disabled=false;
 document.getElementById('consultar').textContent='Consultar previsão';
 results.setAttribute('aria-busy','false');statusEl.dataset.error='false';
 statusEl.textContent='Informe os parâmetros e consulte a previsão.';
}
base.addEventListener('change',()=>{
 clearResults();const selected=areas.find(a=>a.chave===base.value);
 localInput.value=selected?.local || '';
 document.getElementById('vinculo').textContent=selected?.local ? 'Local associado a esta base na configuração do projeto.' : 'Esta base ainda não possui vínculo confirmado no Oceanop. Informe o identificador correto; o nome do município pode não ser aceito pela fonte.';
});
localInput.addEventListener('input',clearResults);
async function loadAreas(){
 try{
 const r=await fetch('/api/oceanop/areas');if(!r.ok)throw new Error('Não foi possível carregar as bases. Reinicie o servidor atualizado e recarregue esta página.');
 const data=await r.json();if(!data.ok)throw new Error('Não foi possível carregar as bases.');
 areas=data.areas;base.innerHTML=areas.map(a=>`<option value="${escape(a.chave)}">${escape(a.nome)} — ${escape(a.uf)}</option>`).join('');
 const fromUrl=new URLSearchParams(location.search).get('cidade');if(areas.some(a=>a.chave===fromUrl))base.value=fromUrl;
 base.dispatchEvent(new Event('change'));
 }catch(e){statusEl.dataset.error='true';statusEl.textContent=e.message;base.innerHTML='<option value="">Bases indisponíveis</option>'}
}
function render(){
 if(!response)return;
 const rows=response.previsoes.filter(r=>!localFilter.value||r.local===localFilter.value);
 document.getElementById('previsoes').innerHTML=rows.map(r=>`<tr><td>${escape(r.local)||'—'}<small>Escrita na fonte: ${escape(r.escritoEm)||'—'}</small></td><td>${escape(r.inicio)||'—'}</td><td>${escape(r.fim)||'—'}</td>${['Temperatura','VelocidadeVento','VelocidadeVento_10M_Rajada','AlturaMaximaOnda','Precipitacao'].map(k=>`<td>${value(r.valores[k])}</td>`).join('')}<td><details><summary>Ver parâmetros</summary><dl>${response.campos.map(c=>`<div><dt>${escape(c.rotulo)}</dt><dd>${value(r.valores[c.chave])}</dd></div>`).join('')}</dl></details></td></tr>`).join('');
}
localFilter.addEventListener('change',render);
form.addEventListener('submit',async e=>{
 e.preventDefault();clearResults();const request=new AbortController();controller=request;
 const button=document.getElementById('consultar');button.disabled=true;button.textContent='Consultando…';
 results.setAttribute('aria-busy','true');statusEl.textContent='Consultando Oceanop…';
 try{
 const params=new URLSearchParams({local:localInput.value.trim()});
 const r=await fetch(`/api/oceanop/previsao?${params}`,{signal:request.signal});
 const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.erro||'Não foi possível consultar o Oceanop.');
 if(controller!==request)return;response=data;
 statusEl.textContent=data.previsoes.length ? `${data.previsoes.length} intervalos retornados pela fonte.` : 'Nenhuma previsão encontrada para este local.';
 if(!data.previsoes.length)return;
 localFilter.innerHTML='<option value="">Todos os locais retornados</option>'+[...new Set(data.previsoes.map(r=>r.local).filter(Boolean))].map(p=>`<option value="${escape(p)}">${escape(p)}</option>`).join('');
 document.getElementById('resultado-titulo').textContent=`Local: ${data.consulta.local}`;
 document.getElementById('consulta-info').textContent=`Consulta realizada em ${new Date(data.consultadoEm).toLocaleString('pt-BR')} · Confira o local retornado antes de associar os dados à base.`;
 results.hidden=false;render();
 }catch(e){if(e.name!=='AbortError'&&controller===request){statusEl.dataset.error='true';statusEl.textContent=e.message}}
 finally{if(controller===request){button.disabled=false;button.textContent='Consultar previsão';results.setAttribute('aria-busy','false')}}
});
loadAreas();
