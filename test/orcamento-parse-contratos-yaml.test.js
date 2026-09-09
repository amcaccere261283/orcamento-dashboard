'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseContratosYaml, lerContratos } = require('../tools/orcamento/parse-contratos-yaml.js');

test('parseContratosYaml parses a minimal YAML with one contract (quoted cliente)', () => {
  const yaml = `contratos:
  - slug: ccr-autoban-ab
    cliente: "CCR AUTOBAN"
    numero_contrato: "SUP-8224-25 (AB)"
    contrato_id: 1190
    ativo: true
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].cliente, 'CCR AUTOBAN');
  assert.equal(contratos[0].numeroContrato, 'SUP-8224-25 (AB)');
  assert.equal(contratos[0].contratoId, 1190);
  assert.equal(contratos[0].ativo, true);
});

test('parseContratosYaml handles unquoted strings', () => {
  const yaml = `contratos:
  - slug: test-contract
    cliente: CCR UNQUOTED
    numero_contrato: SUP-1234-56
    contrato_id: 999
    ativo: true
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].cliente, 'CCR UNQUOTED');
  assert.equal(contratos[0].numeroContrato, 'SUP-1234-56');
});

test('parseContratosYaml handles boolean false', () => {
  const yaml = `contratos:
  - slug: inactive-contract
    cliente: "INACTIVE CORP"
    numero_contrato: "SUP-0000-00"
    contrato_id: 0
    ativo: false
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].ativo, false);
});

test('parseContratosYaml defaults ativo to true when missing', () => {
  const yaml = `contratos:
  - slug: no-ativo-field
    cliente: "NO ATIVO CORP"
    numero_contrato: "SUP-1111-11"
    contrato_id: 1111
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].ativo, true);
});

test('parseContratosYaml ignores optional fields like pasta_drive_reports', () => {
  const yaml = `contratos:
  - slug: with-pasta
    cliente: "CCR WITH PASTA"
    numero_contrato: "SUP-2222-22"
    contrato_id: 2222
    vigencia_inicio: "08/12/2025"
    vigencia_fim: "05/06/2029"
    pasta_drive_reports: "01 - Araucária"
    ativo: true
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].cliente, 'CCR WITH PASTA');
  assert.equal(contratos[0].contratoId, 2222);
});

test('parseContratosYaml parses multiple contracts', () => {
  const yaml = `contratos:
  - slug: contract-1
    cliente: "CLIENT A"
    numero_contrato: "SUP-1111-11"
    contrato_id: 111
    ativo: true

  - slug: contract-2
    cliente: "CLIENT B"
    numero_contrato: "SUP-2222-22"
    contrato_id: 222
    ativo: true

  - slug: contract-3
    cliente: "CLIENT C"
    numero_contrato: "SUP-3333-33"
    contrato_id: 333
    ativo: false
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 3);
  assert.equal(contratos[0].cliente, 'CLIENT A');
  assert.equal(contratos[0].contratoId, 111);
  assert.equal(contratos[1].cliente, 'CLIENT B');
  assert.equal(contratos[1].contratoId, 222);
  assert.equal(contratos[2].cliente, 'CLIENT C');
  assert.equal(contratos[2].contratoId, 333);
  assert.equal(contratos[2].ativo, false);
});

test('parseContratosYaml ignores comments', () => {
  const yaml = `contratos:
  # This is a comment
  - slug: contract-with-comment
    cliente: "CLIENT COMMENTED"
    numero_contrato: "SUP-4444-44"  # inline comment
    contrato_id: 444
    ativo: true  # another comment
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].cliente, 'CLIENT COMMENTED');
  assert.equal(contratos[0].numeroContrato, 'SUP-4444-44');
});

test('parseContratosYaml handles blank lines gracefully', () => {
  const yaml = `contratos:

  - slug: contract-with-blanks
    cliente: "CLIENT BLANK"

    numero_contrato: "SUP-5555-55"
    contrato_id: 555

    ativo: true

`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].cliente, 'CLIENT BLANK');
  assert.equal(contratos[0].contratoId, 555);
});

test('parseContratosYaml handles mixed quoted/unquoted in same YAML', () => {
  const yaml = `contratos:
  - slug: mixed-quotes
    cliente: "QUOTED CLIENT"
    numero_contrato: UNQUOTED-SUP-6666-66
    contrato_id: 666
    ativo: true
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].cliente, 'QUOTED CLIENT');
  assert.equal(contratos[0].numeroContrato, 'UNQUOTED-SUP-6666-66');
});

