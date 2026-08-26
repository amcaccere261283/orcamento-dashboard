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
// dados: o resultado de prepararDadosAlocacao(registros, indices, opcoes)
// (render-aba-alocacao.js) -- null quando opcoes.semRoster.
function renderAbaAlocacaoMapa(dados, opcoes) {
  var o = opcoes || {};
  if (o.semRoster) {
    return renderControles(o, true) + renderGuardaSemRoster();
  }

  var html = renderControles(o, dados.somenteLeitura);
  html += renderFaixaAlocacao(dados.resumo.totais);
  if (dados.somenteLeitura === 'mes-diferente') html += renderAvisoSomenteLeitura();
  html += '<div class="mapa-alocacao-corpo">';
  html += '<aside class="mapa-alocacao-pool">' + renderPool(
    dados.equipes, o.foraDoQuadro, dados.porEquipeMap, dados.somenteLeitura,
    o.alocacao, o.buscaEquipe, o.tipologiaAlocacao || null
  ) + '</aside>';
  html += '<div class="mapa-alocacao-mapa-wrap">'
    + '<div id="mapa-alocacao-canvas"></div>'
    + '<div id="mapa-alocacao-sem-localizacao" class="mapa-alocacao-sem-localizacao"></div>'
    + '</div>';
  html += '</div>';
  return html;
}

module.exports = { renderAbaAlocacaoMapa };
