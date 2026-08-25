# Alocação Equipes vira página própria — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair a 7ª aba do `planejamento-semanal.html` ("Alocação Equipes") para uma
página HTML própria (`docs/alocacao-equipes.html`), publicada no mesmo repositório e no
mesmo GitHub Pages, removendo-a de `planejamento-semanal.html`.

**Architecture:** `tools/semanal/build-dashboard.js` continua sendo o único ponto que
busca/calcula os dados (nenhuma duplicação de fetch/parse); passa a chamar um segundo
módulo de renderização, `tools/semanal/render-alocacao-pagina.js` (novo), com os MESMOS
`registros`/`demandas`/`periodos`/`senha` já calculados na mesma execução, escrevendo
`dist/alocacao-equipes.html` ao lado de `dist/planejamento-semanal.html`. O módulo novo
reaproveita `RenderAbaAlocacao.renderAbaAlocacao` (não muda), a casca (`cssBase`,
`markupCabecalho`, `markupFiltros`, `scriptDesbloqueio`, `scriptFiltros` de
`tools/comum/render-shell.js`) e um bundle de módulos reduzido. O bloco de estado/
interação da Alocação, hoje dentro do template gigante `SCRIPT_CLIENTE_SEMANAL` de
`tools/semanal/render-semanal.js`, é MOVIDO (copiado e depois apagado da origem) para um
`SCRIPT_CLIENTE_ALOCACAO` próprio dentro do módulo novo.

**Tech Stack:** Node.js puro (sem framework de build), `node --test`, templates literais
JS para HTML/CSS/client-script, AES-256-GCM (`tools/comum/criptografia.js`) para o blob
cifrado, `tools/comum/browser-bundle.js` para empacotar módulos Node como `<script>` de
navegador.

## Global Constraints

- A senha nunca aparece em arquivo do repositório — só via `ORCAMENTO_SENHA` (env var),
  lida no momento do build.
- Nenhuma mudança de comportamento visível na aba Alocação: mesma grade, mesmo arrasto,
  mesma persistência (Apps Script `apps-script-alocacao.gs`/`alocacao-sheet.js`), mesmo
  live-refresh, mesma senha.
- `render-aba-alocacao.js` e `compute-alocacao.js` (a lógica pura da Alocação) NÃO mudam
  neste plano — só passam a ser importados por um bundle diferente.
- `docs/` só é atualizado na Task 4 (regra permanente do CLAUDE.md: build → cp → commit →
  push, sempre junto, sempre publicado sem perguntar de novo).
- `test/semanal-render-aba-alocacao.test.js`, `test/semanal-compute-alocacao.test.js`,
  `test/semanal-equipes-alocaveis.test.js`, `test/semanal-grupos-veiculo.test.js`,
  `test/semanal-alocacao-sheet.test.js`, `test/semanal-apps-script-alocacao.test.js` e
  `test/semanal-alocacao-interacao.test.js` **não precisam mudar** — nenhum deles importa
  `render-semanal.js`; todos testam módulos puros diretamente.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `tools/semanal/render-alocacao-pagina.js` | Criar | HTML/CSS/bundle/script-cliente da página standalone; exporta `renderAlocacaoPagina(...)`. |
| `tools/semanal/render-semanal.js` | Modificar | Exporta 4 constantes/funções a mais (Task 1); remove o bloco Alocação — aba, seção, script cliente, blob, bundle (Task 3). |
| `tools/semanal/build-dashboard.js` | Modificar | Chama `renderAlocacaoPagina` com os mesmos dados já calculados e escreve `dist/alocacao-equipes.html`. |
| `test/semanal-render-alocacao-pagina.test.js` | Criar | Smoke test do shell da página nova (Task 1). |
| `test/semanal-alocacao-pagina-wireup.test.js` | Criar | A suíte de interação/wireup da Alocação, migrada de `semanal-render-semanal-wireup.test.js` (Task 2). |
| `test/semanal-render-semanal-wireup.test.js` | Modificar | Perde as linhas 1723-2300 (Task 3), depois de confirmadas migradas. |
| `test/publicacao-docs-sincronizado.test.js` | Modificar | Ganha 1 entrada para `alocacao-equipes.html`. |

---

### Task 1: Exports reutilizáveis + esqueleto da página nova + build wiring

**Files:**
- Modify: `tools/semanal/render-semanal.js:3139` (module.exports)
- Create: `tools/semanal/render-alocacao-pagina.js`
- Modify: `tools/semanal/build-dashboard.js:514-524`
- Create: `test/semanal-render-alocacao-pagina.test.js`

**Interfaces:**
- Consumes (de `render-semanal.js`, já existentes): `CSS_SEMANAL` (já exportado),
  `opcoesMesSemanal()` (linha 103-107), `CSS_ABAS_SEMANAL` (linha 150), `CSS_DEMANDAS`
  (linha 726), `SCRIPT_AVISO_ATUALIZACAO_ATRASADA` (linha 955) — todos hoje só locais ao
  módulo, precisam entrar no `module.exports`.
- Consumes (de `tools/comum/render-shell.js`, já exportados): `cssBase`,
  `markupCabecalho`, `markupFiltros`, `scriptDesbloqueio`, `scriptFiltros`.
- Consumes (de `tools/comum/browser-bundle.js`): `buildBrowserBundle`.
- Consumes (de `tools/comum/criptografia.js`): `cifrarComSenha`.
- Consumes (de `tools/comum/datas.js`): `formatarMesAno`, `calcularVigenteIdx`.
- Consumes (de `tools/comum/calculo-equipes.js`, `tipologias-avancos.js`,
  `tipologias-lab.js`, `datas.js`, `linha-base.js`): `fonteParaCliente` de cada um (mesmos
  5 imports que `render-semanal.js` já faz nas linhas 9-13).
- Produces: `renderAlocacaoPagina({ registros, demandas, periodos, senha, geradoEm,
  logoDataUri, iconDataUri, avisoAtualizacao, ultimaAtualizacaoOkIso })` → string HTML.
  **Não recebe `baseline`** (a Alocação nunca usa linha de base).

- [ ] **Step 1: Exportar as 4 peças que faltam em `render-semanal.js`**

Editar o `module.exports` no final do arquivo (linha 3139):

