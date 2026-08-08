'use strict';
const path = require('node:path');
const { formatarMesAno, calcularVigenteIdx } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupFiltros, markupAbas, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
const { buildBrowserBundle } = require('../comum/browser-bundle.js');
const { fonteParaCliente: fonteParaClienteEquipes } = require('../comum/calculo-equipes.js');
const { fonteParaCliente: fonteParaClienteTipologiasAvancos } = require('../comum/tipologias-avancos.js');
const { fonteParaCliente: fonteParaClienteTipologiasLab } = require('../comum/tipologias-lab.js');
const { fonteParaCliente: fonteParaClienteDatas } = require('../comum/datas.js');
const { fonteParaCliente: fonteParaClienteLinhaBase } = require('../comum/linha-base.js');

// Página da spec com as duas abas (Semanal / Balanço de massa), agora com a
// barra de filtros compartilhada (markupFiltros()/scriptFiltros() da casca,
// ../comum/render-shell.js): origem/categoria/tipologia/grupo/sup + dimensão
// + somente ativos governam as DUAS abas ao mesmo tempo, recalculando a que
// estiver ativa (ver SCRIPT_CLIENTE_SEMANAL, montarDashboard). A aba Balanço
// de massa também mantém 3 controles próprios (período/base/dimensão),
// embutidos no HTML que ela mesma produz (RenderAbaBalanco.renderAbaBalanco,
// via montarAbaBalanco) -- esses 3 NÃO fazem parte da barra compartilhada.

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
  // Alertas e Consolidado (2026-08-03) reaproveitam os MESMOS ícones que o
  // orçamento já usa nas abas equivalentes -- triângulo de atenção e grade de
  // tabela --, pelo mesmo motivo dos dois primeiros: um leitor que conhece um
  // dashboard reconhece o outro.
  { id: 'aba-alertas', rotulo: 'Alertas', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86l-8.18 14.18A2 2 0 0 0 3.9 21h16.2a2 2 0 0 0 1.79-2.96L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>' },
  { id: 'aba-consolidado', rotulo: 'Consolidado', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg>' },
];

// Os 5 seletores próprios da aba Alertas -- mesmos ids do orçamento, porque o
// CSS deles (.filtros-alertas, .filtro-multi, .status-circulo, .busca-alertas)
// já vive em cssBase() (tools/comum/render-shell.js), compartilhado pelas duas
// páginas. Os rótulos iniciais descrevem o estado com que a aba abre (ver
// filtrosAlertasSemanal em SCRIPT_CLIENTE_SEMANAL).
const FILTROS_ALERTAS_SEMANAL = [
  { id: 'filtro-alertas-agrupar-por', rotulo: 'SUP' },
  { id: 'filtro-alertas-numerico', rotulo: '2 selecionadas' },
  { id: 'filtro-alertas-baseline', rotulo: 'Previsto' },
  { id: 'filtro-alertas-periodo', rotulo: '2 selecionadas' },
  { id: 'filtro-alertas-status', rotulo: 'Status' },
];

// Seletor de mês + "Limpar filtros" + atualização ao vivo. As abas continuam
// FORA deste slot (renderizadas à parte, via markupAbas() logo abaixo da barra
// de filtros -- ver a chamada de renderSemanal), diferente do orçamento.
// Reaproveita os MESMOS ids (#limpar-filtros/#atualizar-dashboard/
// #status-atualizacao) e o MESMO ícone que o orçamento usa, porque o CSS
// compartilhado em cssBase() (tools/comum/render-shell.js) já estiliza os três
// -- nada de CSS novo por causa deste botão.

// 12 rótulos curtos (Jan..Dez), só pra montar o <select> de mês no HTML
// estático do build -- duplicado de propósito (array pequeno e estável,
// mesmo raciocínio de diaEpoch duplicado em compute-semanal.js): não vale
// exportar MESES_PT de tools/comum/datas.js só por causa disto. O cliente
// NUNCA precisa converter índice->rótulo -- os <option> já nascem
// rotulados no HTML estático gerado aqui; o cliente só lê/escreve o
// value numérico (mesSelecionadoIdx).
const MESES_PT_CURTO_SERVIDOR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function opcoesMesSemanal() {
  return MESES_PT_CURTO_SERVIDOR.map(function (rotulo, i) {
    return '<option value="' + i + '">' + rotulo + '</option>';
  }).join('');
}

const MARKUP_ACOES_SEMANAL = `      <div class="filtros-acoes">
        <label class="controle-mes-semanal">Mês<select id="seletor-mes-semanal">${opcoesMesSemanal()}</select></label>
        <label class="controle-ativos-semanal"><input type="checkbox" id="somente-ativos" checked> Somente SUPs ativos no período</label>
        <button id="limpar-filtros" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>Limpar filtros</button>
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>`;

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

// CSS das abas PRÓPRIAS desta página: os controles do Balanço de massa
// (renderControles, em render-aba-balanco.js: período/base/dimensão/somente
// ativos) e do contêiner dos gráficos, os controles e a tabela do Consolidado,
// e os dois ajustes que a aba Alertas precisa por cima do que cssBase() já dá.
// (Chamava-se CSS_BALANCO até 2026-08-03, quando as abas Alertas e Consolidado
// entraram aqui e o nome virou mentira -- achado da revisão de código.)
// NÃO entra em cssBase() (tools/comum/render-shell.js)
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
const CSS_ABAS_SEMANAL = `
  /* Os controles da aba CONSOLIDADO (semana/dimensão) entram nas MESMAS
     regras, com nome próprio: são o mesmo componente visual, e uma segunda
     cópia das regras seria a forma mais fácil das duas abas divergirem de
     aparência com o tempo. */
  .controles-balanco, .controles-consolidado {
    display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px;
    margin-bottom: 20px;
  }
  .controle-balanco, .controle-consolidado {
    display: flex; flex-direction: column; gap: 6px;
    font-size: 12px; color: var(--text-secondary);
  }
  .controle-consolidado select,
  .controle-balanco select {
    padding: 8px 30px 8px 10px; height: 36px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23c3c2b7' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center;
    color: var(--text-primary);
    font-size: 13px; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }
  .controle-balanco select:hover, .controle-consolidado select:hover { border-color: rgba(246,181,63,0.5); }
  .controle-balanco select:focus-visible, .controle-consolidado select:focus-visible { outline: 2px solid #f6b53f; outline-offset: 2px; }

  /* Aba CONSOLIDADO. As colunas de premissa (equipes previstas/produtividade/
     ticket) são do MÊS, não da semana -- a faixa de fundo mais clara agrupa as
     duas coisas como blocos distintos, a divisória marca a fronteira, e o
     cinza as rebaixa em relação aos números da semana, que são o assunto da
     aba. Os três juntos, e não só a nota em texto: a revisão de design de
     2026-08-03 apontou que a nota estava fazendo o trabalho que o layout
     deveria fazer.

     background-image (e não background-color) de propósito: as linhas de total
     têm fundo PRÓPRIO vindo de cssBase(), e uma cor de fundo aqui competiria
     com ele -- a faixa quebraria justamente nas linhas TOTAL. Uma imagem
     empilha por cima, então a faixa atravessa a tabela inteira. */
  #tabela-consolidado .celula-premissa, #tabela-consolidado .cabecalho-premissa {
    background-image: linear-gradient(rgba(255,255,255,0.04), rgba(255,255,255,0.04));
    white-space: nowrap;
  }
  #tabela-consolidado .celula-premissa { color: var(--text-secondary); }
  /* Só a PRIMEIRA premissa carrega a divisória -- uma por coluna transformaria
     o bloco em compartimentos e desfaria o agrupamento acima. */
  #tabela-consolidado .celula-premissa-inicio,
  #tabela-consolidado .cabecalho-premissa-inicio { border-left: 2px solid #4a4a46; }
  .nota-consolidado { font-size: 12px; color: var(--text-secondary); margin: 0 0 14px; max-width: 90ch; }
  #tabela-consolidado .col-sup, #tabela-consolidado .col-grupo, #tabela-consolidado .col-tomador { white-space: nowrap; }

  /* Número à direita: é o que deixa comparar ordem de grandeza descendo a
     coluna. th/td em cssBase() são text-align:left para a tabela inteira, e a
     regra genérica não pode mudar (o HTML do orçamento é travado byte a byte).
     Escopado no Consolidado de propósito: a aba Alertas é um porte deliberado
     da aba do orçamento e alinhar só um dos dois quebraria a paridade que o
     porte existe para manter. */
  #tabela-consolidado .num { text-align: right; }

  /* Densidade: ~3px a menos por linha, em ~400 linhas. */
  #tabela-consolidado th, #tabela-consolidado td { padding-top: 6px; padding-bottom: 6px; }

  /* Fechamento de bloco. As regras equivalentes de cssBase() exigem DUAS
     classes (tr.linha-total.linha-total-geral), e o markup desta aba emite só
     a segunda -- os fundos pintavam e as bordas de fechamento nunca
     renderizavam. Achado da revisão de design de 2026-08-03. Não dá para
     resolver acrescentando .linha-total ao markup: lá aquela classe significa
     "linha da série Tendência", não "linha de total", e reusá-la aqui herdaria
     a cor âmbar de série junto. */
  #tabela-consolidado .linha-total-geral:not(.linha-total-geral-tipologia) td { border-bottom: 2px solid #f6b53f; }
  #tabela-consolidado .linha-total-geral-tipologia + .linha-consolidado td { border-top: 2px solid var(--gridline); }
  #tabela-consolidado .linha-total-sup td { border-bottom: 2px solid var(--gridline); }

  /* Hover. filter:brightness() só clareia o que TEM fundo próprio, então em
     linha comum ele acendia apenas a primeira coluna (que é sticky e tem fundo
     para não deixar o conteúdo passar por baixo) -- a linha inteira ficava
     inerte. box-shadow inset pinta a célula toda, com ou sem fundo.
     #tabela-alertas-tendencia (2026-08-04, bloco "Alertas de tendência" logo
     abaixo de #tabela-alertas na mesma aba) entra na MESMA regra, e não numa
     cópia à parte: as duas tabelas são a mesma leitura da aba e têm de
     acender igual ao passar o mouse -- valor duplicado é o tipo de coisa que
     diverge em silêncio quando só um lado é ajustado depois. */
  #tabela-consolidado tbody tr:hover td,
  #tabela-alertas tbody tr:hover td,
  #tabela-alertas-tendencia tbody tr:hover td { box-shadow: inset 0 0 0 9999px rgba(255,255,255,0.06); }

  /* O anel de contraste do .status-circulo foi REMOVIDO em 2026-08-04 a pedido
     do dono do projeto: o indicador desta página tem de ficar idêntico ao do
     dashboard de orçamento, que nunca teve anel. O preço é conhecido e aceito
     -- o #1414CC ("Excelente") fica em ~1,65:1 contra a superfície escura e
     quase some, justamente no status que se quer achar varrendo a tela. Não
     recolocar numa revisão de design sem perguntar a ele. */

  /* Os 5 filtros PRÓPRIOS da aba Alertas eram visualmente idênticos aos 6
     filtros de recorte da barra de cima, logo acima deles. O fio âmbar diz de
     quem é cada faixa. Mesmo motivo da regra anterior para não morar em
     cssBase(), onde .filtros-alertas já existe. */
  .filtros-alertas { border-left: 2px solid rgba(246,181,63,0.35); padding-left: 12px; }

  /* Recorte por semana. O rótulo fica em cima (mesma estrutura dos <label>
     dos selects vizinhos, que já são coluna) e as caixas numa linha só --
     assim o grupo inteiro alinha pela mesma base dos outros controles em vez
     de flutuar. */
  .controle-balanco-caixas {
    display: flex; align-items: center; gap: 10px;
    height: 36px;
  }
  .caixa-semana {
    display: flex; align-items: center; gap: 5px;
    font-size: 13px; color: var(--text-primary); cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  /* O #somente-ativos da barra de ações entra na MESMA regra, em vez de ganhar
     uma cópia do âmbar: duplicar valor de cor é como as duas metades da página
     acabam divergindo. Sem isso ele saía com o azul padrão do navegador ao
     lado de controles âmbar. */
  .caixa-semana input[type="checkbox"],
  .controle-ativos-semanal input[type="checkbox"] { accent-color: #f6b53f; cursor: pointer; }
  /* Desabilitado fora de Mês Vigente: continua visível (some e o layout pula
     a cada troca de período), mas legivelmente inerte. */
  .controle-balanco-desabilitado { opacity: 0.45; }
  .controle-balanco-desabilitado .caixa-semana,
  .controle-balanco-desabilitado .caixa-semana input { cursor: not-allowed; }

  /* Aviso de Δ equipes sem dado no período. Âmbar (a cor de atenção da página,
     mesma do foco e das abas), não vermelho: não é erro, é uma informação que
     falta -- e o resto da aba continua válido, o que a última frase diz. */
  .aviso-equipes {
    display: flex; align-items: center; gap: 8px;
    margin: 0 0 16px; padding: 10px 12px;
    border: 1px solid rgba(246,181,63,0.35); border-left: 3px solid #f6b53f;
    border-radius: 6px; background: rgba(246,181,63,0.07);
    font-size: 12px; color: var(--text-secondary); line-height: 1.5;
  }

  /* O painel dos gráficos ganha a MESMA superfície que #secao-grafico tem no
     orçamento (rgba(26,26,25,0.68) + cantos de 8px), mas aplicada em
     .graficos-balanco e não em #secao-balanco: os controles e a legenda ficam
     ACIMA dessa superfície, como a barra de filtros do orçamento fica acima
     da dele. #secao-balanco só precisa do position:relative, que é o que
     ancora o balão de tooltip absoluto. */
  #secao-balanco { position: relative; z-index: 1; }
  .graficos-balanco {
    display: flex; flex-direction: column; gap: 40px;
    background: rgba(26,26,25,0.68); border-radius: 8px; padding: 18px 12px;
  }
  /* .grafico-painel traz margin-bottom:28px de cssBase() (lá os painéis não
     vivem num flex e a margem é o único espaçador). Aqui ela SOMA com o gap e
     o respiro real virava 56px, o dobro do declarado. Zerada: quem espaça é o
     gap. */
  .graficos-balanco .grafico-painel { margin-bottom: 0; }

  /* Teto de escala. O viewBox de 1000 com width:100% faz TUDO dentro do SVG
     crescer junto com a janela, enquanto o título (que é HTML) não cresce: em
     1920px o rótulo de SUP renderizava a 20px -- do tamanho do <h1> -- e o
     título do painel continuava em 12px, sendo ele o único elemento de
     navegação numa página de 10 painéis. Com o teto o fator para em ~1,18, os
     rótulos ficam em 12-13px e as classes compartilhadas (.grafico-eixo-texto,
     11px) passam a renderizar perto do corpo que declaram. De quebra, um
     painel de 13 linhas cai de 924px para ~590px de altura. */
  .grafico-balanco { max-width: 1180px; }

  /* Título do painel promovido: é o único lugar onde a tipologia e a unidade
     ("em milhares") aparecem. Escopado em .graficos-balanco para não tocar no
     .grafico-titulo do orçamento, cujo HTML é travado byte a byte por
     test/orcamento-html-inalterado.test.js. */
  .graficos-balanco .grafico-titulo {
    font-size: 14px; color: var(--text-primary);
    letter-spacing: 0.04em; margin-bottom: 12px;
  }

  .legenda-balanco {
    display: flex; flex-wrap: wrap; align-items: center; gap: 18px;
    margin: 0 0 16px; font-size: 12px; color: var(--text-secondary);
  }
  .legenda-item { display: inline-flex; align-items: center; gap: 7px; }
  .legenda-swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: none; }
  .legenda-nota { color: var(--muted); font-style: italic; }

  /* Aviso de "o período não tem Realizado" -- borda âmbar à esquerda, o mesmo
     acento que a UI usa para chamar atenção sem gritar (não é um erro). */
  .aviso-balanco {
    margin: 0 0 16px; padding: 10px 14px; max-width: 90ch;
    border-left: 3px solid #f6b53f; border-radius: 0 6px 6px 0;
    background: rgba(246,181,63,0.07);
    font-size: 13px; line-height: 1.5; color: var(--text-secondary);
  }
  .aviso-balanco strong { color: var(--text-primary); font-weight: 600; }

  /* Nenhum <text> do gráfico pode capturar o mouse: as áreas de hover
     (.grafico-hit) são desenhadas ANTES dos rótulos, então sem isto cada
     rótulo abriria um buraco no hover da própria linha. */
  .grafico-balanco text { pointer-events: none; }
  .balanco-sup { fill: var(--text-primary); font-size: 11px; }
  .balanco-tomador { fill: var(--text-secondary); }
  .balanco-vazio { fill: var(--muted); font-size: 11px; font-style: italic; }
  .balanco-cabecalho-coluna { fill: var(--muted); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
  .balanco-divisoria { stroke: var(--border); stroke-width: 1; }
  /* Rótulo DENTRO da barra: tinta escura, escolhida pela luminância dos dois
     preenchimentos (#7fd858 e #e0684f são claros o bastante para pedir tinta
     escura em cima). Sem halo -- ele existe para separar texto do FUNDO da
     página, e aqui o fundo é a própria barra. */
  .balanco-rotulo-dentro { fill: #0d0d0d; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
  /* Rótulo do desvio quando NÃO coube dentro da barra. Mesmo corpo (10px) e
     mesmo peso do de dentro: é o mesmo número, com a mesma importância -- só
     muda se coube ou não, e o tamanho do texto não pode carregar essa
     diferença. Antes reaproveitava .grafico-rotulo-final, que é 11px, e numa
     coluna só as primeiras linhas saíam maiores que as de baixo.
     O halo é #161615, a superfície JÁ COMPOSTA (rgba(26,26,25,0.68) sobre
     #0d0d0d), não var(--page): com --page o contorno ficava mais escuro que o
     fundo real e virava auréola em vez de recorte. */
  .balanco-rotulo-fora {
    fill: var(--text-primary); font-size: 10px; font-weight: 600;
    font-variant-numeric: tabular-nums;
    paint-order: stroke; stroke: #161615; stroke-width: 3px; stroke-linejoin: round;
  }
  .balanco-rotulo-equipes { fill: var(--text-secondary); font-size: 10px; font-variant-numeric: tabular-nums; }
  /* Um passo acima de --gridline (#2c2c2a): o zero é a base contra a qual
     todo desvio é medido, não mais uma linha de grade. */
  .balanco-eixo-zero { stroke: #4a4a46; stroke-width: 1; }
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
// Assim como CSS_ABAS_SEMANAL, NÃO entra em cssBase(): aquela folha é
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
  /* Pedido do dono do projeto (2026-08-07): as CÉLULAS de cada linha (não só
     o rótulo à esquerda e o Total à direita, que cssBase()/as duas regras
     acima já colorem) ganham a mesma cor da série -- mesmas 4 cores já
     estabelecidas no resto do dashboard (.linha-previsto/.linha-realizado em
     cssBase(), .linha-tendencia/.linha-pendentes-demandas acima). Time
     "sem-dado" fica sem texto (célula vazia), então colorir não muda nada
     visualmente nelas -- o seletor não precisa excluí-las. */
  .linha-previsto td.num { color: #2f6ad0; }
  .linha-realizado td.num { color: #7fd858; }
  .linha-tendencia td.num { color: #f6b53f; }
  .linha-pendentes-demandas td.num { color: #9700DA; }
  /* Alinhar as colunas ENTRE tabelas empilhadas (Equipes + Financeiro, ou
     qualquer combinação de dimensões marcadas): cada <table> é um elemento
     HTML separado (um bloco por dimensão) e por padrão calcula a largura de
     cada coluna sozinha, a partir do próprio conteúdo -- "2" (Equipes) e
     "12.345" (Financeiro) davam colunas de largura diferente, e a mesma
     semana (S1, por exemplo) não ficava embaixo uma da outra ao rolar a
     vista. table-layout:fixed tira essa auto-medição: com a 1ª coluna
     (rótulo) numa largura FIXA e igual em toda tabela da página, o espaço
     restante se reparte igualmente entre as colunas de semana + Total -- e
     como todas as tabelas exibidas mostram o MESMO mês (mesmo número de
     semanas), o resultado é a mesma largura de coluna em toda tabela.
     170px cobre o rótulo mais comprido, "Demandas Pendentes" (19
     caracteres), com folga. */
  .tabela-semanal { table-layout: fixed; }
  .tabela-semanal .serie-label { width: 170px; }
  .linha-pendentes-demandas .serie-label { border-left-color: #9700DA; }
  /* Mesmo tratamento visual de .nota-demandas (CSS_DEMANDAS abaixo) --
     mensagem de estado vazio (aba Gráficos, render-aba-grafico-semanal.js,
     "Sem mês vigente válido"), texto secundário discreto em vez do branco
     padrão do corpo. Classe própria (não reaproveita .nota-demandas
     diretamente) porque o nome é sobre o que a mensagem É (aviso de
     ausência de dado), não sobre em qual aba ela mora -- outras abas podem
     usar o mesmo aviso no futuro sem o nome soar deslocado. */
  .aviso-sem-dado { font-size: 12px; color: var(--text-secondary); margin: 0 0 10px; max-width: 70ch; }
  .controle-mes-semanal { display: flex; flex-direction: row; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
  .controle-mes-semanal select {
    padding: 6px 26px 6px 10px; height: 32px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23c3c2b7' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center;
    color: var(--text-primary);
    font-size: 13px; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }
  .controle-mes-semanal select:hover { border-color: rgba(246,181,63,0.5); }
  .controle-mes-semanal select:focus-visible { outline: 2px solid #f6b53f; outline-offset: 2px; }
  /* var(--text-secondary) e não var(--muted): a etiqueta fica COLADA na do
     seletor de mês (.controle-mes-semanal, logo acima), e duas etiquetas
     vizinhas em cinzas diferentes leem como uma delas estar desabilitada.
     cursor: pointer porque o <label> inteiro alterna o checkbox. */
  .controle-ativos-semanal { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
  /* Bloco "Alertas de tendência" (2026-08-04, render-alertas-tendencia.js).
     --texto-suave não existe neste projeto -- a variável de texto apagado
     chama-se --muted (ver :root em tools/comum/render-shell.js); --border
     já existe com esse nome mesmo. */
  .bloco-alertas-tendencia { margin-top: 28px; }
  .titulo-alertas-tendencia { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
  .linha-nota-alertas td { color: var(--muted); font-size: 13px; padding: 12px 8px; }
`;

// CSS da aba Demandas (Task 5 desta fase). Mesma razão de CSS_SEMANAL/
// CSS_ABAS_SEMANAL: NÃO entra em cssBase() (tools/comum/render-shell.js), que é
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
  // render-aba-alertas.js consome compute-semanal.js E render-aba-semanal.js
  // (calcularSeriesSemanaisDimensao/formatarIntervaloSemana) -- os dois têm de
  // vir ANTES dele na lista, senão o require reescrito lê undefined de MODULOS.
  // render-aba-consolidado.js tem a mesma dependência de render-aba-semanal.js
  // (calcularSeriesSemanaisDimensao/formatarIntervaloSemana) e mais um require
  // de '../comum/calculo-equipes.js', que o bundler REMOVE -- DIAS_PREMISSA_MES
  // chega como global pelo <script> de fonteParaCliente(), igual ao que
  // compute-balanco.js já faz com mediaEquipesPonderada.
  // compute-tendencia-semanal.js (2026-08-04) consome compute-semanal.js
  // (diasNaSemana) e é consumido por render-aba-semanal.js -- por isso entra
  // ENTRE os dois. A ordem desta lista é o contrato de dependência.
  'compute-semanal.js', 'compute-tendencia-semanal.js', 'render-aba-semanal.js', 'render-aba-alertas.js', 'render-aba-consolidado.js',
  // Os dois de 2026-08-04. compute-alertas-tendencia.js só tem um
  // require('../comum/calculo-equipes.js'), que o bundler REMOVE
  // (DIAS_PREMISSA_MES chega como global). render-alertas-tendencia.js
  // consome compute-alertas-tendencia.js, render-aba-semanal.js,
  // render-aba-consolidado.js, render-aba-alertas.js e compute-semanal.js --
  // todos já registrados acima dele nesta lista.
  'compute-alertas-tendencia.js', 'render-alertas-tendencia.js',
  'compute-grafico-semanal.js', 'render-aba-grafico-semanal.js',
  // compute-equipes-mobilizadas.js (2026-08-03) vem ANTES de
  // compute-balanco.js, que o consome (equipesEquivalentes) para o Δ equipes
  // do Balanço. Não tem require nenhum -- é matemática pura sobre o mapa
  // { 'sup||tipologia': { dia: n } } que o build embute.
  'compute-equipes-mobilizadas.js',
  // Equipes ATIVAS (2026-08-03): classificar-dia-equipe.js nao tem require
  // nenhum; compute-equipes-ativas.js consome ele e parse-matriz-cliente.js,
  // entao os dois precisam vir ANTES dele na lista.
  // parse-matriz-cliente.js sobe para cá (antes ficava no grupo do
  // live-refresh, mais abaixo): compute-equipes-ativas.js consome parseCsvGrid
  // dele, e um require same-dir vira MODULOS['...'] -- que precisa existir
  // ANTES de quem o desestrutura.
  'parse-matriz-cliente.js',
  'classificar-dia-equipe.js', 'compute-equipes-ativas.js',
  // Equipes NÃO PRODUTIVAS (2026-08-05): tem require de
  // classificar-dia-equipe.js, já registrado acima. Precisa vir ANTES de
  // compute-balanco.js/render-aba-balanco.js só porque este bundle é lido em
  // ordem -- não é consumido por nenhum dos módulos acima hoje (a ligação é
  // feita em JS solto dentro de SCRIPT_CLIENTE_SEMANAL, não por require).
  // compute-equipes-produtivas.js SAIU desta lista na Task 12 (2026-08-08):
  // o botão "Atualizar dados" não roda mais agregação de equipes própria
  // sobre dado cru -- equipes-online.csv já chega pré-agregado (ver
  // URL_ESPELHO_EQUIPES_SEMANAL acima). O módulo continua no repositório,
  // sem consumidor aqui.
  'compute-equipes-nao-produtivas.js',
  // Equipes ATIVAS via Matriz (2026-08-06): também sem require same-dir.
  'compute-equipes-ativo-matriz.js',
  'compute-balanco.js', 'render-aba-balanco.js', 'render-aba-demandas.js',
  // filtro-ativos.js (2026-08-04) não consome nenhum módulo same-dir e pode
  // entrar cedo na lista.
  'filtro-ativos.js',
  // Os 4 abaixo alimentam o botão "Atualizar dados" (live-refresh) -- ver
  // docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md.
  // parse-matriz-cliente.js não tem require nenhum (auto-suficiente).
  // parse-avancos.js/parse-lab.js/compute-demandas.js têm require('../comum/...')
  // que o bundle REMOVE (ver transformaModulo) -- as funções que sobram
  // undefined (excelSerialParaData, rotularTipologia, classificarEnsaioLab,
  // chaveMatriz) são supridas como globais pelo <script> de fonteParaCliente()
  // logo ANTES deste bundle (ver a Task 9 deste plano). compute-demandas.js
  // também precisa vir DEPOIS de compute-semanal.js na lista -- ele lê
  // diaEpoch de lá agora (require('./compute-semanal.js'), same-dir,
  // resolvido normalmente pelo bundler).
  'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js',
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
var RenderAbaAlertas = MODULOS['render-aba-alertas.js'];
var RenderAbaConsolidado = MODULOS['render-aba-consolidado.js'];
var RenderAlertasTendencia = MODULOS['render-alertas-tendencia.js'];
var RenderAbaGraficoSemanal = MODULOS['render-aba-grafico-semanal.js'];
var ComputeBalanco = MODULOS['compute-balanco.js'];
var RenderAbaBalanco = MODULOS['render-aba-balanco.js'];
var RenderAbaDemandas = MODULOS['render-aba-demandas.js'];
var ParseMatrizCliente = MODULOS['parse-matriz-cliente.js'];
var ParseAvancos = MODULOS['parse-avancos.js'];
var ParseLab = MODULOS['parse-lab.js'];
var ComputeDemandas = MODULOS['compute-demandas.js'];
var ComputeEquipes = MODULOS['compute-equipes-mobilizadas.js'];
var ComputeEquipesAtivas = MODULOS['compute-equipes-ativas.js'];
var ComputeEquipesNaoProdutivas = MODULOS['compute-equipes-nao-produtivas.js'];
var ComputeEquipesAtivoMatriz = MODULOS['compute-equipes-ativo-matriz.js'];
var FiltroAtivos = MODULOS['filtro-ativos.js'];

var MODO_DEMANDAS = 'mensal';

// Ligado por padrão -- era o default do checkbox próprio do Balanço, e a
// grade de origem é densa o bastante para que "tudo" seja ruído.
var SOMENTE_ATIVOS = true;

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

// Estado dos 5 seletores próprios da aba Alertas -- separado de
// filtrosSelecionadosSemanal (a barra de recorte de cima), exatamente como o
// orçamento separa filtrosAlertas de filtrosSelecionados. Os defaults abrem a
// aba já mostrando algo útil: agrupado por SUP, Realizado E Tendência contra
// Previsto, no acumulado até a semana atual e no mês inteiro -- o paralelo
// direto de "Acumulado até Vigente + Total Ano" no orçamento.
//
// 'periodo' é o único cujas OPÇÕES mudam com o mês selecionado (um mês tem 5
// ou 6 semanas), por isso a config é uma função, não uma constante -- ver
// configFiltrosAlertasSemanal.
var filtrosAlertasSemanal = {
  agruparPor: new Set(['sup']),
  numerico: new Set(['realizado', 'total']),
  baseline: new Set(['previsto']),
  periodo: new Set([RenderAbaAlertas.PERIODO_ACUMULADO, RenderAbaAlertas.PERIODO_MES]),
  status: new Set(),
};

var PERIODOS_ALERTAS_PADRAO = [RenderAbaAlertas.PERIODO_ACUMULADO, RenderAbaAlertas.PERIODO_MES];

function configFiltrosAlertasSemanal() {
  return [
    { id: 'filtro-alertas-agrupar-por', chave: 'agruparPor', rotuloPadrao: 'Agrupar por', exclusivo: true, opcoesFixas: [
      { valor: 'sup', rotulo: 'SUP' },
      { valor: 'tipologia', rotulo: 'Tipologia' },
      { valor: 'grupo', rotulo: 'Grupo' },
      { valor: 'categoria', rotulo: 'Categoria' },
      { valor: 'origem', rotulo: 'Origem' },
    ] },
    { id: 'filtro-alertas-numerico', chave: 'numerico', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: [
      { valor: 'realizado', rotulo: 'Realizado' },
      { valor: 'total', rotulo: 'Tendência' },
    ] },
    { id: 'filtro-alertas-baseline', chave: 'baseline', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true, opcoesFixas: [
      { valor: 'previsto', rotulo: 'Previsto' },
      { valor: 'previstoInicial', rotulo: 'Previsto Inicial' },
    ] },
    // Dinâmico: S1..Sn do mês SELECIONADO (com o intervalo de datas no
    // rótulo) + os dois acumulados.
    { id: 'filtro-alertas-periodo', chave: 'periodo', rotuloPadrao: 'Selecione ao menos 1', minimoUm: true,
      opcoesFixas: RenderAbaAlertas.periodosDisponiveis(semanasDoMesSelecionado()) },
    // Único dos 5 que FILTRA linhas (os outros decidem que colunas/grupos
    // aparecem) -- por isso sem minimoUm/exclusivo: Set vazio mostra tudo,
    // igual aos filtros de recorte da barra de cima. O valor de cada opção é
    // o próprio rótulo que classificarSemaforo devolve.
    { id: 'filtro-alertas-status', chave: 'status', rotuloPadrao: 'Status',
      opcoesFixas: RenderAbaAlertas.STATUS_ORDEM.map(function (s) { return { valor: s, rotulo: s }; }) },
  ];
}

// Índice do mês (0-11) que a Tabela Semanal/Gráficos mostram -- começa no
// vigente, mas o usuário pode trocar pelo <select> #seletor-mes-semanal
// (ver montarDashboard). O clamp cobre o caso raro de window.__VIGENTE_IDX__
// vir fora de [0,11] (ano inteiro no passado/futuro -- ver calcularVigenteIdx).
var mesSelecionadoIdx = Math.max(0, Math.min(11, window.__VIGENTE_IDX__));

// "Hoje" em dia-desde-época, na convenção do projeto inteiro: o dia civil
// LOCAL de quem está vendo a página (getFullYear/getMonth/getDate, o dia que a
// pessoa vê no relógio dela) ancorado em UTC ANTES de virar número -- ver o
// comentário longo em diaEpoch (compute-semanal.js). Calculado a cada chamada,
// nunca guardado: a aba fica aberta e pode atravessar a meia-noite.
//
// Uma função só, e não a mesma expressão repetida em cada aba: a versão
// anterior de montarAbaBalanco construía TRÊS Dates novos na mesma expressão,
// o que numa virada de meia-noite entre eles montaria uma data que nunca
// existiu.
function hojeEpochDoNavegador() {
  var agora = new Date();
  return ComputeSemanal.diaEpoch(new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate())));
}

