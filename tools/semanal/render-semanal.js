'use strict';
const path = require('node:path');
const { formatarMesAno } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupAbas, scriptDesbloqueio,
} = require('../comum/render-shell.js');
const { buildBrowserBundle } = require('../comum/browser-bundle.js');

// Esta é a 1ª entrega publicável da página nova: casca (cabeçalho + gate de
// senha) e as duas abas da spec (Semanal / Balanço de massa), ainda sem
// conteúdo -- cada uma é só um <div> vazio que uma tarefa futura preenche.
// markupFiltros() NÃO entra aqui (ao contrário do orçamento): não faz
// sentido oferecer um filtro antes de existir o que filtrar.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mesmos dois ícones (tabela/gráfico de barras) que o orçamento já usa nas
// abas Tabela/Gráfico -- mesmo sistema visual, mesma linguagem de ícone
// pros dois dashboards deste repositório.
const ABAS_VISUALIZACAO = [
  { id: 'aba-semanal', rotulo: 'Semanal', ativa: true,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>' },
  { id: 'aba-balanco', rotulo: 'Balanço de massa', ativa: false,
    svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>' },
];

// Só compute-semanal.js por enquanto -- é o único módulo de tools/semanal/
// que o navegador precisa hoje. Uma tarefa futura que adicionar outro
// módulo de cliente entra nesta lista, respeitando a ordem de dependência
// (ver o comentário no topo de buildBrowserBundle).
const BUNDLE_ARQUIVOS = ['compute-semanal.js'];

// O gate de senha (scriptDesbloqueio, casca compartilhada) sempre chama
// fecharTendenciaVigente(registros, vigenteIdx) e montarDashboard(registros)
// assim que a senha certa decifra os dados -- as duas PRECISAM existir no
// escopo global da página, senão o desbloqueio quebra com ReferenceError.
//
// fecharTendenciaVigente aqui é identidade (devolve os registros como
// vieram): a página ainda não tem nenhuma série "Tendência" própria pra
// fechar -- isso é conteúdo de uma tarefa futura (a aba Balanço de massa,
// ou uma versão semanal do fechamento que o orçamento já faz). Não
// reaproveita a versão do orçamento porque aquela mexe em campos
// (registro.total) que só fazem sentido no contexto da tabela mensal dele.
//
// montarDashboard, com as duas abas vazias, só liga a troca de aba -- não
// tem tabela/gráfico pra montar ainda.
const SCRIPT_CLIENTE_SEMANAL = `
// MODULOS['compute-semanal.js'] já está definido pelo bundle (ver o
// <script> anterior a este) -- guardado aqui só pra tarefas futuras não
// precisarem repetir a busca em MODULOS.
var ComputeSemanal = MODULOS['compute-semanal.js'];

function fecharTendenciaVigente(registros) {
  return registros;
}

function alternarAba(aba) {
  document.getElementById('secao-semanal').style.display = aba === 'semanal' ? '' : 'none';
  document.getElementById('secao-balanco').style.display = aba === 'balanco' ? '' : 'none';
  document.getElementById('aba-semanal').classList.toggle('aba-ativa', aba === 'semanal');
  document.getElementById('aba-balanco').classList.toggle('aba-ativa', aba === 'balanco');
}

function montarDashboard(registros) {
  document.getElementById('aba-semanal').addEventListener('click', function () { alternarAba('semanal'); });
  document.getElementById('aba-balanco').addEventListener('click', function () { alternarAba('balanco'); });
}
`;

// registros: array de registros da MATRIZ (mesmo formato do orçamento --
// ver tools/orcamento/parse-matriz.js). baseline: dados da linha de base
// (formato ainda em aberto -- só passa adiante, cifrado, pra tarefa futura
// que decidir como usá-lo na aba Balanço de massa).
//
// Os REGISTROS SÓ ENTRAM no HTML dentro do blob cifrado (dadosCifrados) --
// nunca soltos no markup ou no JS de cliente -- porque SUP/Grupo/Tomador/
// Tipologia são protegidos pela senha e este HTML vai pra um GitHub Pages
// público.
function renderSemanal({ registros, baseline, senha, geradoEm }) {
  if (!senha) {
    throw new Error('renderSemanal requer "senha" -- os registros (SUP/Grupo/Tomador/Tipologia/valores) são cifrados com ela antes de ir pro HTML.');
  }

  const dadosJson = JSON.stringify({ registros, baseline });
  const dadosCifrados = cifrarComSenha(dadosJson, senha);
  const dadosCifradosJson = JSON.stringify(dadosCifrados).replace(/<\/script/gi, '<\\/script');

  // vigenteIdx aqui é uma simplificação deliberada: ao contrário do
  // orçamento (calcularVigenteIdx, que compara o ano de 'periodos' com o
  // de 'geradoEm'), renderSemanal não recebe 'periodos' -- a interface da
  // spec é só {registros, baseline, senha, geradoEm}. Assume-se que os
  // registros são sempre do ano corrente (mesma premissa que o resto do
  // projeto já faz), então o mês de geradoEm já É o mês vigente.
  const vigenteIdx = geradoEm.getUTCMonth();

  const bundle = buildBrowserBundle(path.join(__dirname), BUNDLE_ARQUIVOS);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>PLANEJAMENTO SEMANAL</title>
<style>
${cssBase()}
</style>
</head>
<body>
  <main>
${markupCabecalho({
    titulo: 'Planejamento Semanal',
    subtitulo: escapeHtml(formatarMesAno(geradoEm)),
    recuo: '  ',
  })}

  <div id="gate-senha" class="gate-senha">
    <div class="gate-senha-box">
      <h2>Digite a senha para abrir o dashboard</h2>
      <input type="password" id="campo-senha" autocomplete="off" placeholder="Senha">
      <button id="btn-desbloquear" type="button">Abrir</button>
      <div id="gate-senha-erro" class="gate-senha-erro" style="display:none"></div>
    </div>
  </div>

  <div id="conteudo-protegido" style="display:none">
${markupAbas(ABAS_VISUALIZACAO, '    ')}
    <div id="secao-semanal"></div>
    <div id="secao-balanco" style="display:none"></div>
  </div>
  </main>
  <script>window.__VIGENTE_IDX__ = ${vigenteIdx};</script>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${scriptDesbloqueio()}</script>
  <script>${bundle}</script>
  <script>${SCRIPT_CLIENTE_SEMANAL}</script>
</body>
</html>`;
}

module.exports = { renderSemanal };
