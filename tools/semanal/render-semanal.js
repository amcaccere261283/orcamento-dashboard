'use strict';
const path = require('node:path');
const { formatarMesAno, calcularVigenteIdx } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
const { buildBrowserBundle } = require('../comum/browser-bundle.js');
const { fonteParaCliente } = require('../comum/calculo-equipes.js');

// Página da spec com as duas abas (Semanal / Balanço de massa), agora com a
// barra de filtros compartilhada (markupFiltros()/scriptFiltros() da casca,
// ../comum/render-shell.js): origem/categoria/tipologia/grupo/sup + dimensão
// governam as DUAS abas ao mesmo tempo, recalculando a que estiver ativa
// (ver SCRIPT_CLIENTE_SEMANAL, montarDashboard). A aba Balanço de massa
// também mantém 4 controles próprios (período/base/dimensão/somente ativos),
// embutidos no HTML que ela mesma produz (RenderAbaBalanco.renderAbaBalanco,
// via montarAbaBalanco) -- esses 4 NÃO fazem parte da barra compartilhada.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mesmos dois ícones (tabela/gráfico de barras) que o orçamento já usa nas
// abas Tabela/Gráfico -- mesmo sistema visual, mesma linguagem de ícone
// pros dois dashboards deste repositório.
// Ícone da aba Gráficos: linha de tendência (não o mesmo ícone de 3 barras
// que "Balanço de massa" já usa nesta mesma barra -- os dois apareceriam
// idênticos lado a lado, então este é distinto de propósito).
const ABAS_VISUALIZACAO = [
  { id: 'aba-semanal', rotulo: 'Semanal', ativa: true,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>' },
  { id: 'aba-grafico-semanal', rotulo: 'Gráficos', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>' },
  { id: 'aba-balanco', rotulo: 'Balanço de massa', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>' },
  { id: 'aba-demandas', rotulo: 'Demandas', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>' },
];

// Os 6 filtros multi-select da barra compartilhada entre as duas abas: só
// id e rótulo inicial (mesmo padrão de FILTROS_PRINCIPAIS no orçamento) --
// as opções de cada um são montadas no cliente a partir dos registros
// decifrados. Sem filtro-serie (a Tabela semanal não tem colunas
// alternáveis -- ver docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md).
const FILTROS_SEMANAL = [
  { id: 'filtro-origem', rotulo: 'Todas as origens' },
  { id: 'filtro-categoria', rotulo: 'Todas as categorias' },
  { id: 'filtro-tipologia', rotulo: 'Todas as tipologias' },
  { id: 'filtro-grupo', rotulo: 'Todos os grupos' },
  { id: 'filtro-sup', rotulo: 'Todos os SUP' },
  { id: 'seletor-dimensao', rotulo: 'Financeiro' },
];

// CSS dos 4 controles da aba Balanço de massa (renderControles, em
// render-aba-balanco.js: período/base/dimensão/somente ativos) e do
// contêiner dos gráficos. NÃO entra em cssBase() (tools/comum/render-shell.js)
// de propósito: aquela folha é compartilhada com o orçamento e
// test/orcamento-html-inalterado.test.js trava o HTML dele byte a byte --
// qualquer linha a mais ali reprovaria o golden. Este bloco é só desta
// página, injetado num <style> à parte (ver o final de renderSemanal()).
//
// Segue as mesmas convenções visuais de cssBase(): mesmos tokens de cor
// (--surface-1/--border/--text-primary/--text-secondary), mesmo layout
// flex+gap de .filtros-selecao, e o MESMO ícone de seta em data-URI que
// .filtros select já usa (copiado, não referenciado -- os dois blocos de
// CSS nunca se importam um do outro, cada `<style>` é independente).
// .grafico-painel (o invólucro de cada gráfico de tipologia) e .grafico-svg
// (a tag <svg> em si) já têm regra em cssBase() -- não duplicados aqui.
const CSS_BALANCO = `
  .controles-balanco {
    display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px;
    margin-bottom: 20px;
  }
  .controle-balanco {
    display: flex; flex-direction: column; gap: 6px;
    font-size: 12px; color: var(--text-secondary);
  }
  .controle-balanco select {
    padding: 8px 30px 8px 10px; height: 36px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23c3c2b7' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center;
    color: var(--text-primary);
    font-size: 13px; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }
  .controle-balanco select:hover { border-color: rgba(246,181,63,0.5); }
  .controle-balanco select:focus-visible { outline: 2px solid #f6b53f; outline-offset: 2px; }
  .controle-balanco-check {
    flex-direction: row; align-items: center; gap: 8px;
    height: 36px; font-size: 13px; color: var(--text-primary);
  }
  .controle-balanco-check input[type="checkbox"] { accent-color: #f6b53f; cursor: pointer; }
  .graficos-balanco { display: flex; flex-direction: column; gap: 28px; }
`;

// CSS da aba Semanal. Só uma regra hoje: a 3ª linha da tabela
// (renderLinhaSerie('Tendência', 'tendencia', ...) em render-aba-semanal.js)
// emite a classe .linha-tendencia, que NÃO tem regra em cssBase() -- as
// irmãs .linha-previsto/.linha-realizado têm, então a linha renderizava sem
// cor nenhuma, como se fosse de outro tipo. Aqui ela ganha o MESMO dourado
// (#f6b53f) que o orçamento usa na Tendência dele (.linha-total, em
// cssBase()); só a cor é copiada, não a regra inteira -- o `border-bottom`
// de `tr.linha-total td` marca o fim de um bloco de SUP na tabela do
// orçamento e não faz sentido aqui.
//
// Assim como CSS_BALANCO, NÃO entra em cssBase(): aquela folha é
// compartilhada com o orçamento e test/orcamento-html-inalterado.test.js
// trava o HTML dele byte a byte. Usar diretamente a classe .linha-total no
// markup seria a outra saída, mas custaria a legibilidade do nome (a linha é
// "Tendência", não um total) e traria junto o border-bottom.
const CSS_SEMANAL = `
  .linha-tendencia .serie-label, .linha-tendencia .celula-total-linha { color: #f6b53f; }
  .linha-tendencia .serie-label { border-left-color: #f6b53f; }
  .bloco-dimensao-semanal + .bloco-dimensao-semanal { margin-top: 28px; padding-top: 28px; border-top: 1px solid var(--border); }
  .tabela-semanal-titulo { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
  /* Mesmo roxo de .linha-demandas em CSS_DEMANDAS abaixo -- fio visual
     entre as duas: esta linha também vem do Avanço Sond, também é
     execução (estoque de furos), nunca previsão. #9700DA é a cor padrão
     de Demandas no dashboard inteiro. */
  .linha-pendentes-demandas .serie-label, .linha-pendentes-demandas .celula-total-linha { color: #9700DA; }
  .linha-pendentes-demandas .serie-label { border-left-color: #9700DA; }
`;

// CSS da aba Demandas (Task 5 desta fase). Mesma razão de CSS_SEMANAL/
// CSS_BALANCO: NÃO entra em cssBase() (tools/comum/render-shell.js), que é
// compartilhada com o orçamento e cujo HTML test/orcamento-html-inalterado.test.js
// trava byte a byte.
const CSS_DEMANDAS = `
  .controles-demandas { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; margin-bottom: 20px; }
  .controle-demandas { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-secondary); }
  .controle-demandas select {
    padding: 8px 30px 8px 10px; height: 36px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23c3c2b7' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center;
    color: var(--text-primary); font-size: 13px; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }
  .bloco-demandas { margin-bottom: 28px; }
  .bloco-demandas h3 { font-size: 14px; margin: 0 0 6px; color: var(--text-primary); }
  .nota-demandas { font-size: 12px; color: var(--text-secondary); margin: 0 0 10px; max-width: 70ch; }
  .tabela-demandas { width: 100%; border-collapse: collapse; }
  .tabela-demandas th, .tabela-demandas td { padding: 6px 8px; font-size: 12px; }
  .tabela-demandas .num { text-align: right; }
  /* cssBase() fixa "th, td { text-align: left }" pro dashboard inteiro, e a
     regra acima só alcança <td class="num"> -- os <th> dos 12 meses e da
     coluna de fechamento (renderCabecalho, render-aba-demandas.js) não têm
     classe nenhuma, então ficavam à esquerda por cima de números alinhados à
     direita. Só o primeiro <th> (cabeçalho vazio da coluna de rótulo) fica de
     fora, porque não tem número embaixo dele. */
  .tabela-demandas th:not(:first-child) { text-align: right; }
  /* .linha-demandas é emitida em toda linha de tipologia (renderLinha,
     render-aba-demandas.js) e não tinha regra de cor nenhuma -- diferente das
     tabelas irmãs (.linha-previsto/.linha-realizado em cssBase(),
     .linha-tendencia em CSS_SEMANAL acima), que sempre colorem .serie-label e
     dão um acento no border-left. #9700DA (roxo) é a cor padrão de Demandas
     no dashboard inteiro -- ver o mesmo valor em .linha-pendentes-demandas
     (CSS_SEMANAL acima). Uma cor só para as 5 tabelas porque
     render-aba-demandas.js não emite um nome de classe por bloco/série --
     todas as linhas de tipologia usam o mesmo 'linha-demandas', então não há
     como colorir por série sem mexer no render (fora do escopo deste
     ajuste, que é só CSS_DEMANDAS).
     .linha-total-demandas fica como já estava (negrito + borda), sem herdar
     esta cor -- ela já se destingue das linhas de tipologia por peso e borda,
     igual .linha-total-sup em cssBase() não ganha cor de série própria. */
  .linha-demandas .serie-label, .linha-demandas .celula-total-linha { color: #9700DA; }
  .linha-demandas .serie-label { border-left-color: #9700DA; }
  .linha-total-demandas td { font-weight: 600; border-top: 1px solid var(--border); }
`;

// render-aba-semanal.js consome compute-semanal.js (require('./compute-semanal.js'))
// -- por isso vem depois na lista: a ordem aqui é a ordem de dependência, e
// buildBrowserBundle não resolve isso sozinho (ver o comentário no topo dele).
// Mesma regra para o par da Task 10: render-aba-balanco.js consome
// compute-balanco.js (require('./compute-balanco.js')), então vem depois.
// compute-balanco.js, por sua vez, TAMBÉM consome compute-semanal.js
// (diaEpoch, achado de 2026-08-01 -- Realizado do Avanço Sond em Mês
// Vigente precisa converter índice de mês pra dia-desde-época) -- por isso
// 'compute-semanal.js' precisa continuar vindo ANTES de 'compute-balanco.js'
// na lista abaixo, não só antes de 'render-aba-semanal.js'.
//
// render-aba-grafico-semanal.js (aba Gráficos, achado de 2026-08-01) consome
// os TRÊS: compute-semanal.js (semanasDoMes/indiceSemanaAtual),
// render-aba-semanal.js (calcularSeriesSemanaisDimensao/formatarIntervaloSemana
// -- a aba Gráficos é uma segunda leitura visual dos MESMOS números que a
// Tabela Semanal já calcula, nunca uma fonte própria) e
// compute-grafico-semanal.js (calcularAcumulado/calcularEscalaEixo, só
// matemática pura) -- os três precisam vir antes dele na lista.
//
// compute-balanco.js TAMBÉM consome tools/comum/calculo-equipes.js
// (mediaEquipesPonderada), um require '../' que o bundle REMOVE em vez de
// reescrever (ver o comentário no topo de compute-balanco.js e em
// transformaModulo, tools/comum/browser-bundle.js) -- por isso
// fonteParaCliente() é injetada num <script> À PARTE, ANTES deste bundle,
// lá embaixo em renderSemanal(). Sem isso a aba Balanço de massa quebra em
// produção com ReferenceError, mesmo com os testes em Node passando (Node
// resolve o require normalmente).
const BUNDLE_ARQUIVOS = [
  'compute-semanal.js', 'render-aba-semanal.js',
  'compute-grafico-semanal.js', 'render-aba-grafico-semanal.js',
  'compute-balanco.js', 'render-aba-balanco.js', 'render-aba-demandas.js',
];

// O gate de senha (scriptDesbloqueio, casca compartilhada) sempre chama
// fecharTendenciaVigente(registros, vigenteIdx) e montarDashboard(registros)
// assim que a senha certa decifra os dados -- as duas PRECISAM existir no
// escopo global da página, senão o desbloqueio quebra com ReferenceError.
//
// fecharTendenciaVigente NÃO é mais identidade pura (era, até a Task 8
// consumir 'registros' de verdade -- ver achado abaixo): a página ainda não
// tem nenhuma série "Tendência" própria pra fechar -- isso continua
// conteúdo de uma tarefa futura (uma versão semanal do fechamento que o
// orçamento já faz). A aba Balanço de massa (Task 10) NÃO precisa disso:
// Tendência foi descartada explicitamente pelo dono do projeto como opção
// de base (ver compute-balanco.js) -- só Previsto/Previsto Inicial entram.
// Não reaproveita a versão do orçamento porque aquela mexe em campos
// (registro.total) que só fazem sentido no contexto da tabela mensal dele.
//
// ACHADO (corrigido nesta task): o gate (scriptDesbloqueio, casca
// compartilhada com o orçamento -- NÃO pode mudar, ver
// test/orcamento-html-inalterado.test.js) faz
// `window.__REGISTROS__ = JSON.parse(jsonTexto)` e passa isso DIRETO pra
// fecharTendenciaVigente. No orçamento jsonTexto decifra pro array de
// registros puro; aqui (renderSemanal) decifra pra `{registros, baseline}`
// -- os dois SÓ entram no HTML dentro do mesmo blob cifrado (ver o
// comentário grande abaixo de renderSemanal). Task 7 nunca notou porque
// montarDashboard não usava o argumento; a Task 8 usa, e sem desembrulhar
// aqui a aba somaria sempre null (o objeto inteiro vira "registros[0]"
// undefined). fecharTendenciaVigente agora desembrulha e guarda o baseline
// em window.__BASELINE__ -- é de lá que montarAbaBalanco (Task 10) lê,
// quando a base escolhida é 'previstoInicial'.
//
// montarDashboard liga a troca de aba E desenha as duas abas (Semanal e,
// desde a Task 10, Balanço de massa). Roda só DEPOIS que a senha certa
// decifra os dados (chamado de dentro de tentarDesbloquear, em
// scriptDesbloqueio -- ver ../comum/render-shell.js): é a ÚNICA vez que
// #secao-semanal/#secao-balanco recebem HTML, e recebem os registros já
// decifrados -- nunca em build (renderSemanal só cifra) nem antes do clique
// em "Abrir", quando SUP/Grupo/Tomador/Tipologia ainda não existem em texto
// plano no navegador.
const SCRIPT_CLIENTE_SEMANAL = `
// ComputeBalanco nunca é lido diretamente daqui em diante -- quem faz o
// trabalho é RenderAbaBalanco, que o usa por dentro (chamada indireta,
// dentro do bundle). ComputeSemanal MUDOU: recalcularSemanal usa
// ComputeSemanal.diaEpoch diretamente agora, pra calcular "hoje" em dias-
// desde-época com a MESMA convenção que os eventos de furos (ver
// compute-semanal.js/compute-demandas.js) -- sem isso, um futuro leitor
// poderia achar RenderAbaBalanco é o único motivo de ComputeBalanco estar
// aqui e continuar achando o mesmo de ComputeSemanal por engano.
var ComputeSemanal = MODULOS['compute-semanal.js'];
var RenderAbaSemanal = MODULOS['render-aba-semanal.js'];
var RenderAbaGraficoSemanal = MODULOS['render-aba-grafico-semanal.js'];
var ComputeBalanco = MODULOS['compute-balanco.js'];
var RenderAbaBalanco = MODULOS['render-aba-balanco.js'];
var RenderAbaDemandas = MODULOS['render-aba-demandas.js'];

var MODO_DEMANDAS = 'mensal';

// As 3 dimensões que a aba Semanal expõe -- subconjunto das 5 do orçamento
// (sem produtividade/ticketMedio, que não fazem sentido pra uma tabela
// semanal). Ordem canônica: sempre nesta ordem quando várias estão
// marcadas, nunca na ordem em que a pessoa marcou os checkboxes -- mesmo
// raciocínio de DIMENSOES_CONFIG/dimensoesEmOrdem no orçamento.
var DIMENSOES_CONFIG_SEMANAL = [
  { valor: 'equipes', rotulo: 'Equipes' },
  { valor: 'volume', rotulo: 'Volume' },
  { valor: 'financeiro', rotulo: 'Financeiro' },
];

function dimensoesEmOrdemSemanal(selecionadas) {
  var ordenadas = DIMENSOES_CONFIG_SEMANAL.filter(function (d) { return selecionadas.has(d.valor); }).map(function (d) { return d.valor; });
  return ordenadas.length ? ordenadas : ['financeiro'];
}

// Réplica do FILTROS_CONFIG do orçamento, com uma omissão deliberada: sem
// filtro-serie (ver docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md,
// "Escopo de campos -- aba 1"). categoriaTipologia/opcoesFiltro/
// indicesFiltrados/montarFiltroMulti vêm de scriptFiltros() (tools/comum/render-shell.js),
// concatenado ANTES deste script na mesma <script> tag.
var FILTROS_CONFIG_SEMANAL = [
  { id: 'filtro-origem', chave: 'origem', rotuloPadrao: 'Todas as origens', campo: 'origem', rotuloCapitalizado: true },
  { id: 'filtro-categoria', chave: 'categoria', rotuloPadrao: 'Todas as categorias', opcoesFixas: [
    { valor: 'labConvencional', rotulo: 'Lab. Convencional' },
    { valor: 'labEspecial', rotulo: 'Lab. Especial' },
    { valor: 'sondagemConvencional', rotulo: 'Sondagem Convencional' },
    { valor: 'sondagemEspecial', rotulo: 'Sondagem Especial' },
  ] },
  { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas as tipologias', campo: 'tipologia' },
  { id: 'filtro-grupo', chave: 'grupo', rotuloPadrao: 'Todos os grupos', campo: 'grupo' },
  { id: 'filtro-sup', chave: 'sup', rotuloPadrao: 'Todos os SUP', campo: 'sup', rotuloComposto: true },
  { id: 'seletor-dimensao', chave: 'dimensao', rotuloPadrao: 'Selecione ao menos 1', opcoesFixas: DIMENSOES_CONFIG_SEMANAL, minimoUm: true },
];

// chave -> Set dos valores marcados -- Set vazio significa "sem filtro,
// mostra tudo", igual ao orçamento (ver filtroExclui em scriptFiltros()).
// dimensao começa com Financeiro marcado (nunca pode ficar vazio, minimoUm:true).
var filtrosSelecionadosSemanal = {};
FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { filtrosSelecionadosSemanal[cfg.chave] = new Set(); });
filtrosSelecionadosSemanal.dimensao.add('financeiro');

// dados: o que o gate acabou de JSON.parse -- {registros, baseline} (ver o
// ACHADO documentado acima desta constante). Guarda baseline à parte
// (window.__BASELINE__) e devolve só o array de registros, que é o que o
// resto do gate (e montarDashboard) espera em window.__REGISTROS__.
function fecharTendenciaVigente(dados) {
  window.__BASELINE__ = dados && dados.baseline;
  window.__DEMANDAS__ = dados && dados.demandas;
  return dados && dados.registros ? dados.registros : dados;
}

function alternarAba(aba) {
  document.getElementById('secao-semanal').style.display = aba === 'semanal' ? '' : 'none';
  document.getElementById('secao-grafico-semanal').style.display = aba === 'grafico-semanal' ? '' : 'none';
  document.getElementById('secao-balanco').style.display = aba === 'balanco' ? '' : 'none';
  document.getElementById('secao-demandas').style.display = aba === 'demandas' ? '' : 'none';
  document.getElementById('aba-semanal').classList.toggle('aba-ativa', aba === 'semanal');
  document.getElementById('aba-grafico-semanal').classList.toggle('aba-ativa', aba === 'grafico-semanal');
  document.getElementById('aba-balanco').classList.toggle('aba-ativa', aba === 'balanco');
  document.getElementById('aba-demandas').classList.toggle('aba-ativa', aba === 'demandas');
}

// Redesenha só o CONTEÚDO de #secao-grafico-semanal (não a div inteira --
// #grafico-semanal-tooltip é irmã dele no HTML e precisa sobreviver aos
// redesenhos, senão o listener delegado em inicializarTooltipGraficoSemanal
// perderia o elemento de destino). Mesmos 'registros'/'indices' que
// recalcularSemanal já filtrou pela barra compartilhada, mesma 'dimensoes'
// e 'hojeEpoch' que RenderAbaSemanal.renderAbaSemanal recebe -- a aba
// Gráficos é uma segunda leitura visual dos MESMOS números da Tabela
// Semanal, nunca um recorte à parte (por isso não tem controles próprios,
// ao contrário da aba Balanço de massa).
function montarAbaGraficoSemanal(registros, indices, dimensoes, hojeEpoch) {
  document.getElementById('grafico-semanal-conteudo').innerHTML = RenderAbaGraficoSemanal.renderAbaGraficoSemanal(registros, indices, dimensoes, {
    vigenteIdx: window.__VIGENTE_IDX__,
    ano: window.__ANO__,
    demandas: window.__DEMANDAS__,
    hojeEpoch: hojeEpoch,
  });
}

// Tooltip único, delegado -- mesmo mecanismo do Gráfico no orçamento
// (inicializarTooltipGrafico, tools/orcamento/render-dashboard.js): os SVGs
// são recriados via innerHTML a cada montarAbaGraficoSemanal, então um
// listener por elemento seria descartado toda hora. Chamada uma vez só, em
// montarDashboard (o elemento #secao-grafico-semanal em si nunca é
// recriado -- só o filho #grafico-semanal-conteudo, ver a função acima).
function inicializarTooltipGraficoSemanal() {
  var secao = document.getElementById('secao-grafico-semanal');
  var tooltip = document.getElementById('grafico-semanal-tooltip');
  secao.addEventListener('mousemove', function (e) {
    var alvo = e.target.closest ? e.target.closest('[data-tooltip]') : null;
    if (!alvo) { tooltip.style.display = 'none'; return; }
    var rectSecao = secao.getBoundingClientRect();
    tooltip.textContent = alvo.getAttribute('data-tooltip');
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX - rectSecao.left + 14) + 'px';
    tooltip.style.top = (e.clientY - rectSecao.top - 12) + 'px';
  });
  secao.addEventListener('mouseleave', function () { tooltip.style.display = 'none'; });
}

// Estado dos controles PRÓPRIOS da aba Balanço de massa (Período/Base/
// Dimensão-2/Ativos) -- continuam locais a esta aba, aplicados DEPOIS do
// indices que a barra compartilhada já filtrou (ver "Fluxo de dados" no
// spec). somenteAtivos começa LIGADO -- a grade de origem é densa (34 SUPs
// x 10 tipologias, todo SUP presente em toda tipologia, a maioria zerada);
// desligado por padrão, cada gráfico abriria com a maioria das linhas em
// comprimento zero. Tendência não é opção de base -- descartada
// explicitamente pelo dono do projeto (ver compute-balanco.js).
var ESTADO_BALANCO = { periodo: 'mesVigente', base: 'previsto', dimensao: 'financeiro', somenteAtivos: true };

// Redesenha #secao-balanco inteira (controles + um gráfico por tipologia
// presente em 'indices') com o estado atual de ESTADO_BALANCO, e religa os 4
// controles -- eles são recriados a cada innerHTML novo (renderControles, em
// render-aba-balanco.js), então os listeners da renderização anterior
// morreram junto com os elementos antigos e precisam ser religados toda
// vez, depois do innerHTML. 'indices' vem da barra de filtros compartilhada
// (ver recalcularSemanal) -- os 4 controles desta aba filtram ainda mais
// dentro dele, nunca o substituem.
function montarAbaBalanco(registros, indices) {
  document.getElementById('secao-balanco').innerHTML = RenderAbaBalanco.renderAbaBalanco(registros, indices, {
    periodo: ESTADO_BALANCO.periodo,
    base: ESTADO_BALANCO.base,
    dimensao: ESTADO_BALANCO.dimensao,
    somenteAtivos: ESTADO_BALANCO.somenteAtivos,
    vigenteIdx: window.__VIGENTE_IDX__,
    baseline: window.__BASELINE__,
    demandas: window.__DEMANDAS__,
    ano: window.__ANO__,
  });

  document.getElementById('balanco-periodo').addEventListener('change', function (e) {
    ESTADO_BALANCO.periodo = e.target.value;
    montarAbaBalanco(registros, indices);
  });
  document.getElementById('balanco-base').addEventListener('change', function (e) {
    ESTADO_BALANCO.base = e.target.value;
    montarAbaBalanco(registros, indices);
  });
  document.getElementById('balanco-dimensao').addEventListener('change', function (e) {
    ESTADO_BALANCO.dimensao = e.target.value;
    montarAbaBalanco(registros, indices);
  });
  document.getElementById('balanco-somente-ativos').addEventListener('change', function (e) {
    ESTADO_BALANCO.somenteAtivos = e.target.checked;
    montarAbaBalanco(registros, indices);
  });
}

// Redesenha #secao-demandas inteira (controles + tabelas) com o modo atual
// (MODO_DEMANDAS) e religa o <select>, recriado a cada innerHTML -- mesmo
// motivo já documentado em montarAbaBalanco. A aba Demandas NÃO participa da
// barra de filtros compartilhada (ver spec
// 2026-07-29-base-demandas-realizado-design.md, "Fora de escopo") -- é
// redesenhada só por esta função, sempre com window.__DEMANDAS__ inteiro,
// independente de filtrosSelecionadosSemanal/recalcularSemanal.
function montarAbaDemandas() {
  document.getElementById('secao-demandas').innerHTML =
    RenderAbaDemandas.renderAbaDemandas(window.__DEMANDAS__, MODO_DEMANDAS);
  document.getElementById('demandas-modo').addEventListener('change', function (e) {
    MODO_DEMANDAS = e.target.value;
    montarAbaDemandas();
  });
}

// Recalcula o recorte a partir da barra de filtros compartilhada e redesenha
// as abas Semanal e Balanço de massa com o mesmo 'indices' -- é a única
// função que decide "o que recalcular" quando um filtro muda (equivalente a
// recalcularTabela + recalcularAlertas no orçamento, só que aqui é uma
// função só pras duas abas, já que nenhuma delas tem o custo de montagem
// incremental que a Tabela do orçamento tem -- as duas são full re-render
// via innerHTML). A aba Demandas fica de fora deste recorte de propósito --
// ver montarAbaDemandas.
function recalcularSemanal() {
  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia,
    filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo,
    filtrosSelecionadosSemanal.sup,
    filtrosSelecionadosSemanal.origem
  );
  var dimensoes = dimensoesEmOrdemSemanal(filtrosSelecionadosSemanal.dimensao);
  // hojeEpoch vem do relógio de quem está vendo a página (não do build) --
  // calculado de novo a cada recálculo, é barato e evita estado obsoleto se
  // a aba ficar aberta atravessando a meia-noite. O DIA em si é o civil
  // LOCAL de quem está vendo a página (getFullYear/getMonth/getDate, não os
  // getUTC*) -- é o dia que a pessoa vê no relógio dela, de propósito. Mas
  // o NÚMERO que diaEpoch devolve precisa ficar na mesma convenção que o
  // resto do sistema usa (semanasDoMes, eventos de furos): ancorado em UTC,
  // não no instante bruto de 'agora' -- do contrário, diaEpoch(new Date())
  // rola pro dia seguinte a partir de 21h em fusos atrás de UTC (o caso do
  // Brasil), e discorda de vez em fusos à frente de UTC (achado da revisão
  // final da branch).
  var agora = new Date();
  var hojeEpoch = ComputeSemanal.diaEpoch(new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate())));
  document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(
    window.__REGISTROS__, indices, dimensoes, window.__VIGENTE_IDX__, window.__ANO__,
    { demandas: window.__DEMANDAS__, hojeEpoch: hojeEpoch }
  );
  montarAbaGraficoSemanal(window.__REGISTROS__, indices, dimensoes, hojeEpoch);
  montarAbaBalanco(window.__REGISTROS__, indices);
}

// Callback de mudança de filtro (aoMudar, ver montarFiltroMulti em
// scriptFiltros()) -- reproduz a cascata categoria->tipologia que o
// orçamento também precisa (aoMudarFiltroOrcamento, tools/orcamento/render-dashboard.js):
// opcoesFiltro só recalcula a lista de tipologias válidas quando CHAMADA de
// novo, então mudar a categoria exige remontar o painel de tipologia pra
// essa cascata aparecer na tela.
function aoMudarSemanal(cfg) {
  if (cfg.chave === 'categoria') {
    var cfgTipologia = FILTROS_CONFIG_SEMANAL.filter(function (c) { return c.chave === 'tipologia'; })[0];
    montarFiltroMulti(cfgTipologia, window.__REGISTROS__, filtrosSelecionadosSemanal, aoMudarSemanal);
  }
  recalcularSemanal();
}

function montarTodosFiltrosMultiSemanal(registros) {
  FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosSelecionadosSemanal, aoMudarSemanal); });
}

// registros: já decifrados (só é chamada de dentro de tentarDesbloquear,
// depois de decifrarComSenha) -- ver o comentário grande acima desta
// constante.
function montarDashboard(registros) {
  document.getElementById('aba-semanal').addEventListener('click', function () { alternarAba('semanal'); });
  document.getElementById('aba-grafico-semanal').addEventListener('click', function () { alternarAba('grafico-semanal'); });
  document.getElementById('aba-balanco').addEventListener('click', function () { alternarAba('balanco'); });
  document.getElementById('aba-demandas').addEventListener('click', function () { alternarAba('demandas'); });
  montarTodosFiltrosMultiSemanal(registros);
  configurarAberturaFiltrosMulti();
  inicializarTooltipGraficoSemanal();
  recalcularSemanal();
  montarAbaDemandas();
}
`;

// registros: array de registros da MATRIZ (mesmo formato do orçamento --
// ver tools/orcamento/parse-matriz.js). baseline: a linha de base já
// serializada e RECHAVEADA pela MATRIZ (baselineParaCliente, em
// ./build-dashboard.js) -- só passa adiante, cifrada, para a aba Balanço de
// massa consumir no navegador. periodos: os 12 meses da MATRIZ como datas
// (mesma derivação do orçamento), usados só para calcularVigenteIdx.
//
// Os REGISTROS SÓ ENTRAM no HTML dentro do blob cifrado (dadosCifrados) --
// nunca soltos no markup ou no JS de cliente -- porque SUP/Grupo/Tomador/
// Tipologia são protegidos pela senha e este HTML vai pra um GitHub Pages
// público.
function renderSemanal({ registros, baseline, demandas, periodos, senha, geradoEm, logoDataUri, iconDataUri }) {
  if (!senha) {
    throw new Error('renderSemanal requer "senha" -- os registros (SUP/Grupo/Tomador/Tipologia/valores) são cifrados com ela antes de ir pro HTML.');
  }
  if (!Array.isArray(periodos) || periodos.length === 0) {
    throw new Error('renderSemanal requer "periodos" (os 12 meses da MATRIZ, como datas) -- é o que permite calcularVigenteIdx decidir o mês vigente sem assumir que os registros são do ano corrente.');
  }
  if (!demandas || !Array.isArray(demandas.tipologias)) {
    throw new Error('renderSemanal requer "demandas" ({tipologias, totais}, de tools/semanal/compute-demandas.js) -- sem isso a aba Demandas montaria vazia no navegador sem nenhum erro no build.');
  }
  if (!demandas.porRegistroEventos || typeof demandas.porRegistroEventos !== 'object') {
    throw new Error('renderSemanal requer "demandas.porRegistroEventos" (de tools/semanal/compute-demandas.js) -- sem isso Realizado/Tendência/Demandas Pendentes desapareceriam da Tabela Semanal sem nenhum erro no build.');
  }

  const dadosJson = JSON.stringify({ registros, baseline, demandas });
  const dadosCifrados = cifrarComSenha(dadosJson, senha);
  const dadosCifradosJson = JSON.stringify(dadosCifrados).replace(/<\/script/gi, '<\\/script');

  // Mesmo logo (canto superior esquerdo) e marca d'água de fundo (avatar)
  // do orçamento (tools/orcamento/render-dashboard.js) -- mesmo sistema
  // visual nos dois dashboards deste repositório. logoDataUri/iconDataUri
  // vêm de build-dashboard.js (assets/*.png convertidos pra data URI);
  // ausentes (arquivo não encontrado), a imagem simplesmente não aparece --
  // mesmo comportamento do orçamento.
  const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="Suporte Infra">` : '';
  const watermarkImg = iconDataUri ? `<img class="watermark" src="${iconDataUri}" alt="">` : '';

  // MESMA função do orçamento (calcularVigenteIdx, tools/comum/datas.js).
  // Antes daqui saía `geradoEm.getUTCMonth()`, o que assumia que os
  // registros são sempre do ano corrente: em 2027-01, com a MATRIZ de 2026
  // ainda no ar, isso devolveria 0 e a página mostraria JANEIRO DE 2026 como
  // "mês vigente" -- errado, e em silêncio. calcularVigenteIdx compara o ano
  // de periodos[0] com o de geradoEm e devolve -1 (ano inteiro ainda no
  // futuro) ou 12 (ano inteiro já no passado) nos extremos, que é o que os
  // consumidores de window.__VIGENTE_IDX__ precisam para não somar mês
  // nenhum em vez de somar o mês errado.
  const vigenteIdx = calcularVigenteIdx(periodos, geradoEm);

  const bundle = buildBrowserBundle(path.join(__dirname), BUNDLE_ARQUIVOS);

  // fonteParaCliente() (tools/comum/calculo-equipes.js) precisa entrar num
  // <script> ANTES do bundle: compute-balanco.js (dentro do bundle) usa
  // mediaEquipesPonderada, mas o require dela ('../comum/calculo-equipes.js')
  // é REMOVIDO por buildBrowserBundle, não reescrito (ver o comentário no
  // topo de transformaModulo, tools/comum/browser-bundle.js, e o mesmo
  // aviso em compute-balanco.js) -- a função só existe se já estiver
  // definida como global no escopo da página quando o bundle rodar. Mesmo
  // mecanismo que tools/orcamento/render-dashboard.js já usa pra este
  // MESMO módulo (lá via trechosParaCliente(), aqui via fonteParaCliente(),
  // que concatena os dois trechos porque esta página nova não tem os dois
  // pontos de injeção separados que o orçamento tem). Sem isto, a aba
  // Balanço de massa quebra em produção com ReferenceError -- e os testes
  // em Node passam do mesmo jeito, porque lá o require resolve de verdade
  // (ver a prova em test/semanal-render-aba-balanco-wireup.test.js).
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>PLANEJAMENTO SEMANAL</title>
<style>
${cssBase()}
${CSS_SEMANAL}
${CSS_BALANCO}
${CSS_DEMANDAS}
</style>
</head>
<body>
  ${watermarkImg}
  <main>
${markupCabecalho({
    titulo: 'Planejamento Semanal',
    subtitulo: escapeHtml(formatarMesAno(geradoEm)),
    logo: logoImg,
    recuo: '  ',
  })}

  <div id="gate-senha" class="gate-senha">
    <div class="gate-senha-box">
      <h2>Digite a senha para abrir o dashboard</h2>
      <input type="password" id="campo-senha" autocomplete="off" placeholder="Senha">
      <button id="btn-desbloquear" type="button">Abrir</button>
      <div id="gate-senha-erro" class="gate-senha-erro" style="display:none"></div>
    </div>
  </div>

  <div id="conteudo-protegido" style="display:none">
${markupFiltros(FILTROS_SEMANAL, { recuo: '    ' })}
${markupAbas(ABAS_VISUALIZACAO, '    ')}
    <div id="secao-semanal"></div>
    <div id="secao-grafico-semanal" style="display:none">
      <div id="grafico-semanal-conteudo"></div>
      <div id="grafico-semanal-tooltip" class="grafico-tooltip" style="display:none"></div>
    </div>
    <div id="secao-balanco" style="display:none"></div>
    <div id="secao-demandas" style="display:none"></div>
  </div>
  </main>
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO__ = ${periodos[0].getUTCFullYear()};</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${fonteParaCliente()}</script>
  <script>${bundle}</script>
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_SEMANAL}</script>
</body>
</html>`;
}

module.exports = { renderSemanal };
