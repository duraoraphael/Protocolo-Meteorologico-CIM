/* Presentation components. Values come exclusively from /api/preview. */
const Dashboard = (() => {
  const escape = (value) => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    cloud: '<path d="M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11 2 4 4 0 0 1 0 8Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    rain: '<path d="M5 15a4 4 0 0 1 1-8 6 6 0 0 1 11 1 4 4 0 0 1 1 8M8 18l-1 3m6-3-1 3m6-3-1 3"/>',
    storm: '<path d="M5 15a4 4 0 0 1 1-8 6 6 0 0 1 11 1 4 4 0 0 1 1 8M12 12l-3 6h5l-3 5"/>',
    snow: '<path d="M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3"/>',
    fog: '<path d="M3 8h18M5 12h14M3 16h18M7 20h10"/>',
    thermometer: '<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z"/><path d="M12 7v10"/><circle cx="12" cy="18" r="1"/>',
    drop: '<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/>',
    wind: '<path d="M2 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M2 16h6a3 3 0 1 1-3 3"/>',
    leaf: '<path d="M20 3C8 2 2 8 5 15s17 6 15-12ZM4 21 15 10"/>',
    waves: '<path d="M2 6q3-4 6 0t6 0 8 0M2 12q3-4 6 0t6 0 8 0M2 18q3-4 6 0t6 0 8 0"/>',
    alert: '<path d="m12 3 10 18H2Z M12 9v5m0 3v1"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
    globe: '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>',
  };
  const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cloud}</svg>`;
  const weatherIcon = (code, day = true) => code == null ? 'cloud' : code >= 95 ? 'storm' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : code >= 51 ? 'rain' : code >= 45 ? 'fog' : code < 2 ? (day == null ? 'cloud' : day ? 'sun' : 'moon') : 'cloud';
  const unit = (value, suffix) => value == null ? '—' : `${escape(value)}${suffix}`;
  const pair = (a, b, suffix) => a == null && b == null ? '—' : `${unit(a, suffix)} / ${unit(b, suffix)}`;
  function metric(label, value, detail, name, extra = '', source = '') {
    return `<article class="card ${extra}"><div class="metric-heading">${icon(name)}<h2 class="rotulo">${label}</h2></div><div class="valor">${value}</div><p class="detalhe">${escape(detail)}</p>${source ? `<p class="metric-source">${escape(source)}</p>` : ''}</article>`;
  }
  function metrics(r) {
    const gusts = (r.ventoPorPeriodo || []).map(p => p.rajadaMaxKmh).filter(v => v != null);
    const aq = r.qualidadeAr;
    const fields = r.fontesPorCampo || {};
    const sources = (...keys) => [...new Set(keys.map(k=>fields[k]).filter(Boolean))].join(' · ');
    return `<section class="grid-cards" aria-label="Indicadores meteorológicos">${[
      metric('Condição geral', escape(r.condicaoGeral), fields.condicaoGeral?.startsWith('Windy') ? 'Previsão no horário de referência' : 'Previsão para o dia', 'cloud', 'condition', sources('condicaoGeral')),
      metric('Temperatura', pair(r.tempMin, r.tempMax, '°'), 'Mínima / máxima · °C', 'thermometer', '', sources('tempMin','tempMax')),
      metric('Umidade relativa', pair(r.umidadeMin, r.umidadeMax, '%'), 'Mínima / máxima prevista', 'drop', '', sources('umidadeMin','umidadeMax')),
      metric('Rajada de vento máx.', unit(gusts.length ? Math.max(...gusts) : null, ' <small>km/h</small>'), 'Pico previsto no dia', 'wind', '', sources('periodos.manha.rajadaMaxKmh','periodos.tarde.rajadaMaxKmh','periodos.noite.rajadaMaxKmh')),
      metric('Índice UV máx.', escape(aq?.uvMax), aq?.uvClassificacao?.nivel || 'Dado indisponível', 'sun', `uv-${['baixo','moderado','alto','muito_alto','extremo'].includes(aq?.uvClassificacao?.categoria) ? aq.uvClassificacao.categoria : 'ausente'}`, sources('ar.uvMax')),
      metric('Qualidade do ar (PM2,5)', escape(aq?.pm25Classificacao?.nivel), aq?.pm25Medio == null ? 'Dado indisponível' : `${aq.pm25Medio} µg/m³ · ${aq.pm25Periodo || 'média diária'}`, 'leaf', 'air', sources('ar.pm25Medio')),
      metric('Mar — altura máx. de onda', unit(r.mar?.alturaMaxDiaM, ' <small>m</small>'), r.mar?.estadoMarDia || 'Sem dados marítimos para esta base', 'waves', '', sources('mar.alturaMaxDiaM')),
    ].join('')}</section>`;
  }
  function table(title, name, headers, rows, detail) {
    return `<section class="secao-periodos"><div class="section-heading"><h2>${icon(name)}${title}</h2><button class="text-link" data-detail="${detail}">Ver mais <span aria-hidden="true">→</span></button></div><div class="table-scroll" tabindex="0" role="region" aria-label="${title}"><table class="tabela-periodos"><caption class="sr-only">${title}</caption><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map((v, i) => i === 0 ? `<th scope="row">${v}</th>` : `<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty-table">Dados indisponíveis para esta base.</td></tr>`}</tbody></table></div></section>`;
  }
  function marine(r) {
    return table('Condições de mar por período', 'waves', ['Período', 'Estado do mar', 'Altura máx.', 'Período de onda', 'Direção', 'Marulho'], (r.mar?.periodos || []).map(p => [escape(p.periodo), escape(p.estadoMar), unit(p.alturaMaxM,' m'), unit(p.periodoOndaS,' s'), escape(p.direcaoOnda), unit(p.marulhoMaxM,' m')]), 'mar');
  }
  function windRain(r) {
    return table('Vento e chuva por período', 'wind', ['Período', 'Vento', 'Rajada', 'Chance de chuva', 'Acumulado'], (r.ventoPorPeriodo || []).map(v => {
      const c = r.chuvaPorPeriodo?.find(p => p.periodo === v.periodo);
      return [escape(v.periodo), `${escape(v.direcao)} · ${escape(v.intensidade)}`, unit(v.rajadaMaxKmh,' km/h'), unit(c?.probabilidade,'%'), unit(c?.precipitacaoMm,' mm')];
    }), 'vento');
  }
  function priority(r) {
    const e = r.eventoMaisRelevante;
    const severity = e?.nivel >= 5 ? 'extremo' : e?.nivel >= 3 ? 'perigo' : e?.nivel >= 2 ? 'atencao' : 'informativo';
    return `<section class="faixa-evento nivel-${severity}" aria-label="Evento mais relevante do dia">${icon('alert')}<div class="texto"><h2>Evento mais relevante do dia</h2><p>${e ? `${escape(e.descricao)} — janela prevista: ${escape(e.janela)}` : r.avisosColeta?.length ? 'Coleta parcial: consulte a disponibilidade das fontes antes de avaliar as condições.' : 'Sem evento extremo identificado nas fontes consultadas.'}</p>${r.avisosColeta?.length ? '<span class="collection-note">Coleta parcial · consulte os detalhes das fontes</span>' : ''}</div><button class="text-link" data-detail="monitoramento">Ver detalhes <span aria-hidden="true">→</span></button></section>`;
  }
  function currentWeather(r) {
    const a = r.atual;
    const time = a?.previsao && Number.isFinite(Date.parse(a.horario)) ? new Date(a.horario).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : null;
    return `<div class="current-location">${escape(r.cidade.nome)} — ${escape(r.cidade.uf)}</div><div class="current-reading">${icon(weatherIcon(a?.codigo, a?.dia))}<div><strong>${unit(a?.temperaturaC, '<small>°C</small>')}</strong><p>${escape(a?.condicao || 'Condição atual indisponível')}</p></div></div><div class="current-source">${a ? escape(`${a.previsao ? 'Previsão próxima ao horário atual' : 'Condição atual'} · ${a.fonte || 'Open-Meteo'}${time ? ' · '+time+' (Brasília)' : ''}`) : 'Aguardando dados da fonte'}</div>`;
  }
  function details(r, type) {
    if (type === 'sobre') return '<p>O painel CIM integra informações meteorológicas para apoiar a tomada de decisão operacional.</p><p>Fontes: Windy Point (previsão, ondas e PM2,5 quando disponível), Open-Meteo (previsão numérica, condições atuais, mar, UV e qualidade do ar) e INMET (previsão oficial e avisos de perigo).</p><p>Atualização automática a cada 10 minutos. Dados de referência: consulte também a Defesa Civil local para confirmação operacional.</p>';
    if (!r) return '<p>Os dados desta base ainda não estão disponíveis.</p>';
    if (type === 'mar') return `${marine(r)}<p>Ponto de referência: ${escape(r.mar?.referenciaPonto)}</p><p>Temperatura da água: ${unit(r.mar?.temperaturaMarC, '°C')}</p>`;
    if (type === 'vento') return `${windRain(r)}<h3>Referências INMET</h3>${(r.ventoPorPeriodo || []).map(p => `<p>${escape(p.periodo)}: ${escape(p.referenciaInmet)}</p>`).join('')}`;
    const fieldLabel = campo => {
      const labels={condicaoGeral:'Condição geral',atual:'Condições do horário atual',tempMin:'Temperatura mínima',tempMax:'Temperatura máxima',umidadeMin:'Umidade mínima',umidadeMax:'Umidade máxima',rajadaMaxKmh:'Rajada máxima',precipitacaoTotalMm:'Chuva total do dia',direcao:'Direção do vento',intensidadeVento:'Vento',precipitacaoMm:'Chuva acumulada',probabilidadeChuva:'Chance de chuva',alturaMaxDiaM:'Altura máxima de onda',temperaturaMarC:'Temperatura da água',pm25Medio:'PM2,5',uvMax:'Índice UV',aqiUsMax:'Índice de qualidade do ar (US)'};
      const parts=campo.split('.'), key=parts.at(-1), periods={manha:'Manhã',tarde:'Tarde',noite:'Noite'};
      return labels[key] ? (periods[parts[1]] ? periods[parts[1]]+' · ' : '')+labels[key] : null;
    };
    const list = (items) => `<ul>${items.map(x => `<li>${escape(x)}</li>`).join('')}</ul>`;
    return `<h3>Evento do dia</h3><p>${escape(r.eventoMaisRelevante?.descricao || 'Sem evento extremo identificado nas fontes consultadas.')}</p><h3>Avisos oficiais INMET</h3>${r.avisosInmet?.length ? r.avisosInmet.map(a => `<article class="aviso-item"><strong>${escape(a.severidade)}</strong><p>${escape(a.descricao)}</p><small>Vigência: ${escape(a.inicio)} até ${escape(a.fim)}</small></article>`).join('') : '<p>Nenhum aviso retornado pela fonte.</p>'}${r.avisosColeta?.length ? `<h3>Disponibilidade das fontes</h3>${list(r.avisosColeta)}` : ''}${r.divergencias?.length ? `<h3>Divergências entre fontes</h3>${list(r.divergencias)}` : ''}<h3>Destinatários desta base</h3><div id="lista-destinatarios-painel">Carregando…</div><h3>Fonte por campo</h3>${list(Object.entries(r.fontesPorCampo || {}).filter(([campo]) => fieldLabel(campo)).map(([campo,fonte]) => `${fieldLabel(campo)}: ${fonte}`))}<h3>Fontes automatizadas</h3>${list((r.fontesAutomatizadas || []).map(f => `${f.nome}: ${f.uso}`))}`;
  }
  return { escape, icon, currentWeather, details, home: r => `${priority(r)}${metrics(r)}<div class="tables-grid">${marine(r)}${windRain(r)}</div>` };
})();
