'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseEquipesFracaoCsv } = require('../tools/semanal/build-dashboard.js');

// Fecha a lacuna que a revisão final de branch (2026-08-08) apontou: nenhum
// teste chamava a parte de build-dashboard.js que lê equipes-online.csv com
// um Tipo JÁ traduzido pro rótulo da MATRIZ (ex.: "SM / SM.F / SR") -- é
// exatamente por isso que o bug #1 (Tipo bruto do Link 7 nunca traduzido,
// achado na mesma revisão) escapou de 14 revisões de task anteriores: nenhum
// teste de integração exercitava build() (ou a parte relevante dele) com uma
// fixture de equipes-online.csv que tivesse uma linha SM/SM.F/SR/CPTu real.
//
// build() de ponta a ponta não é facilmente testável aqui: config.js
// (tools/orcamento/config.js) lê a MATRIZ real de G:\, que só existe na
// máquina do dono do projeto (ver os testes que já pulam com "G: não
// montado" em test/semanal-avancos-online-csv-real.test.js). Por isso este
// teste exercita parseEquipesFracaoCsv -- a função pura extraída de build()
// nesta mesma rodada de correção -- que é EXATAMENTE o bloco que lê
// equipes-online.csv e monta demandas.equipesPorDia/equipesPeriodo, sem
// tocar em fs/path nem precisar da MATRIZ real: só texto CSV + um array de
// registros sintético entram.

function registroMinimo(sup, tipologia) {
  return { sup, tipologia };
}

test('linha de equipes-online.csv com Tipo já traduzido ("SM / SM.F / SR") resolve pro SUP real da MATRIZ, não "Diversos"', () => {
  // SUP-0001-24 || "SM / SM.F / SR" existe na MATRIZ sintética -- é o rótulo
  // que rotularTipologia("SM") produz (tools/comum/tipologias-avancos.js),
  // e é o que atualizar-equipes-online.js grava em equipes-online.csv desde
  // a correção do bug #1 desta rodada.
  const registros = [registroMinimo('SUP-0001-24', 'SM / SM.F / SR')];
  const csv = 'SUP,Tipo,DiaEpoch,Fracao\n'
    + 'SUP-0001-24,SM / SM.F / SR,19000,1\n';

  const { equipesPorDia, equipesPeriodo } = parseEquipesFracaoCsv(csv, registros);

  assert.ok(equipesPorDia, 'CSV com uma linha válida tem que produzir um mapa, não null');
  const chaves = Object.keys(equipesPorDia);
  assert.deepStrictEqual(chaves, ['SUP-0001-24||SM / SM.F / SR'], 'a chave tem que ser do SUP real, NUNCA "Diversos||SM / SM.F / SR" -- isso seria o bug #1 voltando (Tipo bruto não traduzido, redirecionado por engano)');
  assert.strictEqual(equipesPorDia['SUP-0001-24||SM / SM.F / SR'][19000], 1);
  assert.ok(equipesPeriodo, 'equipesPeriodo tem que vir preenchido junto com equipesPorDia');
});

test('Tipo cru (não traduzido, ex.: "SM" solto) não bate com a MATRIZ e cai em "Diversos" -- prova que a tradução PRECISA acontecer antes de chegar no CSV, não é opcional', () => {
  const registros = [registroMinimo('SUP-0001-24', 'SM / SM.F / SR')];
  const csv = 'SUP,Tipo,DiaEpoch,Fracao\n'
    + 'SUP-0001-24,SM,19000,1\n'; // "SM" cru, sem passar por rotularTipologia

  const { equipesPorDia } = parseEquipesFracaoCsv(csv, registros);
  assert.deepStrictEqual(Object.keys(equipesPorDia), ['Diversos||SM'], 'confirma o modo de falha do bug #1: Tipo cru não traduzido nunca acha o par na MATRIZ');
});

test('duas linhas do mesmo (SUP, Tipo, dia) somam as frações', () => {
  const registros = [registroMinimo('SUP-0001-24', 'SP')];
  const csv = 'SUP,Tipo,DiaEpoch,Fracao\n'
    + 'SUP-0001-24,SP,19000,0.5\n'
    + 'SUP-0001-24,SP,19000,0.5\n';

  const { equipesPorDia } = parseEquipesFracaoCsv(csv, registros);
  assert.strictEqual(equipesPorDia['SUP-0001-24||SP'][19000], 1);
});

test('CSV só com cabeçalho (nenhuma linha de dado) devolve equipesPorDia/equipesPeriodo null -- build() decide manter a fonte de reserva', () => {
  const registros = [registroMinimo('SUP-0001-24', 'SP')];
  const csv = 'SUP,Tipo,DiaEpoch,Fracao\n';

  const { equipesPorDia, equipesPeriodo } = parseEquipesFracaoCsv(csv, registros);
  assert.strictEqual(equipesPorDia, null);
  assert.strictEqual(equipesPeriodo, null);
});

test('equipesPeriodo vem do dia mais antigo encontrado no CSV', () => {
  const registros = [registroMinimo('SUP-0001-24', 'SP')];
  // 19000 = 2022-01-24 (epoch em dias); 19010 é 10 dias depois, mesmo mês.
  const csv = 'SUP,Tipo,DiaEpoch,Fracao\n'
    + 'SUP-0001-24,SP,19010,1\n'
    + 'SUP-0001-24,SP,19000,1\n';

  const { equipesPeriodo } = parseEquipesFracaoCsv(csv, registros);
  const diaMaisAntigo = new Date(19000 * 86400000);
  assert.strictEqual(equipesPeriodo.ano, diaMaisAntigo.getUTCFullYear());
  assert.strictEqual(equipesPeriodo.mes, diaMaisAntigo.getUTCMonth() + 1);
});
