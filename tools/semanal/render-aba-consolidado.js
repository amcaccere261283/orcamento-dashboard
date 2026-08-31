'use strict';
const { indiceSemanaAtual } = require('./compute-semanal.js');
const { calcularSeriesSemanaisDimensao, formatarIntervaloSemana } = require('./render-aba-semanal.js');
const { DIAS_PREMISSA_MES } = require('../comum/calculo-equipes.js');
const { chaveMatriz } = require('../comum/linha-base.js');
const { serieDaSemana } = require('./compute-relatorio-semanal.js');

// Aba CONSOLIDADO (2026-08-03) -- "uma tabela com o consolidado da semana, na
// mesma abertura de linhas da planilha tabela do orçamento, porém com as
// informações apenas da semana".
//
// A "abertura de linhas" portada é a HIERARQUIA da Tabela do orçamento
// (renderCorpoTabela, tools/orcamento/render-dashboard.js), nesta ordem:
//
//   TOTAL GERAL                      (todos os registros do recorte atual)
//   TOTAL GERAL por tipologia        (uma por tipologia presente, alfabética)
//   por SUP:  uma linha por registro (= por tipologia daquele SUP)
//             TOTAL <SUP>
//
// O que NÃO é portado é a forma das colunas: lá, cada série (Previsto/
// Realizado/Tendência) é uma LINHA e os 12 meses são colunas. Aqui só existe
// UMA semana, então as séries cabem como colunas e cada abertura vira uma
// linha só -- é o que torna a tabela legível como "o consolidado da semana",
// em vez de triplicar a altura para preencher uma coluna única.
//
// 2026-08-04: o Previsto SAIU da tabela (pedido do dono do projeto -- a
// coluna comparava mal com uma Tendência que às vezes é histórica, ver
// abaixo) e a Tendência das semanas JÁ COMEÇADAS (encerrada ou em curso)
// passou a vir CONGELADA no 1º dia delas, em vez da projeção de hoje: é
// chamar calcularSeriesSemanaisDimensao de novo com hojeEpoch = início
// daquela semana, fazendo-a virar "a vigente" no recálculo -- o valor
// devolvido é exatamente o que se projetava para ela quando começou. O
// Realizado NUNCA congela (continua saindo do hoje real): congelá-lo também
// zeraria o Realizado de uma semana que de fato produziu, porque a contagem
// pararia no 1º dia dela. Ver renderLinha/renderCabecalho abaixo.
//
// As colunas extras seguem a regra que o dono do projeto deu explicitamente --
// "não misturar as informações físicas e financeiras":
//
//   Volume     -> Equipes previstas + Produtividade média esperada
//   Financeiro -> Ticket médio previsto
//
// As três são PREMISSAS do mês, não grandezas da semana: equipes é foto (2
// equipes no mês são 2 equipes em qualquer semana -- mesma premissa de
// dividirEmSemanas), e produtividade/ticket vêm das colunas PROD./TICKET da
// MATRIZ, que valem para o ano inteiro. Repartir qualquer uma delas por semana
// produziria número errado em silêncio; a nota no rodapé da aba diz isso na
// tela, não só aqui.
//
// Este módulo roda no Node (testes) e no navegador (bundle) -- por isso
// 'var'/'function'. O require de '../comum/calculo-equipes.js' é REMOVIDO pelo
// bundler e DIAS_PREMISSA_MES chega como global (fonteParaCliente(), injetada
// num <script> antes do bundle) -- mesmo mecanismo que compute-balanco.js já
// usa para mediaEquipesPonderada; ver o comentário no topo daquele arquivo.

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatarNumero(v, casasDecimais) {
  if (v === null || v === undefined) return '—';
  var casas = casasDecimais === undefined ? 2 : casasDecimais;
  var fator = Math.pow(10, casas);
  return (Math.round(v * fator) / fator).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Cópia de tipologiaColor do orçamento (tools/orcamento/render-dashboard.js),
// que por sua vez veio de tools/matriz/render-dashboard.js do repositório
// irmão -- duplicada pelo mesmo motivo de sempre neste bundle: a tipologia é
// dado protegido por senha e o chip é montado no navegador, então a cor tem de
// existir aqui dentro.
var TIPOLOGIA_COLOR = {
  SP: '#3f851a', SM: '#2f6ad0', ST: '#8d6f00', PI: '#606060',
  BL: '#4a3aa7', CPTU: '#db244e', SH: '#e87ba4', VT: '#eda100',
  'SEGURANÇA': '#2775b8', ESPECIAIS: '#db244e', SSMA: '#2775b8',
};
var TIPOLOGIA_COMPOSTA_COLOR = {
  'CPTU / VT / SH': TIPOLOGIA_COLOR.CPTU,
  'SP/SM': TIPOLOGIA_COLOR.SP,
};
function tipologiaColor(tipologia) {
  var raw = String(tipologia || '').trim();
  var key = raw.toUpperCase();
  if (TIPOLOGIA_COLOR[key]) return TIPOLOGIA_COLOR[key];
  if (TIPOLOGIA_COMPOSTA_COLOR[key]) return TIPOLOGIA_COMPOSTA_COLOR[key];
  var parenMatch = raw.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) {
    var viaParen = TIPOLOGIA_COLOR[parenMatch[1].trim().toUpperCase()];
    if (viaParen) return viaParen;
  }
  var primeiroToken = key.split('/')[0].trim();
  if (TIPOLOGIA_COLOR[primeiroToken]) return TIPOLOGIA_COLOR[primeiroToken];
  return '#898781';
}

