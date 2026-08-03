'use strict';
const { parseCsvGrid } = require('./parse-matriz-cliente.js');
const { classificarDiaEquipe, contaComoAtiva } = require('./classificar-dia-equipe.js');

// Este módulo roda tanto no Node (build/testes) quanto embrulhado no navegador
// via buildBrowserBundle -- por isso 'var'/'function', não 'const'/arrow, e os
// requires acima na forma EXATA que a reescrita de browser-bundle.js reconhece
// (mesmo diretório, './arquivo.js').
//
// EQUIPES ATIVAS por (SUP, tipologia) e por dia
// ============================================================================
// Fonte: a aba EQ da planilha de equipes (uma linha por equipe, uma coluna por
// dia do mês). Ver docs/superpowers/specs/2026-08-03-equipes-ativas-design.md
// para o desenho completo e os números que sustentam cada decisão.
//
// Ativa = em campo, produzindo ou não, excluindo férias/baixada -- decisão do
// dono do projeto (2026-08-03). Quem classifica cada dia é
// classificar-dia-equipe.js; aqui a questão é OUTRA: a que (SUP, tipologia)
// aquele equipe-dia pertence.

// Cabeçalho de coluna de dia, em DOIS formatos, e os dois são reais:
//
//   "1-Aug", "15-Jul"   -- como está na planilha de equipes. A planilha mistura
//                          português e inglês de um mês para o outro (mesmo
//                          achado de tools/matriz/parse-eq.js), por isso o DIA
//                          sai do número capturado, nunca da comparação do mês.
//   "01/08/2026"        -- como sai da Sheet ESPELHO publicada. O Apps Script
//                          copia valores (getValues), então o cabeçalho de data
//                          chega como data de verdade e o CSV a serializa por
//                          extenso. Descoberto ao ligar a URL publicada em
//                          2026-08-03: sem este segundo formato, nenhuma coluna
//                          de dia era reconhecida no live-refresh e a página
//                          simplesmente ficaria sem equipes -- silenciosamente,
//                          porque uma equipe sem dias vira uma equipe sem
//                          nenhum equipe-dia, não um erro.
//
// Em ambos o dia é o PRIMEIRO número, então uma captura só resolve os dois.
var RE_COLUNA_DIA = /^\s*(\d{1,2})(?:-[A-Za-zÀ-ÿ]{3,4}|\/\d{1,2}\/\d{4})\s*$/;

var COL_ID = 0;
var COL_NOME = 1;
var COL_SERVICOS = 3;

// csvTexto -> [{ id, nome, servicos, dias: [{ dia, texto }] }]
function parseAbaEq(csvTexto) {
  var grid = parseCsvGrid(csvTexto || '');
  var cabecalho = grid[0] || [];
  var colunasDia = [];
  cabecalho.forEach(function (celula, indice) {
    var achou = RE_COLUNA_DIA.exec(String(celula === null || celula === undefined ? '' : celula).trim());
    if (achou) colunasDia.push({ indice: indice, dia: Number(achou[1]) });
  });

  var equipes = [];
  // Linha 0 é o cabeçalho e a 1 é um sub-cabeçalho ("do condutor", "-", ...)
  // -- mesma estrutura que tools/matriz/parse-eq.js já pressupõe.
  for (var r = 2; r < grid.length; r++) {
    var linha = grid[r] || [];
    var id = String(linha[COL_ID] === null || linha[COL_ID] === undefined ? '' : linha[COL_ID]).trim();
    if (!id) continue;
    equipes.push({
      id: id,
      nome: String(linha[COL_NOME] || '').trim(),
      servicos: String(linha[COL_SERVICOS] || '').trim(),
      dias: colunasDia.map(function (c) {
        return { dia: c.dia, texto: String(linha[c.indice] || '').trim() };
      }),
    });
  }
  return equipes;
}

// Normaliza nome de pessoa para comparação: sem acento, minúsculo, sem
// pontuação, sem preposições e sem sufixos de geração.
//
// Existe porque a aba EQ escreve o líder curto ("Lucas Oliveira", "Edy Itallo")
// e o Avanço Sond escreve o nome completo ("Lucas de Oliveira Silva", "Edy
// Itallo Fernandes Gomes"). Casar por igualdade não funcionaria em nenhum dos
// dois; casar por prefixo falharia em "Lucas Oliveira" x "Lucas de Oliveira
// Silva", por causa do "de" no meio.
var PALAVRAS_IGNORADAS = ['de', 'da', 'do', 'das', 'dos', 'e', 'filho', 'junior', 'jr', 'neto'];
function tokensDoNome(nome) {
  return String(nome === null || nome === undefined ? '' : nome)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(function (t) { return t && PALAVRAS_IGNORADAS.indexOf(t) === -1; });
}

// Acha o sondador cujo nome CONTÉM todos os tokens do nome do líder. Devolve
// null quando não acha, e null também quando acha MAIS DE UM -- "Carlos
// Junior" casa com 4 sondadores diferentes, e escolher um seria inventar.
//
// Medido em agosto/2026: das 117 equipes, 86 casam com exatamente um sondador,
// 25 não casam com nenhum e 6 são ambíguas.
function casarSondador(nomeLider, nomesSondadores) {
  var alvo = tokensDoNome(nomeLider);
  if (!alvo.length) return null;
  var achados = [];
  (nomesSondadores || []).forEach(function (nome) {
    var tokens = tokensDoNome(nome);
    var contemTodos = alvo.every(function (t) { return tokens.indexOf(t) !== -1; });
    if (contemTodos) achados.push(nome);
  });
  return achados.length === 1 ? achados[0] : null;
}

