'use strict';
const {
  renderControles, renderFaixaAlocacao, renderPool,
  renderGuardaSemRoster, renderAvisoSomenteLeitura,
} = require('./render-aba-alocacao.js');

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