```js
module.exports = { renderSemanal, CSS_SEMANAL, CSS_ABAS_SEMANAL, CSS_DEMANDAS, SCRIPT_AVISO_ATUALIZACAO_ATRASADA, opcoesMesSemanal };
```

Rodar `node --test test/*.test.js` uma vez aqui só para confirmar que nada quebrou (é uma
mudança aditiva, não deveria).

- [ ] **Step 2: Escrever o esqueleto de `tools/semanal/render-alocacao-pagina.js`**

```js
'use strict';
const path = require('node:path');
const { formatarMesAno, calcularVigenteIdx } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupFiltros, scriptDesbloqueio, scriptFiltros,
} = require('../comum/render-shell.js');
const { buildBrowserBundle } = require('../comum/browser-bundle.js');
const { fonteParaCliente: fonteParaClienteEquipes } = require('../comum/calculo-equipes.js');
const { fonteParaCliente: fonteParaClienteTipologiasAvancos } = require('../comum/tipologias-avancos.js');
const { fonteParaCliente: fonteParaClienteTipologiasLab } = require('../comum/tipologias-lab.js');
const { fonteParaCliente: fonteParaClienteDatas } = require('../comum/datas.js');
const { fonteParaCliente: fonteParaClienteLinhaBase } = require('../comum/linha-base.js');
const {
  CSS_SEMANAL, CSS_ABAS_SEMANAL, CSS_DEMANDAS, SCRIPT_AVISO_ATUALIZACAO_ATRASADA, opcoesMesSemanal,
} = require('./render-semanal.js');

// Mesmo Apps Script que a aba usava dentro de planejamento-semanal.html
// (tools/semanal/apps-script-alocacao.gs) -- MOVIDO pra cá porque só esta
// página consome a alocação agora. Mesma URL: reimplantar o .gs (Gerenciar
// implantações > Nova versão) mantém este literal válido; só uma implantação
// NOVA do zero o trocaria.
const URL_ALOCACAO = 'https://script.google.com/macros/s/AKfycby3jOFa1eOZ9Rtu7mRq8iZWtZdKdg-7ATqzbU-fBba5eLuV5_U69nAe7-Md_3-l_ciB/exec';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Os 5 filtros da barra compartilhada que a Alocação de fato lê (indicesFiltrados,
// ver montarAbaAlocacao) -- sem o 6º (seletor-dimensao): a Tendência da Alocação é
// sempre 'volume', hardcoded em compute-alocacao.js (tendenciaDaCelula).
const FILTROS_ALOCACAO = [
  { id: 'filtro-origem', rotulo: 'Todas as origens' },
  { id: 'filtro-categoria', rotulo: 'Todas as categorias' },
  { id: 'filtro-tipologia', rotulo: 'Todas as tipologias' },
  { id: 'filtro-grupo', rotulo: 'Todos os grupos' },
  { id: 'filtro-sup', rotulo: 'Todos os SUP' },
];

// Réplica de MARKUP_ACOES_SEMANAL (render-semanal.js:109-115) sem o checkbox
// "Somente SUPs ativos" -- a Alocação nunca usou filtro-ativos de propósito
// (esconderia as linhas "Parado c/ carteira", o motivo da aba existir).
const MARKUP_ACOES_ALOCACAO = `      <div class="filtros-acoes">
        <label class="controle-mes-semanal">Mês<select id="seletor-mes-semanal">${opcoesMesSemanal()}</select></label>
        <button id="limpar-filtros" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>Limpar filtros</button>
        <button id="atualizar-dashboard" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>Atualizar dados</button>
        <span id="status-atualizacao" class="status-atualizacao"></span>
      </div>`;

// Reduzido de BUNDLE_ARQUIVOS (render-semanal.js:795-892): só as 18 entradas
// que compute-alocacao.js/render-aba-alocacao.js/equipes-alocaveis.js/
// alocacao-sheet.js/grupos-veiculo.js e o live-refresh (Task 2) precisam,
// SUBSEQUÊNCIA da lista original preservando a ordem relativa (contrato de
// dependência) -- não foi reordenado.
const BUNDLE_ARQUIVOS_ALOCACAO = [
  'compute-semanal.js', 'compute-tendencia-semanal.js', 'render-aba-semanal.js',
  'render-aba-alertas.js', 'render-aba-consolidado.js',
  'parse-matriz-cliente.js', 'classificar-dia-equipe.js', 'compute-equipes-ativas.js',
  'compute-equipes-nao-produtivas.js', 'compute-equipes-realizado-alocado.js',
  'parse-avancos.js', 'parse-lab.js', 'compute-demandas.js',
  'grupos-veiculo.js', 'equipes-alocaveis.js', 'compute-alocacao.js', 'alocacao-sheet.js',
  'render-aba-alocacao.js',
];

// Placeholder até a Task 2 -- será substituído pelo script cliente completo
// (estado/arrasto/live-refresh). Mantém a página funcional (gate abre, seção
// existe vazia) já nesta Task, testável por si só.
const SCRIPT_CLIENTE_ALOCACAO = `
var ComputeSemanal = MODULOS['compute-semanal.js'];
var RenderAbaAlocacao = MODULOS['render-aba-alocacao.js'];
var EquipesAlocaveis = MODULOS['equipes-alocaveis.js'];
var GruposVeiculo = MODULOS['grupos-veiculo.js'];
var AlocacaoSheet = MODULOS['alocacao-sheet.js'];
var ParseMatrizCliente = MODULOS['parse-matriz-cliente.js'];
var ParseAvancos = MODULOS['parse-avancos.js'];
var ParseLab = MODULOS['parse-lab.js'];
var ComputeDemandas = MODULOS['compute-demandas.js'];
var ComputeEquipesAtivas = MODULOS['compute-equipes-ativas.js'];
var ComputeEquipesNaoProdutivas = MODULOS['compute-equipes-nao-produtivas.js'];
var ComputeEquipesRealizadoAlocado = MODULOS['compute-equipes-realizado-alocado.js'];