// Soma um campo mensal do Previsto através dos registros do grupo. null só
// quando NENHUM registro tem valor naquele mês -- mesma convenção de
// previstoMesVigente (render-aba-semanal.js), inclusive para 'equipes': somar
// equipes de CONTRATOS diferentes no mesmo mês é válido (times simultâneos se
// somam); o que não se soma é equipes ao longo do TEMPO.
function somarPrevistoMes(registros, indices, campo, mesIdx) {
  var soma = null;
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    var mensal = registro && registro.previsto && registro.previsto[campo];
    if (!Array.isArray(mensal)) return;
    var v = mensal[mesIdx];
    if (v === null || v === undefined) return;
    soma = (soma === null ? 0 : soma) + v;
  });
  return soma;
}

// Produtividade média ESPERADA, em furos por equipe-dia. Segue a mesma regra
// que o orçamento usa para a produtividade do Previsto (bucketIntervalo,
// tools/orcamento/render-dashboard.js):
//
//   - UM registro só: a premissa PROD. digitada na planilha, lida direto. Ela
//     JÁ é uma taxa diária e não passa por DIAS_PREMISSA_MES;
//   - agregado de vários: recalcula volume ÷ (equipes x dias do mês), porque
//     a média das premissas de tipologias diferentes não é a premissa da soma.
//
// DIAS_PREMISSA_MES (15 em Jan/Dez, 30 nos demais) é a premissa de dias úteis
// do projeto inteiro -- não os dias do calendário. Usar o calendário aqui faria
// esta coluna discordar do mesmo número no dashboard de orçamento.
function produtividadeEsperada(registros, indices, mesIdx) {
  var lista = indices || [];
  if (lista.length === 1) {
    var registro = registros[lista[0]];
    var prod = registro && registro.previsto && registro.previsto.equipesResumo && registro.previsto.equipesResumo.prod;
    return (prod === null || prod === undefined) ? null : prod;
  }
  var volume = somarPrevistoMes(registros, lista, 'volume', mesIdx);
  var equipes = somarPrevistoMes(registros, lista, 'equipes', mesIdx);
  var dias = DIAS_PREMISSA_MES[mesIdx];
  if (volume === null || !equipes || !dias) return null;
  return volume / (equipes * dias);
}

// Ticket médio previsto (R$ por furo), pela mesma regra de dois ramos acima:
// premissa TICKET da planilha para um registro só, razão recalculada para o
// agregado.
function ticketMedioPrevisto(registros, indices, mesIdx) {
  var lista = indices || [];
  if (lista.length === 1) {
    var registro = registros[lista[0]];
    var ticket = registro && registro.previsto && registro.previsto.volumeResumo && registro.previsto.volumeResumo.ticket;
    return (ticket === null || ticket === undefined) ? null : ticket;
  }
  var financeiro = somarPrevistoMes(registros, lista, 'financeiro', mesIdx);
  var volume = somarPrevistoMes(registros, lista, 'volume', mesIdx);
  if (financeiro === null || !volume) return null;
  return financeiro / volume;
}

