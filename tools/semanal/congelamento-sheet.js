'use strict';

// Cliente do Apps Script do congelamento. Espelha o papel de
// alocacao-sheet.js, com duas diferenças: manda um token derivado da senha em
// toda chamada, e NUNCA tem modo local -- congelar é um ato compartilhado, uma
// cópia em localStorage só enganaria quem clicasse.
//
// Toda falha de leitura vira null. O Consolidado trata null como "sem
// congelado" e cai no recálculo com rótulo "recalculada" -- degradar é sempre
// melhor que quebrar a página.
function criarClienteCongelamento(opcoes) {
  var o = opcoes || {};
  var url = String(o.url || '');
  var buscar = o.fetch;
  var token = String(o.token || '');

  function porRegistroDasLinhas(linhas) {
    var porRegistro = {};
    linhas.forEach(function (linha) {
      porRegistro[linha.chaveMatriz] = {
        volume: { tendencia: linha.volume },
        financeiro: { tendencia: linha.financeiro },
        equipe: { tendencia: linha.equipe },
        produtividadeMedia: { tendencia: linha.produtividadeMedia },
      };
    });
    return porRegistro;
  }

  return {
    carregar: async function (chaveSemana) {
      if (!url || !buscar) return null;
      try {
        var resposta = await buscar(url + '?semana=' + encodeURIComponent(chaveSemana) + '&token=' + encodeURIComponent(token));
        var corpo = await resposta.json();
        if (!corpo || corpo.erro || !corpo.linhas || !corpo.linhas.length) return null;
        return {
          porRegistro: porRegistroDasLinhas(corpo.linhas),
          autor: corpo.linhas[0].autor || '',
          congeladoEm: corpo.linhas[0].congeladoEm || '',
        };
      } catch (err) {
        return null;
      }
    },

    congelar: async function (snapshot, autor) {
      if (!url || !buscar) return { ok: false, motivo: 'rede' };
      try {
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            token: token, chaveSegunda: snapshot.chaveSegunda, autor: autor || 'dashboard',
            congeladoEm: new Date().toISOString(), linhas: snapshot.linhas,
          }),
        });
        var corpo = await resposta.json();
        if (corpo && corpo.ok) return { ok: true };
        return { ok: false, motivo: (corpo && corpo.erro) || 'rede', autor: corpo && corpo.autor, congeladoEm: corpo && corpo.congeladoEm };
      } catch (err) {
        return { ok: false, motivo: 'rede' };
      }
    },
  };
}

module.exports = { criarClienteCongelamento };
