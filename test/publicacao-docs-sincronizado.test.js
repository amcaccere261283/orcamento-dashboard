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
// Cada par abaixo é checado de forma independente (a lista cresce conforme
// novos arquivos entram em ARQUIVOS_PUBLICAR -- não fixe esse comentário num
// número, ele já ficou errado duas vezes). Se um par ainda não
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
    nome: 'alocação equipes',
    origem: path.join(RAIZ, 'dist', 'alocacao-equipes.html'),
    publicado: path.join(RAIZ, 'docs', 'alocacao-equipes.html'),
    comando: 'cp dist/alocacao-equipes.html docs/alocacao-equipes.html',
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
  {
    nome: 'CSV de Roster de Equipes',
    origem: path.join(RAIZ, 'dist', 'equipes-roster-online.csv'),
    publicado: path.join(RAIZ, 'docs', 'equipes-roster-online.csv'),
    comando: 'cp dist/equipes-roster-online.csv docs/equipes-roster-online.csv',
  },
  // Entraram em 2026-08-10: até então só alimentavam o build a partir de
  // dist/, e o botão "Atualizar dados" nunca os buscava -- o refresh
  // recalculava Demandas Pendentes sem o backlog (5.493 furos + 12.781
  // ensaios pendentes, medidos em 2026-08-10) e o estoque desabava pra perto
  // de zero com o status "Atualizado" em verde, sem erro nenhum.
  {
    nome: 'CSV de Demandas de Sondagem',
    origem: path.join(RAIZ, 'dist', 'demandas-sondagem-online.csv'),
    publicado: path.join(RAIZ, 'docs', 'demandas-sondagem-online.csv'),
    comando: 'cp dist/demandas-sondagem-online.csv docs/demandas-sondagem-online.csv',
  },
  {
    nome: 'JSON de Demandas de Lab',
    origem: path.join(RAIZ, 'dist', 'demandas-lab-online.json'),
    publicado: path.join(RAIZ, 'docs', 'demandas-lab-online.json'),
    comando: 'cp dist/demandas-lab-online.json docs/demandas-lab-online.json',
  },
  // Entrou em 2026-08-18 com a atualização escalonada: é o CSV que as 3
  // máquinas usam pra combinar entre si quem já atualizou hoje, e que
  // build-dashboard.js lê pro aviso "Atualizado às HH:MM por Fulano" no
  // cabeçalho. Está em ARQUIVOS_PUBLICAR, então precisa da mesma rede de
  // proteção dist/ <-> docs/ dos outros.
  {
    nome: 'CSV de heartbeat da atualização escalonada',
    origem: path.join(RAIZ, 'dist', 'heartbeat-atualizacao-volume.csv'),
    publicado: path.join(RAIZ, 'docs', 'heartbeat-atualizacao-volume.csv'),
    comando: 'cp dist/heartbeat-atualizacao-volume.csv docs/heartbeat-atualizacao-volume.csv',
  },
  // Entrou em 2026-08-27 com a camada de referência de rodovias das
  // concessionárias na aba Mapa (Alocação Equipes) -- mesma rede de proteção
  // dist/ <-> docs/ dos outros arquivos publicados junto com as páginas.
  {
    nome: 'JSON de concessões e rodovias',
    origem: path.join(RAIZ, 'dist', 'concessoes-rodovias.json'),
    publicado: path.join(RAIZ, 'docs', 'concessoes-rodovias.json'),
    comando: 'cp dist/concessoes-rodovias.json docs/concessoes-rodovias.json',
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
