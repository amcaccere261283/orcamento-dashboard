'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { montarEquipesRealizado } = require('../tools/semanal/build-dashboard.js');
// Cabeçalhos REAIS do fetcher (7 colunas no roster desde 2026-08-10) -- este
// arquivo tinha cópias locais que ficaram no formato antigo de 3 colunas. As
// linhas de dado abaixo só preenchem IdEquipe,DiaEpoch,Estado de propósito: é
// o que agregarEquipesRealizadoAlocado usa, e parseRosterOnlineCsvBruto trata
// as colunas ausentes como vazias.
const { CABECALHO_ROSTER, CABECALHO_PRODUCAO } = require('../tools/semanal/atualizar-equipes-online.js');

// Fecha a lacuna que a revisão final de branch (2026-08-08) apontou: nenhum
// teste chamava a parte de build-dashboard.js que resolve o SUP de uma linha
// de produção com um Tipo JÁ traduzido pro rótulo da MATRIZ (ex.: "SM / SM.F
// / SR") -- é exatamente por isso que o bug #1 (Tipo bruto do Link 7 nunca
// traduzido) escapou de 14 revisões de task anteriores.
//
// build() de ponta a ponta não é facilmente testável aqui: config.js
// (tools/orcamento/config.js) lê a MATRIZ real de G:\, que só existe na
// máquina do dono do projeto (ver os testes que já pulam com "G: não
// montado" em test/semanal-avancos-online-csv-real.test.js). Por isso este
// teste exercita montarEquipesRealizado -- a função pura que build() usa --
// que é EXATAMENTE o bloco que cruza dist/equipes-roster-online.csv com
// dist/equipes-online.csv e monta demandas.equipesPorDia, sem tocar em
// fs/path nem precisar da MATRIZ real: só texto CSV + um array de registros
// sintético entram.
//
// Atualizado em 2026-08-10: até então este arquivo cobria
// parseEquipesFracaoCsv, que lia equipes-online.csv no formato pré-agregado
// "SUP,Tipo,DiaEpoch,Fracao". Esse formato (e essa função) foram aposentados
// -- o Link 7 agora publica produção CRUA ("IdEquipe,SUP,Tipo,DiaEpoch") e a
// alocação sai do cruzamento com o roster do Link 6.

function registroMinimo(sup, tipologia) {
  return { sup, tipologia };
}

test('linha de produção com Tipo já traduzido ("SM / SM.F / SR") resolve pro SUP real da MATRIZ, não "Diversos"', () => {
  // SUP-0001-24 || "SM / SM.F / SR" existe na MATRIZ sintética -- é o rótulo
  // que rotularTipologia("SM") produz (tools/comum/tipologias-avancos.js),
  // e é o que atualizar-equipes-online.js grava em equipes-online.csv.
  const registros = [registroMinimo('SUP-0001-24', 'SM / SM.F / SR')];
  const rosterCsv = `${CABECALHO_ROSTER}\n441,19000,mobilizada\n`;
  const producaoCsv = `${CABECALHO_PRODUCAO}\n441,SUP-0001-24,SM / SM.F / SR,19000\n`;

  const { equipesPorDia } = montarEquipesRealizado({ rosterCsv, producaoCsv, registros });

  assert.ok(equipesPorDia, 'um par roster+produção válido tem que produzir um mapa, não null');
  assert.deepStrictEqual(Object.keys(equipesPorDia), ['SUP-0001-24||SM / SM.F / SR'], 'a chave tem que ser do SUP real, NUNCA "Diversos||SM / SM.F / SR" -- isso seria o bug #1 voltando (Tipo bruto não traduzido, redirecionado por engano)');
  assert.strictEqual(equipesPorDia['SUP-0001-24||SM / SM.F / SR'][19000], 1);
});

test('Tipo cru (não traduzido, ex.: "SM" solto) não bate com a MATRIZ e cai em "Diversos" -- prova que a tradução PRECISA acontecer antes de chegar no CSV, não é opcional', () => {
  const registros = [registroMinimo('SUP-0001-24', 'SM / SM.F / SR')];
  const rosterCsv = `${CABECALHO_ROSTER}\n441,19000,mobilizada\n`;
  const producaoCsv = `${CABECALHO_PRODUCAO}\n441,SUP-0001-24,SM,19000\n`; // "SM" cru

  const { equipesPorDia } = montarEquipesRealizado({ rosterCsv, producaoCsv, registros });
  assert.deepStrictEqual(Object.keys(equipesPorDia), ['Diversos||SM'], 'confirma o modo de falha do bug #1: Tipo cru não traduzido nunca acha o par na MATRIZ');
});

test('equipe que produziu em dois contratos no mesmo dia divide a fração entre eles, e o mesmo (SUP,Tipo) soma', () => {
  const registros = [registroMinimo('SUP-0001-24', 'SP'), registroMinimo('SUP-0002-24', 'SP')];
  const rosterCsv = `${CABECALHO_ROSTER}\n441,19000,mobilizada\n442,19000,mobilizada\n`;
  const producaoCsv = `${CABECALHO_PRODUCAO}\n`
    + '441,SUP-0001-24,SP,19000\n'
    + '441,SUP-0002-24,SP,19000\n'
    + '442,SUP-0001-24,SP,19000\n';

  const { equipesPorDia } = montarEquipesRealizado({ rosterCsv, producaoCsv, registros });
  // 441 rateia 0,5 + 0,5; 442 dá 1 inteiro em SUP-0001-24.
  assert.strictEqual(equipesPorDia['SUP-0001-24||SP'][19000], 1.5);
  assert.strictEqual(equipesPorDia['SUP-0002-24||SP'][19000], 0.5);
});

test('equipe FORA (férias/baixada) no roster não entra na conta, mesmo com produção no dia', () => {
  const registros = [registroMinimo('SUP-0001-24', 'SP')];
  const rosterCsv = `${CABECALHO_ROSTER}\n441,19000,fora\n`;
  const producaoCsv = `${CABECALHO_PRODUCAO}\n441,SUP-0001-24,SP,19000\n`;

  const { equipesPorDia, ativos } = montarEquipesRealizado({ rosterCsv, producaoCsv, registros });
  assert.strictEqual(ativos, 0);
  assert.strictEqual(equipesPorDia, null, 'sem nenhum par utilizável, build() mantém a fonte de reserva');
});

test('roster sem produção nenhuma devolve equipesPorDia null e conta os dias fora da janela', () => {
  const registros = [registroMinimo('SUP-0001-24', 'SP')];
  const rosterCsv = `${CABECALHO_ROSTER}\n441,19000,mobilizada\n441,19001,campoSemFuro\n`;
  const producaoCsv = `${CABECALHO_PRODUCAO}\n`;

  const { equipesPorDia, ativos, foraDaJanela } = montarEquipesRealizado({ rosterCsv, producaoCsv, registros });
  assert.strictEqual(equipesPorDia, null);
  assert.strictEqual(ativos, 2);
  assert.strictEqual(foraDaJanela, 2);
});

test('CSVs vazios/ausentes não quebram -- devolvem equipesPorDia null', () => {
  const { equipesPorDia } = montarEquipesRealizado({ rosterCsv: null, producaoCsv: null, registros: [] });
  assert.strictEqual(equipesPorDia, null);
});