// As colunas extras de CADA dimensão -- a separação física/financeira que o
// dono do projeto pediu explicitamente. Volume não mostra ticket, Financeiro
// não mostra equipes nem produtividade. Desde 2026-08-04, valores financeiros
// (ticket) saem sempre inteiros, sem casa decimal.
// A dimensão que a TABELA de fato exibe. A barra compartilhada tem três
// (equipes/volume/financeiro) e esta aba só sabe desenhar duas: 'equipes' cai
// em Volume, porque a página não mede equipes por semana em lugar nenhum.
//
// Exportada de propósito, e não duplicada em quem chama: o recorte de ativos
// (indicesDaAba, render-semanal.js) tem de usar a MESMA dimensão que a tabela
// exibe. Com a regra copiada em dois lugares, marcar "Equipes" na barra fazia
// o recorte filtrar por previsto.equipes enquanto a tabela mostrava colunas de
// Volume -- um registro com volume previsto e equipes zeradas sumia de uma
// tabela que estava exibindo justamente o volume dele.
function dimensaoDaTabela(dimensao) {
  return dimensao === 'financeiro' ? 'financeiro' : 'volume';
}

function colunasExtras(dimensao) {
  if (dimensao === 'financeiro') {
    return [{ chave: 'ticket', rotulo: 'Ticket médio previsto (R$/furo)', casas: 0 }];
  }
  return [
    { chave: 'equipes', rotulo: 'Equipes previstas', casas: 2 },
    { chave: 'produtividade', rotulo: 'Produtividade média esperada', casas: 2 },
  ];
}

function valorExtra(chave, registros, indices, mesIdx) {
  if (chave === 'equipes') return somarPrevistoMes(registros, indices, 'equipes', mesIdx);
  if (chave === 'produtividade') return produtividadeEsperada(registros, indices, mesIdx);
  return ticketMedioPrevisto(registros, indices, mesIdx);
}

// '06/07' -- só o 1º dia da semana, sem o intervalo que formatarIntervaloSemana
// devolve. Mesma reconstrução de Date por multiplicação usada no resto do
// projeto: diaEpoch nunca ajusta fuso, então o produto cai na meia-noite UTC
// daquele dia e getUTC* lê o dia civil certo em qualquer fuso.
function dataCurta(diaEp) {
  var d = new Date(diaEp * 86400000);
  var dia = d.getUTCDate();
  var mes = d.getUTCMonth() + 1;
  return (dia < 10 ? '0' : '') + dia + '/' + (mes < 10 ? '0' : '') + mes;
}

// '2026-07-06' -- mesma conta que chaveSemanaSeguinteDeSexta (Task 1) usa
// para o formato YYYY-MM-DD, aplicada direto a um diaEpoch sem procurar
// sexta-feira nenhuma. Usada aqui para escolher a entrada de
// opcoes.congeladoSemanal que corresponde à semana em tela, e no futuro por
// quem gerar o link entre o snapshot e a semana.
function formatarChaveSemana(diaEpoch) {
  var d = new Date(diaEpoch * 86400000);
  var ano = d.getUTCFullYear();
  var mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dia = String(d.getUTCDate()).padStart(2, '0');
  return ano + '-' + mes + '-' + dia;
}

// 'congeladaEm' é o diaEpoch do 1º dia da semana quando a Tendência está
// congelada, ou null quando ela é a projeção de hoje (semana futura). O
// rótulo TEM de dizer qual das duas está na tela: as duas se chamam
// "Tendência" e significam coisas opostas -- uma é registro histórico do que
// se projetava naquele momento, a outra é a projeção corrente.
function renderCabecalho(dimensao, semana, congelada) {
  var sufixo = semana ? ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')' : '';
  var rotuloTendencia = congelada === true ? ' (congelada)' : congelada === false ? ' (recalculada)' : '';
  return '<thead><tr>'
    + '<th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th>'
    + '<th class="num">Previsto até a data' + escapeHtml(sufixo + rotuloTendencia) + '</th>'
    + '<th class="num">Realizado</th>'
    + '<th class="num">Desvio até a data</th>'
    + '<th class="num">Semana total</th>'
    + '</tr></thead>';
}