// Regras de tipologia da coluna "Serviços" -- decisões do dono do projeto em
// 2026-08-03. Valor simples ("SM", "SP", "ST") vale por si.
//
// SEG.A/SEG.V são SEGURANÇA e nunca Especiais: correção explícita dele, para
// que o balde "Especiais" não vire depósito de tudo que não é sondagem comum.
var TIPOLOGIA_DIRETA = {
  'CPTu | VT | SH': 'Especiais',
  'SP/SM': 'SP',
  'SEG.A': 'SEG.A',
  'SEG.V': 'SEG.V',
  Lab: null,   // laboratório não entra no Balanço por SUP de sondagem
  TST: null,
  SN: null,
};

// servicos -> tipologia única, ou null quando depende do cruzamento por
// sondador ("ST | PI | BL") ou quando a equipe não entra no Balanço.
function tipologiaDireta(servicos) {
  var s = String(servicos === null || servicos === undefined ? '' : servicos).trim();
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(TIPOLOGIA_DIRETA, s)) return TIPOLOGIA_DIRETA[s];
  // Valor simples (sem separador) é a própria tipologia.
  if (!/[|/]/.test(s)) return s;
  return null;
}

// Agrega o equipe-dia ATIVO por (SUP, tipologia) e por dia.
//
// entradas:
//   equipes        -- de parseAbaEq
//   ano, mes       -- do calendário daquela aba (mes 1..12); o dia da coluna
//                     mais os dois viram dia-desde-época
//   osParaSup      -- { '17851-26': 'SUP-7128-24' }, do Avanço Sond. Medido:
//                     1.960 de 1.960 OS resolvem para UM SUP.
//   tipologiaPorSondador -- { 'Lucas de Oliveira Silva': 'ST' }, para as
//                     equipes cuja coluna Serviços é múltipla ("ST | PI | BL")
//   nomesSondadores -- lista para casarSondador
//
// APROPRIAÇÃO AO SUP: a OS na célula do dia diz o contrato. Nos dias ativos sem
// OS (mobilização, chuva, veículo quebrado), vale a ÚLTIMA OS vista daquela
// equipe -- o vínculo não se rompe porque a equipe passou um dia sem furar. Uma
// equipe que nunca teve OS no mês entra em naoApropriadas, visível, nunca
// rateada em silêncio entre contratos.
//
// Devolve { porDia, naoApropriadas, semTipologia, diasPorEstado }.
function agregarEquipesAtivas(opcoes) {
  var o = opcoes || {};
  var equipes = o.equipes || [];
  var osParaSup = o.osParaSup || {};
  var tipologiaPorSondador = o.tipologiaPorSondador || {};
  var nomesSondadores = o.nomesSondadores || [];
  var ano = o.ano;
  var mes = o.mes;

  var porDia = {};
  var naoApropriadas = 0;
  var semTipologia = 0;
  var diasPorEstado = { mobilizada: 0, campoSemFuro: 0, fora: 0, naoEquipe: 0 };
  var textosNoDefault = {};

  equipes.forEach(function (equipe) {
    var tipologia = tipologiaDireta(equipe.servicos);
    if (!tipologia) {
      // Múltipla ("ST | PI | BL"): a tipologia sai dos furos do sondador que
      // lidera a equipe -- ver casarSondador.
      var sondador = casarSondador(equipe.nome, nomesSondadores);
      if (sondador) tipologia = tipologiaPorSondador[sondador] || null;
    }

    var ultimoSup = null;
    equipe.dias.forEach(function (d) {
      var classe = classificarDiaEquipe(d.texto);
      if (!classe) return;
      diasPorEstado[classe.estado] += 1;
      if (classe.noDefault) textosNoDefault[d.texto] = (textosNoDefault[d.texto] || 0) + 1;
      if (!contaComoAtiva(classe.estado)) return;

      // A OS atualiza o vínculo mesmo quando a tipologia é desconhecida: se a
      // equipe voltar a ser identificável depois, o SUP já está em mãos.
      if (classe.os && osParaSup[classe.os]) ultimoSup = osParaSup[classe.os];

      if (!tipologia) { semTipologia += 1; return; }
      if (!ultimoSup) { naoApropriadas += 1; return; }

      var chave = ultimoSup + '||' + tipologia;
      var diaEpoch = Math.floor(Date.UTC(ano, mes - 1, d.dia) / 86400000);
      if (!porDia[chave]) porDia[chave] = {};
      porDia[chave][diaEpoch] = (porDia[chave][diaEpoch] || 0) + 1;
    });
  });

  return {
    porDia: porDia,
    naoApropriadas: naoApropriadas,
    semTipologia: semTipologia,
    diasPorEstado: diasPorEstado,
    textosNoDefault: textosNoDefault,
  };
}

// Junta o porDia de vários meses num mapa só (o Balanço pergunta por período,
// que pode cobrir o ano inteiro em "Acumulado até o mês").
function juntarPorDia(mapas) {
  var saida = {};
  (mapas || []).forEach(function (mapa) {
    Object.keys(mapa || {}).forEach(function (chave) {
      if (!saida[chave]) saida[chave] = {};
      Object.keys(mapa[chave]).forEach(function (dia) {
        saida[chave][dia] = (saida[chave][dia] || 0) + mapa[chave][dia];
      });
    });
  });
  return saida;
}

module.exports = {
  parseAbaEq, tokensDoNome, casarSondador, tipologiaDireta,
  agregarEquipesAtivas, juntarPorDia,
  RE_COLUNA_DIA, TIPOLOGIA_DIRETA,
};
