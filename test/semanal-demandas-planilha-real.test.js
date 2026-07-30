'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { readXlsxSheet } = require('../tools/comum/xlsx-reader.js');
const { parseAvancos } = require('../tools/semanal/parse-avancos.js');
const { computeDemandas } = require('../tools/semanal/compute-demandas.js');
const config = require('../tools/semanal/config-demandas.js');

// Toda a suíte acima roda sobre fixture sintética, o que prova a LÓGICA mas
// não o MAPEAMENTO: um nome de coluna errado, um status escrito de outro jeito,
// um formato de data diferente do esperado -- tudo isso passaria inteiro. Este
// arquivo é a única prova contra a planilha de verdade, e foi ele que pegou o
// erro de medição que gerou a correção de 2026-07-30 (a coluna Cancelamento é
// texto dd/MM/yyyy, não serial). Por isso ele depende do Drive montado em G:.
//
// Sem G:, PULA em vez de falhar: as outras tarefas deste plano rodam em
// qualquer máquina, e um colaborador sem acesso ao Drive não pode ficar com a
// suíte vermelha (ver docs/onboarding-colaborador.md).
//
// Os números vêm da medição de 2026-07-30, feita com readXlsxSheet -- o leitor
// do próprio repositório, nunca um leitor improvisado. Eles MUDAM quando a
// planilha é atualizada: se este teste falhar depois de uma atualização,
// confira a diferença antes de mexer no número. Ajustar o número para o que
// saiu transforma este arquivo num carimbo.
const TEM_DRIVE = fs.existsSync(config.caminhoArquivo);
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));

test('a planilha real é lida e agregada com os números medidos em 2026-07-30', { skip: TEM_DRIVE ? false : 'G: não montado -- este teste só roda com o Drive disponível' }, () => {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const { furos, descartadas, cancelamentoIlegivel } = parseAvancos(grid);

  assert.strictEqual(descartadas, 1, '1 linha vazia na planilha -- caiu de 21 pra 1 depois de uma edição na planilha em 2026-07-30 15:56 (linhas em branco removidas; todo o resto da agregação abaixo não mudou)');
  assert.strictEqual(furos.length, 61906, 'linhas úteis');
  assert.strictEqual(cancelamentoIlegivel, 0, 'todas as 4.331 canceladas têm data legível');

  const demandas = computeDemandas(furos, PERIODOS_2026);
  const soma = serie => demandas.totais[serie].reduce((a, b) => a + b, 0);

  assert.strictEqual(soma('chegadas'), 16570, 'demandas chegadas em 2026');
  assert.strictEqual(soma('sondagemRealizada'), 15387, 'sondagem realizada em 2026');
  assert.strictEqual(soma('relatorioConcluido'), 14804, 'relatório concluído em 2026');
  assert.strictEqual(soma('canceladas'), 1240, 'cancelamentos OCORRIDOS em 2026, ancorados na coluna P');

  assert.strictEqual(demandas.totais.pendentes[0], 7861, 'saldo de janeiro');
  assert.strictEqual(demandas.totais.pendentes[11], 6176, 'saldo de dezembro');
});

test('a coluna Cancelamento é texto dd/MM/yyyy na planilha real -- o dia em que virar serial, este teste avisa', { skip: TEM_DRIVE ? false : 'G: não montado' }, () => {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const { furos } = parseAvancos(grid);
  const canceladas = furos.filter(f => f.status === 'CANCELADO');
  assert.strictEqual(canceladas.length, 4331);
  assert.strictEqual(canceladas.filter(f => f.cancelamento).length, 4331,
    'se este número cair, a coluna mudou de formato e a série de canceladas encolheu em silêncio');
});

test('nenhuma tipologia crua da planilha real fica fora do mapa', { skip: TEM_DRIVE ? false : 'G: não montado' }, () => {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  // parseAvancos LANÇA em tipologia desconhecida (com o número da linha) --
  // este teste existe para que essa falha apareça como teste vermelho, e não
  // só quando alguém rodar o build.
  assert.doesNotThrow(() => parseAvancos(grid));
});