// congeladoPorSemana: a fatia de opcoes.congeladoSemanal já resolvida para a
// chave da semana em tela (congeladoSemanal[formatarChaveSemana(semana.inicio)]
// || null), resolvida uma vez em renderAbaConsolidado e passada via ctx --
// evita recalcular a chave a cada linha.
function tendenciaExternaDoCtx(ctx) {
  if (!ctx.congeladoPorSemana || !ctx.congeladoPorSemana.porRegistro) return undefined;
  var porRegistro = ctx.congeladoPorSemana.porRegistro;
  return function (chave) {
    var entrada = porRegistro[chave];
    if (!entrada || !entrada[ctx.dimensaoSnapshot]) return undefined;
    var v = entrada[ctx.dimensaoSnapshot].tendencia;
    return v === undefined ? undefined : v;
  };
}

// Uma linha da tabela. 'celulas' são as 4 primeiras (SUP/Grupo/Tomador/
// Tipologia), montadas por quem chama porque é só nelas que os 4 tipos de
// linha (registro, total do SUP, total geral, total geral por tipologia)
// diferem -- mesma decomposição de renderBlocosDimensao no orçamento.
function renderLinhaResumo(celulas, classe, registros, indices, ctx) {
  var alvo = { semana: ctx.semanaEscolhida, mesIdx: ctx.mesIdx, semanasDoMesAlvo: ctx.semanas, indiceNoMes: ctx.semanaIdx };
  var serieCtx = {
    hojeEpoch: ctx.hojeEpoch, temSemanasReais: ctx.temSemanasReais, demandas: ctx.demandas,
    tendenciaExterna: tendenciaExternaDoCtx(ctx),
    chaveDoRegistro: function (r) { return chaveMatriz(r.sup, r.tipologia); },
  };
  var janela = serieDaSemana(registros, indices, ctx.dimensaoSnapshot, alvo, serieCtx);
  // "Previsto até a data": fração do Previsto da semana proporcional aos dias
  // já passados dela (mesma leitura do .xlsx) -- dias corridos, não úteis,
  // porque é isso que "até a data" descreve num calendário civil.
  var diasNaSemana = Math.round((ctx.semanaEscolhida.fim - ctx.semanaEscolhida.inicio + 1));
  var diasDecorridos = Math.max(0, Math.min(diasNaSemana, ctx.hojeEpoch - ctx.semanaEscolhida.inicio + 1));
  var previstoAteAData = janela.previsto === null ? null : janela.previsto * (diasDecorridos / diasNaSemana);
  var numeradorDesvio = ctx.semanaEscolhida.inicio <= ctx.hojeEpoch && ctx.semanaEscolhida.fim > ctx.hojeEpoch
    ? janela.tendencia // semana em curso: compara contra a projeção, não o parcial cru
    : janela.realizado;
  var desvio = (numeradorDesvio === null || numeradorDesvio === undefined || !previstoAteAData)
    ? null : (numeradorDesvio / previstoAteAData) - 1;

  function num(v, casas) { return v === null || v === undefined ? '<td class="num sem-dado"></td>' : '<td class="num">' + formatarNumero(v, casas === undefined ? 0 : casas) + '</td>'; }
  function pct(v) { return v === null || v === undefined ? '<td class="num sem-dado"></td>' : '<td class="num">' + formatarNumero(v * 100, 1) + '%</td>'; }

  // "Semana total": Previsto da semana INTEIRA -- janela.previsto, não
  // janela.tendencia. Decisão 3 do design: "'Previsto até a data' e 'Semana
  // total' replicam a mesma dupla que o .xlsx já mostra: Previsto acumulado
  // até hoje dentro da semana (fração dela) vs. Previsto da semana inteira."
  // Fora do ramo R≈P a Tendência diverge do Previsto por construção -- usar
  // janela.tendencia aqui faria "Semana total" mostrar uma projeção em vez
  // do valor planejado/orçado, o número que a Decisão 3 pede para NUNCA
  // divergir do .xlsx. O status congelada/recalculada já é comunicado só
  // pelo rótulo do cabeçalho (renderCabecalho) -- esta coluna não precisa
  // (e não deve) reagir a ctx.tendenciaExterna.
  return '<tr class="' + classe + '">' + celulas
    + num(previstoAteAData) + num(janela.realizado) + pct(desvio) + num(janela.previsto)
    + '</tr>';
}