// Réplica reduzida de FILTROS_CONFIG_SEMANAL (render-semanal.js:1043-1054),
// sem 'seletor-dimensao' -- indicesFiltrados/montarFiltroMulti vêm de
// scriptFiltros() (tools/comum/render-shell.js), concatenado ANTES deste
// script na mesma <script> tag.
var FILTROS_CONFIG_SEMANAL = [
  { id: 'filtro-origem', chave: 'origem', rotuloPadrao: 'Todas as origens', campo: 'origem', rotuloCapitalizado: true },
  { id: 'filtro-categoria', chave: 'categoria', rotuloPadrao: 'Todas as categorias', opcoesFixas: [
    { valor: 'labConvencional', rotulo: 'Lab. Convencional' },
    { valor: 'labEspecial', rotulo: 'Lab. Especial' },
    { valor: 'sondagemConvencional', rotulo: 'Sondagem Convencional' },
    { valor: 'sondagemEspecial', rotulo: 'Sondagem Especial' },
  ] },
  { id: 'filtro-tipologia', chave: 'tipologia', rotuloPadrao: 'Todas as tipologias', campo: 'tipologia' },
  { id: 'filtro-grupo', chave: 'grupo', rotuloPadrao: 'Todos os grupos', campo: 'grupo' },
  { id: 'filtro-sup', chave: 'sup', rotuloPadrao: 'Todos os SUP', campo: 'sup', rotuloComposto: true },
];
var filtrosSelecionadosSemanal = {};
FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { filtrosSelecionadosSemanal[cfg.chave] = new Set(); });

var mesSelecionadoIdx = Math.max(0, Math.min(11, window.__VIGENTE_IDX__));

function hojeEpochDoNavegador() {
  var agora = new Date();
  return ComputeSemanal.diaEpoch(new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate())));
}

function semanasDoMesSelecionado() {
  return ComputeSemanal.semanasDoMes(window.__ANO__, mesSelecionadoIdx);
}

// dados: o que o gate acabou de JSON.parse -- {registros, demandas, alocacaoUrl}
// (ver renderAlocacaoPagina). Reduzido de fecharTendenciaVigente
// (render-semanal.js:1177-1187): sem baseline nem historicoRelatorioUrl, que
// esta página não usa.
function fecharTendenciaVigente(dados) {
  window.__DEMANDAS__ = dados && dados.demandas;
  window.__ALOCACAO_URL__ = dados && dados.alocacaoUrl;
  return dados && dados.registros ? dados.registros : dados;
}

// Placeholder -- substituído na Task 2 pelo bloco real de estado/arrasto.
function montarAbaAlocacao() {}

function aoMudarSemanal(cfg) {
  if (cfg.chave === 'categoria') {
    var cfgTipologia = FILTROS_CONFIG_SEMANAL.filter(function (c) { return c.chave === 'tipologia'; })[0];
    montarFiltroMulti(cfgTipologia, window.__REGISTROS__, filtrosSelecionadosSemanal, aoMudarSemanal);
  }
  montarAbaAlocacao();
}

function montarTodosFiltrosMultiSemanal(registros) {
  FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { montarFiltroMulti(cfg, registros, filtrosSelecionadosSemanal, aoMudarSemanal); });
}

function limparFiltrosSemanal() {
  FILTROS_CONFIG_SEMANAL.forEach(function (cfg) { filtrosSelecionadosSemanal[cfg.chave].clear(); });
  montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
  montarAbaAlocacao();
}

function montarDashboard(registros) {
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltrosSemanal);
  var seletorMes = document.getElementById('seletor-mes-semanal');
  seletorMes.value = String(mesSelecionadoIdx);
  seletorMes.addEventListener('change', function (e) {
    mesSelecionadoIdx = parseInt(e.target.value, 10);
    montarAbaAlocacao();
  });
  montarTodosFiltrosMultiSemanal(registros);
  configurarAberturaFiltrosMulti();
  montarAbaAlocacao();
}
`;

function renderAlocacaoPagina({ registros, demandas, periodos, senha, geradoEm, logoDataUri, iconDataUri, avisoAtualizacao, ultimaAtualizacaoOkIso }) {
  if (!senha) {
    throw new Error('renderAlocacaoPagina requer "senha" -- os registros são cifrados com ela antes de ir pro HTML.');
  }
  if (!Array.isArray(periodos) || periodos.length === 0) {
    throw new Error('renderAlocacaoPagina requer "periodos" (os 12 meses da MATRIZ, como datas).');
  }

  const dadosJson = JSON.stringify({ registros, demandas, alocacaoUrl: URL_ALOCACAO });
  const dadosCifrados = cifrarComSenha(dadosJson, senha);
  const dadosCifradosJson = JSON.stringify(dadosCifrados).replace(/<\/script/gi, '<\\/script');

  const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="Suporte Infra">` : '';
  const watermarkImg = iconDataUri ? `<img class="watermark" src="${iconDataUri}" alt="">` : '';
  const vigenteIdx = calcularVigenteIdx(periodos, geradoEm);
  const bundle = buildBrowserBundle(path.join(__dirname), BUNDLE_ARQUIVOS_ALOCACAO);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ALOCAÇÃO EQUIPES</title>
<style>
${cssBase()}
${CSS_SEMANAL}
${CSS_ABAS_SEMANAL}
${CSS_DEMANDAS}
</style>
</head>
<body>
  ${watermarkImg}
  <main>
${markupCabecalho({
    titulo: 'Alocação Equipes',
    subtitulo: escapeHtml(avisoAtualizacao ? `${formatarMesAno(geradoEm)} · ${avisoAtualizacao}` : formatarMesAno(geradoEm)),
    logo: logoImg,
    recuo: '  ',
  })}
  <div id="aviso-atualizacao-atrasada" class="aviso-atualizacao-atrasada" style="display:none"></div>

  <div id="gate-senha" class="gate-senha">
    <div class="gate-senha-box">
      <h2>Digite a senha para abrir o dashboard</h2>
      <input type="password" id="campo-senha" autocomplete="off" placeholder="Senha">
      <button id="btn-desbloquear" type="button">Abrir</button>
      <div id="gate-senha-erro" class="gate-senha-erro" style="display:none"></div>
    </div>
  </div>

  <div id="conteudo-protegido" style="display:none">
