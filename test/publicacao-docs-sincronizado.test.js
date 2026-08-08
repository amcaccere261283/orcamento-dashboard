'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// O GitHub Pages deste repositório serve `master:/docs`, e NADA copia dist/
// para docs/ automaticamente -- os builds só escrevem em dist/. Em
// 2026-07-22 esse passo foi esquecido: o build do Pages reportou "built"
// (ele publica o que estiver em /docs, tenha dist/ mudado ou não), dando
// falsa confiança, e o site ficou dois commits atrasado. O CLAUDE.md
// registra o incidente e a regra; este arquivo é a rede automatizada que
// faltava, e a spec pede explicitamente para a página nova
// ("docs/planejamento-semanal.html fica idêntica a
// dist/planejamento-semanal.html").
//
// Comparação BYTE A BYTE, sem normalização nenhuma: `cp` é o passo
// documentado, então qualquer diferença -- inclusive só de fim de linha --
// significa que os dois arquivos não saíram da mesma cópia.
//
// Os dois pares são checados de forma independente. Se um par ainda não
// existe neste worktree (a página semanal só é construída na tarefa de
// publicação, e o build exige as planilhas em G:\ mais a senha), o teste
// PULA com a razão explícita -- não reprova por ausência, que transformaria
// "ainda não construí" em "quebrei alguma coisa".

const RAIZ = path.join(__dirname, '..');

const PARES = [
  {
    nome: 'dashboard de orçamento',
    origem: path.join(RAIZ, 'dist', 'orcamento-dashboard.html'),
    publicado: path.join(RAIZ, 'docs', 'index.html'),
    comando: 'cp dist/orcamento-dashboard.html docs/index.html',
  },
  {
    nome: 'planejamento semanal',
    origem: path.join(RAIZ, 'dist', 'planejamento-semanal.html'),
    publicado: path.join(RAIZ, 'docs', 'planejamento-semanal.html'),
    comando: 'cp dist/planejamento-semanal.html docs/planejamento-semanal.html',
  },
  {
    nome: 'CSV combinado de Avanços',
    origem: path.join(RAIZ, 'dist', 'avancos-online.csv'),
    publicado: path.join(RAIZ, 'docs', 'avancos-online.csv'),
    comando: 'cp dist/avancos-online.csv docs/avancos-online.csv',
  },
  {
    nome: 'CSV de Lab Realizado',
    origem: path.join(RAIZ, 'dist', 'lab-online.csv'),
    publicado: path.join(RAIZ, 'docs', 'lab-online.csv'),
    comando: 'cp dist/lab-online.csv docs/lab-online.csv',
  },
  {
    nome: 'CSV de Equipes',
    origem: path.join(RAIZ, 'dist', 'equipes-online.csv'),
    publicado: path.join(RAIZ, 'docs', 'equipes-online.csv'),
    comando: 'cp dist/equipes-online.csv docs/equipes-online.csv',
  },
];

function relativo(p) {
  return path.relative(RAIZ, p).split(path.sep).join('/');
}

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

for (const par of PARES) {
  test(`o HTML publicado em docs/ é byte a byte o de dist/ -- ${par.nome}`, (t) => {
    const faltando = [par.origem, par.publicado].filter(p => !fs.existsSync(p)).map(relativo);
    if (faltando.length) {
      t.skip(`ainda não existe neste worktree: ${faltando.join(', ')}. Assim que o build rodar, este teste passa a valer -- rode \`${par.comando}\` antes de commitar.`);
      return;
    }

    const origem = fs.readFileSync(par.origem);
    const publicado = fs.readFileSync(par.publicado);

    assert.ok(
      origem.equals(publicado),
      `${relativo(par.publicado)} está DESSINCRONIZADO de ${relativo(par.origem)} `
      + `(${origem.length} bytes / sha256 ${sha(origem).slice(0, 12)} vs `
      + `${publicado.length} bytes / sha256 ${sha(publicado).slice(0, 12)}). `
      + `O Pages serve /docs, então o site publicaria a versão velha reportando "built" com sucesso -- `
      + `foi exatamente o incidente de 2026-07-22 (ver CLAUDE.md). Rode \`${par.comando}\` e commite os dois juntos.`
    );
  });
}