// Task 5 (2026-08-31): Produtividade média e Equipe -- dois blocos extras,
// abaixo da tabela principal, com Tendência congelada (SÓ do snapshot, sem o
// fallback de recálculo local que renderLinhaResumo tem) + Realizado.
//
// Produtividade média não existe como série própria em
// calcularSeriesSemanaisDimensao (é derivada de Volume ÷ Equipes), então
// "recalcular localmente" a Tendência exigiria refazer essa mesma divisão
// fora do snapshot -- possível, mas não pedido nesta rodada. Sem entrada no
// snapshot para a semana em tela, a célula de Tendência fica sem dado: é uma
// limitação aceita (o congelamento de sexta ainda não rodou para aquela
// semana), não um bug.
//
// realizadoDoBloco: (registros, indices, ctx) => number|null. Recebido pronto
// em vez de reusar tendenciaExternaDoCtx sozinha porque nem Produtividade
// média nem Equipe têm Realizado saindo de calcularSeriesSemanaisDimensao
// como as outras dimensões (volume/financeiro) -- ver realizadoProdutividadeMedia/
// realizadoEquipe abaixo.
function renderLinhaResumoGenerica(celulas, classe, registros, indices, ctx, chaveDimensaoSnapshot, realizadoDoBloco) {
  var congeladoPorSemana = ctx.congeladoPorSemana;
  var tendenciaExterna;
  if (congeladoPorSemana && congeladoPorSemana.porRegistro && indices.length === 1) {
    var chave = chaveMatriz(registros[indices[0]].sup, registros[indices[0]].tipologia);
    var entrada = congeladoPorSemana.porRegistro[chave];
    if (entrada && entrada[chaveDimensaoSnapshot] && entrada[chaveDimensaoSnapshot].tendencia !== undefined) {
      tendenciaExterna = entrada[chaveDimensaoSnapshot].tendencia;
    }
  }
  var tendencia = tendenciaExterna !== undefined ? tendenciaExterna : null;
  var realizado = realizadoDoBloco(registros, indices, ctx);
  function num(v, casas) { return v === null || v === undefined ? '<td class="num sem-dado"></td>' : '<td class="num">' + formatarNumero(v, casas === undefined ? 2 : casas) + '</td>'; }
  return '<tr class="' + classe + '">' + celulas + num(tendencia) + num(realizado) + '</tr>';
}

// Produtividade média Realizado = Volume Realizado ÷ Equipe Realizado da
// mesma semana (Decisão 3 do design) -- as duas séries já saem de
// serieDaSemana, a mesma função que a tabela principal usa.
function realizadoProdutividadeMedia(registros, indices, ctx) {
  var alvo = { semana: ctx.semanaEscolhida, mesIdx: ctx.mesIdx, semanasDoMesAlvo: ctx.semanas, indiceNoMes: ctx.semanaIdx };
  var serieCtx = { hojeEpoch: ctx.hojeEpoch, temSemanasReais: ctx.temSemanasReais, demandas: ctx.demandas };
  var serieVolume = serieDaSemana(registros, indices, 'volume', alvo, serieCtx);
  var serieEquipe = serieDaSemana(registros, indices, 'equipes', alvo, serieCtx);
  if (serieVolume.realizado === null || !serieEquipe.realizado) return null;
  return serieVolume.realizado / serieEquipe.realizado;
}

// Equipe Realizado = demandas.equipesPorDia agregado pela mesma janela que a
// Tabela Semanal já usa para o Realizado de Equipes (somarEquipesNoIntervalo,
// dentro de calcularSeriesSemanaisDimensao com dimensao === 'equipes').
function realizadoEquipe(registros, indices, ctx) {
  var alvo = { semana: ctx.semanaEscolhida, mesIdx: ctx.mesIdx, semanasDoMesAlvo: ctx.semanas, indiceNoMes: ctx.semanaIdx };
  var serieCtx = { hojeEpoch: ctx.hojeEpoch, temSemanasReais: ctx.temSemanasReais, demandas: ctx.demandas };
  var serieEquipe = serieDaSemana(registros, indices, 'equipes', alvo, serieCtx);
  return serieEquipe.realizado;
}