${markupFiltros(FILTROS_ALOCACAO, { recuo: '    ', acoes: MARKUP_ACOES_ALOCACAO })}
    <div id="secao-alocacao"></div>
  </div>
  </main>
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx}; window.__ANO__ = ${periodos[0].getUTCFullYear()};</script>
  <script>window.__ULTIMA_ATUALIZACAO_OK__ = ${ultimaAtualizacaoOkIso ? JSON.stringify(ultimaAtualizacaoOkIso) : 'null'};</script>
  <script>${SCRIPT_AVISO_ATUALIZACAO_ATRASADA}</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${fonteParaClienteEquipes()}${fonteParaClienteTipologiasAvancos()}${fonteParaClienteTipologiasLab()}${fonteParaClienteDatas()}${fonteParaClienteLinhaBase()}</script>
  <script>${bundle}</script>
  <script>${scriptFiltros()}${SCRIPT_CLIENTE_ALOCACAO}</script>
</body>
</html>`;
}

module.exports = { renderAlocacaoPagina };
```

- [ ] **Step 3: Ligar no build**

Em `tools/semanal/build-dashboard.js`, adicionar o require (perto da linha 13, junto do
`require('./render-semanal.js')`):

```js
const { renderAlocacaoPagina } = require('./render-alocacao-pagina.js');
```

E depois do bloco que escreve `dist/planejamento-semanal.html` (logo após a linha
`console.log(\`Wrote ${html.length} bytes to ${resolvedOutPath}\`);`, ainda dentro de
`build()`, antes do `return resolvedOutPath;`):

```js
  const htmlAlocacao = renderAlocacaoPagina({
    registros, demandas, periodos, senha, geradoEm: today,
    logoDataUri: loadDataUri(LOGO_PATH), iconDataUri: loadDataUri(ICON_PATH),
    avisoAtualizacao, ultimaAtualizacaoOkIso: ultimaAtualizacaoOkIsoValor,
  });
  const outPathAlocacao = path.join(__dirname, '..', '..', 'dist', 'alocacao-equipes.html');
  fs.writeFileSync(outPathAlocacao, htmlAlocacao, 'utf8');
  console.log(`Wrote ${htmlAlocacao.length} bytes to ${outPathAlocacao}`);
```

Não precisa de nenhum fetch novo: `registros`/`demandas`/`periodos`/`senha`/`today` já
existem no escopo de `build()` (a mesma `demandas` que alimenta as outras 6 abas já traz
`equipesCsv`/`osParaSup`/`equipesRosterPeriodo`, populados por `montarEquipesAtivas`,
que continua sendo chamada pelas mesmas linhas de sempre — `equipesNaoProdutivas`, usado
pela aba Balanço, também depende dela, então essa função NÃO pode ser removida).

- [ ] **Step 4: Escrever o smoke test**

Criar `test/semanal-render-alocacao-pagina.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderAlocacaoPagina } = require('../tools/semanal/render-alocacao-pagina.js');

const SENHA_FAKE = 'senha-fake-de-teste-e2e-nao-e-a-real';
const PERIODOS_2026 = Array.from({ length: 12 }, (_, mes) => new Date(Date.UTC(2026, mes, 1)));
const DEMANDAS_VAZIAS = { tipologias: [], totais: {}, porRegistroEventos: {}, equipesCsv: null, osParaSup: null, equipesRosterPeriodo: null };

function registroSintetico(sup, tomador) {
  const zeros = new Array(12).fill(0);
  const bloco = () => ({ equipes: zeros, volume: zeros, financeiro: zeros });
  return { sup, grupo: 'Grupo-Sintetico', tomador, tipologia: 'ST', previsto: bloco(), realizado: bloco(), total: bloco() };
}

test('renderAlocacaoPagina exige senha e periodos', () => {
  assert.throws(() => renderAlocacaoPagina({ registros: [], demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: '', geradoEm: new Date() }));
  assert.throws(() => renderAlocacaoPagina({ registros: [], demandas: DEMANDAS_VAZIAS, periodos: [], senha: SENHA_FAKE, geradoEm: new Date() }));
});

test('o HTML cru tem #secao-alocacao vazia e nenhum dado de registro em texto puro', () => {
  const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa')];
  const html = renderAlocacaoPagina({ registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.match(html, /<div id="secao-alocacao"><\/div>/);
  assert.doesNotMatch(html, /Tomador-Sintetico-Alfa/);
  assert.match(html, /<title>ALOCAÇÃO EQUIPES<\/title>/);
});

test('não tem markup das outras 6 abas', () => {
  const registros = [registroSintetico('SUP-0002-24', 'Tomador-Sintetico-Beta')];
  const html = renderAlocacaoPagina({ registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z') });
  assert.doesNotMatch(html, /id="secao-semanal"/);
  assert.doesNotMatch(html, /id="secao-consolidado"/);
  assert.doesNotMatch(html, /abas-visualizacao/);
});
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS (inclui os 3 testes novos; nada mais deve ter mudado de comportamento).

- [ ] **Step 6: Commit**

```bash
git add tools/semanal/render-semanal.js tools/semanal/render-alocacao-pagina.js tools/semanal/build-dashboard.js test/semanal-render-alocacao-pagina.test.js
git commit -m "feat: esqueleto da página própria Alocação Equipes (shell + build, script cliente ainda placeholder)"
```

---

### Task 2: Portar o script cliente completo (estado, arrasto, live-refresh) + migrar a suíte de testes

**Files:**
- Modify: `tools/semanal/render-alocacao-pagina.js` (substitui o `SCRIPT_CLIENTE_ALOCACAO` placeholder)
- Create: `test/semanal-alocacao-pagina-wireup.test.js`
- Reference (não modificar ainda): `tools/semanal/render-semanal.js` (fonte do que será copiado)

**Interfaces:**
- Consumes: nada novo — os mesmos `MODULOS[...]` já declarados na Task 1, mais
  `indicesFiltrados`/`montarFiltroMulti`/`configurarAberturaFiltrosMulti` (de
  `scriptFiltros()`, já concatenado antes do script).
- Produces: `montarAbaAlocacao()` funcional (substitui o placeholder vazio),
  `atualizarDadosAoVivoSemanal()`, e todo o wireup de arrasto/pool/busca/tipologia que a
  suíte migrada exercita.

- [ ] **Step 1: Copiar o bloco de estado/interação da Alocação**

Em `tools/semanal/render-semanal.js`, o comentário "Alocação Equipes Task 9/10" começa na
linha **1395** e o bloco de interação (`inicializarInteracaoAlocacao`) termina na linha
**2269**. DENTRO desse intervalo, as linhas **1509-1634** são o recurso "Relatório
Semanal Excel" (`ESTADO_RELATORIO_SEMANAL`, `clienteHistoricoRelatorio`,
`montarOpcoesRelatorioSemanal`, `gerarRelatorioExcel` etc.) — **não pertence à Alocação,
fica em `render-semanal.js`, não copiar**.

Copiar VERBATIM pra dentro de `SCRIPT_CLIENTE_ALOCACAO` (substituindo o
`function montarAbaAlocacao() {}` placeholder da Task 1):

- Linhas 1395-1508 (comentário + `ESTADO_ALOCACAO` + `chaveSemanaVista`/
  `semanaJaVista`/`marcarSemanaVista` + `clienteAlocacao`)
- Linhas 1635-2269 (`chaveSemanaAtual`, `aplicarMovimento`, `semearDoRealizado`,
  `limparAlocacao`, `carregarAlocacaoDaSemana`, `selecionarSemanaAlocacao`,
  `montarAbaAlocacao`, `ARRASTO_ALOCACAO`/`SELECAO_ALOCACAO`/
  `SUPRIMIR_PROXIMO_CLICK_ALOCACAO`, `equipeAlocavelPeloId`, `podeDevolverGrupo`,
  `destacarCelulasCompativeis`, `limparDestaquesAlocacao`,
  `criarFantasmaArrasto`/`posicionarFantasmaArrasto`/`removerFantasmaArrasto`,
  `encerrarArrastoAlocacao`, `resolverAlvoAlocacao`, `inicializarInteracaoAlocacao`)

Nenhum texto precisa ser alterado nessas duas cópias — os nomes de função/variável já
batem com o que a Task 1 declarou (`ESTADO_ALOCACAO`, `filtrosSelecionadosSemanal`,
`mesSelecionadoIdx`, `semanasDoMesSelecionado`, `hojeEpochDoNavegador`,
`ComputeSemanal`/`RenderAbaAlocacao`/`EquipesAlocaveis`/`AlocacaoSheet`/`GruposVeiculo`).

- [ ] **Step 2: Copiar e adaptar o live-refresh**

Copiar VERBATIM as linhas **2640-2985** de `render-semanal.js` (as 8 constantes
`URL_ESPELHO_*`, `definirStatusAtualizacaoSemanal`, `periodosDoAnoSemanal`,
`buscarCsvSemanal`, `gridCsvComoXlsx`, `RE_URL_PENDENTE`, e a função inteira
`atualizarDadosAoVivoSemanal`) para o fim de `SCRIPT_CLIENTE_ALOCACAO`, depois do bloco do
Step 1.

Dentro da cópia, localizar o trecho final da função (5 linhas, perto do fim):

```js
    window.__REGISTROS__ = registrosNovos;
    window.__DEMANDAS__ = demandasNovas;
    montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
    recalcularSemanal();
    montarAbaDemandas();
