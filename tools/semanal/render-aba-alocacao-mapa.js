'use strict';
const {
  renderControles, renderFaixaAlocacao, renderPool,
  renderGuardaSemRoster, renderAvisoSomenteLeitura,
} = require('./render-aba-alocacao.js');

// markupFiltroMulti/SETA_FILTRO_MULTI são DUPLICADAS de tools/comum/render-shell.js
// (não importadas) -- mesma convenção que chaveDemandas já segue neste bundle
// (ver render-aba-grafico-semanal.js/render-alocacao-pagina.js): este arquivo é
// dual-módulo (Node + navegador, via buildBrowserBundle/BUNDLE_ARQUIVOS_ALOCACAO em
// render-alocacao-pagina.js), e o bundler REMOVE qualquer `require('../...')` --
// dependência fora do diretório do bundle (ver o comentário grande em
// tools/comum/browser-bundle.js, transformaModulo) -- assumindo que o nome
// destruturado já existe como global antes do bundle rodar. render-shell.js não tem
// (ainda) um fonteParaCliente() que exponha markupFiltroMulti como global de página,
// então um require cru aqui deixaria `markupFiltroMulti` undefined no navegador
// (`ReferenceError`, só visível rodando o bundle real -- os testes deste arquivo
// isolado, que só rodam em Node, não pegam isso). Copiar a função inteira evita
// depender dessa infraestrutura extra para um helper pequeno.
var SETA_FILTRO_MULTI = '<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ESCAPE É DO CHAMADOR, como em render-shell.js: 'filtro.rotulo' entra cru.
function markupFiltroMulti(filtro) {
  return '<div class="filtro-multi" id="' + filtro.id + '">'
    + '<button type="button" class="filtro-multi-trigger">' + filtro.rotulo + SETA_FILTRO_MULTI + '</button>'
    + '<div class="filtro-multi-painel" hidden></div></div>';
}

// Módulo dual (Node + navegador) -- mesmo padrão de render-aba-alocacao.js.
// Devolve o HTML ESTÁTICO da aba Mapa: barra de controles, resumo, pool de
// equipes (os TRÊS reaproveitados de render-aba-alocacao.js, sem nenhuma
// cópia) e o container onde o MapLibre desenha os pinos -- isso é JS puro,
// não faz parte deste HTML (ver render-alocacao-pagina.js, Tasks 11/12).
//
// Ver docs/superpowers/specs/2026-08-26-alocacao-equipes-mapa-design.md.
//
// renderAbaAlocacaoMapaTopo/renderAbaAlocacaoMapaPool (Task 11, correção
// pós-revisão) foram extraídas de dentro de renderAbaAlocacaoMapa -- NÃO
// reimplementam nada, só isolam os dois pedaços que precisam ser
// redesenhados INDEPENDENTEMENTE do wrap do mapa depois que o MapLibre já
// existe. Ver o comentário grande em montarMapaAlocacao
// (render-alocacao-pagina.js) para o porquê: reescrever secao.innerHTML
// inteiro a cada redesenho troca #mapa-alocacao-canvas por um container NOVO
// e vazio, e como mapa.on('load', montarAbaAlocacao) dispara esse MESMO
// redesenho segundos depois de abrir a aba, o mapa acaba desenhando dentro
// de um nó que já caiu do documento -- "existe" (contexto WebGL vivo) mas
// nunca mais aparece na tela, sem F5.

// dados: o resultado de prepararDadosAlocacao(registros, indices, opcoes)
// (render-aba-alocacao.js). Não é chamada com semRoster -- esse caso nem
// tem "topo" separado do resto, ver renderAbaAlocacaoMapa abaixo.
function renderAbaAlocacaoMapaTopo(dados, opcoes) {
  var o = opcoes || {};
  var html = renderControles(o, dados.somenteLeitura);
  html += renderFaixaAlocacao(dados.resumo.totais);
  if (dados.somenteLeitura === 'mes-diferente') html += renderAvisoSomenteLeitura();
  return html;
}

function renderAbaAlocacaoMapaPool(dados, opcoes) {
  var o = opcoes || {};
  return renderPool(
    dados.equipes, o.foraDoQuadro, dados.porEquipeMap, dados.somenteLeitura,
    o.alocacao, o.buscaEquipe, o.tipologiaAlocacao || null
  );
}

// dados: null quando opcoes.semRoster. Continua devolvendo o HTML completo
// da aba de uma vez -- é o que o PRIMEIRO desenho usa (antes do mapa
// existir, quando é seguro/necessário criar um #mapa-alocacao-canvas novo).
// #mapa-alocacao-topo e #mapa-alocacao-pool (ids novos nos wrappers, Task
// 11) são os pontos que montarMapaAlocacao passa a redesenhar SOZINHOS,
// sem tocar aqui, depois que o mapa já existe.
function renderAbaAlocacaoMapa(dados, opcoes) {
  var o = opcoes || {};
  if (o.semRoster) {
    return renderControles(o, true) + renderGuardaSemRoster();
  }

  var html = '<div id="mapa-alocacao-topo">' + renderAbaAlocacaoMapaTopo(dados, o) + '</div>';
  // Bloco ESTÁVEL: nasce aqui (só no render COMPLETO, chamado uma vez só por
  // instância do mapa) e nunca é tocado por renderAbaAlocacaoMapaTopo/-Pool --
  // mesma técnica que já protege .mapa-alocacao-mapa-wrap (ver o comentário
  // grande em montarMapaAlocacao, render-alocacao-pagina.js). O painel do
  // filtro-multi (lista de concessionárias) é vazio aqui de propósito -- só
  // existe depois que o cliente busca concessoes-rodovias.json (Task 6);
  // markupFiltroMulti já desenha o painel como <div hidden></div> vazio, pronto
  // pra ser preenchido depois, mesmo contrato que os outros filtro-multi da
  // página já seguem.
  html += '<div id="mapa-alocacao-rodovias">'
    + markupFiltroMulti({ id: 'filtro-rodovias', rotulo: 'Rodovias' })
    + '<div id="mapa-alocacao-rodovias-legenda" class="mapa-alocacao-rodovias-legenda"></div>'
    + '</div>';
  html += '<div class="mapa-alocacao-corpo">';
  html += '<aside class="mapa-alocacao-pool" id="mapa-alocacao-pool">'
    + renderAbaAlocacaoMapaPool(dados, o) + '</aside>';
  html += '<div class="mapa-alocacao-mapa-wrap">'
    + '<div id="mapa-alocacao-canvas"></div>'
    + '<div id="mapa-alocacao-sem-localizacao" class="mapa-alocacao-sem-localizacao"></div>'
    + '</div>';
  html += '</div>';
  return html;
}

module.exports = { renderAbaAlocacaoMapa, renderAbaAlocacaoMapaTopo, renderAbaAlocacaoMapaPool };
