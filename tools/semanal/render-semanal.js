'use strict';
const path = require('node:path');
const { formatarMesAno } = require('../comum/datas.js');
const { cifrarComSenha } = require('../comum/criptografia.js');
const {
  cssBase, markupCabecalho, markupAbas, scriptDesbloqueio,
} = require('../comum/render-shell.js');
const { buildBrowserBundle } = require('../comum/browser-bundle.js');
const { fonteParaCliente } = require('../comum/calculo-equipes.js');

// Esta é a 1ª entrega publicável da página nova: casca (cabeçalho + gate de
// senha) e as duas abas da spec (Semanal / Balanço de massa). A aba Semanal
// já monta a tabela do mês vigente em 4 semanas (ver SCRIPT_CLIENTE_SEMANAL,
// montarDashboard); a Task 10 fecha a aba Balanço de massa, que agora desenha
// de verdade (RenderAbaBalanco.renderAbaBalanco, chamada por
// montarAbaBalanco) com seus próprios controles (período/base/dimensão/
// somente ativos) embutidos no HTML que ela mesma produz -- não via
// markupFiltros() da casca compartilhada.
// markupFiltros() (da casca) continua NÃO entrando aqui: a aba Semanal, por
// ora, sempre agrega TODOS os registros (sem recorte) na dimensão fixa
// 'financeiro' -- ver o comentário sobre DIMENSAO_PADRAO abaixo. Só a aba
// Balanço de massa ganhou controles nesta tarefa.

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

// render-aba-semanal.js consome compute-semanal.js (require('./compute-semanal.js'))
// -- por isso vem depois na lista: a ordem aqui é a ordem de dependência, e
// buildBrowserBundle não resolve isso sozinho (ver o comentário no topo dele).
// Mesma regra para o par da Task 10: render-aba-balanco.js consome
// compute-balanco.js (require('./compute-balanco.js')), então vem depois.
//
// compute-balanco.js TAMBÉM consome tools/comum/calculo-equipes.js
// (mediaEquipesPonderada), um require '../' que o bundle REMOVE em vez de
// reescrever (ver o comentário no topo de compute-balanco.js e em
// transformaModulo, tools/comum/browser-bundle.js) -- por isso
// fonteParaCliente() é injetada num <script> À PARTE, ANTES deste bundle,
// lá embaixo em renderSemanal(). Sem isso a aba Balanço de massa quebra em
// produção com ReferenceError, mesmo com os testes em Node passando (Node
// resolve o require normalmente).
const BUNDLE_ARQUIVOS = ['compute-semanal.js', 'render-aba-semanal.js', 'compute-balanco.js', 'render-aba-balanco.js'];