```

e substituir as duas últimas linhas por uma:

```js
    window.__REGISTROS__ = registrosNovos;
    window.__DEMANDAS__ = demandasNovas;
    montarTodosFiltrosMultiSemanal(window.__REGISTROS__);
    montarAbaAlocacao();
```

(`recalcularSemanal`/`montarAbaDemandas` não existem nesta página — a Alocação recalcula
sozinha via `montarAbaAlocacao`, que já chama `indicesFiltrados` internamente.)

Em seguida, copiar as linhas **2987, 2989-2993** (o wireup do botão + o comentário +
`inicializarInteracaoAlocacao()`):

```js
document.getElementById('atualizar-dashboard').addEventListener('click', atualizarDadosAoVivoSemanal);

// Wireup incondicional, no load do script -- #secao-alocacao já existe no
// HTML estático (ver renderAlocacaoPagina), e o listener delegado não depende
// de senha nem de a aba já ter sido desenhada.
inicializarInteracaoAlocacao();
```

- [ ] **Step 3: Rodar a suíte da Task 1 pra confirmar que nada quebrou**

Run: `node --test test/semanal-render-alocacao-pagina.test.js`
Expected: PASS (o shell continua funcionando; `montarAbaAlocacao` real ainda não foi
exercitado por nenhum teste ainda).

- [ ] **Step 4: Migrar a suíte de 578 testes de wireup**

Em `test/semanal-render-semanal-wireup.test.js`, as linhas **1723 até o fim do arquivo
(2300)** são inteiramente sobre a Alocação (começam no comentário "--- Alocação Equipes:
a sétima aba..."). Copiar esse trecho para um arquivo novo,
`test/semanal-alocacao-pagina-wireup.test.js`, com estas adaptações:

1. Cabeçalho do arquivo novo — reaproveitar os helpers que o bloco usa (verificar cada um
   com `grep -n "^function \|^const "` nas primeiras 90 linhas do arquivo original antes
   de decidir o que duplicar): `SENHA_FAKE`, `PERIODOS_2026`, `DEMANDAS_VAZIAS`,
   `registroSintetico`, `criarDocumentoFalso` (de `./helpers/dom-falso-semanal.js`),
   `localStorageFalso` (se definida no arquivo original, duplicar; se vier de um helper
   compartilhado, importar de lá).

2. Trocar o require de `renderSemanal`:
   ```js
   const { renderAlocacaoPagina } = require('../tools/semanal/render-alocacao-pagina.js');
   ```

3. Toda chamada `renderSemanal({ registros, baseline: [], demandas: ..., periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: ... })` vira
   `renderAlocacaoPagina({ registros, demandas: ..., periodos: PERIODOS_2026, senha: SENHA_FAKE, geradoEm: ... })`
   (removendo o argumento `baseline`, que a função nova não aceita).

4. Escrever uma versão local de `montarSandbox(html, fetchMock)` (não reaproveitar a do
   arquivo original — ela está fixada em `assert.equal(blocos.length, 8, ...)`, e a
   página nova tem um número diferente de `<script>` porque não tem `markupAbas`/tabs).
   Antes de fixar o número, rodar rapidamente `node -e "const {renderAlocacaoPagina}=require('./tools/semanal/render-alocacao-pagina.js'); const html=renderAlocacaoPagina({registros:[],demandas:{tipologias:[],totais:{},porRegistroEventos:{}},periodos:[new Date()],senha:'x',geradoEm:new Date()}); console.log([...html.matchAll(/<script>/g)].length)"`
   e usar o número real na asserção (deve ser 7 — os mesmos 8 blocos de
   `planejamento-semanal.html` menos o de `markupAbas`, que a página nova não tem; **não
   assuma, confirme rodando**).

5. O teste `'com sete abas, abrir Alocação Equipes esconde as outras seis -- alternarAba
   continua exclusiva'` (linhas 1744-1765 do arquivo original) não faz sentido na página
   nova (não há outras 6 abas nem `alternarAba`) — REMOVER esse teste. Substituir por um
   teste mais simples que prove a mesma coisa que importa aqui — que a seção existe e é
   montada depois da senha certa:
   ```js
   test('depois da senha certa, #secao-alocacao é montada de verdade -- não fica um <div> vazio', async () => {
     const registros = [registroSintetico('SUP-0001-24', 'Tomador-Sintetico-Alfa', 4000)];
     const html = renderAlocacaoPagina({
       registros, demandas: DEMANDAS_VAZIAS, periodos: PERIODOS_2026,
       senha: SENHA_FAKE, geradoEm: new Date('2026-07-01T00:00:00Z'),
     });
     const { sandbox, documentoFalso } = montarSandbox(html);
     documentoFalso.getElementById('campo-senha').value = SENHA_FAKE;
     await sandbox.tentarDesbloquear();
     assert.equal(documentoFalso.getElementById('conteudo-protegido').style.display, '');
     assert.notEqual(documentoFalso.getElementById('secao-alocacao').innerHTML, '');
   });
   ```

