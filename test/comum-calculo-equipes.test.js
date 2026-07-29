'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mediaEquipesPonderada, somarIntervaloEquipeDias, DIAS_PREMISSA_MES, trechosParaCliente, fonteParaCliente } = require('../tools/comum/calculo-equipes.js');

const MODULO = path.join(__dirname, '..', 'tools', 'comum', 'calculo-equipes.js');

test('um único mês devolve o próprio valor do mês', () => {
  const mensal = [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.strictEqual(mediaEquipesPonderada(mensal, 1, 2), 2);
});

test('vários meses fazem média ponderada por dias, não soma', () => {
  const mensal = new Array(12).fill(0);
  mensal[0] = 2; mensal[1] = 4;
  const esperado = (2 * DIAS_PREMISSA_MES[0] + 4 * DIAS_PREMISSA_MES[1])
                 / (DIAS_PREMISSA_MES[0] + DIAS_PREMISSA_MES[1]);
  assert.strictEqual(mediaEquipesPonderada(mensal, 0, 2), esperado);
  assert.ok(mediaEquipesPonderada(mensal, 0, 2) < 6, 'não pode ser a soma');
});

test('meses sem dado não entram no denominador', () => {
  const mensal = new Array(12).fill(null);
  mensal[3] = 5;
  assert.strictEqual(mediaEquipesPonderada(mensal, 0, 12), 5);
});

test('intervalo totalmente vazio devolve null', () => {
  assert.strictEqual(mediaEquipesPonderada(new Array(12).fill(null), 0, 12), null);
});

test('equipe-dias soma, ao contrário da média', () => {
  const mensal = new Array(12).fill(0);
  mensal[0] = 1;
  assert.strictEqual(somarIntervaloEquipeDias(mensal, 0, 1), DIAS_PREMISSA_MES[0]);
});

// O texto recortado é inlinado num <script> cujo resto nasce de template
// literal, e a linguagem normaliza a quebra de linha do literal pra \n mesmo
// com o .js em CRLF no disco -- fs.readFileSync não normaliza. Sem o replace
// em trechosParaCliente(), um checkout Windows (core.autocrlf=true) publica
// um HTML e um checkout Linux publica outro.
//
// O golden é CEGO pra isso de propósito: normalizarVolatil faz
// .replace(/\r\n/g,'\n') porque line ending É uma diferença legítima entre
// builds. Confirmado: com o replace removido e o módulo em CRLF, os 5 testes
// de orcamento-html-inalterado.test.js passam mesmo assim. Daí estes dois
// testes -- são a única rede que segura o replace.
test('o recorte não devolve CR nenhum', () => {
  assert.doesNotMatch(fonteParaCliente(), /\r/);
  trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
});

// O teste acima sozinho passa de graça onde o módulo já está em LF no disco
// (Linux, e esta máquina enquanto o git não reescreve o arquivo) -- ou seja,
// não pegaria a regressão justamente no clone em que ela nasce. Este aqui
// materializa a condição: carrega uma cópia do módulo gravada em CRLF e cobra
// a mesma saída limpa, independente de como o repositório foi clonado.
test('o recorte não devolve CR nem com o módulo em CRLF no disco (clone Windows)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calculo-equipes-crlf-'));
  const copia = path.join(dir, 'calculo-equipes.js');
  try {
    fs.writeFileSync(copia, fs.readFileSync(MODULO, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    // Sem isto o teste viraria vácuo caso a cópia deixasse de ser CRLF.
    assert.match(fs.readFileSync(copia, 'utf8'), /\r\n/, 'a cópia precisava estar em CRLF');

    const emCRLF = require(copia);
    assert.doesNotMatch(emCRLF.fonteParaCliente(), /\r/);
    emCRLF.trechosParaCliente().forEach((trecho, i) => assert.doesNotMatch(trecho, /\r/, `trecho ${i} tem CR`));
    // E o texto tem que ser o MESMO do módulo em LF, não só livre de CR.
    assert.strictEqual(emCRLF.fonteParaCliente(), fonteParaCliente());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// fonteParaCliente() é o contrato declarado pras Tasks 6, 9 e 10, e é a única
// parte dele que ninguém chama ainda: o orçamento consome trechosParaCliente().
// Aqui ele é exercitado do jeito que uma página nova vai usar -- avaliado como
// texto, no navegador -- pra provar que o bloco é auto-suficiente, que
// DIAS_PREMISSA_MES vem antes das funções que dependem dele e que a semântica
// é a mesma que o Node testa nos exports.
test('fonteParaCliente() avalia para as três definições, na ordem, com a semântica dos exports', () => {
  const fonte = fonteParaCliente();

  assert.strictEqual((fonte.match(/var DIAS_PREMISSA_MES/g) || []).length, 1);
  assert.deepStrictEqual(fonte.match(/^function \w+/gm), ['function mediaEquipesPonderada', 'function somarIntervaloEquipeDias']);
  assert.ok(fonte.indexOf('var DIAS_PREMISSA_MES') < fonte.indexOf('function mediaEquipesPonderada'),
    'DIAS_PREMISSA_MES precisa vir antes de quem o usa');

  const cliente = new Function(`${fonte}
return { DIAS_PREMISSA_MES: DIAS_PREMISSA_MES, mediaEquipesPonderada: mediaEquipesPonderada, somarIntervaloEquipeDias: somarIntervaloEquipeDias };`)();

  assert.deepStrictEqual(cliente.DIAS_PREMISSA_MES, DIAS_PREMISSA_MES);

  const casos = [
    [[0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 2],
    [[2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0, 2],
    [[null, null, null, 5, null, null, null, null, null, null, null, null], 0, 12],
    [new Array(12).fill(null), 0, 12],
    [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 0, 12],
  ];
  casos.forEach(([mensal, inicio, fim]) => {
    const rotulo = `${JSON.stringify(mensal)} [${inicio}, ${fim})`;
    assert.strictEqual(cliente.mediaEquipesPonderada(mensal, inicio, fim), mediaEquipesPonderada(mensal, inicio, fim), `média ${rotulo}`);
    assert.strictEqual(cliente.somarIntervaloEquipeDias(mensal, inicio, fim), somarIntervaloEquipeDias(mensal, inicio, fim), `equipe-dias ${rotulo}`);
  });
});
