'use strict';

// Cliente do Apps Script do congelamento. Espelha o papel de
// alocacao-sheet.js, com duas diferenças: manda um token derivado da senha em
// toda chamada, e NUNCA tem modo local -- congelar é um ato compartilhado, uma
// cópia em localStorage só enganaria quem clicasse.
//
// Nenhuma falha de leitura LANÇA -- degradar é sempre melhor que quebrar a
// página. Mas os três casos são DISTINGUÍVEIS, e isso importa: `null` significa
// só "esta semana nunca foi congelada"; `{ motivo: 'token' }` e
// `{ motivo: 'rede' }` significam que existe (ou pode existir) um congelamento
// que não conseguimos ler. Colapsar os três em null fazia uma senha rotacionada
// sem atualizar a Script Property TOKEN_DASHBOARD virar "recalculada" na tela,
// tecnicamente honesto e escondendo que há um congelamento inacessível.
// O chamador cai no recálculo nos três casos -- só o aviso muda.
//
// A LEITURA é POST, não GET: o token viajava na query string, onde aparece nos
// logs de execução do Apps Script e em qualquer registro de requisição, e um
// token vazado permite recuperar a senha do dashboard.
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
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ acao: 'ler', token: token, semana: chaveSemana }),
        });
        var corpo = await resposta.json();
        if (!corpo) return { motivo: 'rede' };
        if (corpo.erro) return { motivo: corpo.erro === 'token' ? 'token' : 'rede' };
        if (!corpo.linhas || !corpo.linhas.length) return null;
        return {
          porRegistro: porRegistroDasLinhas(corpo.linhas),
          autor: corpo.linhas[0].autor || '',
          congeladoEm: corpo.linhas[0].congeladoEm || '',
        };
      } catch (err) {
        return { motivo: 'rede' };
      }
    },

    congelar: async function (snapshot, autor) {
      if (!url || !buscar) return { ok: false, motivo: 'rede' };
      try {
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            acao: 'congelar',
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

    desfazer: async function (chaves) {
      if (!url || !buscar) return { ok: false, motivo: 'rede' };
      try {
        var resposta = await buscar(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ token: token, acao: 'desfazer', chaves: chaves }),
        });
        var corpo = await resposta.json();
        if (corpo && corpo.ok) return { ok: true, apagadas: corpo.apagadas };
        return { ok: false, motivo: (corpo && corpo.erro) || 'rede' };
      } catch (err) {
        return { ok: false, motivo: 'rede' };
      }
    },
  };
}

module.exports = { criarClienteCongelamento };