// Cabeçalho dos dois blocos extras: SUP/Grupo/Tomador/Tipologia + Tendência
// congelada + Realizado -- 6 colunas, mais estreito que renderCabecalho (que
// tem Previsto até a data/Desvio até a data/Semana total, que estes blocos
// não têm).
function renderCabecalhoGenerico() {
  return '<thead><tr>'
    + '<th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th>'
    + '<th class="num">Tendência congelada</th>'
    + '<th class="num">Realizado</th>'
    + '</tr></thead>';
}

// Monta um bloco extra (Produtividade média ou Equipe) percorrendo a MESMA
// hierarquia TOTAL GERAL / por tipologia / por SUP / TOTAL do SUP que a
// tabela principal usa.
function renderBlocoGenerico(titulo, chaveDimensaoSnapshot, realizadoDoBloco, registros, todos, ctx) {
  var linhas = renderLinhaResumoGenerica(
    celula('col-sup', '—') + celula('col-grupo', 'Todos') + celula('col-tomador', 'Todos')
      + celulaChipTotal('TOTAL GERAL', 'chip-total-geral'),
    'linha-total-geral', registros, todos, ctx, chaveDimensaoSnapshot, realizadoDoBloco
  );

  tipologiasPresentes(registros, todos).forEach(function (bloco) {
    linhas += renderLinhaResumoGenerica(
      celula('col-sup', '—') + celula('col-grupo', 'Todos') + celula('col-tomador', 'Todos')
        + celulaChip(bloco.tipologia),
      'linha-total-geral linha-total-geral-tipologia', registros, bloco.indices, ctx, chaveDimensaoSnapshot, realizadoDoBloco
    );
  });

  blocosPorSup(registros, todos).forEach(function (bloco) {
    bloco.indices.forEach(function (idx) {
      var registro = registros[idx];
      linhas += renderLinhaResumoGenerica(
        celula('col-sup', registro.sup) + celula('col-grupo', registro.grupo)
          + celula('col-tomador', registro.tomador) + celulaChip(registro.tipologia),
        'linha-consolidado', registros, [idx], ctx, chaveDimensaoSnapshot, realizadoDoBloco
      );
    });
    var primeiro = registros[bloco.indices[0]];
    linhas += renderLinhaResumoGenerica(
      celula('col-sup', bloco.sup) + celula('col-grupo', primeiro.grupo)
        + celula('col-tomador', primeiro.tomador) + celulaChipTotal('TOTAL'),
      'linha-total-sup', registros, bloco.indices, ctx, chaveDimensaoSnapshot, realizadoDoBloco
    );
  });

  return '<h3>' + escapeHtml(titulo) + '</h3>'
    + '<table>' + renderCabecalhoGenerico() + '<tbody>' + linhas + '</tbody></table>';
}

function celula(classe, texto) {
  return '<td class="' + classe + '">' + escapeHtml(texto) + '</td>';
}

function celulaChip(tipologia) {
  return '<td class="col-tipologia"><span class="tipologia-chip" style="--chip-color:'
    + tipologiaColor(tipologia) + '">' + escapeHtml(tipologia) + '</span></td>';
}

function celulaChipTotal(rotulo, classeExtra) {
  return '<td class="col-tipologia"><span class="tipologia-chip tipologia-chip-total'
    + (classeExtra ? ' ' + classeExtra : '') + '">' + escapeHtml(rotulo) + '</span></td>';
}

// Agrupa por SUP preservando a ordem em que os SUPs aparecem nos registros --
// a MATRIZ já vem ordenada por SUP, e reordenar aqui faria a aba discordar da
// ordem que a Tabela do orçamento mostra para os mesmos dados.
function blocosPorSup(registros, indices) {
  var porSup = {};
  var ordem = [];
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro) return;
    if (!porSup[registro.sup]) { porSup[registro.sup] = []; ordem.push(registro.sup); }
    porSup[registro.sup].push(i);
  });
  return ordem.map(function (sup) { return { sup: sup, indices: porSup[sup] }; });
}

function tipologiasPresentes(registros, indices) {
  var porTipologia = {};
  var ordem = [];
  (indices || []).forEach(function (i) {
    var registro = registros[i];
    if (!registro || !registro.tipologia) return;
    if (!porTipologia[registro.tipologia]) { porTipologia[registro.tipologia] = []; ordem.push(registro.tipologia); }
    porTipologia[registro.tipologia].push(i);
  });
  ordem.sort();
  return ordem.map(function (t) { return { tipologia: t, indices: porTipologia[t] }; });
}