// As semanas reais do mês SELECIONADO -- o mesmo calendário que a Tabela
// Semanal, os Gráficos e o recorte do Balanço usam (semanasDoMes, cortando
// sempre dentro do mês). Nunca uma segunda contagem de semanas.
function semanasDoMesSelecionado() {
  return ComputeSemanal.semanasDoMes(window.__ANO__, mesSelecionadoIdx);
}

// Os índices que uma aba deve mostrar: os já filtrados pela barra, e depois
// só os ativos, se o check estiver ligado. Fica aqui e não em
// indicesFiltrados porque "ativo" depende do MÊS que a aba mostra -- ver o
// comentário no topo de filtro-ativos.js. Consolidado, Alertas e Semanal
// chamam esta função (cada uma com a dimensão que está mostrando);
// Gráficos e Demandas ficam de fora de propósito -- ver o comentário no
// topo do arquivo de spec desta tarefa (Gráficos soma tudo numa série só,
// onde inativo já contribui zero; Demandas não quebra por registro).
function indicesDaAba(indices, dimensao) {
  if (!SOMENTE_ATIVOS) return indices;
  var semanas = semanasDoMesSelecionado();
  var intervalo = semanas.length
    ? { inicio: semanas[0].inicio, fim: semanas[semanas.length - 1].fim }
    : null;
  return FiltroAtivos.indicesAtivos(
    window.__REGISTROS__, indices, dimensao, mesSelecionadoIdx, window.__DEMANDAS__, intervalo
  );
}

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
  document.getElementById('secao-alertas').style.display = aba === 'alertas' ? '' : 'none';
  document.getElementById('secao-consolidado').style.display = aba === 'consolidado' ? '' : 'none';
  document.getElementById('aba-semanal').classList.toggle('aba-ativa', aba === 'semanal');
  document.getElementById('aba-grafico-semanal').classList.toggle('aba-ativa', aba === 'grafico-semanal');
  document.getElementById('aba-balanco').classList.toggle('aba-ativa', aba === 'balanco');
  document.getElementById('aba-demandas').classList.toggle('aba-ativa', aba === 'demandas');
  document.getElementById('aba-alertas').classList.toggle('aba-ativa', aba === 'alertas');
  document.getElementById('aba-consolidado').classList.toggle('aba-ativa', aba === 'consolidado');
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
function montarAbaGraficoSemanal(registros, indices, dimensoes, vigenteIdx, hojeEpoch) {
  document.getElementById('grafico-semanal-conteudo').innerHTML = RenderAbaGraficoSemanal.renderAbaGraficoSemanal(registros, indices, dimensoes, {
    vigenteIdx: vigenteIdx,
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

// Mesma mecânica para a aba Balanço de massa, com UMA diferença que justifica
// a função separada em vez de reaproveitar a de cima: lá o balão
// (#grafico-semanal-tooltip) vive FORA do innerHTML que é reescrito, então dá
// para guardar a referência uma vez; aqui #balanco-tooltip é emitido por
// renderAbaBalanco, ou seja, ele é DESCARTADO e recriado a cada redesenho
// (troca de período/base/dimensão/filtro). Guardar a referência apontaria para
// um elemento órfão depois do primeiro redesenho -- por isso a busca pelo id
// acontece a cada evento. Quem escuta é #secao-balanco, que nunca é recriada,
// então esta função é chamada UMA vez, de montarDashboard.
function inicializarTooltipBalanco() {
  var secao = document.getElementById('secao-balanco');
  function esconder() {
    var balao = document.getElementById('balanco-tooltip');
    if (balao) balao.style.display = 'none';
  }
  secao.addEventListener('mousemove', function (e) {
    var balao = document.getElementById('balanco-tooltip');
    if (!balao) return;
    var alvo = e.target.closest ? e.target.closest('[data-tooltip]') : null;
    if (!alvo) { balao.style.display = 'none'; return; }
    var rectSecao = secao.getBoundingClientRect();
    balao.textContent = alvo.getAttribute('data-tooltip');
    balao.style.display = 'block';
    balao.style.left = (e.clientX - rectSecao.left + 14) + 'px';
    balao.style.top = (e.clientY - rectSecao.top - 12) + 'px';
  });
  secao.addEventListener('mouseleave', esconder);
}

// Estado dos controles PRÓPRIOS da aba Balanço de massa (Período/Base/
// Dimensão-2) -- continuam locais a esta aba, aplicados DEPOIS do
// indices que a barra compartilhada já filtrou (ver "Fluxo de dados" no
// spec). Tendência não é opção de base -- descartada explicitamente pelo
// dono do projeto (ver compute-balanco.js).
// semanas: índices das semanas marcadas no recorte semanal. Começa VAZIO --
// "nada marcado = mês inteiro", mesma convenção dos filtros da barra (ver
// renderControleSemanas em render-aba-balanco.js). Não é resetado na troca de
// período: quem volta pra Mês Vigente reencontra o recorte que tinha feito.
var ESTADO_BALANCO = { periodo: 'mesVigente', base: 'previsto', dimensao: 'financeiro', semanas: [] };

// Redesenha #secao-balanco inteira (controles + um gráfico por tipologia
// presente em 'indices') com o estado atual de ESTADO_BALANCO, e religa os 3
// controles -- eles são recriados a cada innerHTML novo (renderControles, em
// render-aba-balanco.js), então os listeners da renderização anterior
// morreram junto com os elementos antigos e precisam ser religados toda
// vez, depois do innerHTML. 'indices' vem da barra de filtros compartilhada
// (ver recalcularSemanal) -- os 3 controles desta aba filtram ainda mais
// dentro dele, nunca o substituem.
function montarAbaBalanco(registros, indices) {
  document.getElementById('secao-balanco').innerHTML = RenderAbaBalanco.renderAbaBalanco(registros, indices, {
    periodo: ESTADO_BALANCO.periodo,
    base: ESTADO_BALANCO.base,
    dimensao: ESTADO_BALANCO.dimensao,
    somenteAtivos: SOMENTE_ATIVOS,
    // mesSelecionadoIdx, não __VIGENTE_IDX__: desde 2026-08-03 esta aba também
    // segue o seletor de mês do topo, como a Tabela Semanal e os Gráficos já
    // seguiam. Antes ela ficava presa ao mês corrente, então trocar o mês
    // mudava três abas e deixava a quarta descrevendo outro período, sem nada
    // na tela dizendo isso. É por isso que o rótulo do controle é "Mês
    // selecionado" e não mais "Mês vigente".
    vigenteIdx: mesSelecionadoIdx,
    baseline: window.__BASELINE__,
    demandas: window.__DEMANDAS__,
    ano: window.__ANO__,
    // As semanas reais do mesmo mês -- o MESMO calendário da Tabela Semanal
    // (semanasDoMes, cortando sempre dentro do mês), nunca uma segunda
    // contagem de semanas. Tem que sair do MESMO índice da linha vigenteIdx
    // acima: índices diferentes fariam o recorte S1..Sn descrever as semanas
    // de um mês e recortar o dado de outro.
    semanas: ComputeSemanal.semanasDoMes(window.__ANO__, mesSelecionadoIdx),
    semanasSelecionadas: ESTADO_BALANCO.semanas,
    // Equipes MOBILIZADAS medidas no Avanço Sond (2026-08-03) -- viaja dentro
    // de __DEMANDAS__ porque sai da mesma planilha e é recalculada junto no
    // live-refresh. Ausente (HTML de um build anterior), compute-balanco cai
    // sozinho na coluna da MATRIZ.
    equipesPorDia: window.__DEMANDAS__ && window.__DEMANDAS__.equipesPorDia,
    equipesPeriodo: window.__DEMANDAS__ && window.__DEMANDAS__.equipesPeriodo,
    equipesNaoProdutivas: window.__DEMANDAS__ && window.__DEMANDAS__.equipesNaoProdutivas,
    // Trunca a janela de equipes em hoje: sem isso a média do mês corrente sai
    // dividida pelos dias que ainda não aconteceram (ver calcularLinhas).
    // Calculado aqui, e não no build, porque a página fica aberta e o refresh
    // ao vivo tem de enxergar o dia de hoje, não o do build.
    hojeEpoch: ComputeSemanal.diaEpoch(new Date(Date.UTC(
      new Date().getFullYear(), new Date().getMonth(), new Date().getDate()
    ))),
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
  // Uma caixa por semana, cada uma independente: o estado é lido das caixas
  // marcadas no momento do evento, não incrementado a partir do anterior --
  // assim desmarcar é tão simples quanto marcar, e não existe caminho em que
  // o array acumule índice repetido.
  var caixasSemana = document.querySelectorAll('.balanco-semana');
  for (var cs = 0; cs < caixasSemana.length; cs++) {
    caixasSemana[cs].addEventListener('change', function () {
      var marcadas = [];
      var todas = document.querySelectorAll('.balanco-semana');
      for (var k = 0; k < todas.length; k++) {
        if (todas[k].checked) marcadas.push(parseInt(todas[k].value, 10));
      }
      ESTADO_BALANCO.semanas = marcadas;
      montarAbaBalanco(registros, indices);
    });
  }
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

// Estado do ÚNICO controle próprio que sobrou na aba CONSOLIDADO (eram 2 até
// 2026-08-04, quando o de dimensão saiu). 'semana' começa null =
// AUTOMÁTICO: a aba abre na semana em curso do mês selecionado (a última que
// já começou; S1 num mês que ainda não começou). Depois que a pessoa escolhe
// uma, o número escolhido manda -- até trocar de mês para um com menos
// semanas, quando volta pro automático em vez de apontar pra uma semana que
// não existe (ver montarAbaConsolidado).
//
// 'dimensao' saiu daqui em 2026-08-04: a aba passou a usar a PRIMEIRA marcada
// na barra compartilhada, igual à aba Alertas (a tabela tem um jogo de colunas
// de valor só, não dá pra empilhar dimensões nela). Consequência assumida: a
// aba não abre mais em Volume, abre no que a barra tiver -- então as colunas
// de premissa que aparecem de saída são as de Financeiro (Ticket médio).
var ESTADO_CONSOLIDADO = { semana: null };

// Índice da semana a exibir: o escolhido, ou o automático quando não há
// escolha válida. "A semana em curso" é a última que já começou -- mesmo
// critério de semanasElapsadas na aba Alertas, e não indiceSemanaAtual, que
// devolve -1 quando o mês selecionado não contém hoje (mês passado ou futuro,
// onde a aba ainda precisa mostrar alguma semana).
function semanaConsolidadoIdx(semanas, hojeEpoch) {
  if (!semanas.length) return 0;
  if (typeof ESTADO_CONSOLIDADO.semana === 'number'
      && ESTADO_CONSOLIDADO.semana >= 0 && ESTADO_CONSOLIDADO.semana < semanas.length) {
    return ESTADO_CONSOLIDADO.semana;
  }
  var elapsadas = 0;
  for (var i = 0; i < semanas.length; i++) {
    if (semanas[i].inicio <= hojeEpoch) elapsadas++;
  }
  return elapsadas > 0 ? elapsadas - 1 : 0;
}

// Redesenha #secao-consolidado inteira e religa o controle de semana,
// recriado a cada innerHTML -- mesmo motivo já documentado em
// montarAbaBalanco. 'dimensoes' é a lista da barra compartilhada, na mesma
// ordem canônica que dimensoesEmOrdemSemanal devolve -- exatamente como
// recalcularAlertasSemanal(indices, dimensoes) já recebe; a aba usa só a
// PRIMEIRA marcada.
function montarAbaConsolidado(registros, indices, dimensoes) {
  var dimensao = dimensoes[0];
  // Consolidado tem linha por SUP/tipologia -- é onde o filtro de ativos
  // esconde linhas de verdade (ver o comentário de indicesDaAba). O recorte
  // usa a dimensão COERGIDA (dimensaoDaTabela), não a crua da barra: a tabela
  // só sabe desenhar volume/financeiro e cai em Volume quando a barra está em
  // Equipes, então filtrar pela crua recortaria por previsto.equipes e
  // esconderia registros de uma tabela que está mostrando Volume. A crua
  // continua indo em 'dimensao' -- é dela que sai a nota de tela.
  var indicesAba = indicesDaAba(indices, RenderAbaConsolidado.dimensaoDaTabela(dimensao));
  var semanas = semanasDoMesSelecionado();
  var hojeEpoch = hojeEpochDoNavegador();
  // Uma escolha que não existe mais no mês novo é DESCARTADA (volta ao
  // automático), não clampada: clampar mostraria a última semana do mês novo
  // como se tivesse sido escolhida, e o <select> concordaria com a mentira.
  if (typeof ESTADO_CONSOLIDADO.semana === 'number' && ESTADO_CONSOLIDADO.semana >= semanas.length) {
    ESTADO_CONSOLIDADO.semana = null;
  }
  document.getElementById('secao-consolidado').innerHTML = RenderAbaConsolidado.renderAbaConsolidado(registros, indicesAba, {
    semanaIdx: semanaConsolidadoIdx(semanas, hojeEpoch),
    dimensao: dimensao,
    mesIdx: mesSelecionadoIdx,
    semanas: semanas,
    demandas: window.__DEMANDAS__,
    hojeEpoch: hojeEpoch,
  });
  var seletorSemana = document.getElementById('consolidado-semana');
  if (seletorSemana) {
    seletorSemana.addEventListener('change', function (e) {
      ESTADO_CONSOLIDADO.semana = parseInt(e.target.value, 10);
      montarAbaConsolidado(registros, indices, dimensoes);
    });
  }
}

// Redesenha cabeçalho + corpo da aba Alertas inteiros a cada mudança (de
// recorte OU de um dos 5 seletores próprios) -- sem estado incremental, mesma
// filosofia do orçamento: qualquer mudança aqui muda linhas E colunas ao mesmo
// tempo, então não vale a pena ter dois caminhos.
//
// 'dimensao' é a PRIMEIRA marcada na barra compartilhada, igual ao orçamento
// (a tabela de alertas tem uma coluna de valor só, não dá pra empilhar
// dimensões nela). Com Equipes marcada, as células saem "Sem dado": a página
// não mede equipes por semana em lugar nenhum (ver calcularSeriesSemanaisDimensao),
// e cinza é a resposta honesta -- o filtro de Status esconde essas linhas
// para quem não quiser vê-las.
function recalcularAlertasSemanal(indices, dimensoes) {
  var dimensao = dimensoes[0];
  // Alertas tem linha por SUP/tipologia, igual ao Consolidado -- mesmo
  // recorte de ativos (ver indicesDaAba).
  var indicesAba = indicesDaAba(indices, dimensao);
  var agruparPor = filtrosAlertasSemanal.agruparPor.values().next().value || 'sup';
  document.getElementById('cabecalho-alertas').innerHTML = RenderAbaAlertas.renderCabecalhoAlertas(
    RenderAbaAlertas.AGRUPAR_POR_ROTULO[agruparPor] || agruparPor,
    RenderAbaAlertas.DIMENSOES_ROTULO[dimensao] || dimensao
  );
  document.getElementById('corpo-alertas').innerHTML = RenderAbaAlertas.renderCorpoAlertas(
    window.__REGISTROS__, indicesAba, {
      agruparPor: agruparPor,
      dimensao: dimensao,
      numericos: Array.from(filtrosAlertasSemanal.numerico),
      baselines: Array.from(filtrosAlertasSemanal.baseline),
      // A ordem das colunas de período segue periodosDisponiveis (S1..Sn,
      // depois os acumulados), não a ordem em que a pessoa marcou -- por isso
      // a lista é filtrada a partir dela, e não lida do Set direto.
      periodos: RenderAbaAlertas.periodosDisponiveis(semanasDoMesSelecionado())
        .map(function (p) { return p.valor; })
        .filter(function (v) { return filtrosAlertasSemanal.periodo.has(v); }),
      statusFiltro: Array.from(filtrosAlertasSemanal.status),
      mesIdx: mesSelecionadoIdx,
      semanas: semanasDoMesSelecionado(),
      demandas: window.__DEMANDAS__,
      hojeEpoch: hojeEpochDoNavegador(),
      baseline: window.__BASELINE__,
    }
  );
  // O bloco de tendência segue o mesmo agrupamento e o mesmo recorte da
  // tabela de cima, e RECEBE a dimensão selecionada -- não porque calcule
  // nela (os dois alertas só existem em Volume, ver render-alertas-tendencia.js),
  // mas porque precisa saber que outra dimensão está marcada para trocar a
  // tabela por uma nota explicando isso. Sumir calado leria como "nenhum
  // alerta". A busca da aba varre os dois <tbody>
  // pelo data-search, então ele precisa ser preenchido ANTES dela rodar.
  document.getElementById('cabecalho-alertas-tendencia').innerHTML =
    RenderAlertasTendencia.renderCabecalhoAlertasTendencia(
      RenderAbaAlertas.AGRUPAR_POR_ROTULO[agruparPor] || agruparPor
    );
  document.getElementById('corpo-alertas-tendencia').innerHTML =
    RenderAlertasTendencia.renderCorpoAlertasTendencia(window.__REGISTROS__, indicesAba, {
      agruparPor: agruparPor,
      dimensao: dimensao,
      mesIdx: mesSelecionadoIdx,
      semanas: semanasDoMesSelecionado(),
      demandas: window.__DEMANDAS__,
      hojeEpoch: hojeEpochDoNavegador(),
    });
  aplicarBuscaAlertasSemanal();
}

// Filtra as linhas JÁ renderizadas por texto -- nunca refaz o cálculo, só
// esconde/mostra <tr> pelo data-search que renderLinhaAlerta embutiu. Termo
// vazio mostra tudo, mesma convenção da busca dentro de cada filtro-multi.
function aplicarBuscaAlertasSemanal() {
  var campo = document.getElementById('busca-alertas');
  if (!campo) return;
  var termo = RenderAbaAlertas.normalizarBusca(campo.value);
  function filtrarLinhas(tr) {
    // A linha de nota do bloco de tendência (dimensão != Volume) não carrega
    // data-search: ela é uma explicação de por que o bloco está vazio, não
    // um resultado de busca, então um termo digitado não pode escondê-la.
    // Pular linhas sem o atributo é o jeito mais simples de blindar isso.
    if (tr.dataset.search === undefined) return;
    var combina = termo === '' || tr.dataset.search.indexOf(termo) !== -1;
    tr.style.display = combina ? '' : 'none';
  }
  // Cobre os DOIS <tbody> da aba: o semáforo (#tabela-alertas) e o bloco de
  // tendência (#tabela-alertas-tendencia, 2026-08-04) -- antes só o primeiro
  // era varrido, e um termo digitado filtrava uma tabela deixando a outra
  // intacta. Duas chamadas separadas (em vez de um seletor único com vírgula)
  // de propósito: test/helpers/dom-falso-semanal.js casa a string do seletor
  // por igualdade exata, não por CSS de verdade -- combinar as duas num só
  // faria a chamada inteira devolver [] nesse DOM falso.
  document.querySelectorAll('#tabela-alertas tbody tr').forEach(filtrarLinhas);
  document.querySelectorAll('#tabela-alertas-tendencia tbody tr').forEach(filtrarLinhas);
}

// (Re)monta os 5 seletores da aba. Chamada também na troca de mês, porque as
// opções de PERÍODO mudam com ele: montarFiltroMulti já apaga do estado os
// valores que sumiram (um 's6' marcado ao ir de agosto para julho), mas o
// filtro é minimoUm:true -- se a poda esvaziar o Set, a aba ficaria sem coluna
// nenhuma e sem como voltar, então os padrões são readicionados aqui.
function montarFiltrosAlertasSemanal(registros) {
  configFiltrosAlertasSemanal().forEach(function (cfg) {
    montarFiltroMulti(cfg, registros, filtrosAlertasSemanal, aoMudarAlertasSemanal);
  });
  if (filtrosAlertasSemanal.periodo.size === 0) {
    PERIODOS_ALERTAS_PADRAO.forEach(function (p) { filtrosAlertasSemanal.periodo.add(p); });
    var cfgPeriodo = configFiltrosAlertasSemanal().filter(function (c) { return c.chave === 'periodo'; })[0];
    montarFiltroMulti(cfgPeriodo, registros, filtrosAlertasSemanal, aoMudarAlertasSemanal);
  }
}

// Mudar um seletor da aba Alertas não mexe nas outras abas (elas não olham
// esse estado), então recalcula só ela -- ao contrário de aoMudarSemanal, que
// vem da barra compartilhada e precisa redesenhar tudo.
function aoMudarAlertasSemanal() {
  recalcularSemanalAlertasSozinho();
}

function recalcularSemanalAlertasSozinho() {
  var indices = indicesFiltrados(
    window.__REGISTROS__,
    filtrosSelecionadosSemanal.tipologia,
    filtrosSelecionadosSemanal.categoria,
    filtrosSelecionadosSemanal.grupo,
    filtrosSelecionadosSemanal.sup,
    filtrosSelecionadosSemanal.origem
  );
  recalcularAlertasSemanal(indices, dimensoesEmOrdemSemanal(filtrosSelecionadosSemanal.dimensao));
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
  var hojeEpoch = hojeEpochDoNavegador();
  // A Semanal não tem linha por SUP -- Previsto/Realizado/Tendência são
  // agregados, e um registro inativo já contribui zero neles. O único número
  // que o filtro muda de verdade é Demandas Pendentes (estoque em aberto de
  // um registro sem movimento no mês). Ainda assim aplica-se, pra página
  // inteira responder ao mesmo recorte -- e como "ativo" depende da
  // dimensão, chama renderAbaSemanal UMA VEZ POR DIMENSÃO exibida, cada uma
  // com seu próprio recorte de índices, em vez de uma chamada só com
  // 'dimensoes' inteiro (que teria de compartilhar um único 'indices').
  document.getElementById('secao-semanal').innerHTML = dimensoes.map(function (dimensao) {
    return RenderAbaSemanal.renderAbaSemanal(
      window.__REGISTROS__, indicesDaAba(indices, dimensao), [dimensao], mesSelecionadoIdx, window.__ANO__,
      { demandas: window.__DEMANDAS__, hojeEpoch: hojeEpoch }
    );
  }).join('');
  montarAbaGraficoSemanal(window.__REGISTROS__, indices, dimensoes, mesSelecionadoIdx, hojeEpoch);
  montarAbaBalanco(window.__REGISTROS__, indices);
  // A aba Alertas entra no MESMO recorte das outras. O orçamento já registrou o
  // que acontece quando não entra: por um tempo, filtrar por SUP na barra de
  // cima nunca atualizava os Alertas de lá, porque só os seletores próprios da
  // aba acionavam o recálculo dela.
  recalcularAlertasSemanal(indices, dimensoes);
  // O Consolidado usa a PRIMEIRA dimensão marcada na barra, igual à aba
  // Alertas (recalcularAlertasSemanal acima) -- o seletor próprio dela saiu
  // em 2026-08-04. O RECORTE de registros continua sendo o mesmo das outras
  // abas.
  montarAbaConsolidado(window.__REGISTROS__, indices, dimensoes);
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

// Zera a barra de filtros compartilhada e redesenha tudo -- mesmo contrato de
// limparFiltros no orçamento (tools/orcamento/render-dashboard.js): volta ao
// estado em que a página abre, com os 5 recortes vazios ("nada marcado =
// tudo") e a dimensão de volta em Financeiro, que é o único filtro com
// minimoUm:true e portanto não pode ficar vazio.
//
// O que este botão deliberadamente NÃO toca, pelo mesmo motivo que o orçamento
// não toca: o mês selecionado (é navegação, não recorte -- quem está olhando
// agosto continua em agosto) e os controles PRÓPRIOS das abas Balanço/Alertas/
// Consolidado (período, base, dimensão, semanas, status...), que vivem em
// estado separado e são parte do desenho daquela aba, não da barra de cima.
function limparFiltrosSemanal() {
  FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { filtrosSelecionadosSemanal[cfg.chave].clear(); });
  filtrosSelecionadosSemanal.dimensao.add('financeiro');
  montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
  recalcularSemanal();
}

// registros: já decifrados (só é chamada de dentro de tentarDesbloquear,
// depois de decifrarComSenha) -- ver o comentário grande acima desta
// constante.
function montarDashboard(registros) {
  document.getElementById('aba-semanal').addEventListener('click', function () { alternarAba('semanal'); });
  document.getElementById('aba-grafico-semanal').addEventListener('click', function () { alternarAba('grafico-semanal'); });
  document.getElementById('aba-balanco').addEventListener('click', function () { alternarAba('balanco'); });
  document.getElementById('aba-demandas').addEventListener('click', function () { alternarAba('demandas'); });
  document.getElementById('aba-alertas').addEventListener('click', function () { alternarAba('alertas'); });
  document.getElementById('aba-consolidado').addEventListener('click', function () { alternarAba('consolidado'); });
  document.getElementById('busca-alertas').addEventListener('input', aplicarBuscaAlertasSemanal);
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltrosSemanal);
  document.getElementById('somente-ativos').addEventListener('change', function (e) {
    SOMENTE_ATIVOS = e.target.checked;
    recalcularSemanal();
  });
  var seletorMes = document.getElementById('seletor-mes-semanal');
  seletorMes.value = String(mesSelecionadoIdx);
  seletorMes.addEventListener('change', function (e) {
    mesSelecionadoIdx = parseInt(e.target.value, 10);
    // As opções de PERÍODO da aba Alertas são as semanas do mês -- remontadas
    // antes do recálculo, senão o painel continuaria oferecendo as semanas do
    // mês antigo (e um "S6" que não existe no mês novo).
    montarFiltrosAlertasSemanal(window.__REGISTROS__);
    recalcularSemanal();
  });
  montarTodosFiltrosMultiSemanal(registros);
  montarFiltrosAlertasSemanal(registros);
  configurarAberturaFiltrosMulti();
  inicializarTooltipGraficoSemanal();
  recalcularSemanal();
  // Depois de recalcularSemanal (que é quem cria #balanco-tooltip, via
  // montarAbaBalanco) e UMA vez só -- ver inicializarTooltipBalanco.
  inicializarTooltipBalanco();
  montarAbaDemandas();
}

// ---- Atualização ao vivo (busca as fontes publicadas, sem tocar nos
// arquivos originais) -- ver docs/superpowers/specs/2026-07-31-semanal-atualizar-dados-design.md.
// URL_ESPELHO_MATRIZ_SEMANAL é a MESMA Sheet publicada que o orçamento já
// usa (tools/orcamento/render-dashboard.js) -- literal duplicado de
// propósito, não hà como as duas páginas compartilharem uma constante JS
// (são dois builds independentes).
//
// URL_ESPELHO_LAB_SEMANAL ainda vem da Sheet espelho do Avanço Sond.xlsx
// (Apps Script copiando o .xlsx do Drive a cada 30 min, publicado como CSV,
// aba "Lab Concluido" -- gid 213649864). Confira o cabeçalho antes de mexer
// no gid se um dia essa Sheet for republicada: era a MESMA Sheet que também
// publicava "Avanços" (gid 943230110), mas esse lado migrou pro CSV online
// em 2026-08-05 (ver URL_ESPELHO_AVANCOS_SEMANAL abaixo) -- só Lab ainda usa
// esse mecanismo.
var URL_ESPELHO_MATRIZ_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRaOjGxPYWKj-as9RwErptIND7PE_zxsND19PReV1MdOup1ZY3iAu_DGrQ0gatPyYFEy3hg-LWE2esw/pub?gid=609773455&single=true&output=csv';
// 2026-08-05: trocado do espelho da Sheet (Apps Script copiando o .xlsx do
// Drive) pro CSV combinado publicado junto com a própria página -- gerado
// por tools/semanal/atualizar-avancos-online.js (roda à parte, não a cada
// build). Caminho relativo: mesmo domínio do GitHub Pages, sem CORS, e sem
// depender de um Apps Script rodando em outra conta. Ver
// docs/superpowers/specs/2026-08-05-avancos-online-design.md.
var URL_ESPELHO_AVANCOS_SEMANAL = 'avancos-online.csv';
var URL_ESPELHO_EQ_SEMANAL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7SaAZI8VwQaZD0nPxtOyw56b1XmKfqDTC6qSkj-1PAQr4A8ihTY4vZCOhF4PuMNIYm_-hN_CNdNrX/pub?gid=199381651&single=true&output=csv';
// 2026-08-05: trocado do espelho da Sheet (Apps Script) pro CSV publicado
// junto com a própria página -- mesmo padrão de URL_ESPELHO_AVANCOS_SEMANAL.
// Ver docs/superpowers/specs/2026-08-05-lab-e-equipes-online-design.md.
var URL_ESPELHO_LAB_SEMANAL = 'lab-online.csv';
// 2026-08-08 (Task 12): equipes FRACIONADAS -- substitui o antigo
// equipes-produtivas-online.csv. O CSV publicado já vem pré-agregado por
// (SUP, tipologia, dia) no formato "SUP,Tipo,DiaEpoch,Fracao"
// (atualizar-equipes-online.js, via agregarEquipesFracao em
// compute-equipes-fracao.js), então o botão só faz parse+soma abaixo --
// MESMA lógica que o bloco equivalente em build-dashboard.js (Task 12) --
// em vez de rodar uma agregação própria sobre dado cru. Mesmo padrão de
// publicação relativa dos outros dois.
var URL_ESPELHO_EQUIPES_SEMANAL = 'equipes-online.csv';
// 2026-08-06: "Ativas (total)" do dashboard Matriz (outro projeto deste
// repositório-mãe) -- JSON público, domínio diferente do GitHub Pages desta
// página (por isso URL absoluta, não relativa como as de cima). Alimenta o
// Realizado de Equipes da Tabela Semanal -- ver compute-equipes-ativo-matriz.js.
var URL_ESPELHO_EQUIPES_ATIVO_MATRIZ = 'https://amcaccere261283.github.io/suporte-infra-matriz-dashboard/historico.json';

function definirStatusAtualizacaoSemanal(texto, ehErro) {
  var el = document.getElementById('status-atualizacao');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('status-erro', !!ehErro);
}

function periodosDoAnoSemanal() {
  var periodos = [];
  for (var i = 0; i < 12; i++) periodos.push(new Date(Date.UTC(window.__ANO__, i, 1)));
  return periodos;
}

function buscarCsvSemanal(url) {
  var comCacheBust = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
  return fetch(comCacheBust).then(function (resposta) {
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' ao buscar ' + url);
    return resposta.text();
  });
}

// parseAvancos/parseLab consomem a grade 1-INDEXADA de readXlsxSheet
// (tools/comum/xlsx-reader.js): grid[0] é sempre um buraco vazio, grid[1] é o
// cabeçalho, o dado começa em grid[2]. parseCsvGrid devolve uma grade
// 0-INDEXADA normal (grid[0] = cabeçalho, já que um CSV publicado não tem a
// linha 0 vazia que o .xlsx real tem). Sem este deslocamento, os dois parsers
// procurariam o cabeçalho na primeira linha de DADO e ou lançariam "Coluna não
// encontrada" ou desalinhariam tudo em silêncio.
//
// parseMatrizCliente NÃO passa por aqui de propósito: ele já foi escrito pra
// consumir a grade 0-indexada de parseCsvGrid direto (ver o comentário sobre
// grid[0] em parse-matriz-cliente.js).
function gridCsvComoXlsx(texto) {
  var g = ParseMatrizCliente.parseCsvGrid(texto);
  g.unshift(null);
  return g;
}

// RE_URL_PENDENTE reconhece uma URL_ESPELHO_* ainda no literal placeholder
// "PENDENTE-..." (ver o comentário delas acima) e degrada com graça em vez
// de falhar tudo: enquanto QUALQUER uma das duas (Avanços/Lab) continuar
// placeholder, o botão atualiza só a MATRIZ (Previsto/ticket médio) e deixa
// window.__DEMANDAS__ como estava. URL_ESPELHO_AVANCOS_SEMANAL não bate mais
// nesse padrão desde 2026-08-05 (é sempre um caminho relativo real,
// 'avancos-online.csv') -- na prática só URL_ESPELHO_LAB_SEMANAL ainda pode
// estar pendente hoje, mas o mecanismo continua genérico pras duas.
var RE_URL_PENDENTE = /^PENDENTE-/;

// Tudo-ou-nada, mas só ENTRE as fontes que este refresh de fato tentou
// atualizar: nenhum window.__REGISTROS__/window.__DEMANDAS__ é sobrescrito
// antes de todos os fetches tentados E de todo o parsing terminarem com
// sucesso -- uma falha parcial (ex.: MATRIZ ok, Avanços fora do ar) não pode
// deixar os dois globais referindo momentos diferentes. baseline
// (window.__BASELINE__) nunca é tocado aqui -- ver "Estado atual" no spec.
function atualizarDadosAoVivoSemanal() {
  definirStatusAtualizacaoSemanal('Atualizando…', false);
  var avancosLabConfigurados = !RE_URL_PENDENTE.test(URL_ESPELHO_AVANCOS_SEMANAL)
    && !RE_URL_PENDENTE.test(URL_ESPELHO_LAB_SEMANAL);

  Promise.all([
    buscarCsvSemanal(URL_ESPELHO_MATRIZ_SEMANAL),
    avancosLabConfigurados ? buscarCsvSemanal(URL_ESPELHO_AVANCOS_SEMANAL) : Promise.resolve(null),
    avancosLabConfigurados ? buscarCsvSemanal(URL_ESPELHO_LAB_SEMANAL) : Promise.resolve(null),
    // Espelho da aba EQ (equipes ATIVAS). Falha sozinha: se esta única fonte
    // cair, o refresh continua atualizando MATRIZ/Avanços/Lab e o Δ equipes
    // fica com o dado do build -- em vez de o botão inteiro dar erro por causa
    // da série secundária.
    buscarCsvSemanal(URL_ESPELHO_EQ_SEMANAL).catch(function () { return null; }),
    // Equipes FRACIONADAS (2026-08-08, Task 12 -- antes "produtivas"). Gated
    // pelo MESMO avancosLabConfigurados dos dois de cima: o parse+soma abaixo
    // roda depois de furos/ensaios estarem prontos, igual ao build.
    //
    // Falha sozinha, igual à aba EQ acima: este CSV é publicado à parte
    // (cp dist/equipes-online.csv docs/), então um 404 por cópia esquecida é
    // o modo de falha ESPERADO -- e sem o .catch ele derrubava o botão
    // INTEIRO ("Falha ao atualizar: HTTP 404"), levando MATRIZ e Avanços com
    // ele. Sem fracionadas o Δ equipes só volta pra reserva
    // (ativas/mobilizadas), que é como era antes desta branch.
    avancosLabConfigurados
      ? buscarCsvSemanal(URL_ESPELHO_EQUIPES_SEMANAL).catch(function () { return null; })
      : Promise.resolve(null),
    // "Ativas (total)" do dashboard Matriz (2026-08-06) -- alimenta o
    // Realizado de Equipes da Tabela Semanal (ver compute-equipes-ativo-
    // matriz.js). Fetch INDEPENDENTE de avancosLabConfigurados (não depende
    // de furos nem de tipologiaPorSondador) e com .catch próprio: é outro
    // projeto deste repositório-mãe, publicado num domínio diferente -- se o
    // dele cair, MATRIZ/Avanços/Lab/EQ/produtivas continuam atualizando
    // normalmente, só o Realizado de Equipes fica com o dado do build.
    fetch(URL_ESPELHO_EQUIPES_ATIVO_MATRIZ).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function () { return null; }),
  ]).then(function (textos) {
    var registrosNovos = ParseMatrizCliente.parseMatrizCliente(ParseMatrizCliente.parseCsvGrid(textos[0]));
    if (!registrosNovos.length) throw new Error('nenhum registro encontrado no espelho da MATRIZ -- confira se o Apps Script já rodou pelo menos uma vez');

    var demandasNovas = window.__DEMANDAS__;

    // Realizado de Equipes (2026-08-06): calculado numa variável PRÓPRIA, não
    // escrito direto em demandasNovas. Se avancosLabConfigurados for true (o
    // caso normal), a linha "demandasNovas = ComputeDemandas.computeDemandas(...)"
    // logo abaixo REATRIBUI demandasNovas pra um objeto novo -- gravar aqui
    // ficaria órfão no objeto antigo e nunca chegaria ao window.__DEMANDAS__
    // final (bug real, 2026-08-06: a linha Realizado de Equipes da Tabela
    // Semanal ficava em branco depois de qualquer "Atualizar dados", porque
    // é isso que sempre acontecia). Sem fetch novo (fetch falhou ou textos[5]
    // veio vazio), preserva o que já estava em window.__DEMANDAS__ antes
    // desta atualização -- não apaga o dado do build à toa.
    var equipesAtivoPorDiaAtualizado = textos[5]
      ? ComputeEquipesAtivoMatriz.agregarEquipesAtivoPorDia(textos[5])
      : window.__DEMANDAS__.equipesAtivoPorDia;

    if (avancosLabConfigurados) {
      var furosLidos = ParseAvancos.parseAvancos(gridCsvComoXlsx(textos[1])).furos;
      var ensaiosLidos = ParseLab.parseLab(gridCsvComoXlsx(textos[2])).ensaios;

      var furos = ComputeDemandas.redirecionarSupsDesconhecidos(furosLidos, registrosNovos).itens;
      var ensaios = ComputeDemandas.redirecionarSupsDesconhecidos(ensaiosLidos, registrosNovos).itens;

      // Falha alto em vez de reportar sucesso vazio: se vieram furos mas NENHUM
      // deles tem uma única data legível, o formato de data do espelho mudou de
      // um jeito que nem o serial nem o fallback dd/MM/yyyy de dataSaneada
      // reconhecem -- e computeDemandas devolveria zeros em todas as séries com
      // o status dizendo "Atualizado". Erro antes de qualquer atribuição, pra
      // manter a atomicidade tudo-ou-nada.
      var algumaData = furos.some(function (f) { return f.criacaoOS || f.terminoSondagem || f.conclusao; });
      if (furos.length > 0 && !algumaData) {
        throw new Error('nenhuma data legível encontrada nos furos do espelho de Avanços -- confira se o formato de data mudou (serial vs texto)');
      }

      demandasNovas = ComputeDemandas.computeDemandas(furos, periodosDoAnoSemanal(), ensaios);
      // Mesma agregação que o build faz (build-dashboard.js), sobre os MESMOS
      // furos já redirecionados -- sem isso o refresh atualizaria volume e
      // financeiro do Balanço e deixaria o Δ equipes preso ao dado do build.
      demandasNovas.equipesPorDia = ComputeEquipes.agregarEquipesPorDia(furos);
      // Mobilizadas cobrem o ano inteiro: null = "sem restrição de mês" pra
      // foraDaCoberturaDeEquipes. equipesPeriodo anda SEMPRE junto de
      // equipesPorDia -- ver o comentário equivalente em build-dashboard.js.
      demandasNovas.equipesPeriodo = null;

      // Equipes ATIVAS: mesma montagem que o build faz (build-dashboard.js,
      // montarEquipesAtivas), sobre os MESMOS furos já redirecionados. Sem
      // isso o refresh atualizaria volume e financeiro e deixaria o Δ equipes
      // preso ao build.
      var csvEq = textos[3];
      var periodoEq = csvEq ? ComputeEquipesAtivas.mesDaAbaEq(csvEq) : null;

      // FORA do if (periodoEq): só dependem de 'furos'. Mesmo tratamento que
      // montarEquipesAtivas recebeu no lado Node (build-dashboard.js).
      //
      // Estava declarado com 'var' DENTRO do if, e 'var' é escopo de FUNÇÃO:
      // com periodoEq falso, o bloco de produtivas (existia até a Task 12,
      // 2026-08-08 -- substituído pelo bloco de equipes FRACIONADAS abaixo,
      // que lê o CSV já pré-agregado e não depende mais de
      // tipologiaPorSondador) lia 'undefined', agregarEquipesProdutivas caía
      // no default {}, toda linha ia pra semTipologia, porDia voltava vazio
      // -- e o botão degradava o Δ equipes de produtivas pra mobilizadas em
      // silêncio, com status verde "Atualizado". Exatamente a classe de bug
      // "um caminho se comporta diferente do outro" que esta branch
      // precisava evitar -- tipologiaPorSondador continua calculado aqui
      // porque equipes ATIVAS (logo abaixo) ainda o consome.
      var osParaSup = {};
      var contagemTip = {};
      furos.forEach(function (f) {
        if (f.os && f.sup && !osParaSup[f.os]) osParaSup[f.os] = f.sup;
        if (f.sondador && f.tipologia) {
          var k = f.sondador + '||' + f.tipologia;
          contagemTip[k] = (contagemTip[k] || 0) + 1;
        }
      });
      var melhorTip = {};
      Object.keys(contagemTip).forEach(function (k) {
        var partes = k.split('||');
        if (!melhorTip[partes[0]] || contagemTip[k] > melhorTip[partes[0]].n) {
          melhorTip[partes[0]] = { tipologia: partes[1], n: contagemTip[k] };
        }
      });
      var tipologiaPorSondador = {};
      Object.keys(melhorTip).forEach(function (s) { tipologiaPorSondador[s] = melhorTip[s].tipologia; });

      if (periodoEq) {
        var agregado = ComputeEquipesAtivas.agregarEquipesAtivas({
          equipes: ComputeEquipesAtivas.parseAbaEq(csvEq),
          osParaSup: osParaSup,
          tipologiaPorSondador: tipologiaPorSondador,
          nomesSondadores: Object.keys(tipologiaPorSondador),
          // rotularTipologia vem de tipologias-avancos.js, injetado como global
          // por fonteParaCliente() antes do bundle -- mesmo mecanismo de
          // mediaEquipesPonderada. Sem traduzir, a chave não casa com a do
          // Balanço e o Realizado sai 0,0 em todas as linhas.
          rotularTipologia: typeof rotularTipologia === 'function' ? rotularTipologia : null,
          ano: periodoEq.ano, mes: periodoEq.mes,
        });
        demandasNovas.equipesPorDia = agregado.porDia;
        demandasNovas.equipesPeriodo = periodoEq;
      }

      // Equipes FRACIONADAS (2026-08-08, Task 12 -- antes "produtivas"):
      // mesma prioridade que o build já dá -- se o CSV respondeu e produz
      // pelo menos um dia utilizável, ela GANHA de ativas/mobilizadas
      // (setadas acima). O CSV já chega PRÉ-AGREGADO por (SUP, tipologia,
      // dia) no formato "SUP,Tipo,DiaEpoch,Fracao" (mesmo que
      // atualizar-equipes-online.js grava em dist/) -- por isso este bloco
      // só faz parse+soma, MESMA lógica do bloco Node equivalente em
      // build-dashboard.js (Task 12), sem chamar nenhuma função de
      // "agregar*": a agregação de verdade (Link 6 roster + Link 7
      // campo/produção) já rodou fora do navegador, em
      // atualizar-equipes-online.js.
      if (textos[4]) {
        var gridEquipesCliente = ParseMatrizCliente.parseCsvGrid(textos[4]);
        var porDiaFracaoCliente = {};
        var diasFracaoCliente = [];
        gridEquipesCliente.slice(1).forEach(function (linha) {
          if (!linha || !linha.length) return;
          var sup = linha[0];
          var tipo = linha[1];
          var dia = Number(linha[2]);
          var fracao = Number(linha[3]);
          // MESMO redirecionamento que furos/ensaios levam nas duas linhas do
          // topo deste bloco: par (contrato, tipologia) que a MATRIZ não
          // conhece vira "Diversos" em vez de sumir do Δ equipes -- e
          // fracionadas é a fonte PRIMÁRIA dele. Ver o gêmeo em
          // build-dashboard.js.
          var supResolvido = ComputeDemandas.resolverSupConhecido(registrosNovos)(sup, tipo);
          var chave = supResolvido + '||' + tipo;
          if (!porDiaFracaoCliente[chave]) porDiaFracaoCliente[chave] = {};
          porDiaFracaoCliente[chave][dia] = (porDiaFracaoCliente[chave][dia] || 0) + fracao;
          diasFracaoCliente.push(dia);
        });
        if (Object.keys(porDiaFracaoCliente).length) {
          demandasNovas.equipesPorDia = porDiaFracaoCliente;
          // JUNTO com equipesPorDia, sempre: fracionadas cobre UM mês, e sem
          // isto escolher um mês passado desenharia Δ equipes quase zero sem o
          // aviso de "sem dado". Período equivalente ao que build-dashboard.js
          // deriva: o mês/ano do dia mais antigo encontrado.
          var diaRepresentativoCliente = new Date(Math.min.apply(null, diasFracaoCliente) * 86400000);
          demandasNovas.equipesPeriodo = {
            ano: diaRepresentativoCliente.getUTCFullYear(),
            mes: diaRepresentativoCliente.getUTCMonth() + 1,
          };
        }
      }

      // Equipes NÃO produtivas (2026-08-05): reusa o MESMO csvEq/periodoEq já
      // obtidos acima para ativas -- nenhuma busca nova. Informação separada,
      // nunca somada em equipesPorDia.
      if (csvEq && periodoEq) {
        demandasNovas.equipesNaoProdutivas = ComputeEquipesNaoProdutivas.agregarEquipesNaoProdutivas({
          equipes: ComputeEquipesAtivas.parseAbaEq(csvEq), ano: periodoEq.ano, mes: periodoEq.mes,
        }).porDiaPorMotivo;
      }
    }

    // Aplicado por ÚLTIMO, depois de qualquer reatribuição de demandasNovas
    // acima (avancosLabConfigurados=true troca o objeto inteiro) -- é o que
    // garante que o valor sobrevive aos dois caminhos.
    demandasNovas.equipesAtivoPorDia = equipesAtivoPorDiaAtualizado;

    window.__REGISTROS__ = registrosNovos;
    window.__DEMANDAS__ = demandasNovas;
    montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
    recalcularSemanal();
    montarAbaDemandas();

    var agora = new Date();
    var horario = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    var statusTexto = avancosLabConfigurados
      ? 'Atualizado às ' + horario
      : 'Atualizado (só MATRIZ) às ' + horario + ' -- Avanços/Lab pendente de configuração do Apps Script';
    definirStatusAtualizacaoSemanal(statusTexto, false);
  }).catch(function (erro) {
    definirStatusAtualizacaoSemanal('Falha ao atualizar: ' + erro.message, true);
  });
}

document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivoSemanal);
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
${CSS_ABAS_SEMANAL}
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
${markupFiltros(FILTROS_SEMANAL, { recuo: '    ', acoes: MARKUP_ACOES_SEMANAL })}
${markupAbas(ABAS_VISUALIZACAO, '    ')}
    <div id="secao-semanal"></div>
    <div id="secao-grafico-semanal" style="display:none">
      <div id="grafico-semanal-conteudo"></div>
      <div id="grafico-semanal-tooltip" class="grafico-tooltip" style="display:none"></div>
    </div>
    <div id="secao-balanco" style="display:none"></div>
    <div id="secao-demandas" style="display:none"></div>
    <div id="secao-alertas" style="display:none">
${markupFiltros(FILTROS_ALERTAS_SEMANAL, { recuo: '      ', classes: 'filtros-alertas' })}
      <input id="busca-alertas" type="text" class="busca-alertas" placeholder="Buscar..." autocomplete="off">
      <table id="tabela-alertas">
        <thead id="cabecalho-alertas"></thead>
        <tbody id="corpo-alertas"></tbody>
      </table>
      <div class="bloco-alertas-tendencia">
        <h3 class="titulo-alertas-tendencia">Alertas de tendência</h3>
        <table id="tabela-alertas-tendencia">
          <thead id="cabecalho-alertas-tendencia"></thead>
          <tbody id="corpo-alertas-tendencia"></tbody>
        </table>
      </div>
    </div>
    <div id="secao-consolidado" style="display:none"></div>
  </div>
  </main>
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO__ = ${periodos[0].getUTCFullYear()};</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${fonteParaClienteEquipes()}${fonteParaClienteTipologiasAvancos()}${fonteParaClienteTipologiasLab()}${fonteParaClienteDatas()}${fonteParaClienteLinhaBase()}</script>
  <script>${bundle}</script>
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_SEMANAL}</script>
</body>
</html>`;
}

module.exports = { renderSemanal };
