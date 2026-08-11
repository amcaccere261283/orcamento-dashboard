'use strict';

// Módulo dual (Node + navegador). Sem require nenhum -- tudo que ele precisa
// (fetch, armazenamento) é INJETADO por quem chama, e é isso que deixa o teste
// rodar offline, sem localStorage e sem rede.
//
// PERSISTÊNCIA DA ALOCAÇÃO
// ===========================================================================
// Ver docs/superpowers/specs/2026-08-10-semanal-alocacao-equipes-design.md,
// Decisão 8.

// Mesmo padrão de RE_URL_PENDENTE (render-semanal.js): enquanto o Apps Script
// não estiver publicado, o literal fica 'PENDENTE-...' e a aba roda inteira em
// armazenamento local, dizendo isso no status. É o ESTADO INICIAL do recurso.
var RE_URL_ALOCACAO_PENDENTE = /^PENDENTE-/;

var PREFIXO_ARMAZENAMENTO = 'alocacao-equipes:';
var CHAVE_FILA = 'alocacao-equipes:fila';

// '2026|2026-08-10' -- ano civil mais a data ISO do primeiro dia da semana.
// Sai de diaEpoch (dias-desde-época UTC), então reconstruir com Date.UTC cai
// exatamente na meia-noite daquele dia; lê com getUTC*, nunca local.
function chaveSemana(ano, semanaInicioEpoch) {
  var d = new Date(semanaInicioEpoch * 86400000);
  var mes = d.getUTCMonth() + 1;
  var dia = d.getUTCDate();
  return ano + '|' + d.getUTCFullYear()
    + '-' + (mes < 10 ? '0' : '') + mes
    + '-' + (dia < 10 ? '0' : '') + dia;
}

function criarClienteAlocacao(opcoes) {
  var o = opcoes || {};
  var url = String(o.url || '');
  var buscar = o.fetch;
  var armazenamento = o.armazenamento;
  var autor = o.autor || 'anônimo';
  var local = RE_URL_ALOCACAO_PENDENTE.test(url) || !url;

  function lerJson(chave, padrao) {
    if (!armazenamento) return padrao;
    try {
      var texto = armazenamento.getItem(chave);
      return texto ? JSON.parse(texto) : padrao;
    } catch (err) { return padrao; }
  }

  function gravarJson(chave, valor) {
    if (!armazenamento) return;
    try { armazenamento.setItem(chave, JSON.stringify(valor)); } catch (err) { /* cota cheia */ }
  }

  function aplicarLocal(movimento) {
    var chave = PREFIXO_ARMAZENAMENTO + movimento.chaveSemana;
    var mapa = lerJson(chave, {});
    if (!movimento.sup) delete mapa[movimento.equipeId];
    else mapa[movimento.equipeId] = { sup: movimento.sup, coluna: movimento.coluna };
    gravarJson(chave, mapa);
    return mapa;
  }

  function linhasParaMapa(linhas) {
    var mapa = {};
    (linhas || []).forEach(function (l) {
      if (!l || !l.equipeId || !l.sup) return;
      mapa[l.equipeId] = { sup: l.sup, coluna: l.coluna };
    });
    return mapa;
  }

  function enfileirar(movimento) {
    var fila = lerJson(CHAVE_FILA, []);
    // Um movimento por equipe/semana: reenviar dois estados da mesma equipe
    // só faria o mais velho sobrescrever o mais novo do outro lado.
    fila = fila.filter(function (m) {
      return !(m.chaveSemana === movimento.chaveSemana && m.equipeId === movimento.equipeId);
    });
    fila.push(movimento);
    gravarJson(CHAVE_FILA, fila);
  }

  async function enviar(movimento) {
    var resposta = await buscar(url, {
      method: 'POST',
      // text/plain faz disto uma requisição SIMPLES: sem preflight OPTIONS,
      // que um web app do Apps Script não sabe responder. O corpo continua
      // sendo JSON, lido em e.postData.contents do lado de lá.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        chaveSemana: movimento.chaveSemana,
        equipeId: movimento.equipeId,
        sup: movimento.sup,
        coluna: movimento.coluna,
        autor: autor,
        atualizadoEm: new Date().toISOString(),
      }),
      redirect: 'follow',
    });
    if (!resposta || !resposta.ok) throw new Error('HTTP ' + (resposta && resposta.status));
    return await resposta.json();
  }

  return {
    modo: function () { return local ? 'local' : 'sheet'; },

    carregar: async function (chave) {
      var mapaLocal = lerJson(PREFIXO_ARMAZENAMENTO + chave, {});
      if (local) return mapaLocal;
      try {
        var resposta = await buscar(url + '?semana=' + encodeURIComponent(chave), { redirect: 'follow' });
        if (!resposta || !resposta.ok) throw new Error('HTTP ' + (resposta && resposta.status));
        var dados = await resposta.json();
        var mapa = linhasParaMapa(dados && dados.linhas);
        gravarJson(PREFIXO_ARMAZENAMENTO + chave, mapa);
        return mapa;
      } catch (err) {
        // Sem rede, o cache local é a melhor resposta disponível -- e é honesta:
        // é o que ESTA máquina gravou por último. Quem chama mostra o aviso.
        return mapaLocal;
      }
    },

    gravar: async function (movimento) {
      // O local é aplicado SEMPRE e primeiro: a tela nunca espera a rede, e uma
      // falha de gravação não pode desfazer o que o usuário acabou de ver.
      aplicarLocal(movimento);
      if (local) return { ok: true, modo: 'local' };
      try {
        await enviar(movimento);
        return { ok: true, modo: 'sheet' };
      } catch (err) {
        enfileirar(movimento);
        return { ok: false, modo: 'sheet', erro: err.message };
      }
    },

    pendentes: function () { return lerJson(CHAVE_FILA, []); },

    tentarDeNovo: async function () {
      var fila = lerJson(CHAVE_FILA, []);
      var restantes = [];
      for (var i = 0; i < fila.length; i++) {
        try { await enviar(fila[i]); } catch (err) { restantes.push(fila[i]); }
      }
      gravarJson(CHAVE_FILA, restantes);
      return restantes.length;
    },
  };
}

module.exports = { criarClienteAlocacao, chaveSemana, RE_URL_ALOCACAO_PENDENTE };