6. Todos os demais testes do bloco (a partir de `csvEqComOs`/`sandboxAlocacao`/os testes
   de arrasto, semeadura, devolução, race condition, filtro de tipologia, busca de
   equipe) migram como estão — eles já chamam `sandbox.montarAbaAlocacao()`,
   `sandbox.ESTADO_ALOCACAO`, `sandbox.selecionarSemanaAlocacao`,
   `sandbox.resolverAlvoAlocacao`, `sandbox.limparDestaquesAlocacao` etc., que existem
   igual no script cliente novo (Step 1/2 copiaram os nomes sem alteração). Só a chamada
   que MONTA a página (`renderSemanal(...)`/`montarSandbox(...)`) precisa das trocas dos
   itens 2-4 acima.

- [ ] **Step 5: Rodar a suíte migrada isolada**

Run: `node --test test/semanal-alocacao-pagina-wireup.test.js`
Expected: PASS. Se algum teste falhar por causa de um helper que não foi copiado/importado
corretamente (item 1), corrigir o import — não reescrever a lógica do teste.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS. Neste ponto `test/semanal-render-semanal-wireup.test.js` ainda tem a cópia
ANTIGA (linhas 1723-2300) rodando também, apontando pra `render-semanal.js` — que ainda
não mudou nesta task, então ela também deve passar. Ter as duas suítes verdes ao mesmo
tempo é a prova de que a migração não alterou nenhum comportamento.

- [ ] **Step 7: Commit**

```bash
git add tools/semanal/render-alocacao-pagina.js test/semanal-alocacao-pagina-wireup.test.js
git commit -m "feat: porta estado/arrasto/live-refresh da Alocação Equipes pro script cliente da página própria"
```

---

### Task 3: Remover o bloco Alocação de `planejamento-semanal.html`

**Files:**
- Modify: `tools/semanal/render-semanal.js`
- Modify: `test/semanal-render-semanal-wireup.test.js`
- Modify: `test/publicacao-docs-sincronizado.test.js`

**Interfaces:**
- Consumes: nenhuma interface nova — só remoção de código morto (a Task 2 já provou que
  o equivalente funciona na página nova).
- Produces: `planejamento-semanal.html` com 6 abas, sem `equipesCsv`/`osParaSup`/
  `equipesRosterPeriodo` no blob cifrado, sem `URL_ALOCACAO`.

- [ ] **Step 1: Remover a aba da lista de abas e a seção**

Em `ABAS_VISUALIZACAO` (linha 50-71), remover a entrada:
```js
  // Alocação Equipes (2026-08-10, Task 10). Ícone: pessoas num quadro --
  // distinto dos 6 que já existem nesta barra.
  { id: 'aba-alocacao', rotulo: 'Alocação Equipes', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M5 17c0-2 2-3 4-3s4 1 4 3"/><path d="M16 9h3M16 13h3"/></svg>' },
```

No HTML final (perto da linha 3119), remover a linha:
```html
    <div id="secao-alocacao" style="display:none"></div>
```

- [ ] **Step 2: Remover a aba de `alternarAba`**

Em `alternarAba` (linha 1189-1204), remover as duas linhas:
```js
  document.getElementById('secao-alocacao').style.display = aba === 'alocacao' ? '' : 'none';
```
e
```js
  document.getElementById('aba-alocacao').classList.toggle('aba-ativa', aba === 'alocacao');
```

- [ ] **Step 3: Remover o bloco de estado/interação (mesmo intervalo da Task 2, Step 1)**

Apagar as linhas **1395-1508** e **1635-2269** de `render-semanal.js` (o comentário e todo
o código que a Task 2 copiou verbatim). **Manter** as linhas 1509-1634 (Relatório Semanal
Excel) no lugar — como o corte remove tudo ANTES e DEPOIS delas, elas ficam soltas onde
estavam; confirmar depois do corte que nenhuma delas referenciava algo definido só dentro
do intervalo removido (não deveria — é um recurso concettualmente independente,
`ESTADO_RELATORIO_SEMANAL` não depende de `ESTADO_ALOCACAO`).

- [ ] **Step 4: Remover a chamada de `montarAbaAlocacao` de `recalcularSemanal`**

Em `recalcularSemanal` (por volta da linha 2497 antes do corte do Step 3 — reconferir
depois, os números vão ter mudado), remover:
```js
  // A aba Alocação Equipes também segue a barra compartilhada -- ela mesma
  // recalcula 'indices' com indicesFiltrados (não indicesDaAba, ver o
  // comentário em montarAbaAlocacao), então basta chamá-la aqui para que
  // filtro/mês/limpar-filtros a redesenhem junto com as demais.
  montarAbaAlocacao();
```