// 2026-08-04: o seletor de dimensão PRÓPRIO saiu daqui -- a aba passou a usar
// a dimensão da barra de filtros compartilhada (ver ESTADO_CONSOLIDADO em
// render-semanal.js). O de semana continua: não existe equivalente dele na
// barra de cima -- e por isso 'estado' só carrega semanas/semanaIdx: a
// dimensão que continuava sendo passada aqui não era lida por ninguém.
function renderControles(estado) {
  var e = estado || {};
  var semanas = e.semanas || [];
  var opcoesSemana = semanas.map(function (semana, i) {
    return '<option value="' + i + '"' + (i === e.semanaIdx ? ' selected' : '') + '>'
      + escapeHtml('S' + (i + 1) + ' (' + formatarIntervaloSemana(semana.inicio, semana.fim) + ')') + '</option>';
  }).join('');
  return '<div class="controles-consolidado">'
    + '<label class="controle-consolidado">Semana<select id="consolidado-semana">' + opcoesSemana + '</select></label>'
    + '<button id="gerar-relatorio-excel" type="button">Gerar relatório Excel</button>'
    + '<span id="status-relatorio-excel" class="status-atualizacao"></span>'
    + '</div>';
}

// A nota existe na TELA, e não só no comentário do topo: as três colunas de
// premissa são do MÊS, ao lado de três colunas que são da SEMANA, e ninguém
// tem como adivinhar isso olhando a tabela.
function renderNota(dimensao) {
  var premissas = dimensao === 'financeiro'
    ? 'O ticket médio previsto é a premissa TICKET da MATRIZ'
    : 'As equipes previstas são a foto do mês (não se repartem por semana) e a produtividade esperada é a premissa PROD. da MATRIZ, em furos por equipe-dia';
  // A Tendência das semanas já começadas (encerrada ou em curso) é CONGELADA
  // no 1º dia delas -- um registro histórico do que se projetava naquele
  // momento, não a projeção de hoje. Ela é recalculada a cada build/refresh a
  // partir do mesmo Avanço Sond: um lançamento retroativo muda os furos
  // daquele intervalo e, com isso, muda o que a Tendência congelada mostra.
  return '<p class="nota-consolidado">Realizado e Tendência são da SEMANA selecionada. '
    + 'Numa semana já começada, a Tendência exibida é a CONGELADA no 1º dia dela (o que se '
    + 'projetava então) — e não a projeção de hoje; um lançamento retroativo no Avanço Sond '
    + 'recalcula esse valor. '
    + escapeHtml(premissas) + ' — valem para o mês inteiro, e por isso repetem em todas as semanas.</p>';
}

// A nota que avisa que a dimensão da barra não é a que está na tela. Mesma
// gramática visual da nota do bloco de alertas de tendência
// (render-alertas-tendencia.js): um <tr>/<td colspan> dentro do <tbody>, e não
// um <p> -- um <p> aqui seria içado para fora da tabela pelo parser HTML5
// (foster parenting). A classe .linha-nota-alertas já é estilizada em
// CSS_SEMANAL e vale para a página inteira; não há componente novo.
function renderNotaDimensao(dimensaoBarra, dimensaoTabela) {
  if (dimensaoBarra !== 'equipes') return '';
  // 4 colunas de texto (SUP/Grupo/Tomador/Tipologia) + as 4 do resumo
  // (Previsto até a data/Realizado/Desvio até a data/Semana total) -- as
  // colunas de premissa saíram da tabela (Task 4), então a contagem não
  // depende mais de colunasExtras(dimensaoTabela).
  var colunas = 4 + 4;
  return '<tr class="linha-nota-alertas"><td colspan="' + colunas + '">'
    + 'A dimensão <strong>Equipes</strong> não se aplica ao Consolidado — a página não mede '
    + 'equipes por semana em lugar nenhum. Os números abaixo são de <strong>Volume</strong>.'
    + '</td></tr>';
}