test('parseContratosYaml extracts only required fields, ignoring unknown ones', () => {
  const yaml = `contratos:
  - slug: contract-full
    cliente: "FULL CLIENT"
    numero_contrato: "SUP-7777-77"
    numero_contrato_cliente: "4600089828"
    contrato_id: 777
    vigencia_inicio: "08/12/2025"
    vigencia_fim: "05/06/2029"
    valor_contrato: "R$ 935.186,25"
    volumetria_contratada: "20 sondagens"
    pasta_drive_reports: "15 - Sorocabana"
    ativo: true
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  const c = contratos[0];
  assert.equal(c.cliente, 'FULL CLIENT');
  assert.equal(c.numeroContrato, 'SUP-7777-77');
  assert.equal(c.contratoId, 777);
  assert.equal(c.ativo, true);
  // Verify that only the 4 required fields are present
  assert.deepEqual(Object.keys(c).sort(), ['ativo', 'cliente', 'contratoId', 'numeroContrato']);
});

test('parseContratosYaml filters out entries with missing cliente, contrato_id ou numero_contrato', () => {
  const yaml = `contratos:
  - slug: contract-ok
    cliente: "OK CLIENT"
    numero_contrato: "SUP-8888-88"
    contrato_id: 888
    ativo: true

  - slug: contract-no-cliente
    numero_contrato: "SUP-9999-99"
    contrato_id: 999
    ativo: true

  - slug: contract-no-id
    cliente: "NO ID CLIENT"
    numero_contrato: "SUP-0000-00"
    ativo: true

  - slug: contract-no-numero-contrato
    cliente: "NO NUMERO CLIENT"
    contrato_id: 777
    ativo: true
`;
  const contratos = parseContratosYaml(yaml);
  assert.equal(contratos.length, 1);
  assert.equal(contratos[0].cliente, 'OK CLIENT');
  assert.equal(contratos[0].contratoId, 888);
});

// Fix 4 (revisão final de branch): numero_contrato é a chave de join usada
// por todo o funil (chaveMatriz casa registro.sup com numero_contrato) --
// faltando, virava undefined, fluía em silêncio pro CSV como célula vazia e
// produzia uma linha do funil chaveada tipo "||SP" sem nenhum aviso. Este
// teste isola esse caso (cliente e contrato_id presentes, só numero_contrato
// faltando) pra provar que agora é rejeitado, com o mesmo aviso das outras
// ausências.
test('parseContratosYaml rejeita entrada com cliente e contrato_id mas SEM numero_contrato', () => {
  const yaml = `contratos:
  - slug: contract-sem-numero
    cliente: "CLIENTE SEM NUMERO"
    contrato_id: 4242
    ativo: true
`;
  const avisos = [];
  const warnOriginal = console.warn;
  console.warn = (...args) => avisos.push(args.join(' '));
  try {
    const contratos = parseContratosYaml(yaml);
    assert.deepEqual(contratos, [], 'entrada sem numero_contrato deve ser descartada, não passar undefined adiante');
    assert.ok(avisos.some(m => /incompleto descartado/.test(m)), 'deve avisar sobre o contrato incompleto descartado');
  } finally {
    console.warn = warnOriginal;
  }
});

test('lerContratos reads and parses a file from disk', () => {
  const testYaml = `contratos:
  - slug: file-test
    cliente: "FILE CLIENT"
    numero_contrato: "SUP-XXXX-XX"
    contrato_id: 5555
    ativo: true
`;
  const tmpFile = path.join(__dirname, '..', '.test-temp-contratos.yaml');
  try {
    fs.writeFileSync(tmpFile, testYaml, 'utf8');
    const contratos = lerContratos(tmpFile);
    assert.equal(contratos.length, 1);
    assert.equal(contratos[0].cliente, 'FILE CLIENT');
    assert.equal(contratos[0].contratoId, 5555);
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
});

test('lerContratos on real contratos.yaml file (if present)', () => {
  // Smoke test: if the real sibling file exists, parse it without throwing
  // and verify we get at least one contract with numeric contratoId.
  // Skip gracefully if not present (CI/other machines won't have sibling repo).
  const realFile = path.resolve(__dirname, '../../../extrato-gerencial-mensal/contratos.yaml');
  if (!fs.existsSync(realFile)) {
    // File not present on this machine -- skip this test
    return;
  }
  const contratos = lerContratos(realFile);
  assert(contratos.length > 0, 'Expected at least one contract from real file');
  const firstContrato = contratos[0];
  assert(typeof firstContrato.cliente === 'string');
  assert(typeof firstContrato.contratoId === 'number');
  assert(typeof firstContrato.ativo === 'boolean');
});