- [ ] **Step 5: Remover o wireup do botão da aba em `montarDashboard`**

Remover a linha:
```js
  document.getElementById('aba-alocacao').addEventListener('click', function () { alternarAba('alocacao'); });
```

- [ ] **Step 6: Remover o trecho exclusivo da Alocação dentro de `atualizarDadosAoVivoSemanal`**

Dentro da função (a Alocação não existe mais nesta página, mas `csvEq`/`periodoEq`
continuam necessários para `equipesNaoProdutivas`, que a aba Balanço usa — **não remover
essas duas variáveis**):

Manter:
```js
      var csvEq = textos[3];
      var periodoEq = csvEq ? ComputeEquipesAtivas.mesDaAbaEq(csvEq) : null;
```

Remover o comentário e as atribuições exclusivas da Alocação logo depois (5 linhas de
comentário + 3 atribuições `demandasNovas.equipesCsv/osParaSup/equipesRosterPeriodo = null;`):
```js
      // Equipes ATIVAS (Sheet espelho da aba EQ): mesma montagem que o build
      // faz (build-dashboard.js, montarEquipesAtivas), sobre os MESMOS furos
      // já redirecionados. Alimenta só equipesCsv/osParaSup/
      // equipesRosterPeriodo (consumidos pela aba Alocação Equipes) --
      // NUNCA mais o Realizado da Tabela Semanal (equipesPorDia), que é
      // exclusividade do bloco REALIZADO abaixo desde 2026-08-21.
```
```js
      // A aba Alocação Equipes recomputa o roster a partir deste CSV a cada
      // troca de semana -- sem atualizá-lo aqui, o quadro continuaria
      // mostrando o roster do momento do build depois de um "Atualizar
      // dados". null por padrão (nunca ''), mesma regra de
      // montarEquipesAtivas (build-dashboard.js): sem {ano, mes} o cliente
      // não sabe a que mês os dias pertencem, e roster sem calendário é
      // pior que nenhum.
      demandasNovas.equipesCsv = null;
      // osParaSup segue a mesma regra -- ver o comentário simétrico em
      // montarEquipesAtivas (build-dashboard.js).
      demandasNovas.osParaSup = null;
      // equipesRosterPeriodo (2026-08-21): cobertura da Sheet EQ, separada
      // de equipesPeriodo (cobertura do Realizado/Link 6+7) -- ver o
      // comentário longo em build-dashboard.js sobre por que os dois campos
      // não podem mais compartilhar o mesmo nome.
      demandasNovas.equipesRosterPeriodo = null;

      // osParaSup: só depende de 'furos', usado pela aba Alocação Equipes
      // (equipesDoQuadro resolve supRealizado/colunaRealizada a partir dele).
      // 'var' fora do if (periodoEq) de propósito (escopo de FUNÇÃO): com
      // periodoEq falso ele ainda precisa existir para a atribuição
      // condicional abaixo não lançar ReferenceError.
      //
      // tipologiaPorSondador/agregarEquipesAtivas (que só serviam pra montar
      // equipesPorDia a partir da Sheet ATIVAS) saíram em 2026-08-21 --
      // equipesPorDia é exclusividade do bloco REALIZADO (Link 6+7) agora, e
      // a Sheet ATIVAS só alimenta equipesCsv/equipesRosterPeriodo/
      // osParaSup pra Alocação (ver comentário acima da declaração de csvEq).
      var osParaSup = {};
      furos.forEach(function (f) {
        if (f.os && f.sup && !osParaSup[f.os]) osParaSup[f.os] = f.sup;
      });

      if (periodoEq) {
        demandasNovas.equipesRosterPeriodo = periodoEq;
        demandasNovas.equipesCsv = csvEq;
        demandasNovas.osParaSup = osParaSup;
      }
```

O bloco seguinte (Δ equipes REALIZADO, "equipesNaoProdutivas") permanece intocado — ele
já usa `csvEq`/`periodoEq` que ficaram.

- [ ] **Step 7: Remover as 5 entradas de `BUNDLE_ARQUIVOS` exclusivas da Alocação**

Em `BUNDLE_ARQUIVOS` (linha 795-892), remover o comentário e a linha (perto do fim do
array, linhas 873-891):
```js
  // Alocação Equipes (2026-08-10, Task 9 -- a integração completa da aba
  // é a Task 10, mas o bundle e o wireup mínimo que o TESTE de interação
  // exige já entram aqui, ver a nota no topo do plano/progress.md).
  // equipes-alocaveis.js consome compute-equipes-ativas.js e
  // classificar-dia-equipe.js -- os dois já estão registrados acima.
  // compute-alocacao.js consome equipes-alocaveis.js, render-aba-semanal.js,
  // render-alertas-tendencia.js e compute-semanal.js, todos acima, mais um
  // require de '../comum/calculo-equipes.js' que o bundler REMOVE
  // (DIAS_PREMISSA_MES chega como global pelo <script> de fonteParaCliente(),
  // já injetado antes do bundle -- mesmo mecanismo que compute-balanco.js e
  // compute-alertas-tendencia.js já usam). alocacao-sheet.js não consome
  // nada same-dir. render-aba-alocacao.js consome compute-alocacao.js,
  // equipes-alocaveis.js e, desde a trava de veículo (2026-08-12, Task 6),
  // grupos-veiculo.js direto (conflitosDeVeiculo) -- por isso vem por último.
  // grupos-veiculo.js (2026-08-12) não consome nada same-dir (é matemática pura
  // sobre a coluna Veículo da aba EQ), mas equipes-alocaveis.js e
  // render-aba-alocacao.js o consomem -- por isso vem ANTES dos dois. A ordem
  // desta lista é o contrato de dependência.
  'grupos-veiculo.js', 'equipes-alocaveis.js', 'compute-alocacao.js', 'alocacao-sheet.js', 'render-aba-alocacao.js',
```

Não remover `render-aba-alertas.js`/`render-aba-consolidado.js` do array — as abas
Alertas/Consolidado continuam usando os dois.

- [ ] **Step 8: Remover `URL_ALOCACAO` e o campo `alocacaoUrl` do blob**

