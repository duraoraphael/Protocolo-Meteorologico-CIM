const brand = require("./brand");
const { HEADER_AMARELO, HEADER_VERDE, LOGOS_HEADER, logoHeaderDataUri } = require("../config/headerAssets");
const { ordenarEventosParaExibicao } = require("./eventOrdering");
const { consolidarAvisosInmet, grauAvisoInmet } = require("../sources/inmet");
const { formatarDataBrasilia } = require("../sources/sourceHealth");
const monitorSecas = require("../sources/monitorSecas");
const CorRio = require("../../public/cor-rio-compartilhado");
const { comunicadoDoDia } = require("./corRioEmail");
const AlertTitle = require("../../public/alert-title");
const { recomendacoesChuvaAvisoInmet } = require("../logic/inmetAlertRules");
const {
  alertaExibivel,
  avisosExibiveis,
  deveExibirNoDocumento,
  informativoProgramado,
  resolverRecomendacoesAlerta,
  tipoDocumentoDoRelatorio,
} = require("../logic/alertPresentation");
const { calorPorData, fonteCalor, DESCRICAO_CALOR } = require("../logic/calorPorData");

function esc(valor) {
  if (valor === null || valor === undefined) return "—";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAtributo(valor) {
  return esc(valor).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function listaHtml(itens) {
  return `<ul>${itens.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

// Mesmo mapeamento de severidade usado nas recomendações (grauAvisoInmet):
// "Perigo Potencial" é ATENÇÃO — antes caía na regra de "perigo" (vermelho).
function corSeveridade(severidade = "") {
  const grau = grauAvisoInmet(severidade);
  if (grau === "EMERGÊNCIA") return "#B71C1C";
  if (grau === "ALERTA") return "#D32F2F";
  if (grau === "ATENÇÃO" || /aten[çc][ãa]o/i.test(String(severidade))) return "#F57C00";
  return "#2E7D32";
}

function visualCard(grau) {
  return grau === "NORMAL" ? { cor: "#2E7D32", fundo: "#E8F5E9" } : brand.statusVisual(grau);
}

function eventosLocais(r) {
  const eventos = r.severidade?.eventos || (r.eventoMaisRelevante ? [r.eventoMaisRelevante] : []);
  const tipoDocumento = tipoDocumentoDoRelatorio(r);
  return ordenarEventosParaExibicao(
    (Array.isArray(eventos) ? eventos : []).filter((evento) =>
      evento && evento.tipo !== "avisoInmet"
      && deveExibirNoDocumento({
        nivel: evento.grau || AlertTitle.normalizarGrau(evento.titulo),
        tipoDocumento,
      })
    )
  );
}

function textoOficialHtml(valor) {
  const texto = Array.isArray(valor) ? valor.filter(Boolean).join(" ") : valor;
  return esc(texto).replace(/\r?\n/g, "<br>");
}

function cardEvento({ titulo, grau, descricao, janela, fonteDados, detalhes = "", semFonte = false }) {
  const visual = visualCard(grau);
  const tituloFormatado = AlertTitle.formatarTitulo(titulo, grau);
  const classeTitulo = tituloFormatado.length > 34 ? " evento-titulo-longo" : "";
  return `<div class="evento-card" style="border-color:${visual.cor};background:${visual.fundo};">
    <div class="evento-titulo${classeTitulo}" style="color:${visual.cor};"><span class="evento-icone">●</span> ${esc(tituloFormatado)}</div>
    ${descricao ? `<p class="evento-descricao">${esc(descricao)}</p>` : ""}
    ${detalhes}
    ${janela ? `<p class="evento-linha"><em>Janela prevista:</em> ${esc(janela)}</p>` : ""}
    ${semFonte ? "" : `<p class="evento-linha">Fonte de dados: ${esc(fonteDados || "Indisponível")}</p>`}
  </div>`;
}

// Tabela com título e fonte de dados num bloco só: se o conjunto couber numa
// página e não couber no espaço restante, vai inteiro para a próxima. Tabela
// maior que uma página quebra entre linhas (nunca no meio de uma) e repete o
// cabeçalho. A fonte fica sempre logo abaixo da tabela, no mesmo estilo.
function blocoTabela({ titulo = "", tabela, fonte = "", antes = "" }) {
  if (!tabela) return "";
  return `<section class="bloco-tabela">
    ${titulo}${antes}
    ${tabela}
    ${fonte ? `<p class="fonte-tabela">${fonte}</p>` : ""}
  </section>`;
}

const TITULO_RECOMENDACOES = "Recomendações - Protocolo Meteorológico do COMPARTILHADO";

function tituloFenomenoRecomendacao(valor) {
  return `${AlertTitle.nomeParametro(valor).toUpperCase()}:`;
}

// Alerta à esquerda (tipo, nível e descrição) e as recomendações cadastradas
// à direita, no mesmo bloco indivisível.
function blocoAlerta(cardHtml, { grau, itens = [], subtitulo = "", nota = "", tituloRecomendacoes = TITULO_RECOMENDACOES }) {
  const cor = visualCard(grau).cor;
  return `<table class="alerta-bloco" role="presentation"><tr>
    <td class="alerta-col-card">${cardHtml}</td>
    <td class="alerta-col-rec"><div class="alerta-rec" style="border-top-color:${cor};">
      <div class="alerta-rec-titulo">${esc(tituloRecomendacoes)}</div>
      ${subtitulo ? `<div class="alerta-rec-sub" style="color:${cor};">${subtitulo}</div>` : ""}
      ${itens.length ? listaHtml(itens) : ""}
      ${nota ? `<p class="alerta-rec-nota">${nota}</p>` : ""}
    </div></td>
  </tr></table>`;
}

// recomendacoesExibidas: itens já listados — os avisos do INMET,
// renderizados depois, não os repetem.
function blocoEventoExtremo(r, recomendacoesExibidas = new Set()) {
  const eventos = eventosLocais(r);
  if (eventos.length) {
    return eventos.map((evento) => {
      const grau = evento.grau || AlertTitle.normalizarGrau(evento.titulo) || "NORMAL";
      const card = cardEvento({ ...evento, grau });
      if (!alertaExibivel(grau)) return card;
      const resolucao = resolverRecomendacoesAlerta({ evento, avisosInmet: r.avisosInmet });
      const itens = resolucao.itens;
      itens.forEach((item) => recomendacoesExibidas.add(item));
      return blocoAlerta(card, {
        grau,
        itens,
        tituloRecomendacoes: resolucao.origem === "inmet" ? "Orientações oficiais do INMET" : TITULO_RECOMENDACOES,
        subtitulo: tituloFenomenoRecomendacao(evento.fenomeno || evento.titulo || evento.tipo),
      });
    }).join("");
  }
  if (informativoProgramado(tipoDocumentoDoRelatorio(r)) && (r.severidade?.grau || "NORMAL") === "NORMAL") {
    return cardEvento({
      titulo: "CONDIÇÕES METEOROLÓGICAS",
      grau: "NORMAL",
      descricao: "Não foram identificadas condições meteorológicas que atinjam os níveis de Atenção, Alerta ou Emergência no período analisado.",
      semFonte: true,
    });
  }
  return "";
}

function blocoDivergencias(divergencias) {
  if (!divergencias || divergencias.length === 0) return "";
  return `<div class="warning-box">
    <strong>⚠ Ressalva sobre divergência entre fontes</strong>
    ${listaHtml(divergencias)}
  </div>`;
}

function blocoAvisosColeta(r) {
  const windyValido = (r.fontesAutomatizadas || r.fontes || []).some((fonte) => /^Windy\b/i.test(fonte.nome || ""));
  const avisosColeta = [...new Set((r.avisosColeta || [])
    .filter((aviso) => typeof aviso === "string" && aviso.trim())
    .filter((aviso) => windyValido || !/^Windy\b/i.test(aviso.trim()))
    .map((aviso) => aviso.trim()))];
  if (!avisosColeta.length) return "";
  return `<div class="warning-box">
    <strong>⚠ Avisos de coleta automática</strong>
    ${listaHtml(avisosColeta)}
  </div>`;
}

// ---------------------------------------------------------------------------
// Card "Comunicado oficial COR-Rio" (só relatórios com r.corRio — município do
// Rio). r.corRio é o mesmo estado de /api/cor-rio; cores e leitura do estado
// vêm de public/cor-rio-compartilhado.js, também usado pelo painel.
// Comunicados longos são divididos em partes de cerca de meia página (cada uma
// inteira numa página, duas por página), identificadas como continuação —
// nada é cortado nem omitido, e o vazio deixado ao mover uma parte para a
// página seguinte fica limitado. Medidas calibradas no PDF renderizado
// (10,5 pt, ~105 caracteres por linha útil do card).
// ---------------------------------------------------------------------------
// Até este volume de texto o card inteiro (com cabeçalho, dados e estágio)
// cabe numa página: fica num bloco só, movido para a página seguinte se preciso.
const LINHAS_CARD_INTEIRO = 30;
const LINHAS_PRIMEIRA_PARTE = 13;
const LINHAS_DEMAIS_PARTES = 17;
const CARACTERES_POR_LINHA = 105;

const linhasTexto = (texto) => String(texto).split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CARACTERES_POR_LINHA)), 0);

// Parágrafo maior que uma parte inteira: quebra por linhas e depois por frases.
function fatiarParagrafo(p, limite) {
  if (linhasTexto(p.texto) <= limite) return [p];
  const pedacos = [];
  let atual = "";
  const unidades = p.texto.split("\n").flatMap((linha) => linhasTexto(linha) > limite ? linha.match(/[^.!?;]+[.!?;]*\s*/g) || [linha] : [linha + "\n"]);
  for (const u of unidades) {
    if (atual && linhasTexto(atual + u) > limite) { pedacos.push(atual.trim()); atual = ""; }
    atual += u;
  }
  if (atual.trim()) pedacos.push(atual.trim());
  return pedacos.map((texto) => ({ ...p, texto }));
}

const LINHAS_BLOCO_ESTAGIO = 7;
function dividirEmPartes(paragrafos) {
  const pesoTotal = LINHAS_BLOCO_ESTAGIO + (paragrafos || []).reduce((n, p) => n + linhasTexto(p.texto) + 0.4 + (p.destaque ? 0.4 : 0), 0);
  if (pesoTotal <= LINHAS_CARD_INTEIRO) return [paragrafos || []];
  const partes = [[]];
  let usadas = 0;
  for (const original of paragrafos || []) {
    const limite = () => (partes.length === 1 ? LINHAS_PRIMEIRA_PARTE : LINHAS_DEMAIS_PARTES);
    for (const p of fatiarParagrafo(original, LINHAS_DEMAIS_PARTES)) {
      const peso = linhasTexto(p.texto) + 0.4 + (p.destaque ? 0.4 : 0);
      if (usadas + peso > limite() && partes.at(-1).length) { partes.push([]); usadas = 0; }
      partes.at(-1).push(p);
      usadas += peso;
    }
  }
  return partes;
}

function paragrafosCorRioHtml(paragrafos) {
  let html = "";
  let lista = [];
  const fechar = () => { if (lista.length) html += `<ul class="cor-lista">${lista.join("")}</ul>`; lista = []; };
  for (const p of paragrafos) {
    if (p.item) { lista.push(`<li>${textoOficialHtml(p.texto)}</li>`); continue; }
    fechar();
    html += `<p class="cor-par${p.destaque ? " cor-par-destaque" : ""}">${textoOficialHtml(p.texto)}</p>`;
  }
  fechar();
  return html;
}

function dataHoraBrasilia(iso) {
  const texto = formatarDataBrasilia(iso);
  return texto ? `${texto} (Brasília)` : "horário indisponível";
}

function linkCorRioHtml(url, texto) {
  return /^https:\/\/cor\.rio\//.test(url || "") ? `<a href="${escAtributo(url)}">${esc(texto)}</a>` : "";
}

// somenteDoDia: versão do PDF anexada ao e-mail — só o comunicado do dia, com
// o conteúdo referente ao dia (mesma seleção do corpo do e-mail) e sem a
// lista de outros comunicados. O PDF baixado pelo site usa a versão completa.
function blocoCorRio(r, { somenteDoDia = false } = {}) {
  const estado = r.corRio;
  if (!estado) return "";
  const s = CorRio.situacao(estado);
  const documentoCompleto = informativoProgramado(tipoDocumentoDoRelatorio(r));
  // O COR-Rio não usa os nomes NORMAL/ATENÇÃO do protocolo. Para exibição,
  // apenas o nível 1 é condição normal; níveis 2–5 continuam visíveis sem
  // mudar a classificação oficial recebida e armazenada.
  const exibirEstagio = documentoCompleto || !s.nivel || Number(s.nivel) > 1;
  const exibirCalor = documentoCompleto || !s.nivelCalor || Number(s.nivelCalor) > 1;
  if (!exibirEstagio && !exibirCalor) return "";
  const doDia = somenteDoDia && s.comunicados === "disponivel"
    ? comunicadoDoDia(s.itens, { geradoEm: r.geradoEmISO || Date.now() })
    : null;
  const semComunicadoDoDia = somenteDoDia && s.comunicados !== "indisponivel" && !doDia;
  const est = estado.estagio || {};
  const com = estado.comunicados || {};
  const cor = exibirEstagio && s.estagio ? s.estagio.cor : exibirCalor && s.calor ? s.calor.cor : CorRio.NEUTRO.cor;
  const fundo = (exibirEstagio && s.estagio) || (exibirCalor && s.calor) ? CorRio.tomClaro(cor, 0.1) : CorRio.NEUTRO.fundo;
  const selo = !exibirEstagio ? "" : s.nivel
    ? `<span class="cor-selo" style="background:${s.estagio.cor};color:${CorRio.TINTA};">ESTÁGIO ${s.nivel}</span>`
    : `<span class="cor-selo cor-selo-neutro">ESTÁGIO INDISPONÍVEL</span>`;
  const corCalor = s.calor ? s.calor.cor : CorRio.NEUTRO.cor;
  const seloCalor = !exibirCalor ? "" : s.nivelCalor
    ? `<span class="cor-selo cor-selo-calor" style="background:${corCalor};color:${CorRio.TINTA};">ESTÁGIO DE CALOR ${s.nivelCalor}</span>`
    : `<span class="cor-selo cor-selo-neutro cor-selo-calor">CALOR INDISPONÍVEL</span>`;
  const abrirCard = (titulo, extraClasse = "") => `<div class="evento-card cor-card${extraClasse}" style="border-color:${cor};background:${fundo};">
    <div class="cor-topo"><div class="cor-titulo">${titulo}</div><div class="cor-selos">${selo}${seloCalor}</div></div>`;
  const desatualizado = (rotulo, iso) => `<p class="cor-desatualizado"><strong>Dados desatualizados</strong> — a consulta ao COR-Rio falhou nesta geração. Última consulta bem-sucedida ${rotulo}: ${esc(dataHoraBrasilia(iso))}.</p>`;

  // Estágio: informação própria, com seus horários.
  const linhaEstagio = !exibirEstagio ? "" : s.nivel
    ? `<p class="evento-linha"><strong>Estágio operacional da cidade:</strong> Estágio ${s.nivel}${est.dados.vigenteDesde ? `, em vigor desde ${esc(dataHoraBrasilia(est.dados.vigenteDesde))}` : ""}. Consulta à fonte: ${esc(dataHoraBrasilia(est.consultadoEm))}.</p>
      ${(est.dados.mensagens || []).map((m) => `<p class="evento-linha"><strong>Mensagem oficial do COR-Rio:</strong> ${textoOficialHtml(m)}</p>`).join("")}
      ${s.estagioDesatualizado ? desatualizado("do estágio", est.consultadoEm) : ""}`
    : `<p class="evento-linha"><strong>Estágio indisponível</strong> — não há consulta válida ao estágio operacional do COR-Rio${est.falha ? ` (${esc(est.falha)})` : ""}. Nenhum estágio é presumido.</p>`;

  const calor = estado.calor || {};
  const linhaCalor = !exibirCalor ? "" : s.nivelCalor
    ? `<p class="evento-linha"><strong>Estágio de calor:</strong> Estágio de Calor ${s.nivelCalor}. Consulta à fonte: ${esc(dataHoraBrasilia(calor.consultadoEm))}. Protocolo independente do estágio operacional da cidade.</p>
      ${s.calorDesatualizado ? desatualizado("do estágio de calor", calor.consultadoEm) : ""}`
    : `<p class="evento-linha"><strong>Estágio de calor indisponível</strong> — não há consulta válida ao Protocolo de Calor do COR-Rio${calor.falha ? ` (${esc(calor.falha)})` : ""}. Nenhum nível é presumido.</p>`;

  const linkEstagios = exibirEstagio ? linkCorRioHtml(est.dados?.urlPublica || "https://cor.rio/estagios-operacionais-da-cidade/", "Estágios operacionais no cor.rio") : "";
  const linkCalor = exibirCalor ? linkCorRioHtml(calor.dados?.urlPublica || "https://cor.rio/niveis-de-calor/", "Níveis de calor no cor.rio") : "";

  if (s.comunicados !== "disponivel" || semComunicadoDoDia) {
    const texto = semComunicadoDoDia
      ? `<p class="cor-com-titulo"><strong>Nenhum comunicado do dia disponível até o horário da consulta.</strong></p>
         <p class="evento-linha">Consulta à fonte: ${esc(dataHoraBrasilia(com.consultadoEm))}.</p>
         ${s.comunicadosDesatualizados ? desatualizado("dos comunicados", com.consultadoEm) : ""}`
      : s.comunicados === "nenhum"
      ? `<p class="cor-com-titulo"><strong>Nenhum comunicado vigente disponibilizado pela fonte.</strong></p>
         <p class="evento-linha">O COR-Rio não publicou nem atualizou comunicados nas últimas ${esc(com.janelaHoras)} h. Consulta à fonte: ${esc(dataHoraBrasilia(com.consultadoEm))}.</p>
         ${s.comunicadosDesatualizados ? desatualizado("dos comunicados", com.consultadoEm) : ""}`
      : `<p class="cor-com-titulo"><strong>Não foi possível consultar os comunicados do COR-Rio nesta geração${com.falha ? ` (${esc(com.falha)})` : ""}.</strong></p>`;
    return `${abrirCard("Comunicado oficial COR-Rio", s.nivel ? "" : " cor-card-neutro")}
      ${texto}
      <div class="cor-separador"></div>
      ${linhaEstagio}
      ${linhaCalor}
      <p class="evento-linha"><strong>Abrangência:</strong> ${esc(estado.abrangencia || "Município do Rio de Janeiro")} &nbsp;|&nbsp; <strong>Fonte:</strong> COR-Rio${linkEstagios ? ` &nbsp;|&nbsp; ${linkEstagios}` : ""}${linkCalor ? ` &nbsp;|&nbsp; ${linkCalor}` : ""}</p>
    </div>`;
  }

  const c = somenteDoDia ? doDia : s.itens[0];
  const outros = somenteDoDia ? [] : s.itens.slice(1);
  const partes = dividirEmPartes(c.paragrafos?.length ? c.paragrafos : [{ texto: c.resumo || "" }]);
  const atualizado = c.atualizadoEm && formatarDataBrasilia(c.atualizadoEm) !== formatarDataBrasilia(c.publicadoEm)
    ? ` · atualizado em ${esc(dataHoraBrasilia(c.atualizadoEm))}` : "";
  const anteriorAoEstagio = exibirEstagio && s.nivel && est.dados.vigenteDesde && Date.parse(c.publicadoEm) < Date.parse(est.dados.vigenteDesde);
  const relacao = exibirEstagio
    ? `<p class="cor-nota">O selo indica o estágio da cidade informado pelo COR-Rio na consulta de ${esc(dataHoraBrasilia(est.consultadoEm || com.consultadoEm))}; estágio e comunicado são publicados separadamente.${anteriorAoEstagio ? ` <strong>Este comunicado foi publicado antes do início do estágio atual</strong> e não deve ser lido como o comunicado desse estágio.` : ""}</p>`
    : "";
  const linkPublicacao = linkCorRioHtml(c.link, "Consultar publicação oficial");
  const total = partes.length;
  const outrosHtml = outros.length
    ? `<div class="cor-outros" style="border-left-color:${cor};"><strong>Outros comunicados vigentes do COR-Rio</strong> (consulta em ${esc(dataHoraBrasilia(com.consultadoEm))}):<ul>${outros.map((o) => `<li>${esc(o.titulo)} — publicado em ${esc(dataHoraBrasilia(o.publicadoEm))}${linkCorRioHtml(o.link, "Consultar publicação oficial") ? ` · ${linkCorRioHtml(o.link, "Consultar publicação oficial")}` : ""}</li>`).join("")}</ul></div>`
    : "";

  return partes.map((paragrafos, i) => {
    const primeira = i === 0;
    const ultima = i === total - 1;
    const titulo = primeira ? "Comunicado oficial COR-Rio" : `Comunicado oficial COR-Rio — continuação (parte ${i + 1} de ${total})`;
    return `${abrirCard(titulo, primeira ? "" : " cor-card-continuacao")}
      <p class="cor-com-titulo"><strong>${esc(c.titulo)}</strong>${primeira ? "" : " <span class=\"cor-cont\">(continuação)</span>"}</p>
      ${primeira ? `<table class="cor-meta"><tbody>
        <tr><th>Abrangência</th><td>${esc(c.abrangencia || estado.abrangencia)}</td></tr>
        <tr><th>Publicação</th><td>${esc(dataHoraBrasilia(c.publicadoEm))}${atualizado}</td></tr>
        <tr><th>Fonte</th><td>${esc(estado.fonte || "COR-Rio — Centro de Operações e Resiliência (Prefeitura do Rio)")}</td></tr>
        <tr><th>Consulta à fonte</th><td>${esc(dataHoraBrasilia(com.consultadoEm))}</td></tr>
        <tr><th>Publicação oficial</th><td>${linkPublicacao || "Link não disponibilizado pela fonte"}</td></tr>
      </tbody></table>
      ${s.comunicadosDesatualizados ? desatualizado("dos comunicados", com.consultadoEm) : ""}
      <p class="cor-rotulo">Conteúdo divulgado pelo COR-Rio${total > 1 ? ` (parte 1 de ${total})` : ""}:</p>` : ""}
      ${paragrafosCorRioHtml(paragrafos)}
      ${ultima ? `${total > 1 && linkPublicacao ? `<p class="evento-linha">Fim do comunicado · ${linkPublicacao}</p>` : ""}
      <div class="cor-separador"></div>
      ${linhaEstagio}
      ${linhaCalor}
      ${relacao}` : `<p class="cor-continua">Continua na próxima parte.</p>`}
    </div>`;
  }).join("") + outrosHtml;
}

// Aviso oficial do INMET (texto preservado, origem identificada). Aviso de
// chuva aplicável à base traz ao lado as recomendações de chuva cadastradas
// para o nível correspondente à severidade oficial — mesmo sem alerta
// equivalente da previsão. Itens já listados em outro alerta de chuva deste
// documento não são repetidos.
function blocoAvisosInmet(r, recomendacoesExibidas = new Set()) {
  const tipoDocumento = tipoDocumentoDoRelatorio(r);
  const consolidados = avisosExibiveis(consolidarAvisosInmet(r.avisosInmet), tipoDocumento);
  const eventos = eventosLocais(r);
  if (!consolidados.length) return "";
  return consolidados
    .map(
      (a) => {
        const evento = a.event || a.evento || a.descricao || a.headline;
        const severidade = a.severity || a.severidade;
        const inicio = a.onset || a.inicio;
        const fim = a.expires || a.fim;
        const motivo = a.description || a.riscos;
        const instrucoes = a.instruction || a.instrucoes;
        const grau = grauAvisoInmet(severidade) || "NORMAL";
        const cor = corSeveridade(severidade);
        const card = `<div class="aviso-inmet evento-card" style="border-color:${cor};background:#FFF8F0;">
        <div class="evento-titulo" style="color:${cor};"><span class="evento-icone">●</span> Aviso oficial INMET</div>
        <p class="evento-descricao"><strong>${esc(evento)}</strong> — <strong style="color:${cor};">${esc(severidade)}</strong></p>
        ${(inicio || fim) ? `<p class="evento-linha"><strong>Vigência:</strong> ${esc(inicio)} até ${esc(fim)}</p>` : ""}
        <p class="evento-linha"><strong>Fonte de dados:</strong> INMET</p>
        ${motivo?.length ? `<p class="evento-linha"><strong>Motivo do aviso:</strong> ${textoOficialHtml(motivo)}</p>` : ""}
        ${instrucoes?.length ? `<p class="evento-linha"><strong>Instruções oficiais:</strong> ${textoOficialHtml(instrucoes)}</p>` : ""}
      </div>`;
        // Informativos programados preservam o quadro completo, inclusive
        // avisos em condição normal. Recomendações só acompanham níveis que
        // configuram alerta operacional.
        if (!alertaExibivel(grau)) return card;
        const chuva = recomendacoesChuvaAvisoInmet(a);
        const resolucao = resolverRecomendacoesAlerta({ aviso: a, eventosLocais: eventos });
        const novas = resolucao.itens.filter((item) => !recomendacoesExibidas.has(item));
        const repetidas = resolucao.itens.length - novas.length;
        novas.forEach((item) => recomendacoesExibidas.add(item));
        return blocoAlerta(card, {
          grau,
          itens: novas,
          tituloRecomendacoes: resolucao.origem === "inmet" ? "Orientações oficiais do INMET" : TITULO_RECOMENDACOES,
          subtitulo: tituloFenomenoRecomendacao(evento || "Aviso oficial INMET"),
          nota: repetidas
            ? `${novas.length ? "As demais recomendações" : "As recomendações"} deste aviso já constam no alerta correspondente acima e não foram repetidas.`
            : "",
        });
      }
    )
    .join("");
}

function tabelaTemperatura(linhas) {
  if (!linhas?.length) return "";
  return `<table>
    <thead><tr><th>Fonte</th><th>Temp. Mínima</th><th>Temp. Máxima</th><th>Umidade Mínima</th><th>Umidade Máxima</th></tr></thead>
    <tbody>
      ${linhas
        .map(
          (l, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
            <td>${esc(l.fonte)}</td><td>${esc(l.tempMin)}°C</td><td>${esc(l.tempMax)}°C</td>
            <td>${esc(l.umidadeMin)}${l.umidadeMin !== "—" ? "%" : ""}</td><td>${esc(l.umidadeMax)}${l.umidadeMax !== "—" ? "%" : ""}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function celulaPeriodo(p) {
  return `${esc(p.periodo)}${p.janela ? `<br/><small>${esc(p.janela)}</small>` : ""}`;
}

function tabelaVento(periodos) {
  if (!periodos?.length) return "";
  return `<table>
    <thead><tr><th>Período</th><th>Direção</th><th>Vento (velocidade média)</th><th>Rajada prevista (máx.)</th><th>Referência INMET</th></tr></thead>
    <tbody>
      ${periodos
        .map(
          (p, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
            <td>${celulaPeriodo(p)}</td><td>${esc(p.direcao)}</td><td>${esc(p.intensidade)}</td>
            <td>${p.rajadaMaxKmh == null ? "—" : p.rajadaMaxKmh + " km/h"}</td><td>${esc(p.referenciaInmet)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function tabelaChuva(periodos) {
  if (!periodos?.length) return "";
  return `<table>
    <thead><tr><th>Período</th><th>Probabilidade (Open-Meteo)</th><th>Acumulado estimado</th><th>Resumo INMET</th></tr></thead>
    <tbody>
      ${periodos
        .map(
          (p, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
            <td>${celulaPeriodo(p)}</td>
            <td>${p.probabilidade == null ? "—" : p.probabilidade + "%"}</td>
            <td>${p.precipitacaoMm == null ? "—" : p.precipitacaoMm + " mm"}</td>
            <td>${esc(p.resumoInmet)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function tabelaMar(mar, fontesPorCampo = {}) {
  if (!mar?.periodos?.length) return "";
  const fonte = fontesPorCampo["mar.alturaMaxDiaM"] && fontesPorCampo["mar.alturaMaxDiaM"] !== "Indisponível"
    ? fontesPorCampo["mar.alturaMaxDiaM"]
    : mar.fonte || "Open-Meteo Marine";
  const temperatura = mar.temperaturaMarC != null
    ? ` Temperatura média da superfície do mar: ${mar.temperaturaMarC}°C (${esc(fontesPorCampo["mar.temperaturaMarC"] || "Open-Meteo Marine")}).`
    : "";
  return blocoTabela({
    titulo: `<h4 class="subsecao">Condições de mar${mar.referenciaPonto ? ` (ponto de referência: ${esc(mar.referenciaPonto)})` : ""}</h4>`,
    antes: mar.desatualizado ? `<p class="nota"><strong>Dado armazenado.</strong> Última atualização válida: ${esc(formatarDataBrasilia(mar.ultimaAtualizacao) || "horário indisponível")}.</p>` : "",
    fonte: `Fonte de dados: ${esc(fonte)}. Altura e marulho: máximo previsto em cada período de hoje.${temperatura}`,
    tabela: `<table>
    <thead><tr><th>Período</th><th>Estado do mar</th><th>Altura máx.</th><th>Período de onda</th><th>Direção</th><th>Marulho</th></tr></thead>
    <tbody>
      ${mar.periodos
        .map(
          (p, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
            <td>${esc(p.periodo)}</td><td>${esc(p.estadoMar)}</td>
            <td>${p.alturaMaxM == null ? "—" : p.alturaMaxM + " m"}</td>
            <td>${p.periodoOndaS == null ? "—" : p.periodoOndaS + " s"}</td>
            <td>${esc(p.direcaoOnda)}</td>
            <td>${p.marulhoMaxM == null ? "—" : p.marulhoMaxM + " m"}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`,
  });
}

function tabelaQualidadeAr(qa, fontesPorCampo = {}) {
  if (!qa) return "";
  const fontePm = fontesPorCampo["ar.pm25Medio"] && fontesPorCampo["ar.pm25Medio"] !== "Indisponível" ? fontesPorCampo["ar.pm25Medio"] : "Open-Meteo Air Quality";
  const linhasParticulado = [
    qa.pm25Medio == null ? "" : `<tr class="zebra">
      <td>Material particulado inalável (PM2,5)</td>
      <td>${qa.pm25Medio} µg/m³</td>
      <td>—</td>
      <td>Diretriz OMS 2021: até 15 µg/m³</td>
    </tr>`,
    qa.pm10Medio == null ? "" : `<tr>
      <td>Material particulado inalável (PM10)</td>
      <td>${qa.pm10Medio} µg/m³</td>
      <td>—</td>
      <td>Diretriz OMS 2021: até 45 µg/m³</td>
    </tr>`,
  ].join("");
  return blocoTabela({
    titulo: `<h4 class="subsecao">Qualidade do Ar e Índice UV</h4>`,
    fonte: `Fonte de dados: ${esc(fontePm)} (material particulado); Open-Meteo Air Quality (índice UV).`,
    tabela: `<table>
    <thead><tr><th>Indicador</th><th>Valor</th><th>Classificação</th><th>Referência</th></tr></thead>
    <tbody>
      <tr>
        <td>QUALIDADE DO AR</td>
        <td></td>
        <td>${esc(qa.pm25Classificacao?.nivel)}</td>
        <td></td>
      </tr>
      ${linhasParticulado}
      <tr class="zebra">
        <td>Índice UV (máximo do dia)</td>
        <td>${qa.uvMax ?? "—"}${qa.horaPicoUv ? ` (pico ~${esc(qa.horaPicoUv)})` : ""}</td>
        <td>${esc(qa.uvClassificacao?.nivel)}</td>
        <td>Faixas OMS: 8+ muito alto, 11+ extremo</td>
      </tr>
    </tbody>
  </table>`,
  });
}

// Fontes apresentadas em tabela, por nome e uso — sem URL: as chamadas de
// API trazem a query completa e poluíam o documento sem servir ao leitor.
function blocoFontes(r) {
  // Relatórios antigos (antes da separação em dois grupos) só tinham `fontes`.
  const automatizadas = r.fontesAutomatizadas || r.fontes || [];
  const manuais = r.fontesManuais || [];

  const linhas = (lista) =>
    lista
      .map(
        (f, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
          <td style="width:32%;"><strong>${esc(f.nome)}</strong></td>
          <td>${esc(f.uso || "")}</td>
        </tr>`
      )
      .join("");

  const tabelaAutomatizadas = automatizadas.length ? `<table>
    <thead><tr><th>Fonte</th><th>Uso neste informativo</th></tr></thead>
    <tbody>${linhas(automatizadas)}</tbody>
  </table>` : "";
  const tabelaManuais = manuais.length ? `<table>
    <thead><tr><th>Fonte</th><th>Observação</th></tr></thead>
    <tbody>${linhas(manuais)}</tbody>
  </table>` : "";
  return `${blocoTabela({
    titulo: `<h4 class="subsecao">Fontes Consultadas</h4>`,
    antes: tabelaAutomatizadas ? `<p class="rotulo-tabela"><strong>Integradas à coleta automática:</strong></p>` : "",
    tabela: tabelaAutomatizadas || `<p class="rotulo-tabela">Nenhuma fonte automática respondeu nesta emissão.</p>`,
  })}
  ${blocoTabela({
    antes: `<p class="rotulo-tabela"><strong>Verificação manual (não integradas):</strong></p>`,
    tabela: tabelaManuais,
  })}
  ${blocoFontesMonitorSecas(r.monitorSecas)}
  ${blocoDivergencias(r.divergencias)}`;
}

// Endereços oficiais efetivamente usados na seção do Monitor de Secas.
function blocoFontesMonitorSecas(ms) {
  if (!ms?.urls?.pagina) return "";
  const linhas = [
    ["Página do mapa (fonte de referência)", ms.urls.pagina],
    ms.urls.api && ["API pública consumida pela página: resumo oficial por UF e data de elaboração", ms.urls.api],
    ms.urls.mapa && ["Mapa oficial (imagem reproduzida)", ms.urls.mapa],
  ].filter(Boolean);
  return blocoTabela({
    antes: `<p class="rotulo-tabela"><strong>Monitor de Secas — ANA (${esc(ms.competencia?.rotulo || "competência indisponível")}):</strong></p>`,
    tabela: `<table class="ms-fontes">
    <thead><tr><th>Uso</th><th>Endereço</th></tr></thead>
    <tbody>${linhas.map(([uso, url], i) => `<tr class="${i % 2 ? "zebra" : ""}"><td style="width:38%;">${esc(uso)}</td><td class="ms-url">${esc(url)}</td></tr>`).join("")}</tbody>
  </table>`,
  });
}

function dataElaboracaoMs(valor) {
  const partes = String(valor || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : null;
}

const IMPACTOS_MS = Object.freeze({ C: "Curto prazo (C)", L: "Longo prazo (L)", CL: "Curto e longo prazo (CL)" });
const VERBOS_EVOLUCAO_MS = /avan[çc]|recu|agrav|surg|desapare|intensific|passou|passando|deixou|amplia|pior|melhor|expan|retra/i;

// Reorganiza o texto oficial da UF sem reescrevê-lo: cada frase vai, inteira,
// para "Situação", "Evolução no mês" ou "Impactos". As intensidades e os
// tipos de impacto destacados são só os códigos citados literalmente no texto.
function analisarResumoMs(texto) {
  const original = String(texto || "");
  const frases = original.split(/(?<=\.)\s+/).map((f) => f.trim()).filter(Boolean);
  const grupos = { situacao: [], evolucao: [], impactos: [] };
  for (const frase of frases) {
    if (/impacto/i.test(frase)) grupos.impactos.push(frase);
    else if (VERBOS_EVOLUCAO_MS.test(frase)) grupos.evolucao.push(frase);
    else grupos.situacao.push(frase);
  }
  const codigos = new Set([...original.matchAll(/\((S[0-4])\)/g)].map((m) => m[1].toLowerCase()));
  if (/\(SSR\)|sem seca relativa/i.test(original)) codigos.add("si");
  const intensidades = Object.keys(monitorSecas.CATEGORIAS).filter((chave) => codigos.has(chave));
  const ordemImpactos = Object.keys(IMPACTOS_MS);
  const impactos = [...new Set([...original.matchAll(/\((CL|C|L)\)/g)].map((m) => m[1]))]
    .sort((a, b) => ordemImpactos.indexOf(a) - ordemImpactos.indexOf(b));
  return { grupos, intensidades, impactos };
}

function blocoResumoUfMs(resumo, rotulo) {
  const cabecalho = `<div class="ms-uf-titulo">Situação da seca — ${esc(resumo.nome)}</div>
    <div class="ms-uf-abrangencia">Resumo estadual — ${esc(resumo.uf)}; sem detalhamento municipal disponível na fonte.</div>`;
  if (!resumo.texto) {
    return `${cabecalho}<p class="ms-uf-paragrafo">Não disponível na fonte para ${esc(rotulo.toLowerCase())}.</p>`;
  }
  const { grupos, intensidades, impactos } = analisarResumoMs(resumo.texto);
  const destaques = [
    intensidades.length && `<div class="ms-destaque"><span class="ms-destaque-rotulo">Intensidades citadas</span>${intensidades.map((chave) => {
      const cat = monitorSecas.CATEGORIAS[chave];
      return `<span class="ms-tag"><span class="ms-chip" style="background:${cat.cor};"></span>${chave === "si" ? "" : `${cat.codigo} `}${esc(cat.nome)}</span>`;
    }).join("")}</div>`,
    impactos.length && `<div class="ms-destaque"><span class="ms-destaque-rotulo">Tipos de impacto citados</span>${impactos.map((c) => `<span class="ms-tag">${esc(IMPACTOS_MS[c])}</span>`).join("")}</div>`,
  ].filter(Boolean).join("");
  const grupo = (titulo, frases) => frases.length
    ? `<div class="ms-grupo"><div class="ms-grupo-titulo">${titulo}</div>${frases.map((f) => `<p class="ms-uf-paragrafo">${esc(f)}</p>`).join("")}</div>`
    : "";
  return `${cabecalho}
    ${destaques ? `<div class="ms-destaques">${destaques}</div>` : ""}
    ${grupo("Situação", grupos.situacao)}
    ${grupo("Evolução no mês", grupos.evolucao)}
    ${grupo("Impactos", grupos.impactos)}`;
}

// Seção "Monitor de Secas — <Mês>/<Ano>": mapa oficial à esquerda e, à
// direita, só o resumo oficial da UF do próprio informativo.
function blocoMonitorSecas(r) {
  const ms = r.monitorSecas;
  if (!ms) return "";
  const rotulo = ms.competencia?.rotulo || "competência indisponível";
  const titulo = `<h4 class="subsecao ms-titulo">Monitor de Secas — ${esc(rotulo)}</h4>
  <p class="ms-nota">Acompanhamento <strong>mensal</strong> da seca publicado pela ANA (condição acumulada no mês de referência). Não é previsão meteorológica diária.</p>`;
  const resumo = (ms.resumosUf || []).find((item) => item.uf === r.cidade?.uf);
  const mapa = ms.status === "indisponivel" ? null : monitorSecas.mapaDataUri(ms.competencia);
  if (ms.status === "indisponivel" || !mapa || !resumo) {
    return `${titulo}
    <p class="clima-indisponivel">Não disponível na fonte para ${esc(rotulo.toLowerCase())} nesta emissão${ms.mensagem ? ` — ${esc(ms.mensagem)}` : ""}. Consulta: ${esc(ms.urls?.pagina || "monitordesecas.ana.gov.br")}</p>`;
  }

  const elaborado = dataElaboracaoMs(ms.dataElaboracao);
  const coletado = formatarDataBrasilia(ms.coletadoEm);
  const legenda = ["si", "s0", "s1", "s2", "s3", "s4"].map((chave) => {
    const cat = monitorSecas.CATEGORIAS[chave];
    return `<span class="ms-leg-item"><span class="ms-chip" style="background:${cat.cor};"></span>${chave === "si" ? "" : `${cat.codigo} `}${esc(cat.nome)}</span>`;
  }).join("");

  return `<div class="ms-bloco">${titulo}
  <table class="ms-layout" role="presentation"><tr>
    <td class="ms-col-mapa">
      <img class="ms-mapa" src="${mapa}" alt="Mapa oficial do Monitor de Secas — ${escAtributo(rotulo)}" />
      <div class="ms-legenda"><strong>Legenda (reproduzida do mapa oficial):</strong><br>${legenda}<br>
        <strong>Tipos de impacto:</strong> C = curto prazo (ex.: agricultura, pastagem); L = longo prazo (ex.: hidrologia, ecologia); linhas = delimitação de impactos dominantes.</div>
      <p class="ms-ref">Fonte: ANA / Monitor de Secas — competência ${esc(rotulo.toLowerCase())}.${elaborado ? ` Elaborado em ${esc(elaborado)}.` : ""} Coleta: ${esc(coletado || "—")}${ms.status === "cache" ? " (cópia validada armazenada)" : ""}.</p>
    </td>
    <td class="ms-col-info">${blocoResumoUfMs(resumo, rotulo)}</td>
  </tr></table></div>`;
}

function dataCurta(dataIso) {
  const partes = String(dataIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : dataIso;
}

const grausC = (valor) => (Number.isFinite(valor) ? `${Math.round(valor)}°C` : "—");

// Tabela da previsão de hoje (05h–00h), sem título próprio: abre a seção
// "1. Previsão" e fica no mesmo bloco que o título da seção. Os dias
// seguintes têm seção própria no fim do informativo.
function blocoPrevisaoAgendada(r, tituloSecao = "") {
  if (!r.previsaoDias?.length) return "";
  const linhas = r.previsaoDias.map((dia, i) => `<tr class="${i % 2 ? "zebra" : ""}">
    <td>${esc(dia.periodo)}<br/><small>${esc(dataCurta(dia.data))}</small></td>
    <td>${esc(dia.condicao)}</td>
    <td>${grausC(dia.tempMin)} / ${grausC(dia.tempMax)}</td>
    <td>${Number.isFinite(dia.chuvaMm) ? `${numeroBr(dia.chuvaMm, 1)} mm` : "—"}</td>
    <td>${Number.isFinite(dia.rajadaKmh) ? `${numeroBr(dia.rajadaKmh, 0)} km/h` : "—"}</td>
    <td>${celulaCalor(r.climaSaude, dia.data)}</td>
  </tr>`).join("");
  return blocoTabela({
    titulo: tituloSecao,
    tabela: `<table class="previsao-hoje"><thead><tr><th>Período</th><th>Condição</th><th>Temperatura mín./máx.</th><th>Chuva/dia</th><th>Rajada prevista</th><th>Calor</th></tr></thead><tbody>${linhas}</tbody></table>`,
    fonte: `Fonte de dados: Open-Meteo (condição, temperatura, chuva e rajada). Para hoje, chuva e rajada consideram a janela indicada. Calor: ${esc(fonteCalor(r.climaSaude, formatarDataBrasilia))} — ${DESCRICAO_CALOR}.`,
  });
}

const NAO_DISPONIVEL = `<span class="p3d-nd">Não disponível</span>`;

// Classificação de calor da data, na cor do nível; sem dado → "Indisponível".
function celulaCalor(climaSaude, dataIso) {
  const calor = calorPorData(climaSaude, dataIso);
  if (!calor) return `<span class="calor-nd">Indisponível</span>`;
  return `<span class="calor-nivel" style="color:${visualCard(calor.grau).cor};">${esc(calor.rotulo)}</span>`;
}

function numeroBr(valor, casas) {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function celulaNumero(valor, casas = 0) {
  return valor == null ? NAO_DISPONIVEL : numeroBr(valor, casas);
}

function dataHoraLocal(iso, fuso) {
  const instante = new Date(iso);
  if (!iso || Number.isNaN(instante.getTime())) return null;
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset",
  }).formatToParts(instante);
  const p = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute} (${p.timeZoneName})`;
}

// Seção final "Previsão para os próximos 3 dias": título e tabela num mesmo
// bloco indivisível — se não couberem no fim da página, vão juntos para a
// próxima. Valor ausente na fonte aparece como "Não disponível", nunca zero.
function blocoPrevisaoProximosDias(r, numeroSecao) {
  const p = r.previsaoProximosDias;
  if (!p?.dias?.length) return "";
  const local = `${esc(p.localidade?.nome || r.cidade.nome)} — ${esc(p.localidade?.uf || r.cidade.uf)}`;
  const linhas = p.dias.map((d, i) => {
    const temperatura = d.tempMaxC == null && d.tempMinC == null
      ? NAO_DISPONIVEL
      : `<span class="p3d-max">${celulaNumero(d.tempMaxC)}</span><span class="p3d-sep">/</span><span class="p3d-min">${celulaNumero(d.tempMinC)}</span>`;
    return `<tr class="${i % 2 === 1 ? "zebra" : ""}">
      <td class="p3d-data"><strong>${esc(d.dataFormatada)}</strong><span>${esc(d.diaSemana)}</span></td>
      <td class="p3d-num">${temperatura}</td>
      <td class="p3d-num">${celulaNumero(d.rajadaMaxKmh)}</td>
      <td class="p3d-num">${celulaNumero(d.chuvaMm, 1)}</td>
      <td class="p3d-num">${celulaNumero(d.uvMax, 1)}</td>
      <td class="p3d-num">${celulaCalor(r.climaSaude, d.data)}</td>
      <td>${d.condicao ? esc(d.condicao) : NAO_DISPONIVEL}</td>
    </tr>`;
  }).join("");

  const consulta = dataHoraLocal(p.consultadoEm, p.fuso);
  const ponto = p.pontoGrade
    ? ` Ponto de grade da fonte mais próximo da localidade: ${numeroBr(p.pontoGrade.latitude, 2)}; ${numeroBr(p.pontoGrade.longitude, 2)}.`
    : "";
  const situacao = p.status === "indisponivel"
    ? `<p class="p3d-aviso"><strong>Fonte indisponível nesta emissão.</strong> ${esc(p.mensagem || "")} Os campos aparecem como "Não disponível"; nenhum valor foi estimado.</p>`
    : p.status === "parcial"
      ? `<p class="p3d-aviso">Alguns campos não foram fornecidos pela fonte para esta localidade e aparecem como "Não disponível".</p>`
      : "";

  return `<div class="p3d-bloco">
    <h3 class="secao">${numeroSecao}. Previsão para os próximos 3 dias</h3>
    <p class="p3d-sub">${local} · três dias seguintes à data de geração deste informativo (hoje não incluído).</p>
    ${situacao}
    <table class="p3d">
      <colgroup><col style="width:14%"><col style="width:15%"><col style="width:12%"><col style="width:12%"><col style="width:11%"><col style="width:13%"><col style="width:23%"></colgroup>
      <thead><tr>
        <th>Data</th>
        <th class="p3d-num">Temperatura Máx./Mín. (°C)</th>
        <th class="p3d-num">Rajada prevista (km/h)</th>
        <th class="p3d-num">Chuva acumulada (mm)</th>
        <th class="p3d-num">Índice UV (máx.)</th>
        <th class="p3d-num">Calor</th>
        <th>Condição geral</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <p class="fonte-tabela">Fonte de dados meteorológicos: ${esc(p.fonte)} — previsão diária (seleção automática de modelos), consultada para ${local}.${ponto}
      ${p.status === "indisponivel" ? "Tentativa de consulta" : "Atualização (horário da consulta à fonte)"}: ${esc(consulta || "horário indisponível")}, horário local.
      Valores diários calculados pela fonte no dia civil local (00h–24h, ${esc(p.fuso)}): rajada = maior rajada prevista a 10 m (não é a velocidade média do vento); chuva = volume total previsto no dia (não é probabilidade); índice UV = máximo previsto no dia.
      Fonte de dados de calor: ${esc(fonteCalor(r.climaSaude, formatarDataBrasilia))} — ${DESCRICAO_CALOR}.</p>
  </div>`;
}

function blocoMudancasDia(r) {
  if (!r.mudancasDia) return "";
  return `<section class="bloco-lista"><h4 class="subsecao">Mudanças do dia em relação ao relatório das 05:00</h4>${listaHtml(r.mudancasDia)}</section>`;
}

// Fontes efetivas de um campo nos três períodos (normalmente uma só).
function fontesPeriodos(r, campo) {
  const fontes = ["manha", "tarde", "noite"]
    .map((k) => r.fontesPorCampo?.[`periodos.${k}.${campo}`])
    .filter((f) => f && f !== "Indisponível");
  return [...new Set(fontes)].join(" / ") || "Open-Meteo";
}

function referenciaConsulta(r) {
  const fuso = r.cidade?.fuso || "America/Sao_Paulo";
  return `consulta em ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)} (horário de Brasília); janelas no horário local (${esc(fuso)})`;
}

function blocosPrevisao(r) {
  const tituloSecao = `<h3 class="secao">1. Previsão</h3>`;
  const previsao = blocoPrevisaoAgendada(r, tituloSecao);
  const fontesTemperatura = [...new Set((r.tabelaTemperaturaUmidade || []).map((l) => l.fonte).filter(Boolean))].join(", ");
  const temperatura = blocoTabela({
    titulo: `${previsao ? "" : tituloSecao}<h4 class="subsecao">Temperatura e umidade</h4>`,
    tabela: tabelaTemperatura(r.tabelaTemperaturaUmidade),
    fonte: `Fonte de dados: ${esc(fontesTemperatura || "indisponível")}, conforme a coluna "Fonte".${r.horarioAgendado ? " Open-Meteo: mínimas e máximas de hoje na janela 05h–00h." : ""} INMET: previsão oficial do município.`,
  });
  const vento = blocoTabela({
    titulo: `<h4 class="subsecao">Vento por período</h4>`,
    tabela: tabelaVento(r.ventoPorPeriodo),
    fonte: `Fonte de dados: ${esc(fontesPeriodos(r, "rajadaMaxKmh"))} — previsão horária a 10 m, em km/h; ${referenciaConsulta(r)}. Vento: maior velocidade média horária prevista na janela do período. Rajada: maior rajada prevista na mesma janela. Referência INMET: previsão oficial do município.`,
  });
  const chuva = blocoTabela({
    titulo: `<h4 class="subsecao">Chuva por período</h4>`,
    tabela: tabelaChuva(r.chuvaPorPeriodo),
    fonte: `Fonte de dados: ${esc(fontesPeriodos(r, "precipitacaoMm"))} — probabilidade: máxima horária na janela; acumulado: soma prevista na janela; ${referenciaConsulta(r)}. Resumo: INMET, previsão oficial do município.`,
  });
  return `${previsao}${temperatura || (previsao ? "" : tituloSecao)}${vento}${chuva}`;
}

function blocoClimaSaude(r) {
  const integracao = r.climaSaude;
  if (!integracao) return '';
  const dados = integracao.dados;
  if (!dados) return `<p class="clima-indisponivel">${esc(integracao.mensagem || "Dados do Clima e Saúde indisponíveis nesta atualização.")}</p>`;
  const nivel = dados.nivel || { grau: "NORMAL" };
  if (!deveExibirNoDocumento({ nivel: nivel.grau, tipoDocumento: tipoDocumentoDoRelatorio(r) })) return "";
  const temperatura = dados.temperatura || {};
  const previsao = (dados.previsaoDias || []).map((dia) => `<li>${esc(dia.data)}: EHF ${esc(dia.classificacao)}; máxima ${dia.tempMax == null ? 'indisponível' : `${esc(dia.tempMax)} °C`}</li>`).join('');
  const detalhes = `<p class="evento-linha">Temperatura média: ${temperatura.media == null ? 'indisponível' : `${esc(temperatura.media)} °C`}</p>
    <p class="evento-linha">Temperatura máxima prevista: ${temperatura.maxima == null ? 'indisponível' : `${esc(temperatura.maxima)} °C`}</p>
    <p class="evento-linha">Temperatura mínima: ${temperatura.minima == null ? 'indisponível' : `${esc(temperatura.minima)} °C`}</p>
    <p class="evento-linha">RISCO COMBINADO À SAÚDE: ${esc(dados.riscoCombinado)}</p>
    <p class="evento-linha">GeoSES / vulnerabilidade social: ${dados.geoses?.valor == null ? 'indisponível' : esc(dados.geoses.valor)}${dados.geoses?.classificacao ? ` (${esc(dados.geoses.classificacao)})` : ''}</p>
    <p class="evento-linha">Consulta: ${esc(dados.consultadoEm)}${integracao.status === 'armazenado' ? ' — última coleta válida armazenada' : ''}</p>
    ${previsao ? `<div class="evento-linha"><strong>Previsão Clima e Saúde</strong><ul>${previsao}</ul></div>` : ''}`;
  const card = cardEvento({
    titulo: "CALOR / RISCO À SAÚDE",
    grau: nivel.grau,
    descricao: `EHF: ${dados.ehf?.classificacao || "Indisponível"}${dados.ehf?.valor == null ? '' : ` (${dados.ehf.valor})`}`,
    fonteDados: dados.source,
    detalhes,
  });
  if (!alertaExibivel(nivel.grau)) return card;
  const resolucao = resolverRecomendacoesAlerta({
    evento: { fenomeno: "calor", grau: nivel.grau, recomendacoes: dados.recomendacoes },
    avisosInmet: r.avisosInmet,
  });
  return blocoAlerta(card, {
    grau: nivel.grau,
    itens: resolucao.itens,
    tituloRecomendacoes: resolucao.origem === "inmet" ? "Orientações oficiais do INMET" : TITULO_RECOMENDACOES,
    subtitulo: tituloFenomenoRecomendacao("Calor / risco à saúde"),
  });
}

// Cabeçalho institucional dos PDFs (diário e semanal): CIM à esquerda,
// título/local/data/horário centralizados e Petrobras à direita, sobre o
// mesmo verde do e-mail. A logo do CIM já tem esse verde como fundo; a da
// Petrobras vem num cartão branco embutido na imagem (src/assets/header/).
function cabecalhoPdfCss(margemLateral) {
  return `
  .header {
    width: auto;
    margin: 0 -${margemLateral}px;
    background: ${HEADER_VERDE};
    color: #ffffff;
    break-inside: avoid;
    page-break-inside: avoid;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header-tabela { width: 100%; border-collapse: collapse; margin: 0; table-layout: fixed; font-size: inherit; }
  .header-tabela td { border: 0; padding: 0; vertical-align: middle; }
  .header-tabela td.header-col-cim { width: 236px; padding: 18px 0 18px 26px; text-align: left; }
  .header-tabela td.header-col-centro { padding: 16px 12px; text-align: center; }
  .header-tabela td.header-col-petrobras { width: 186px; padding: 18px 26px 18px 0; text-align: right; }
  .header-logo-cim img { display: block; width: 210px; height: auto; }
  .header-logo-petrobras img { display: block; width: 160px; height: auto; margin-left: auto; }
  .header-logo-cim-fallback { color: #ffffff; font: 900 30pt/1 'Arial Black', Arial, sans-serif; letter-spacing: -1px; white-space: nowrap; }
  .header-logo-cim-fallback span.i { color: #FEBF0A; }
  .header-logo-petrobras-fallback { color: #ffffff; font: italic bold 16pt/1.2 Arial, sans-serif; }
  .header h1 {
    font-size: 18pt;
    font-weight: bold;
    text-align: center;
    margin: 0;
    line-height: 1.2;
    letter-spacing: 0.3px;
    color: #ffffff;
  }
  .header .header-local {
    font-size: 10.5pt;
    font-weight: normal;
    text-align: center;
    line-height: 1.35;
    margin: 6px 0 0 0;
    color: #ffffff;
  }
  .divisor-amarelo {
    height: 4px;
    background: ${HEADER_AMARELO};
    margin: 0 -${margemLateral}px 20px -${margemLateral}px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }`;
}

function cabecalhoPdfHtml({ titulo, linhaLocal }) {
  const cim = logoHeaderDataUri("cim");
  const petrobras = logoHeaderDataUri("petrobras");
  const logoCimHtml = cim
    ? `<div class="header-logo-cim"><img src="${cim}" alt="${escAtributo(LOGOS_HEADER.cim.alt)}" /></div>`
    : `<div class="header-logo-cim"><div class="header-logo-cim-fallback">C<span class="i">I</span>M</div></div>`;
  const logoPetrobrasHtml = petrobras
    ? `<div class="header-logo-petrobras"><img src="${petrobras}" alt="Petrobras" /></div>`
    : `<div class="header-logo-petrobras"><div class="header-logo-petrobras-fallback">PETROBRAS</div></div>`;
  return `<div class="header">
    <table class="header-tabela" role="presentation"><tr>
      <td class="header-col-cim">${logoCimHtml}</td>
      <td class="header-col-centro header-center">
        <h1>${esc(titulo)}</h1>
        <div class="header-local">${linhaLocal}</div>
      </td>
      <td class="header-col-petrobras">${logoPetrobrasHtml}</td>
    </tr></table>
  </div>
  <div class="divisor-amarelo"></div>`;
}

/**
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.corRioSomenteDoDia] card do COR-Rio só com o
 *   comunicado do dia (PDF anexado ao e-mail).
 */
function renderPdfHtml(r, opcoes = {}) {
  // Itens de recomendação de chuva já exibidos (evita repetição entre o
  // alerta da previsão e os avisos do INMET).
  const recomendacoesExibidas = new Set();
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html { background: #ffffff; }
  body {
    font-family: ${brand.fontePrincipal};
    color: ${brand.cinzaTexto};
    background: #ffffff;
    font-size: 11pt;
    line-height: 1.45;
    margin: 0;
    padding: 0 36px 20px 36px;
  }
  ${cabecalhoPdfCss(36)}
  h3.secao {
    break-after: avoid;
    page-break-after: avoid;
    color: ${brand.verde};
    font-weight: bold;
    font-size: 14pt;
    border-bottom: 2px solid ${brand.verde};
    padding-bottom: 4px;
    margin-top: 20px;
    margin-bottom: 10px;
  }
  h4.subsecao {
    break-after: avoid;
    page-break-after: avoid;
    font-weight: bold;
    font-size: 12pt;
    margin-bottom: 6px;
    margin-top: 15px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0 11px 0;
    font-size: 10pt;
  }
  th {
    background: ${brand.verde};
    color: #ffffff;
    text-align: left;
    padding: 8px 9px;
  }
  td {
    padding: 8px 9px;
    border-bottom: 1px solid ${brand.cinzaBorda};
  }
  tr.zebra { background: ${brand.cinzaClaro}; }
  /* Paginação: título, tabela e fonte juntos; tabela longa repete o
     cabeçalho e nunca corta uma linha. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .bloco-tabela { break-inside: avoid; page-break-inside: avoid; }
  .bloco-lista { break-inside: auto; page-break-inside: auto; }
  .bloco-lista li { break-inside: avoid; page-break-inside: avoid; }
  .bloco-tabela > table { margin-bottom: 0; }
  .bloco-tabela td small { color: #666; font-size: 8.5pt; }
  .fonte-tabela { font-family: ${brand.fontePrincipal}; font-size: 8.5pt; line-height: 1.45; color: #555; text-align: left; margin: 5px 0 14px 0; }
  .rotulo-tabela { font-size: 10pt; margin: 10px 0 4px 0; }
  /* Alerta à esquerda, recomendações à direita, no mesmo bloco. */
  table.alerta-bloco { table-layout: fixed; border-collapse: collapse; margin: 10px 0; font-size: inherit; break-before: auto; break-after: auto; break-inside: avoid; page-break-before: auto; page-break-after: auto; page-break-inside: avoid; }
  table.alerta-bloco > tbody > tr > td { padding: 0; border: 0; vertical-align: top; }
  td.alerta-col-card { width: 55%; padding-right: 9px !important; }
  td.alerta-col-card .evento-card { margin: 0; padding: 11px 14px; }
  td.alerta-col-card .evento-titulo { white-space: normal; font-size: 12.5pt; }
  td.alerta-col-card .evento-titulo-longo { font-size: 11pt; }
  .alerta-rec { border: 1px solid ${brand.cinzaBorda}; border-top: 4px solid; border-radius: 5px; padding: 10px 12px; font-size: 9.5pt; line-height: 1.38; background: #ffffff; }
  .alerta-rec-titulo { font-weight: 700; font-size: 9.5pt; color: ${brand.verdeEscuro}; }
  .alerta-rec-sub { font-weight: 700; font-size: 9.5pt; margin: 3px 0 0 0; text-transform: uppercase; }
  .alerta-rec ul { margin: 4px 0 0 0; padding-left: 16px; }
  .alerta-rec li { margin-bottom: 3px; }
  .alerta-rec-nota { font-size: 9pt; color: #555; margin: 6px 0 0 0; }
  .evento-card {
    width: 100%;
    border: 1.5px solid;
    border-left-width: 5px;
    border-radius: 5px;
    padding: 14px 17px;
    margin: 11px 0;
    font-size: 10.5pt;
    line-height: 1.48;
    break-inside: avoid;
    page-break-inside: avoid;
    -webkit-column-break-inside: avoid;
  }
  .evento-titulo {
    font-size: 15pt;
    font-weight: 700;
    line-height: 1.4;
    margin: 0 0 8px 0;
    white-space: nowrap;
    word-break: keep-all;
    overflow-wrap: normal;
    break-after: avoid;
    page-break-after: avoid;
  }
  .evento-titulo-longo { font-size: 11.5pt; letter-spacing: -0.1px; }
  .evento-icone { font-size: 11pt; vertical-align: 1px; }
  .evento-descricao { margin: 0 0 7px 0; line-height: 1.48; }
  .evento-linha { margin: 6px 0 0 0; line-height: 1.48; }
  .evento-linha ul { margin-bottom: 0; }
  .recomendacao-grupo ul { margin: 5px 0 0 0; }
  .clima-indisponivel { color: #666; font-size: 10pt; margin: 12px 0; }
  .warning-box {
    border-left: 4px solid ${brand.vermelhoAlerta};
    background: #FDF2F1;
    padding: 8px 14px;
    margin: 14px 0;
    font-size: 10pt;
  }
  .aviso-inmet { break-inside: avoid; page-break-inside: avoid; }
  .cor-card { border-width: 1.5px; border-left-width: 7px; border-radius: 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #1F2A26; }
  .cor-card-continuacao { margin-top: 10px; }
  .cor-topo { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 10px; }
  .cor-titulo { font-size: 15pt; font-weight: 700; line-height: 1.3; color: #1F2A26; }
  .cor-selo { flex: none; padding: 4px 12px; border-radius: 5px; font-size: 10.5pt; font-weight: 800; letter-spacing: 0.6px; white-space: nowrap; }
  .cor-selos { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex: none; }
  .cor-selo-calor { font-size: 9.5pt; }
  .cor-selo-neutro { background: #DDE3E1; color: #2B3431; border: 1px dashed #8A9894; }
  .cor-com-titulo { margin: 0 0 8px 0; font-size: 12pt; line-height: 1.4; }
  .cor-cont { font-weight: normal; font-size: 10pt; color: #555; }
  table.cor-meta { margin: 6px 0 10px 0; font-size: 9.5pt; background: rgba(255,255,255,0.65); }
  table.cor-meta th { background: transparent; color: #1F2A26; width: 26%; padding: 4px 8px; vertical-align: top; border-bottom: 1px solid rgba(0,0,0,0.08); }
  table.cor-meta td { padding: 4px 8px; border-bottom: 1px solid rgba(0,0,0,0.08); overflow-wrap: anywhere; }
  .cor-card a, .cor-outros a { color: ${brand.verdeEscuro}; font-weight: 600; text-decoration: underline; }
  .cor-rotulo { margin: 10px 0 2px 0; font-weight: 700; font-size: 10pt; }
  .cor-par { margin: 6px 0 0 0; line-height: 1.5; overflow-wrap: anywhere; }
  .cor-par-destaque { font-weight: 700; margin-top: 10px; }
  .cor-lista { margin: 6px 0 0 0; }
  .cor-lista li { margin-bottom: 3px; }
  .cor-separador { border-top: 1px solid rgba(0,0,0,0.12); margin: 12px 0 2px 0; }
  .cor-nota { margin: 8px 0 0 0; font-size: 9.5pt; color: #3A4541; line-height: 1.5; }
  .cor-desatualizado { margin: 8px 0 0 0; padding: 6px 10px; border: 1px dashed #B7791F; background: #FFF8E6; font-size: 9.5pt; }
  .cor-continua { margin: 10px 0 0 0; font-size: 9pt; font-style: italic; color: #555; text-align: right; }
  .cor-outros { margin: -4px 0 16px 0; padding: 8px 14px; border: 1px solid ${brand.cinzaBorda}; border-left: 4px solid; border-radius: 5px; font-size: 9.5pt; break-inside: avoid; page-break-inside: avoid; }
  .cor-outros ul { margin: 4px 0 0 0; }
  ul { margin: 8px 0 14px 0; padding-left: 20px; }
  li { margin-bottom: 6px; line-height: 1.45; }
  .ms-bloco { break-inside: avoid; page-break-inside: avoid; }
  .ms-titulo { border-bottom: 2px solid ${brand.verde}; padding-bottom: 3px; margin-top: 0; }
  .ms-nota { font-size: 9.5pt; margin: 4px 0 8px 0; }
  table.ms-layout { margin: 0; font-size: 9pt; table-layout: fixed; break-inside: avoid; page-break-inside: avoid; }
  table.ms-layout > tbody > tr > td { border: 0; padding: 0; vertical-align: top; }
  td.ms-col-mapa { width: 54%; padding-right: 12px !important; }
  img.ms-mapa { display: block; width: 100%; height: auto; border: 1px solid ${brand.cinzaBorda}; }
  .ms-legenda { font-size: 8pt; line-height: 1.5; margin-top: 5px; }
  .ms-leg-item { display: inline-block; margin-right: 8px; white-space: nowrap; }
  .ms-chip { display: inline-block; width: 10px; height: 10px; border: 1px solid #555; margin-right: 4px; vertical-align: -1px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ms-ref { font-size: 8pt; color: #444; margin: 5px 0 0 0; }
  td.ms-col-info { padding-left: 6px !important; }
  .ms-uf-titulo { font-size: 13pt; font-weight: bold; color: ${brand.verde}; line-height: 1.3; margin: 0 0 4px 0; }
  .ms-uf-abrangencia { font-size: 9pt; font-style: italic; color: #555; margin-bottom: 12px; }
  .ms-destaques { background: ${brand.cinzaClaro}; border-radius: 4px; padding: 8px 10px; margin-bottom: 12px; }
  .ms-destaque + .ms-destaque { margin-top: 8px; }
  .ms-destaque-rotulo { display: block; font-size: 8.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; color: #555; margin-bottom: 4px; }
  .ms-tag { display: inline-block; font-size: 9.5pt; margin: 0 10px 3px 0; white-space: nowrap; }
  .ms-grupo { margin-bottom: 10px; }
  .ms-grupo-titulo { font-size: 10pt; font-weight: bold; border-bottom: 1px solid ${brand.cinzaBorda}; padding-bottom: 2px; margin-bottom: 5px; }
  .ms-uf-paragrafo { font-size: 10.5pt; line-height: 1.55; margin: 0 0 7px 0; }
  table.ms-fontes { font-size: 8.5pt; }
  td.ms-url { word-break: break-all; }
  .p3d-bloco { break-inside: avoid; page-break-inside: avoid; padding-top: 1px; }
  .p3d-sub { font-size: 10pt; color: #555; margin: 6px 0 4px 0; }
  table.p3d { table-layout: fixed; font-size: 10.5pt; margin: 8px 0 0 0; border: 1px solid ${brand.cinzaBorda}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table.p3d th { background: ${brand.verde}; color: #ffffff; font-size: 9.5pt; line-height: 1.3; padding: 10px 10px; vertical-align: bottom; }
  table.p3d td { padding: 12px 10px; vertical-align: middle; line-height: 1.35; }
  table.p3d tr { break-inside: avoid; page-break-inside: avoid; }
  table.p3d .p3d-num { text-align: center; padding-left: 6px; padding-right: 6px; }
  td.p3d-data strong { display: block; font-size: 11.5pt; color: ${brand.verdeEscuro}; letter-spacing: 0.2px; }
  td.p3d-data span { display: block; font-size: 8.5pt; color: #666; margin-top: 1px; }
  .p3d-max { font-weight: bold; color: #B23A12; }
  .p3d-min { font-weight: bold; color: #1F5F99; }
  .p3d-sep { color: #999; margin: 0 5px; }
  .p3d-nd { font-size: 9pt; font-style: italic; color: #666; white-space: nowrap; }
  .calor-nivel { font-weight: bold; white-space: nowrap; }
  .calor-nd { font-size: 9pt; font-style: italic; color: #666; white-space: nowrap; }
  .p3d-aviso { font-size: 9.5pt; margin: 6px 0; padding: 6px 10px; border-left: 4px solid ${brand.amarelo}; background: #FFFBE6; }
</style>
</head>
<body>
  ${cabecalhoPdfHtml({
    titulo: "INFORMATIVO METEOROLÓGICO",
    linhaLocal: `${esc(r.cidade.nome)} — ${esc(r.cidade.uf)} — ${esc(r.dataFormatadaLonga)}`,
  })}

  <p><strong>Data da previsão:</strong> ${esc(r.dataFormatadaCurta)} &nbsp;|&nbsp; <strong>Hora da consulta:</strong> ${esc(r.horaConsulta)} (Horário de Brasília)</p>
  ${r.periodoCoberto ? `<p><strong>Período coberto:</strong> ${esc(r.periodoCoberto)}.</p>` : ""}
  ${blocoMudancasDia(r)}

  ${blocosPrevisao(r)}

  ${tabelaMar(r.mar, r.fontesPorCampo)}
  ${tabelaQualidadeAr(r.qualidadeAr, r.fontesPorCampo)}
  ${blocoEventoExtremo(r, recomendacoesExibidas)}
  ${blocoClimaSaude(r)}
  ${blocoCorRio(r, { somenteDoDia: opcoes.corRioSomenteDoDia })}
  ${blocoAvisosInmet(r, recomendacoesExibidas)}
  ${blocoMonitorSecas(r)}
  ${blocoAvisosColeta(r)}

  ${blocoFontes(r)}

  <section class="bloco-lista">
    <h3 class="secao">2. Recomendações de Segurança — Deslocamento</h3>
    <p>Considerando o horário da consulta (${esc(r.horaConsulta)}), as recomendações abaixo projetam os riscos meteorológicos para o restante do dia.</p>
    <h4 class="subsecao">a) Pedestres</h4>
    ${listaHtml(r.deslocamento.pedestres)}
  </section>
  <section class="bloco-lista"><h4 class="subsecao">b) Transporte Público</h4>${listaHtml(r.deslocamento.transporte)}</section>
  <section class="bloco-lista"><h4 class="subsecao">c) Condutores de Veículo Próprio</h4>${listaHtml(r.deslocamento.condutores)}</section>

  ${r.edificacao
    .map(
      (secao, i) => `<section class="bloco-lista">${i === 0 ? `<h3 class="secao">3. Recomendações de Segurança — Edificação e Ocupantes</h3>` : ""}<h4 class="subsecao">${esc(secao.titulo)}</h4>${listaHtml(secao.itens)}</section>`
    )
    .join("") || `<h3 class="secao">3. Recomendações de Segurança — Edificação e Ocupantes</h3>`}

  ${blocoPrevisaoProximosDias(r, 4)}

</body>
</html>`;
}

function headerTemplateVazio() {
  return `<div></div>`;
}

function footerTemplate(r) {
  // Só as fontes efetivamente integradas entram no rodapé — citar as de
  // verificação manual aqui daria a entender que foram consultadas.
  const fontesResumo = (r.fontesAutomatizadas || r.fontes || [])
    .slice(0, 3)
    .map((f) => f.nome.split("—")[0].trim())
    .join(", ");
  return `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#666;padding:0 36px;">
    <div style="border-top:2px solid ${brand.amarelo};padding-top:4px;display:flex;justify-content:space-between;">
      <span>Documento gerado automaticamente por ferramenta de geração assistida por IA em ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)}. Sujeito a revisão humana antes de uso operacional. Fontes: ${esc(fontesResumo)} e outras listadas no corpo do documento.</span>
      <span style="white-space:nowrap;margin-left:12px;"><span class="pageNumber"></span>/<span class="totalPages"></span></span>
    </div>
  </div>`;
}

module.exports = { renderPdfHtml, headerTemplateVazio, footerTemplate, esc, cabecalhoPdfCss, cabecalhoPdfHtml };