// registros/indices: mesmo par do resto do projeto. opcoes: { semanaIdx,
// dimensao, mesIdx, semanas, demandas, hojeEpoch }. 'dimensao' é a da barra
// compartilhada, crua: a coerção para o par que a tabela sabe desenhar é
// dimensaoDaTabela, e quando as duas divergem a nota acima diz isso na tela.
function renderAbaConsolidado(registros, indices, opcoes) {
  var o = opcoes || {};
  var semanas = o.semanas || [];
  var numSemanas = semanas.length;
  var dimensao = dimensaoDaTabela(o.dimensao);
  var semanaIdx = typeof o.semanaIdx === 'number' ? Math.max(0, Math.min(numSemanas - 1, o.semanaIdx)) : 0;
  var temDemandas = !!(o.demandas && o.demandas.porRegistroEventos && typeof o.hojeEpoch === 'number');

  var controles = renderControles({ semanas: semanas, semanaIdx: semanaIdx });
  if (!numSemanas) {
    return controles + '<p class="nota-consolidado">Sem semanas para o mês selecionado — nada a consolidar.</p>';
  }

  // Congela na semana JÁ COMEÇADA (encerrada ou em curso): inicio <= hoje.
  // A futura (inicio > hoje) não tem o que congelar -- nunca começou.
  var semanaEscolhida = semanas[semanaIdx];
  var chaveSemanaEscolhida = formatarChaveSemana(semanaEscolhida.inicio);
  var congeladoPorSemana = (o.congeladoSemanal && o.congeladoSemanal[chaveSemanaEscolhida]) || null;
  var ctx = {
    dimensao: dimensao, mesIdx: o.mesIdx, semanas: semanas, numSemanas: numSemanas,
    temSemanasReais: temDemandas,
    demandas: o.demandas, hojeEpoch: o.hojeEpoch, semanaIdx: semanaIdx,
    semanaEscolhida: semanaEscolhida, congeladoPorSemana: congeladoPorSemana,
    dimensaoSnapshot: dimensao,
  };

  var todos = indices || [];
  var linhas = renderNotaDimensao(o.dimensao, dimensao) + renderLinhaResumo(
    celula('col-sup', '—') + celula('col-grupo', 'Todos') + celula('col-tomador', 'Todos')
      + celulaChipTotal('TOTAL GERAL', 'chip-total-geral'),
    'linha-total-geral', registros, todos, ctx
  );

  tipologiasPresentes(registros, todos).forEach(function (bloco) {
    linhas += renderLinhaResumo(
      celula('col-sup', '—') + celula('col-grupo', 'Todos') + celula('col-tomador', 'Todos')
        + celulaChip(bloco.tipologia),
      'linha-total-geral linha-total-geral-tipologia', registros, bloco.indices, ctx
    );
  });

  blocosPorSup(registros, todos).forEach(function (bloco) {
    bloco.indices.forEach(function (idx) {
      var registro = registros[idx];
      linhas += renderLinhaResumo(
        celula('col-sup', registro.sup) + celula('col-grupo', registro.grupo)
          + celula('col-tomador', registro.tomador) + celulaChip(registro.tipologia),
        'linha-consolidado', registros, [idx], ctx
      );
    });
    var primeiro = registros[bloco.indices[0]];
    linhas += renderLinhaResumo(
      celula('col-sup', bloco.sup) + celula('col-grupo', primeiro.grupo)
        + celula('col-tomador', primeiro.tomador) + celulaChipTotal('TOTAL'),
      'linha-total-sup', registros, bloco.indices, ctx
    );
  });

  // Task 5: dois blocos extras abaixo da tabela principal, mesma hierarquia,
  // Tendência congelada (só do snapshot) + Realizado.
  var blocoProdutividade = renderBlocoGenerico(
    'Produtividade média', 'produtividadeMedia', realizadoProdutividadeMedia, registros, todos, ctx
  );
  var blocoEquipe = renderBlocoGenerico('Equipe', 'equipe', realizadoEquipe, registros, todos, ctx);

  return controles + renderNota(dimensao)
    + '<table id="tabela-consolidado">' + renderCabecalho(dimensao, semanas[semanaIdx], !!congeladoPorSemana)
    + '<tbody>' + linhas + '</tbody></table>'
    + blocoProdutividade + blocoEquipe;
}

module.exports = {
  renderAbaConsolidado, renderControles, renderCabecalho, colunasExtras, dimensaoDaTabela,
  formatarChaveSemana,
  produtividadeEsperada, ticketMedioPrevisto, somarPrevistoMes,
  blocosPorSup, tipologiasPresentes, tipologiaColor,
  renderLinhaResumoGenerica, realizadoProdutividadeMedia, realizadoEquipe,
};
