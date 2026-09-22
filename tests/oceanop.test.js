const test=require('node:test');const assert=require('node:assert/strict');
const {numero,normalizarResposta,buscarOceanop,validarConsulta}=require('../src/sources/oceanop');
test('comma decimals, zero and missing values',()=>{assert.equal(numero('24,67'),24.67);assert.equal(numero('0'),0);for(const v of ['',null,' ','2,3,4'])assert.equal(numero(v),null)});
test('corrected area schema preserves dates, fields and unknown coordinates',()=>{
 const [p]=normalizarResposta({success:true,data:[{Local:'Sururu',DataInicial:'18/03/2026 09:00:00',DataFinal:'18/03/2026 09:59:59',DataEscrita:'18/03/2026 06:01:03',Temperatura:'24,67',VelocidadeVento_10M_Rajada:'4,99',VelocidadeVento_100M:'2,91',Precipitacao:'0',Latitude:'0',Longitude:'0',Confiabilidaae:'',PressaoNivelMar:'101276,42',Condicao_Clima:'cloudy',Cobertura_Nuvem_Alta:'1'}]});
 assert.equal(p.local,'Sururu');assert.equal(p.inicio,'18/03/2026 09:00:00');assert.equal(p.fim,'18/03/2026 09:59:59');assert.equal(p.escritoEm,'18/03/2026 06:01:03');
 assert.equal(p.valores.Temperatura,24.67);assert.equal(p.valores.VelocidadeVento_10M_Rajada,4.99);assert.equal(p.valores.VelocidadeVento_100M,2.91);assert.equal(p.valores.PressaoNivelMar,101276.42);assert.equal(p.valores.Condicao_Clima,'cloudy');assert.equal(p.valores.Confiabilidaae,null);assert.equal(p.valores.Latitude,0);assert.equal(p.valores.Cobertura_Nuvem_Alta,1);assert.equal(p.valores.Precipitacao,0);assert.equal(p.valores.Visibilidade,null);assert.equal(Object.hasOwn(p,'plataforma'),false);
});
test('empty and malformed upstream results',()=>{assert.deepEqual(normalizarResposta({success:true,data:[]}),[]);for(const v of [{success:false,data:[]},{success:true,data:{}},{success:true,data:[null]}])assert.throws(()=>normalizarResposta(v))});
test('invalid local rejected before fetching',async()=>{assert.throws(()=>validarConsulta(['sururu']),{status:400});await assert.rejects(buscarOceanop('',()=>assert.fail('network')),{status:400})});
test('only local query is sent to corrected endpoint',async()=>{
 const result=await buscarOceanop('área & teste',async url=>{assert.equal(url.hostname,'oceanop-api-disp.petrobras.com.br');assert.equal(url.pathname,'/api/v1/previsao/JsonPrevisaoAreaAsync');assert.deepEqual([...url.searchParams],[['local','área & teste']]);return {ok:true,json:async()=>({success:true,data:[]})}});
 assert.deepEqual(result.consulta,{local:'área & teste'});
});
test('safe DNS, permission and HTML errors',async()=>{
 await assert.rejects(buscarOceanop('sururu',async()=>{throw Object.assign(new Error('secret'),{cause:{code:'ENOTFOUND'}})}),/não resolvido/);
 await assert.rejects(buscarOceanop('sururu',async()=>({ok:false,status:403})),/autorização/);
 await assert.rejects(buscarOceanop('sururu',async()=>({ok:true,json:async()=>{throw new Error('private')}})),/não retornou JSON/);
});
