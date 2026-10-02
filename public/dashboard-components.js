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
    octagon: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8Z"/><path d="M12 7v6m0 3v1"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 8v5m0 3v1"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
    globe: '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>',
    megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h3l8 5V4L7 9H4a1 1 0 0 0-1 1Z"/><path d="M7 15l1.5 5h3L10 16.5M19 9a4 4 0 0 1 0 6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cloud}</svg>`;
  const weatherIcon = (code, day = true) => code == null ? 'cloud' : code >= 95 ? 'storm' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : code >= 51 ? 'rain' : code >= 45 ? 'fog' : code < 2 ? (day == null ? 'cloud' : day ? 'sun' : 'moon') : 'cloud';
  const unit = (value, suffix) => value == null ? '—' : `${escape(value)}${suffix}`;
  const pair = (a, b, suffix) => a == null && b == null ? '—' : `${unit(a, suffix)} / ${unit(b, suffix)}`;
  const list = (items) => `<ul>${items.map(x => `<li>${escape(x)}</li>`).join('')}</ul>`;
  // Níveis do protocolo: nomes preservados, cores do painel por gravidade.
  const NIVEIS = {
    'EMERGÊNCIA': { classe:'emergencia', icone:'octagon' },
    'ALERTA': { classe:'alerta', icone:'alert' },
    'ATENÇÃO': { classe:'atencao', icone:'info' },
  };
  const nivel = (grau) => NIVEIS[grau] || { classe:'indefinido', icone:'info' };
  function metric(label, value, detail, name, extra = '', source = '', badge = '') {
    return `<article class="card ${extra}"><div class="metric-heading">${icon(name)}<h2 class="rotulo">${label}</h2>${badge}</div><div class="valor">${value}</div><p class="detalhe">${escape(detail)}</p>${source ? `<p class="metric-source">${escape(source)}</p>` : ''}</article>`;
  }
  function dateTimeBrasilia(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    return new Intl.DateTimeFormat('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)).replace(',', '');
  }

  // Card compacto "Calor e Saúde": selo discreto quando normal; dado ausente
  // ou desatualizado nunca aparece como "Normal".
  function heatCard(r) {
    const integracao = r.climaSaude;
    const dados = integracao?.dados;
    const fonte = dados?.source || 'Clima e Saúde — Ministério da Saúde';
    if (!integracao || integracao.status === 'nao_configurada') {
      return metric('Calor e Saúde', 'Não configurado', 'Fonte não configurada para esta base', 'thermometer', 'heat span-2', fonte, '<span class="selo selo-neutro">Sem dado</span>');
    }
    if (!dados) {
      return metric('Calor e Saúde', 'Indisponível', integracao.mensagem || 'Dados indisponíveis nesta atualização', 'thermometer', 'heat span-2 heat-indisponivel', fonte, '<span class="selo selo-indisponivel">Indisponível</span>');
    }
    const grau = dados.nivel?.grau || 'NORMAL';
    const classificacao = dados.ehf?.classificacao;
    const valor = /^sem excesso$/i.test(classificacao || '') ? 'Sem excesso de calor' : classificacao ? `EHF ${escape(classificacao)}` : 'Classificação indisponível';
    const maxima = dados.temperatura?.maxima == null ? 'Máxima prevista indisponível' : `Máxima prevista ${dados.temperatura.maxima} °C`;
    // EHF é diário: coleta válida do mesmo dia (Brasília) segue atual, ainda
    // que lida do armazenamento; de outro dia (ou sem data) é desatualizada.
    const diaBrasilia = (v) => Number.isFinite(Date.parse(v || '')) ? new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo' }).format(new Date(v)) : null;
    const atual = Boolean(diaBrasilia(dados.consultadoEm)) && diaBrasilia(dados.consultadoEm) === diaBrasilia(new Date().toISOString());
    if (!atual) {
      const coleta = dateTimeBrasilia(dados.consultadoEm) || 'horário indisponível';
      return metric('Calor e Saúde', valor, `${maxima} · última coleta válida: ${coleta}`, 'thermometer', 'heat span-2 heat-desatualizado', fonte, '<span class="selo selo-indisponivel">Desatualizado</span>');
    }
    const selo = grau === 'NORMAL'
      ? '<span class="selo selo-normal">Normal</span>'
      : `<span class="selo selo-${nivel(grau).classe}">${escape(grau)}${dados.nivel?.protocolo ? ` · ${escape(dados.nivel.protocolo)}` : ''}</span>`;
    const coleta = integracao.status === 'operacional' ? '' : ` · coleta de ${dateTimeBrasilia(dados.consultadoEm)}`;
    return metric('Calor e Saúde', valor, `${maxima}${coleta}`, 'thermometer', `heat span-2${grau === 'NORMAL' ? '' : ` heat-${nivel(grau).classe}`}`, fonte, selo);
  }

  // Indicadores marítimos só para bases em que o monitoramento de mar se aplica.
  function marAplicavel(r) {
    const marinha = (r.monitoramentoApis || []).find(api => api.id === 'open-meteo-marine');
    return Boolean(r.mar) || (marinha ? marinha.status !== 'nao_aplicavel' : false);
  }
  function metrics(r) {
    const gusts = (r.ventoPorPeriodo || []).map(p => p.rajadaMaxKmh).filter(v => v != null);
    const aq = r.qualidadeAr;
    const fields = r.fontesPorCampo || {};
    const sources = (...keys) => [...new Set(keys.map(k=>fields[k]).filter(Boolean))].join(' · ');
    const comMar = marAplicavel(r);
    const cards = [
      metric('Temperatura', pair(r.tempMin, r.tempMax, '°'), 'Mínima / máxima · °C', 'thermometer', '', sources('tempMin','tempMax')),
      metric('Umidade relativa', pair(r.umidadeMin, r.umidadeMax, '%'), 'Mínima / máxima prevista', 'drop', '', sources('umidadeMin','umidadeMax')),
      metric('Rajada prevista', unit(gusts.length ? Math.max(...gusts) : null, ' <small>km/h</small>'), 'Pico previsto no dia', 'wind', '', sources('periodos.manha.rajadaMaxKmh','periodos.tarde.rajadaMaxKmh','periodos.noite.rajadaMaxKmh')),
      metric('Chuva acumulada', unit(r.precipitacaoTotalMm, ' <small>mm</small>'), 'Acumulado previsto no dia', 'rain', '', sources('precipitacaoTotalMm')),
      metric('Índice UV máx.', escape(aq?.uvMax), aq?.uvClassificacao?.nivel || 'Dado indisponível', 'sun', `uv-${['baixo','moderado','alto','muito_alto','extremo'].includes(aq?.uvClassificacao?.categoria) ? aq.uvClassificacao.categoria : 'ausente'}`, sources('ar.uvMax')),
      metric('Condição geral', escape(r.condicaoGeral), fields.condicaoGeral?.startsWith('Windy') ? 'Previsão no horário de referência' : 'Previsão para o dia', 'cloud', `condition${comMar ? '' : ' span-2'}`, sources('condicaoGeral')),
      metric('Qualidade do ar', escape(aq?.pm25Classificacao?.nivel), '', 'leaf', 'air', sources('ar.pm25Medio')),
      comMar ? metric('Mar — altura máx. de onda', r.mar?.alturaMaxDiaM == null ? 'Indisponível' : unit(r.mar.alturaMaxDiaM, ' <small>m</small>'), r.mar?.desatualizado ? `Dado armazenado · última atualização válida: ${dateTimeBrasilia(r.mar?.ultimaAtualizacao) || 'horário indisponível'}` : r.mar?.estadoMarDia || 'Dados marítimos indisponíveis', 'waves', '', sources('mar.alturaMaxDiaM')) : '',
      heatCard(r),
    ];
    return `<section class="indicadores" aria-labelledby="titulo-indicadores"><h2 id="titulo-indicadores" class="bloco-titulo">Indicadores meteorológicos</h2><div class="grid-cards">${cards.join('')}</div></section>`;
  }

  function table(title, name, headers, rows, detail) {
    return `<section class="secao-periodos"><div class="section-heading"><h2>${icon(name)}${title}</h2><button class="text-link" data-detail="${detail}">Ver mais <span aria-hidden="true">→</span></button></div><div class="table-scroll" tabindex="0" role="region" aria-label="${title}"><table class="tabela-periodos"><caption class="sr-only">${title}</caption><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map((v, i) => i === 0 ? `<th scope="row">${v}</th>` : `<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty-table">Dados indisponíveis para esta base.</td></tr>`}</tbody></table></div></section>`;
  }
  function marine(r) {
    return table('Condições de mar por período', 'waves', ['Período', 'Estado do mar', 'Altura máx.', 'Período de onda', 'Direção', 'Marulho'], (r.mar?.periodos || []).map(p => [escape(p.periodo), escape(p.estadoMar), unit(p.alturaMaxM,' m'), unit(p.periodoOndaS,' s'), escape(p.direcaoOnda), unit(p.marulhoMaxM,' m')]), 'mar');
  }
  function windRain(r) {
    return table('Vento e chuva por período', 'wind', ['Período', 'Vento', 'Rajada prevista', 'Chance de chuva', 'Acumulado'], (r.ventoPorPeriodo || []).map(v => {
      const c = r.chuvaPorPeriodo?.find(p => p.periodo === v.periodo);
      return [escape(v.periodo), `${escape(v.direcao)} · ${escape(v.intensidade)}`, unit(v.rajadaMaxKmh,' km/h'), unit(c?.probabilidade,'%'), unit(c?.precipitacaoMm,' mm')];
    }), 'vento');
  }

  // Relatórios sem `ocorrencias` (versões antigas/testes): eventos do
  // protocolo viram cards simples, sem fusão com avisos.
  function occurrencesOf(r) {
    if (Array.isArray(r.ocorrencias)) return r.ocorrencias;
    const ordem = { 'EMERGÊNCIA':3, 'ALERTA':2, 'ATENÇÃO':1 };
    return (r.severidade?.eventos || [])
      .filter(e => e && ordem[e.grau] && e.tipo !== 'avisoInmet')
      .sort((a, b) => ordem[b.grau] - ordem[a.grau])
      .map((e, i) => ({ id:`oc-${i + 1}`, grau:e.grau, rotulo:String(e.titulo || e.tipo).split(/\s+—\s+/).slice(-1)[0], icone:'alert', resumo:e.descricao, valores:[], validade:e.janela || 'Hoje', fontes:e.fonteDados ? [e.fonteDados] : [], blocos:[{ origem:'protocolo', titulo:e.titulo, grau:e.grau, descricao:e.detalhe || e.descricao, janela:e.janela, fonte:e.fonteDados, recomendacoes:e.recomendacoes || [] }] }));
  }

  function occurrenceCard(o) {
    const n = nivel(o.grau);
    const rotuloNivel = o.grau && NIVEIS[o.grau] ? o.grau : (o.classificacaoOficial || 'Sem classificação');
    const valores = (o.valores || []).length ? `<dl class="oc-valores">${o.valores.map(v => `<div><dt>${escape(v.rotulo)}</dt><dd>${escape(v.valor)}</dd></div>`).join('')}</dl>` : '';
    const fontes = (o.fontes || []).map(f => f.replace(/\s+—\s+aviso oficial$/i, '')).join(' + ') || 'Fonte não informada';
    const avisos = [
      o.classificacoesDivergentes ? '<span class="oc-flag">Classificações diferentes entre fontes</span>' : '',
      o.detalhesIndisponiveis ? '<span class="oc-flag">Detalhes do aviso indisponíveis na fonte</span>' : '',
      o.desatualizado ? '<span class="oc-flag">Dado desatualizado</span>' : '',
    ].join('');
    return `<article class="ocorrencia nivel-${n.classe}" aria-label="${escape(rotuloNivel)} — ${escape(o.rotulo)}">
      <div class="oc-topo"><span class="nivel-chip">${icon(n.icone)}${escape(rotuloNivel)}</span>${o.classificacaoOficial && NIVEIS[o.grau] ? `<span class="oc-oficial" title="Classificação oficial do INMET">INMET: ${escape(o.classificacaoOficial)}</span>` : ''}</div>
      <h3 class="oc-titulo">${icon(o.icone)}<span>${escape(o.rotulo)}</span></h3>
      <p class="oc-resumo">${escape(o.resumo)}</p>
      ${valores}
      ${avisos ? `<div class="oc-flags">${avisos}</div>` : ''}
      <div class="oc-meta"><span>${icon('clock')}<span><span class="sr-only">Validade: </span>${escape(o.validade)}</span></span><span>${icon('globe')}<span>Fonte: ${escape(fontes)}</span></span></div>
      <button class="oc-detalhes" data-detail="ocorrencia:${escape(o.id)}">Ver detalhes <span aria-hidden="true">→</span></button>
    </article>`;
  }

  function occurrences(r) {
    const lista = occurrencesOf(r);
    const contagem = ['EMERGÊNCIA', 'ALERTA', 'ATENÇÃO'].map(g => [g, lista.filter(o => o.grau === g).length]).filter(([, n]) => n);
    const notas = [
      r.avisosInmetStatus === 'indisponivel' ? 'Avisos oficiais INMET indisponíveis nesta atualização — não é possível confirmar a ausência de avisos.' : '',
      r.avisosColeta?.length ? 'Coleta parcial: algumas fontes não responderam. Veja “Fontes e monitoramento”.' : '',
    ].filter(Boolean).map(t => `<p class="oc-nota">${icon('info')}<span>${escape(t)}</span></p>`).join('');
    const corpo = lista.length
      ? `<div class="oc-grid">${lista.map(occurrenceCard).join('')}</div>`
      : `<p class="sem-ocorrencias">${icon('check')}<span>Nenhuma ocorrência ativa de Atenção, Alerta ou Emergência para ${escape(r.cidade?.nome)} no momento.</span></p>`;
    return `<section class="ocorrencias" aria-labelledby="titulo-ocorrencias">
      <div class="bloco-cabecalho"><h2 id="titulo-ocorrencias" class="bloco-titulo">Ocorrências em destaque</h2>
        ${contagem.length ? `<p class="oc-contagem">${contagem.map(([g, n]) => `<span class="contagem-${nivel(g).classe}">${n} ${escape(g)}</span>`).join('')}</p>` : ''}
        <button class="text-link" data-detail="monitoramento">Fontes e monitoramento <span aria-hidden="true">→</span></button></div>
      ${corpo}${notas}
    </section>`;
  }

  function occurrenceDetails(r, id) {
    const o = occurrencesOf(r).find(item => item.id === id);
    if (!o) return '<p>Esta ocorrência não está mais ativa na atualização atual.</p>';
    const linha = (rotulo, valor) => valor == null || valor === '' ? '' : `<div><dt>${escape(rotulo)}</dt><dd>${valor}</dd></div>`;
    const blocos = (o.blocos || []).map(b => {
      if (b.origem === 'inmet') {
        const area = [b.area?.estados, b.area?.totalMunicipios ? `${b.area.totalMunicipios} municípios, incluindo ${r.cidade?.nome}` : null].filter(Boolean).join(' · ');
        return `<section class="det-bloco"><h3>Aviso oficial INMET</h3><dl class="det-lista">
          ${linha('Fenômeno', escape(b.fenomeno))}
          ${linha('Classificação oficial', `${escape(b.classificacaoOficial)}${b.grau ? ` <span class="selo selo-${nivel(b.grau).classe}">${escape(b.grau)} no protocolo</span>` : ' <span class="selo selo-neutro">sem nível correspondente no protocolo</span>'}`)}
          ${linha('Validade', escape(b.validade))}
          ${linha('Área abrangida', area ? escape(area) : null)}
          ${linha('Identificação', b.identificador ? escape(b.identificador) : null)}
          ${b.copiasNaFonte > 1 ? linha('Repetições na fonte', `${b.copiasNaFonte} registros idênticos reunidos`) : ''}
        </dl>
        ${b.riscos?.length ? `<h4>Riscos descritos</h4>${list(b.riscos)}` : ''}
        ${b.instrucoes?.length ? `<h4>Orientações oficiais</h4>${list(b.instrucoes)}` : ''}
        ${b.detalhesDisponiveis ? '' : '<p class="det-indisponivel">A fonte oficial não forneceu riscos nem orientações para este aviso nesta coleta.</p>'}
        <p class="det-fonte">Fonte de dados: INMET${b.linkOficial ? ` · Referência complementar: <a href="${escape(b.linkOficial)}" target="_blank" rel="noopener noreferrer">previsão oficial INMET para ${escape(r.cidade?.nome)}</a>` : ''}</p></section>`;
      }
      if (b.origem === 'clima-saude') {
        return `<section class="det-bloco"><h3>Clima e Saúde</h3><dl class="det-lista">
          ${linha('Classificação', `${escape(b.grau)}${b.protocolo ? ` · protocolo ${escape(b.protocolo)}` : ''}`)}
          ${linha('EHF', `${escape(b.ehf?.classificacao)}${b.ehf?.valor == null ? '' : ` (${escape(b.ehf.valor)})`}`)}
          ${linha('Máxima prevista', unit(b.tempMax, ' °C'))}
          ${linha('Risco combinado à saúde', escape(b.riscoCombinado))}
          ${linha('GeoSES', b.geoses?.classificacao ? escape(b.geoses.classificacao) : null)}
          ${linha('Consulta', `${escape(dateTimeBrasilia(b.consultadoEm) || 'horário indisponível')}${b.desatualizado ? ' — última coleta válida (dado desatualizado)' : ''}`)}
        </dl>${b.recomendacoes?.length ? `<h4>Recomendações - Protocolo Meteorológico do COMPARTILHADO</h4>${list(b.recomendacoes)}` : ''}<p class="det-fonte">Fonte de dados: ${escape(b.fonte)}</p></section>`;
      }
      return `<section class="det-bloco"><h3>Protocolo CIM${b.derivadoDoAviso ? ' — registrado a partir do aviso oficial' : ''}</h3><dl class="det-lista">
        ${linha('Classificação', escape(b.grau))}
        ${linha('Descrição', escape(b.descricao))}
        ${linha('Janela prevista', b.janela ? escape(b.janela) : null)}
      </dl>${b.recomendacoes?.length ? `<h4>Recomendações - Protocolo Meteorológico do COMPARTILHADO</h4>${list(b.recomendacoes)}` : ''}<p class="det-fonte">Fonte de dados: ${escape(b.fonte || 'não informada')}</p></section>`;
    }).join('');
    const divergencia = o.classificacoesDivergentes
      ? `<p class="det-divergencia">${icon('info')}<span>As fontes classificam esta ocorrência de forma diferente: ${(o.blocos || []).filter(b => b.grau).map(b => `${b.origem === 'inmet' ? `INMET (${escape(b.classificacaoOficial)})` : b.origem === 'clima-saude' ? 'Clima e Saúde' : 'Protocolo CIM'}: ${escape(b.grau)}`).join(' · ')}. O destaque do card segue o maior grau, conforme a regra do protocolo.</span></p>`
      : '';
    return `<div class="det-resumo nivel-${nivel(o.grau).classe}"><span class="nivel-chip">${icon(nivel(o.grau).icone)}${escape(NIVEIS[o.grau] ? o.grau : o.classificacaoOficial || 'Sem classificação')}</span><p>${escape(o.resumo)}</p>${(o.valores || []).length ? `<dl class="oc-valores">${o.valores.map(v => `<div><dt>${escape(v.rotulo)}</dt><dd>${escape(v.valor)}</dd></div>`).join('')}</dl>` : ''}<p class="det-meta">Validade: ${escape(o.validade)} · Fontes: ${escape((o.fontes || []).join(' + ') || 'não informada')}</p></div>${divergencia}${blocos}`;
  }

  function currentWeather(r) {
    const a = r.atual;
    const time = a?.previsao && Number.isFinite(Date.parse(a.horario)) ? new Date(a.horario).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : null;
    return `<div class="current-location">${escape(r.cidade.nome)} — ${escape(r.cidade.uf)}</div><div class="current-reading">${icon(weatherIcon(a?.codigo, a?.dia))}<div><strong>${unit(a?.temperaturaC, '<small>°C</small>')}</strong><p>${escape(a?.condicao || 'Condição atual indisponível')}</p></div></div><div class="current-source">${a ? escape(`${a.previsao ? 'Previsão próxima ao horário atual' : 'Condição atual'} · ${a.fonte || 'Open-Meteo'}${time ? ' · '+time+' (Brasília)' : ''}`) : 'Aguardando dados da fonte'}</div>`;
  }
  function detailsTitle(r, type) {
    if (String(type).startsWith('ocorrencia:')) {
      const o = r && occurrencesOf(r).find(item => item.id === type.slice(11));
      return o ? `${NIVEIS[o.grau] ? o.grau : o.classificacaoOficial || 'Ocorrência'} — ${o.rotulo}` : 'Ocorrência';
    }
    return {monitoramento:'Monitoramento e fontes', mar:'Condições marítimas', vento:'Vento e chuva', sobre:'Sobre o CIM'}[type] || 'Detalhes';
  }
  function details(r, type) {
    if (type === 'sobre') return '<p>O painel CIM integra informações meteorológicas para apoiar a tomada de decisão operacional.</p><p>Fontes: Windy Point (previsão, ondas e PM2,5 quando disponível), Open-Meteo (previsão numérica, condições atuais, mar, UV e qualidade do ar) e INMET (previsão oficial e avisos de perigo).</p><p>Na base Rio de Janeiro, o painel “Comunicados COR-Rio” mostra o estágio operacional e os comunicados publicados pelo Centro de Operações e Resiliência da Prefeitura do Rio, que valem apenas para o município do Rio de Janeiro.</p><p>Atualização automática a cada 10 minutos. Dados de referência: consulte também a Defesa Civil local para confirmação operacional.</p>';
    if (!r) return '<p>Os dados desta base ainda não estão disponíveis.</p>';
    if (String(type).startsWith('ocorrencia:')) return occurrenceDetails(r, type.slice(11));
    if (type === 'mar') return `${marine(r)}<p>Ponto de referência: ${escape(r.mar?.referenciaPonto)}</p><p>Temperatura da água: ${unit(r.mar?.temperaturaMarC, '°C')}</p>`;
    if (type === 'vento') return `${windRain(r)}<h3>Referências INMET</h3>${(r.ventoPorPeriodo || []).map(p => `<p>${escape(p.periodo)}: ${escape(p.referenciaInmet)}</p>`).join('')}`;
    const fieldLabel = campo => {
      const labels={condicaoGeral:'Condição geral',atual:'Condições do horário atual',tempMin:'Temperatura mínima',tempMax:'Temperatura máxima',umidadeMin:'Umidade mínima',umidadeMax:'Umidade máxima',rajadaMaxKmh:'Rajada prevista',precipitacaoTotalMm:'Chuva total do dia',direcao:'Direção do vento',intensidadeVento:'Vento',precipitacaoMm:'Chuva acumulada',probabilidadeChuva:'Chance de chuva',alturaMaxDiaM:'Altura máxima de onda',temperaturaMarC:'Temperatura da água',pm25Medio:'PM2,5',uvMax:'Índice UV',aqiUsMax:'Índice de qualidade do ar (US)'};
      const parts=campo.split('.'), key=parts.at(-1), periods={manha:'Manhã',tarde:'Tarde',noite:'Noite'};
      return labels[key] ? (periods[parts[1]] ? periods[parts[1]]+' · ' : '')+labels[key] : null;
    };
    const statusLabels = {operacional:'Operacional',degradado:'Degradado',armazenado:'Última coleta armazenada',indisponivel:'Indisponível',nao_configurada:'Não configurada',nao_aplicavel:'Não se aplica'};
    const apiCards = (r.monitoramentoApis || []).map(api => `<article class="api-status api-${escape(api.status)}"><div><strong>${escape(api.nome)}</strong><span>${escape(statusLabels[api.status] || api.status)}</span></div><p>${escape(api.detalhe)}</p>${api.id === 'oceanop' ? `<a href="areas.html?cidade=${encodeURIComponent(r.cidade.chave)}">Abrir monitoramento Oceanop</a>` : ''}</article>`).join('');
    const ocorrencias = occurrencesOf(r);
    const resumoEventos = ocorrencias.length
      ? ocorrencias.map(o => `<article class="aviso-item nivel-${nivel(o.grau).classe}"><strong>${escape(NIVEIS[o.grau] ? o.grau : o.classificacaoOficial)} — ${escape(o.rotulo)}</strong><p>${escape(o.resumo)}</p><p>Validade: ${escape(o.validade)} · Fonte de dados: ${escape((o.fontes || []).join(' + '))}</p><button class="text-link det-link" data-detail="ocorrencia:${escape(o.id)}">Ver detalhes <span aria-hidden="true">→</span></button></article>`).join('')
      : '<p>Nenhuma ocorrência ativa no período analisado.</p>';
    const avisos = r.avisosInmetStatus === 'indisponivel'
      ? '<p class="det-indisponivel">A coleta de avisos oficiais do INMET falhou nesta atualização; os avisos vigentes não puderam ser confirmados.</p>'
      : r.avisosInmet?.length
        ? r.avisosInmet.map(a => `<article class="aviso-item"><strong>Aviso oficial INMET: ${escape(a.descricao)} — ${escape(a.severidade)}</strong><p>Vigência: ${escape(a.inicio)} até ${escape(a.fim)}</p><p>Fonte de dados: INMET</p>${a.riscos?.length ? `<p><strong>Motivo do aviso:</strong> ${escape(a.riscos.filter(Boolean).join(' '))}</p>` : '<p>Riscos não informados pela fonte nesta coleta.</p>'}${a.instrucoes?.length ? `<p><strong>Orientações oficiais:</strong></p>${list(a.instrucoes)}` : ''}</article>`).join('')
        : '<p>Nenhum aviso vigente do INMET para esta base.</p>';
    return `<h3>Status de todas as APIs</h3><p class="api-status-note">Última coleta desta base: ${escape(r.horaConsulta)} (Brasília).</p><div class="api-monitor-grid">${apiCards || '<p>Status das APIs indisponível nesta versão do relatório.</p>'}</div><h3>Ocorrências ativas</h3>${resumoEventos}<h3>Avisos oficiais INMET</h3>${avisos}${r.avisosColeta?.length ? `<h3>Falhas e avisos da coleta</h3>${list(r.avisosColeta)}` : ''}${r.divergencias?.length ? `<h3>Divergências entre fontes</h3>${list(r.divergencias)}` : ''}<h3>Destinatários desta base</h3><div id="lista-destinatarios-painel">Carregando…</div><h3>Fonte por campo</h3>${list(Object.entries(r.fontesPorCampo || {}).filter(([campo]) => fieldLabel(campo)).map(([campo,fonte]) => `${fieldLabel(campo)}: ${fonte}`))}<h3>Fontes automatizadas que responderam</h3>${list((r.fontesAutomatizadas || []).map(f => `${f.nome}: ${f.uso}`))}`;
  }
  // ---------------------------------------------------------------------
  // Comunicados e estágio operacional do COR-Rio (só bases do município do
  // Rio). Cores e leitura do estado vêm de cor-rio-compartilhado.js (o mesmo
  // módulo usado no PDF). O CSS lê --estagio/--estagio-tinta, aplicadas por
  // aplicarCoresEstagio() via CSSOM (a CSP não permite estilo inline no HTML).
  // O estágio vem apenas do COR-Rio; sem dado válido o painel fica neutro —
  // nunca assume o estágio 1.
  // ---------------------------------------------------------------------
  const ESTAGIOS_COR_RIO = CorRio.ESTAGIOS;
  const TINTA_SOBRE_ESTAGIO = CorRio.TINTA;

  function aplicarCoresEstagio(raiz) {
    const alvos = [raiz, ...(raiz?.querySelectorAll?.('[data-cor-estagio]') || [])];
    for (const el of alvos) {
      const estagio = ESTAGIOS_COR_RIO[el?.dataset?.corEstagio];
      if (!estagio || !el.style?.setProperty) continue;
      el.style.setProperty('--estagio', estagio.cor);
      el.style.setProperty('--estagio-tinta', TINTA_SOBRE_ESTAGIO);
    }
  }

  // Estado montado em dashboard.js: { carregando, falhaServidor, resposta }.
  // `resposta` é o JSON de /api/cor-rio (última resposta válida do servidor).
  function corRioPartes(st) {
    const d = st?.resposta;
    const s = CorRio.situacao(d, { falhaServidor: Boolean(st?.falhaServidor) });
    return {
      d, est: d?.estagio, com: d?.comunicados, nivel: s.nivel,
      estagioDesatualizado: s.estagioDesatualizado,
      comunicadosDesatualizados: s.comunicadosDesatualizados,
    };
  }
  const motivoFalhaCor = (parte, st) => parte?.falha || (st?.falhaServidor ? 'o servidor do painel não respondeu' : '');

  function corRioEscala(nivel) {
    return `<ol class="cor-rio-escala" aria-label="Escala de estágios operacionais, de 1 a 5">${[1, 2, 3, 4, 5].map(n => {
      const atual = n === nivel;
      return `<li data-cor-estagio="${n}" class="${atual ? 'atual' : ''}"${atual ? ' aria-current="step"' : ''}><span class="cor-rio-num" aria-hidden="true">${n}</span><span class="sr-only">Estágio ${n}${atual ? ' (atual)' : ''}</span>${atual ? '<span class="cor-rio-atual-txt" aria-hidden="true">Atual</span>' : ''}</li>`;
    }).join('')}</ol>`;
  }

  function corRioEstagio(st, p) {
    const { est, nivel } = p;
    if (!nivel) {
      const carregando = st.carregando && !p.d;
      const motivo = motivoFalhaCor(est, st);
      return `<aside class="cor-rio-estagio sem-estagio" aria-label="Estágio operacional do COR-Rio">
        <p class="cor-rio-estagio-rotulo">Estágio operacional</p>
        <p class="cor-rio-estagio-atual">${carregando ? 'Consultando…' : 'Estágio indisponível'}</p>
        ${corRioEscala(null)}
        <p class="cor-rio-estagio-meta">${carregando ? 'Consultando o COR-Rio.' : `Não foi possível obter o estágio no COR-Rio${motivo ? `: ${escape(motivo)}` : ''}. Nova tentativa automática.`}</p>
      </aside>`;
    }
    const desde = dateTimeBrasilia(est.dados.vigenteDesde);
    const consulta = dateTimeBrasilia(est.consultadoEm);
    const motivo = motivoFalhaCor(est, st);
    return `<aside class="cor-rio-estagio" data-cor-estagio="${nivel}" aria-label="Estágio operacional do COR-Rio: estágio ${nivel}">
      <p class="cor-rio-estagio-rotulo">Estágio operacional</p>
      <p class="cor-rio-estagio-atual"><span class="cor-rio-estagio-chip">ESTÁGIO ${nivel}</span></p>
      ${corRioEscala(nivel)}
      <p class="cor-rio-estagio-meta">${desde ? `Em vigor desde ${escape(desde)}<br>` : ''}${p.estagioDesatualizado ? '' : `Consultado em ${escape(consulta || 'horário indisponível')}`}</p>
      ${p.estagioDesatualizado ? `<p class="oc-flag cor-rio-flag">Desatualizado · última consulta válida: ${escape(consulta || 'horário indisponível')}${motivo ? ` (${escape(motivo)})` : ''}</p>` : ''}
    </aside>`;
  }

  function corRioPublicacao(c) {
    const publicado = dateTimeBrasilia(c.publicadoEm) || 'horário indisponível';
    const atualizado = dateTimeBrasilia(c.atualizadoEm);
    return `Publicado em ${escape(publicado)}${atualizado && atualizado !== publicado ? ` · atualizado em ${escape(atualizado)}` : ''}`;
  }

  function corRioComunicado(st, p) {
    const { com } = p;
    const motivo = motivoFalhaCor(com, st);
    if (st.carregando && !p.d) return '<p class="cor-rio-vazio" role="status">Consultando os comunicados do COR-Rio…</p>';
    if (!com?.consultadoEm) {
      return `<p class="cor-rio-vazio cor-rio-falha">${icon('alert')}<span>Não foi possível consultar a fonte de comunicados do COR-Rio${motivo ? ` (${escape(motivo)})` : ''}. Nova tentativa automática.</span></p>`;
    }
    const consulta = escape(dateTimeBrasilia(com.consultadoEm) || 'horário indisponível');
    const flagDesatualizado = p.comunicadosDesatualizados
      ? `<p class="oc-flag cor-rio-flag">Comunicados desatualizados · última consulta válida: ${consulta}${motivo ? ` (${escape(motivo)})` : ''}</p>`
      : '';
    const itens = com.itens || [];
    if (!itens.length) {
      return `<p class="cor-rio-vazio">${icon('check')}<span>Nenhum comunicado vigente: o COR-Rio não publicou nem atualizou comunicados nas últimas ${escape(com.janelaHoras)} h${p.comunicadosDesatualizados ? ' (última consulta válida)' : ''}.</span></p>${flagDesatualizado}`;
    }
    const c = itens[0];
    const outros = itens.length - 1;
    return `<article class="cor-rio-comunicado" aria-labelledby="cor-rio-com-${escape(c.id)}">
      <h3 class="cor-rio-com-titulo" id="cor-rio-com-${escape(c.id)}">${escape(c.titulo)}</h3>
      ${c.resumo ? `<p class="cor-rio-resumo">${escape(c.resumo)}</p>` : ''}
      <div class="oc-meta cor-rio-meta">
        <span>${icon('pin')}<span>Abrangência: ${escape(c.abrangencia || p.d.abrangencia)}</span></span>
        <span>${icon('clock')}<span>${corRioPublicacao(c)}</span></span>
        <span>${icon('globe')}<span>Fonte: COR-Rio</span></span>
      </div>
      ${flagDesatualizado}
      <div class="cor-rio-acoes">
        <button class="cor-rio-botao" data-detail="cor-rio:${escape(c.id)}">Ver comunicado <span aria-hidden="true">→</span></button>
        ${outros ? `<button class="text-link" data-detail="cor-rio">Ver ${outros === 1 ? 'outro comunicado vigente' : `outros ${outros} comunicados vigentes`} <span aria-hidden="true">→</span></button>` : ''}
      </div>
    </article>`;
  }

  function corRio(st) {
    if (!st) return '';
    const p = corRioPartes(st);
    return `<section class="cor-rio${p.nivel ? '' : ' sem-estagio'}"${p.nivel ? ` data-cor-estagio="${p.nivel}"` : ''} aria-labelledby="titulo-cor-rio">
      <div class="cor-rio-principal">
        <div class="cor-rio-cabecalho"><span class="cor-rio-icone">${icon('megaphone')}</span><h2 id="titulo-cor-rio" class="cor-rio-titulo">Comunicados COR-Rio</h2></div>
        ${corRioComunicado(st, p)}
      </div>
      ${corRioEstagio(st, p)}
    </section>`;
  }

  function corRioParagrafos(paragrafos) {
    let html = '', lista = [];
    const fecharLista = () => { if (lista.length) html += `<ul class="cor-rio-lista">${lista.join('')}</ul>`; lista = []; };
    for (const b of paragrafos || []) {
      if (b.item) { lista.push(`<li>${escape(b.texto)}</li>`); continue; }
      fecharLista();
      html += `<p class="cor-rio-par${b.destaque ? ' destaque' : ''}">${escape(b.texto)}</p>`;
    }
    fecharLista();
    return html;
  }

  function corRioTitulo(st, id) {
    const c = id && (st?.resposta?.comunicados?.itens || []).find(item => item.id === id);
    return c ? 'Comunicado COR-Rio' : 'Comunicados COR-Rio';
  }

  function corRioDetalhes(st, id) {
    if (!st?.resposta) return '<p>Os dados do COR-Rio ainda não estão disponíveis.</p>';
    const p = corRioPartes(st);
    const itens = p.com?.itens || [];
    const c = id ? itens.find(item => item.id === id) : null;
    const linkOriginal = (url, texto) => /^https:\/\/cor\.rio\//.test(url || '') ? `<a class="cor-rio-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${icon('external')}${texto}</a>` : '';
    const estagio = p.nivel
      ? `<div class="cor-rio-det-estagio" data-cor-estagio="${p.nivel}"><span class="cor-rio-estagio-chip">ESTÁGIO ${p.nivel}</span><dl class="det-lista">
          ${p.est.dados.vigenteDesde ? `<div><dt>Em vigor desde</dt><dd>${escape(dateTimeBrasilia(p.est.dados.vigenteDesde))}</dd></div>` : ''}
          <div><dt>Consulta ao COR-Rio</dt><dd>${escape(dateTimeBrasilia(p.est.consultadoEm) || 'horário indisponível')}${p.estagioDesatualizado ? ' — última consulta válida (dado desatualizado)' : ''}</dd></div>
          ${(p.est.dados.mensagens || []).map(m => `<div><dt>Mensagem do COR-Rio</dt><dd>${escape(m)}</dd></div>`).join('')}
        </dl></div>`
      : '<p class="det-indisponivel">Estágio indisponível: não há consulta válida ao COR-Rio.</p>';
    const blocoEstagio = `<section class="det-bloco"><h3>Estágio operacional da cidade</h3><p class="cor-rio-nota">O estágio é publicado pelo COR-Rio separadamente dos comunicados e pode ter sido definido em outro horário.</p>${estagio}<p class="det-fonte">Fonte: COR-Rio · ${linkOriginal(p.est?.dados?.urlPublica || 'https://cor.rio/estagios-operacionais-da-cidade/', 'Estágios operacionais no cor.rio')}</p></section>`;
    const lista = (excluir) => itens.filter(i => i.id !== excluir).map(i => `<article class="aviso-item cor-rio-item"><strong>${escape(i.titulo)}</strong><p>${corRioPublicacao(i)}</p><button class="text-link det-link" data-detail="cor-rio:${escape(i.id)}">Ver comunicado <span aria-hidden="true">→</span></button></article>`).join('');
    if (id && !c) return `<p>Este comunicado não está mais entre os vigentes na atualização atual.</p>${itens.length ? `<h3>Comunicados vigentes</h3>${lista()}` : ''}${blocoEstagio}`;
    if (!c) {
      const vazio = !p.com?.consultadoEm
        ? '<p class="det-indisponivel">Não foi possível consultar a fonte de comunicados do COR-Rio.</p>'
        : `<p>Nenhum comunicado vigente: o COR-Rio não publicou nem atualizou comunicados nas últimas ${escape(p.com.janelaHoras)} h.</p>`;
      return `<h3>Comunicados vigentes</h3>${itens.length ? lista() : vazio}${blocoEstagio}`;
    }
    const outros = lista(c.id);
    return `<div class="det-resumo cor-rio-det-resumo"${p.nivel ? ` data-cor-estagio="${p.nivel}"` : ''}>
        <h3 class="cor-rio-det-titulo">${escape(c.titulo)}</h3>
        <p class="det-meta">${corRioPublicacao(c)} · Abrangência: ${escape(c.abrangencia || p.d.abrangencia)} · Fonte: COR-Rio</p>
        ${p.comunicadosDesatualizados ? `<p class="oc-flag cor-rio-flag">Comunicados desatualizados · última consulta válida: ${escape(dateTimeBrasilia(p.com.consultadoEm) || 'horário indisponível')}</p>` : ''}
      </div>
      <section class="det-bloco cor-rio-conteudo">${corRioParagrafos(c.paragrafos) || `<p>${escape(c.resumo)}</p>`}
        <p class="det-fonte">${linkOriginal(c.link, 'Abrir a publicação original no cor.rio')}</p></section>
      ${outros ? `<h3>Outros comunicados vigentes</h3>${outros}` : ''}
      ${blocoEstagio}`;
  }

  return { escape, icon, currentWeather, details, detailsTitle, corRio, corRioDetalhes, corRioTitulo, aplicarCoresEstagio, ESTAGIOS_COR_RIO, home: r => `${occurrences(r)}<div id="cor-rio-slot"></div>${metrics(r)}<div class="tables-grid${marAplicavel(r) ? '' : ' tabela-unica'}">${marAplicavel(r) ? marine(r) : ''}${windRain(r)}</div>` };
})();
