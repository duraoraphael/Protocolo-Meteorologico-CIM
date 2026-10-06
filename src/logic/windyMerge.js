// Merge only present values, recording the source of every replaced field.
function integrarWindy(base, mar, qualidadeAr, pacote, fonteBase) {
  const fontesPorCampo={};
  const merge=(target,incoming,keys,prefix,fallback)=>{
    const out={...target};
    for(const key of keys){
      const value=incoming?.[key];
      const use=value!=null&&value!=='—';
      if(use)out[key]=value;
      fontesPorCampo[prefix+key]=use?incoming.fonte:(target?.[key]!=null?fallback:'Indisponível');
    }
    return out;
  };
  const weather=pacote.weather;
  // Vento, rajada e chuva por período (e os totais do dia derivados deles)
  // vêm de uma única série: a horária da Open-Meteo, com as janelas 05h–12h,
  // 12h–18h e 18h–24h usadas no painel e nos PDFs. Misturar o Windy (amostras
  // de 3 h, outro modelo) só no painel fazia o mesmo período mostrar valores
  // diferentes em cada lugar. Sem Open-Meteo, o Windy segue como alternativa.
  const seriePeriodos=fonteBase==='Open-Meteo'?null:weather;
  base=merge(base,weather,['condicaoGeral','tempMin','tempMax','umidadeMin','umidadeMax'],'',fonteBase);
  base=merge(base,seriePeriodos,['rajadaMaxKmh','precipitacaoTotalMm'],'',fonteBase);
  fontesPorCampo.precipitacaoHorariaMaxMm=base.precipitacaoHorariaMaxMm!=null?fonteBase:'Indisponível';
  base.periodos={...base.periodos};
  for(const k of ['manha','tarde','noite']) {
    base.periodos[k]=merge(base.periodos[k],seriePeriodos?{...seriePeriodos.periodos[k],fonte:seriePeriodos.fonte}:null,['direcao','intensidadeVento','rajadaMaxKmh','precipitacaoMm'],`periodos.${k}.`,fonteBase);
    base.periodos[k].tempestade=Boolean(base.periodos[k].tempestade||weather?.periodos[k].tempestade);
    fontesPorCampo[`periodos.${k}.probabilidadeChuva`]=base.periodos[k].probabilidadeChuva==null?'Indisponível':'Open-Meteo';
  }
  base.temTempestadeHoje=Boolean(base.temTempestadeHoje||weather?.temTempestadeHoje);

  const atual=weather?.atual||base.atual;
  fontesPorCampo.atual=atual?.fonte||(atual?'Open-Meteo':'Indisponível');
  if(pacote.sea?.alturaMaxDiaM!=null){
    const previous=mar;
    mar=merge(mar,pacote.sea,['alturaMaxDiaM','estadoMarDia'],'mar.','Open-Meteo Marine');
    mar.fonte=pacote.sea.fonte;
    mar.periodos=pacote.sea.periodos.map((p,i)=>merge(previous?.periodos?.[i],{...p,fonte:pacote.sea.fonte},['periodo','alturaMaxM','alturaMediaM','periodoOndaS','direcaoOnda','marulhoMaxM','estadoMar','periodoMarulhoS','direcaoMarulho'],`mar.${i}.`,'Open-Meteo Marine'));
  }else fontesPorCampo['mar.alturaMaxDiaM']=mar?'Open-Meteo Marine':'Indisponível';
  if(pacote.air?.pm25Medio!=null){
    qualidadeAr=merge(qualidadeAr,pacote.air,['pm25Medio','pm25Classificacao','aqiUsMax'],'ar.','Open-Meteo Air Quality');
    qualidadeAr.pm25Periodo='média das amostras previstas para hoje';
  }else fontesPorCampo['ar.pm25Medio']=qualidadeAr?.pm25Medio!=null?'Open-Meteo Air Quality':'Indisponível';
  fontesPorCampo['ar.uvMax']=qualidadeAr?.uvMax!=null?'Open-Meteo Air Quality':'Indisponível';
  fontesPorCampo['mar.temperaturaMarC']=mar?.temperaturaMarC!=null?'Open-Meteo Marine':'Indisponível';
  return {base,mar,qualidadeAr,atual,fontesPorCampo};
}
module.exports={integrarWindy};