// O gate de senha (scriptDesbloqueio, casca compartilhada) sempre chama
// fecharTendenciaVigente(registros, vigenteIdx) e montarDashboard(registros)
// assim que a senha certa decifra os dados -- as duas PRECISAM existir no
// escopo global da página, senão o desbloqueio quebra com ReferenceError.
//
// fecharTendenciaVigente NÃO é mais identidade pura (era, até a Task 8
// consumir 'registros' de verdade -- ver achado abaixo): a página ainda não
// tem nenhuma série "Tendência" própria pra fechar -- isso continua
// conteúdo de uma tarefa futura (uma versão semanal do fechamento que o
// orçamento já faz). A aba Balanço de massa (Task 10) NÃO precisa disso:
// Tendência foi descartada explicitamente pelo dono do projeto como opção
// de base (ver compute-balanco.js) -- só Previsto/Previsto Inicial entram.
// Não reaproveita a versão do orçamento porque aquela mexe em campos
// (registro.total) que só fazem sentido no contexto da tabela mensal dele.
//
// ACHADO (corrigido nesta task): o gate (scriptDesbloqueio, casca
// compartilhada com o orçamento -- NÃO pode mudar, ver
// test/orcamento-html-inalterado.test.js) faz
// `window.__REGISTROS__ = JSON.parse(jsonTexto)` e passa isso DIRETO pra
// fecharTendenciaVigente. No orçamento jsonTexto decifra pro array de
// registros puro; aqui (renderSemanal) decifra pra `{registros, baseline}`
// -- os dois SÓ entram no HTML dentro do mesmo blob cifrado (ver o
// comentário grande abaixo de renderSemanal). Task 7 nunca notou porque
// montarDashboard não usava o argumento; a Task 8 usa, e sem desembrulhar
// aqui a aba somaria sempre null (o objeto inteiro vira "registros[0]"
// undefined). fecharTendenciaVigente agora desembrulha e guarda o baseline
// em window.__BASELINE__ -- é de lá que montarAbaBalanco (Task 10) lê,
// quando a base escolhida é 'previstoInicial'.
//
// montarDashboard liga a troca de aba E desenha as duas abas (Semanal e,
// desde a Task 10, Balanço de massa). Roda só DEPOIS que a senha certa
// decifra os dados (chamado de dentro de tentarDesbloquear, em
// scriptDesbloqueio -- ver ../comum/render-shell.js): é a ÚNICA vez que
// #secao-semanal/#secao-balanco recebem HTML, e recebem os registros já
// decifrados -- nunca em build (renderSemanal só cifra) nem antes do clique
// em "Abrir", quando SUP/Grupo/Tomador/Tipologia ainda não existem em texto
// plano no navegador.
const SCRIPT_CLIENTE_SEMANAL = `
// MODULOS['compute-semanal.js'], ['render-aba-semanal.js'],
// ['compute-balanco.js'] e ['render-aba-balanco.js'] já estão definidos
// pelo bundle (ver o <script> anterior a este) -- guardados aqui só pra
// este script não precisar repetir a busca em MODULOS. RenderAbaSemanal.
// renderAbaSemanal já embute a divisão em 4 semanas (compute-semanal.js),
// então ComputeSemanal fica sem uso direto aqui. Mesma coisa pro par da
// Task 10: RenderAbaBalanco.renderAbaBalanco já chama calcularLinhas por
// dentro, então ComputeBalanco também fica sem uso direto aqui -- os dois
// só existem pra deixar claro, pra quem ler o bundle no navegador, que
// esses módulos estão carregados.
var ComputeSemanal = MODULOS['compute-semanal.js'];
var RenderAbaSemanal = MODULOS['render-aba-semanal.js'];
var ComputeBalanco = MODULOS['compute-balanco.js'];
var RenderAbaBalanco = MODULOS['render-aba-balanco.js'];

// Fixa em 'financeiro' (mesmo default do orçamento: abre mostrando dinheiro,
// não headcount) porque a aba Semanal ainda não tem seletor de dimensão --
// markupFiltros() não entra aqui (ver comentário no topo do arquivo). Uma
// tarefa futura que adicionar o seletor troca este valor fixo pelo estado
// escolhido pelo usuário.
var DIMENSAO_PADRAO_SEMANAL = 'financeiro';

// Estado dos controles da aba Balanço de massa (Task 10). somenteAtivos
// começa LIGADO -- a grade de origem é densa (34 SUPs x 10 tipologias, todo
// SUP presente em toda tipologia, a maioria zerada); desligado por padrão,
// cada gráfico abriria com a maioria das linhas em comprimento zero (ver o
// mesmo raciocínio em render-aba-balanco.js). Tendência não é opção de base
// -- descartada explicitamente pelo dono do projeto (ver compute-balanco.js).
var ESTADO_BALANCO = { periodo: 'mesVigente', base: 'previsto', dimensao: 'financeiro', somenteAtivos: true };

function indicesTodos(registros) {
  var indices = [];
  for (var i = 0; i < registros.length; i++) indices.push(i);
  return indices;
}

// dados: o que o gate acabou de JSON.parse -- {registros, baseline} (ver o
// ACHADO documentado acima desta constante). Guarda baseline à parte
// (window.__BASELINE__) e devolve só o array de registros, que é o que o
// resto do gate (e montarDashboard) espera em window.__REGISTROS__.
function fecharTendenciaVigente(dados) {
  window.__BASELINE__ = dados && dados.baseline;
  return dados && dados.registros ? dados.registros : dados;
}

function alternarAba(aba) {
  document.getElementById('secao-semanal').style.display = aba === 'semanal' ? '' : 'none';
  document.getElementById('secao-balanco').style.display = aba === 'balanco' ? '' : 'none';
  document.getElementById('aba-semanal').classList.toggle('aba-ativa', aba === 'semanal');
  document.getElementById('aba-balanco').classList.toggle('aba-ativa', aba === 'balanco');
}

// Redesenha #secao-balanco inteira (controles + um gráfico por tipologia)
// com o estado atual de ESTADO_BALANCO, e religa os 4 controles -- eles são
// recriados a cada innerHTML novo (renderControles, em render-aba-balanco.js),
// então os listeners da renderização anterior morreram junto com os
// elementos antigos e precisam ser religados toda vez, depois do innerHTML.
function montarAbaBalanco(registros) {
  var indices = indicesTodos(registros);
  document.getElementById('secao-balanco').innerHTML = RenderAbaBalanco.renderAbaBalanco(registros, indices, {
    periodo: ESTADO_BALANCO.periodo,
    base: ESTADO_BALANCO.base,
    dimensao: ESTADO_BALANCO.dimensao,
    somenteAtivos: ESTADO_BALANCO.somenteAtivos,
    vigenteIdx: window.__VIGENTE_IDX__,
    baseline: window.__BASELINE__,
  });

  document.getElementById('balanco-periodo').addEventListener('change', function (e) {
    ESTADO_BALANCO.periodo = e.target.value;
    montarAbaBalanco(registros);
  });
  document.getElementById('balanco-base').addEventListener('change', function (e) {
    ESTADO_BALANCO.base = e.target.value;
    montarAbaBalanco(registros);
  });
  document.getElementById('balanco-dimensao').addEventListener('change', function (e) {
    ESTADO_BALANCO.dimensao = e.target.value;
    montarAbaBalanco(registros);
  });
  document.getElementById('balanco-somente-ativos').addEventListener('change', function (e) {
    ESTADO_BALANCO.somenteAtivos = e.target.checked;
    montarAbaBalanco(registros);
  });
}

// registros: já decifrados (só é chamada de dentro de tentarDesbloquear,
// depois de decifrarComSenha) -- ver o comentário grande acima desta
// constante. indices cobre TODOS os registros: sem filtro de recorte ainda,
// as duas abas mostram sempre o agregado de todos os registros (ver
// previstoMesVigente em render-aba-semanal.js e listarTipologias em
// render-aba-balanco.js).
function montarDashboard(registros) {
  document.getElementById('aba-semanal').addEventListener('click', function () { alternarAba('semanal'); });
  document.getElementById('aba-balanco').addEventListener('click', function () { alternarAba('balanco'); });
  document.getElementById('secao-semanal').innerHTML = RenderAbaSemanal.renderAbaSemanal(
    registros, indicesTodos(registros), DIMENSAO_PADRAO_SEMANAL, window.__VIGENTE_IDX__
  );
  montarAbaBalanco(registros);
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

  // fonteParaCliente() (tools/comum/calculo-equipes.js) precisa entrar num
  // <script> ANTES do bundle: compute-balanco.js (dentro do bundle) usa
  // mediaEquipesPonderada, mas o require dela ('../comum/calculo-equipes.js')
  // é REMOVIDO por buildBrowserBundle, não reescrito (ver o comentário no
  // topo de transformaModulo, tools/comum/browser-bundle.js, e o mesmo
  // aviso em compute-balanco.js) -- a função só existe se já estiver
  // definida como global no escopo da página quando o bundle rodar. Mesmo
  // mecanismo que tools/orcamento/render-dashboard.js já usa pra este
  // MESMO módulo (lá via trechosParaCliente(), aqui via fonteParaCliente(),
  // que concatena os dois trechos porque esta página nova não tem os dois
  // pontos de injeção separados que o orçamento tem). Sem isto, a aba
  // Balanço de massa quebra em produção com ReferenceError -- e os testes
  // em Node passam do mesmo jeito, porque lá o require resolve de verdade
  // (ver a prova em test/semanal-render-aba-balanco-wireup.test.js).
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
  <script>${fonteParaCliente()}</script>
  <script>${bundle}</script>
  <script>${SCRIPT_CLIENTE_SEMANAL}</script>
</body>
</html>`;
}

module.exports = { renderSemanal };
