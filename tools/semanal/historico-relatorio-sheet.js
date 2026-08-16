'use strict';

// Cliente de histórico do Relatório Semanal em Excel -- mesmo padrão dual
// Node+navegador de alocacao-sheet.js (fetch/armazenamento injetados,
// PENDENTE- cai em modo local sem tocar a rede). Diferente daquele, este é
// APPEND-ONLY: cada geração de relatório grava um lote NOVO, nunca atualiza
// um lote existente -- é histórico, não estado. Por isso não há "carregar":
// não existe um estado atual pra ler de volta, só o que já foi enviado.

var RE_URL_HISTORICO_PENDENTE = /^PENDENTE-/;
var CHAVE_FILA = 'historico-relatorio:fila';

function criarClienteHistoricoRelatorio(opcoes) {
  var o = opcoes || {};
  var url = String(o.url || '');
  var buscar = o.fetch;
  var armazenamento = o.armazenamento;
  var local = RE_URL_HISTORICO_PENDENTE.test(url) || !url;

  function lerJson(chave, padrao) {
    if (!armazenamento) return padrao;
    try { var texto = armazenamento.getItem(chave); return texto ? JSON.parse(texto) : padrao; }
    catch (err) { return padrao; }
  }
  function gravarJson(chave, valor) {
    if (!armazenamento) return;
    try { armazenamento.setItem(chave, JSON.stringify(valor)); } catch (err) { /* cota cheia */ }
  }
  function enfileirar(lote) {
    var fila = lerJson(CHAVE_FILA, []);
    fila.push(lote);
    gravarJson(CHAVE_FILA, fila);
  }
  async function enviar(lote) {
    var resposta = await buscar(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // requisição simples, sem preflight
      body: JSON.stringify(lote),
      redirect: 'follow',
    });
    if (!resposta || !resposta.ok) throw new Error('HTTP ' + (resposta && resposta.status));
    return await resposta.json();
  }

  return {
    modo: function () { return local ? 'local' : 'sheet'; },

    // lote: { linhas: [...] }. Sem URL publicada, não há onde enfileirar de
    // verdade (não sobrevive a um novo build, que troca a constante) --
    // devolve ok:true, modo:'local' sem tocar em nada.
    gravar: async function (lote) {
      if (local) return { ok: true, modo: 'local' };
      try {
        await enviar(lote);
        return { ok: true, modo: 'sheet' };
      } catch (err) {
        enfileirar(lote);
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

module.exports = { criarClienteHistoricoRelatorio, RE_URL_HISTORICO_PENDENTE };
