'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { readXlsxSheet } = require('../tools/comum/xlsx-reader.js');
const { parseLab } = require('../tools/semanal/parse-lab.js');
const config = require('../tools/semanal/config-lab.js');

// Mesmo raciocínio de test/semanal-demandas-planilha-real.test.js: a suíte
// sintética prova a LÓGICA, não o MAPEAMENTO -- um "Tipo de Ensaio" real que
// não bate com nenhuma linha do mapa (tools/comum/tipologias-lab.js), ou um
// nome de coluna diferente do esperado, passariam inteiro pela suíte
// sintética. Este arquivo é a única prova contra a planilha de verdade, e
// por isso depende do Drive montado em G:.
//
// Sem G:, PULA em vez de falhar -- mesmo contrato do arquivo irmão.
//
// Os números vêm da medição de 2026-07-31, feita com readXlsxSheet -- o
// leitor do próprio repositório, nunca um leitor improvisado. Eles MUDAM
// quando a planilha é atualizada: se este teste falhar depois de uma
// atualização, confira a diferença antes de mexer no número.
const TEM_DRIVE = fs.existsSync(config.caminhoArquivo);

test('a aba Lab Concluido é lida e classificada com os números medidos em 2026-07-31', { skip: TEM_DRIVE ? false : 'G: não montado -- este teste só roda com o Drive disponível' }, () => {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  const { ensaios, descartadas } = parseLab(grid);

  assert.strictEqual(descartadas, 176, '176 linhas com SUP = "TESTE" (lixo de planilha)');
  assert.strictEqual(ensaios.length, 98330, 'ensaios úteis');

  const labC = ensaios.filter(e => e.tipologia === 'LAB.C').length;
  const labE = ensaios.filter(e => e.tipologia === 'LAB.E').length;
  assert.strictEqual(labC, 87379, 'Convencional');
  assert.strictEqual(labE, 10951, 'Especial');
  assert.strictEqual(labC + labE, ensaios.length, 'todo ensaio cai em LAB.C ou LAB.E, nenhum fica de fora');

  assert.strictEqual(ensaios.filter(e => e.concluido === null).length, 0, 'nenhum ensaio sem data de conclusão legível');
});

test('nenhum "Tipo de Ensaio" cru da planilha real fica fora do mapa', { skip: TEM_DRIVE ? false : 'G: não montado' }, () => {
  const grid = readXlsxSheet(config.caminhoArquivo, config.nomeAba);
  // parseLab LANÇA em Tipo de Ensaio desconhecido (com o número da linha) --
  // este teste existe pra essa falha aparecer como teste vermelho, e não só
  // quando alguém rodar o build.
  assert.doesNotThrow(() => parseLab(grid));
});
