'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { renderDashboard } = require('../../tools/orcamento/render-dashboard.js');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'registros-golden.json');

// Data fixa: __VIGENTE_IDX__ é derivado dela e mudaria na virada do mês.
const DATA_FIXA = new Date(Date.UTC(2026, 6, 15));
const SENHA_FIXA = 'golden-fake';
const PERIODOS = Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1)));

function construirHtmlGolden() {
  return renderDashboard({
    registros: JSON.parse(fs.readFileSync(FIXTURE, 'utf8')),
    periodos: PERIODOS,
    generatedAt: DATA_FIXA,
    senha: SENHA_FIXA,
    logoDataUri: 'data:image/png;base64,GOLDEN',
    iconDataUri: 'data:image/png;base64,GOLDEN',
  });
}

// O que pode mudar legitimamente entre dois builds do MESMO código:
// - salt e iv do blob cifrado, sorteados a cada execução;
// - o carimbo "Gerado em";
// - o fim de linha, que o git converte pra CRLF no Windows.
// Qualquer outra diferença é regressão.
function normalizarVolatil(html) {
  return html
    .replace(/\r\n/g, '\n')
    .replace(/window\.__DADOS_CIFRADOS__\s*=\s*\{[^}]*\}/, 'window.__DADOS_CIFRADOS__ = {NORMALIZADO}')
    .replace(/Gerado em[^<]*/g, 'Gerado em NORMALIZADO');
}

module.exports = { construirHtmlGolden, normalizarVolatil, SENHA_FIXA };