Remover a constante (linhas 15-23, incluindo o comentário):
```js
// Web app do Apps Script que guarda a alocação (tools/semanal/apps-script-alocacao.gs).
// Enquanto não for publicado, o literal PENDENTE- mantém a aba em modo local,
// dizendo isso na tela -- mesmo padrão de URL_ESPELHO_AVANCOS_SEMANAL. Viaja
// DENTRO do blob cifrado (ver renderSemanal), não em texto puro no HTML: só
// quem destrava a página a enxerga -- mesmo raciocínio de registros/baseline/
// demandas, mas aqui é uma URL de escrita, não dado protegido por senha.
// Publicado em 2026-08-11. Reimplantar o .gs mantém esta URL (Gerenciar
// implantações > Nova versão); só uma implantação NOVA do zero a trocaria.
const URL_ALOCACAO = 'https://script.google.com/macros/s/AKfycby3jOFa1eOZ9Rtu7mRq8iZWtZdKdg-7ATqzbU-fBba5eLuV5_U69nAe7-Md_3-l_ciB/exec';
```

(esta constante já foi duplicada em `render-alocacao-pagina.js` na Task 1 — não é preciso
"mover com cuidado", já existe nos dois lugares neste momento; este Step só limpa a cópia
que ficou órfã aqui.)

Em `renderSemanal` (linha ~3021), trocar:
```js
  const dadosJson = JSON.stringify({ registros, baseline, demandas, alocacaoUrl: URL_ALOCACAO, historicoRelatorioUrl: URL_HISTORICO_RELATORIO });
```
por (removendo `alocacaoUrl` e excluindo os 3 campos exclusivos da Alocação de `demandas`
antes de embutir no blob — o blob encolhe):
```js
  const { equipesCsv, osParaSup, equipesRosterPeriodo, ...demandasSemAlocacao } = demandas;
  const dadosJson = JSON.stringify({ registros, baseline, demandas: demandasSemAlocacao, historicoRelatorioUrl: URL_HISTORICO_RELATORIO });
```

Em `fecharTendenciaVigente` (por volta da linha 1177, reconferir número depois do corte do
Step 3), remover a linha:
```js
  window.__ALOCACAO_URL__ = dados && dados.alocacaoUrl;
```
(e o comentário que a precede, sobre `clienteAlocacao()`/`window.__ALOCACAO_URL__`).

- [ ] **Step 9: Apagar a cópia antiga da suíte de testes migrada**

Em `test/semanal-render-semanal-wireup.test.js`, apagar as linhas **1723 até o fim do
arquivo** — o mesmo trecho que a Task 2 já copiou (com adaptações) para
`test/semanal-alocacao-pagina-wireup.test.js`. Confirmar que o arquivo termina, depois do
corte, no fechamento do teste `'a chamada a RenderAbaSemanal...'`/último teste do bloco
"outras 6 abas" (linha 1721, `});`).

- [ ] **Step 10: Estender `publicacao-docs-sincronizado.test.js`**

Adicionar ao array `PARES` (depois da entrada `'planejamento semanal'`):
```js
  {
    nome: 'alocação equipes',
    origem: path.join(RAIZ, 'dist', 'alocacao-equipes.html'),
    publicado: path.join(RAIZ, 'docs', 'alocacao-equipes.html'),
    comando: 'cp dist/alocacao-equipes.html docs/alocacao-equipes.html',
  },
```

- [ ] **Step 11: Rodar a suíte inteira**

Run: `node --test test/*.test.js`
Expected: PASS. `test/publicacao-docs-sincronizado.test.js` deve pular (skip) a entrada
nova com "ainda não existe neste worktree" (o build real só roda na Task 4) — não deve
reprovar.

- [ ] **Step 12: Commit**

```bash
git add tools/semanal/render-semanal.js test/semanal-render-semanal-wireup.test.js test/publicacao-docs-sincronizado.test.js
git commit -m "refactor: remove a aba Alocação Equipes de planejamento-semanal.html (migrada pra alocacao-equipes.html)"
```

---

### Task 4: Build real, cópia pra docs/, commit e publicação

**Files:**
- Create (via build, não editar à mão): `dist/planejamento-semanal.html`, `dist/alocacao-equipes.html`
- Create (via cp): `docs/planejamento-semanal.html`, `docs/alocacao-equipes.html`

- [ ] **Step 1: Rodar o build real**

```bash
ORCAMENTO_SENHA='<peça ao dono do projeto>' node tools/semanal/build-dashboard.js
```

Expected: escreve `dist/planejamento-semanal.html` e `dist/alocacao-equipes.html`, sem
erro. Conferir no log as duas linhas `Wrote N bytes to ...`.

- [ ] **Step 2: Copiar pra docs/**

```bash
cp dist/planejamento-semanal.html docs/planejamento-semanal.html
cp dist/alocacao-equipes.html docs/alocacao-equipes.html
```

(Se `dist/avancos-online.csv` ou os outros CSVs online estiverem desatualizados, isso é
independente deste plano — não rodar os fetchers aqui a menos que já estivessem
pendentes antes.)

- [ ] **Step 3: Rodar a suíte inteira de novo**

Run: `node --test test/*.test.js`
Expected: PASS, incluindo agora as duas entradas de `publicacao-docs-sincronizado.test.js`
(planejamento semanal + alocação equipes) sem skip.

- [ ] **Step 4: Verificar ao vivo, não só o status do build**

Depois do push (Step 5), conferir com `curl` as duas URLs publicadas
(`https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html` e
`.../alocacao-equipes.html`) e comparar o "Gerado em"/tamanho com o que acabou de ser
construído — não confiar só no status "built" do Pages (ver o incidente de 2026-07-22 no
CLAUDE.md).

- [ ] **Step 5: Commit e push**

```bash
git add dist/planejamento-semanal.html dist/alocacao-equipes.html docs/planejamento-semanal.html docs/alocacao-equipes.html
git commit -m "build: reconstrói planejamento-semanal.html e publica alocacao-equipes.html como página própria"
git push origin master
```

(Ou o branch de trabalho atual, se `master` não for o branch corrente — confirmar com
`git branch --show-current` antes; ver `docs/superpowers/specs/2026-08-25-alocacao-equipes-pagina-propria-design.md`
para o contexto completo desta extração.)
