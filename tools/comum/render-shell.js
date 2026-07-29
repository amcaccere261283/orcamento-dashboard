'use strict';

// Casca visual compartilhada pelos dashboards deste repositório: a header-bar,
// a barra de filtros multi-select, o seletor de abas, o gate de senha e o CSS
// que sustenta tudo isso.
//
// ATENÇÃO ao CSS: cssBase() NÃO é uma base neutra. Ela devolve o CSS INTEIRO
// do dashboard de orçamento, inclusive as ~79 linhas que só ele usa (gráfico,
// tabela, chips de tipologia, alertas). Ver o comentário em cima de cssBase()
// antes de reaproveitá-la numa página nova.
//
// O texto aqui foi RECORTADO de tools/orcamento/render-dashboard.js sem
// nenhuma reformatação -- o dashboard de orçamento já está publicado, e
// test/orcamento-html-inalterado.test.js prova byte a byte que o HTML dele
// não mudou. Por isso este arquivo mantém 'var' no JS de cliente, um literal
// de CSS de ~250 linhas e os comentários originais: preservar o texto vale
// mais que modernizar o código. Limpeza, se vier, é trabalho à parte.
//
// Toda função de markup recebe um 'recuo' (a indentação da linha de abertura)
// e devolve o bloco já indentado, sem quebra de linha no fim -- é o que
// permite substituir o markup literal de render-dashboard.js por uma chamada
// sem mexer num único espaço do HTML gerado.

const CSS_BASE = `  :root {
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --muted: #898781;
    --gridline: #2c2c2a;
    --border: rgba(255,255,255,0.10);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--page);
    color: var(--text-primary);
    padding: 24px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .generated { color: var(--text-secondary); font-size: 13px; margin-bottom: 20px; }
  .watermark {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(70vw, 900px);
    height: auto;
    opacity: 0.16;
    pointer-events: none;
    z-index: 0;
  }
  .header-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .header-bar img { height: 36px; width: auto; }
  .header-bar-title { flex: 1 1 200px; min-width: 0; }
  .gate-senha {
    position: relative; z-index: 1;
    display: flex; align-items: center; justify-content: center;
    min-height: 40vh;
  }
  .gate-senha-box {
    background: var(--surface-1); border: 2px solid #f6b53f; border-radius: 12px;
    padding: 32px; max-width: 360px; width: 100%; text-align: center;
  }
  .gate-senha-box h2 { margin: 0 0 16px; font-size: 16px; }
  .gate-senha-box input {
    width: 100%; padding: 10px 12px; margin-bottom: 12px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--page); color: var(--text-primary); font-size: 14px;
  }
  .gate-senha-box button {
    width: 100%; padding: 10px 16px;
    border: 2px solid #f6b53f; border-radius: 8px;
    background: var(--surface-1); color: var(--text-primary);
    font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .gate-senha-box button:hover { background: rgba(246,181,63,0.1); }
  .gate-senha-box button:disabled { opacity: 0.6; cursor: wait; }
  .gate-senha-erro { color: #f0857a; font-size: 13px; margin-top: 10px; }
  .filtros { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  .filtros-selecao { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .filtros-acoes { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .filtros select,
  #limpar-filtros,
  #atualizar-dashboard,
  .abas-visualizacao button {
    transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 100ms ease, box-shadow 150ms ease;
  }
  .filtros select:focus-visible,
  #limpar-filtros:focus-visible,
  #atualizar-dashboard:focus-visible,
  .abas-visualizacao button:focus-visible,
  .gate-senha-box input:focus-visible,
  .gate-senha-box button:focus-visible {
    outline: 2px solid #f6b53f; outline-offset: 2px;
  }
  .filtros select {
    padding: 8px 30px 8px 10px; height: 36px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23c3c2b7' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center;
    color: var(--text-primary);
    font-size: 13px; cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }
  .filtros select:hover { border-color: rgba(246,181,63,0.5); }
  .filtro-multi { position: relative; }
  .filtro-multi-trigger {
    display: inline-flex; align-items: center; gap: 8px;
    max-width: 190px;
    padding: 8px 10px; height: 36px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-primary);
    font-size: 13px; cursor: pointer; white-space: nowrap;
  }
  .filtro-multi-trigger span,
  .filtro-multi-trigger { overflow: hidden; text-overflow: ellipsis; }
  .filtro-multi-seta { flex: none; margin-left: auto; color: #c3c2b7; transition: transform 150ms ease; }
  .filtro-multi-trigger:hover { border-color: rgba(246,181,63,0.5); }
  .filtro-multi.aberto .filtro-multi-trigger { border-color: #f6b53f; }
  .filtro-multi.aberto .filtro-multi-seta { transform: rotate(180deg); }
  .filtro-multi-painel {
    position: absolute; top: calc(100% + 4px); left: 0; z-index: 30;
    min-width: 210px; max-width: 300px; max-height: 260px; overflow-y: auto;
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45);
    padding: 6px;
  }
  .filtro-multi-painel[hidden] { display: none; }
  .filtro-multi-busca {
    position: sticky; top: 0; z-index: 1;
    display: block; width: 100%; box-sizing: border-box;
    margin-bottom: 6px; padding: 6px 8px;
    border: 1px solid var(--border); border-radius: 4px;
    background: var(--surface-1); color: var(--text-primary); font-size: 13px;
  }
  .filtro-multi-busca::placeholder { color: var(--text-secondary); }
  .filtro-multi-busca:focus-visible { outline: 2px solid #f6b53f; outline-offset: 1px; }
  .filtro-multi-item {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 8px; border-radius: 4px; cursor: pointer;
    font-size: 13px; color: var(--text-primary); white-space: nowrap;
  }
  .filtro-multi-item:hover { background: rgba(255,255,255,0.05); }
  .filtro-multi-item input[type="checkbox"] { accent-color: #f6b53f; cursor: pointer; flex: none; }
  .filtro-multi-vazio { padding: 7px 8px; font-size: 13px; color: var(--text-secondary); }
  #limpar-filtros,
  #atualizar-dashboard,
  .abas-visualizacao button {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; cursor: pointer; white-space: nowrap;
  }
  #limpar-filtros svg, #atualizar-dashboard svg, .abas-visualizacao button svg { flex: none; }
  #limpar-filtros {
    height: 36px; padding: 0 14px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-secondary);
  }
  #limpar-filtros:hover { border-color: #f6b53f; color: var(--text-primary); background: rgba(255,255,255,0.04); }
  #limpar-filtros:active { transform: translateY(1px); }
  #atualizar-dashboard {
    height: 38px; padding: 0 18px;
    border: 2px solid #f6b53f; border-radius: 8px;
    background: var(--surface-1); color: var(--text-primary);
    font-weight: 600;
    box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset, 0 2px 6px rgba(0,0,0,0.35);
  }
  #atualizar-dashboard:hover { background: rgba(246,181,63,0.14); box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 10px rgba(0,0,0,0.4); transform: translateY(-1px); }
  #atualizar-dashboard:active { transform: translateY(0); box-shadow: 0 1px 2px rgba(0,0,0,0.3) inset; }
  #atualizar-dashboard:active svg { transform: rotate(70deg); }
  #atualizar-dashboard svg { transition: transform 300ms ease; }
  .status-atualizacao { font-size: 12px; color: var(--text-secondary); margin-left: 8px; }
  .status-atualizacao.status-erro { color: #e0684f; }
  .nota-premissa {
    width: 100%; margin-top: 10px; padding: 8px 12px;
    border: 1px solid var(--border); border-radius: 6px;
    background: rgba(255,255,255,0.03);
    font-size: 12px; color: var(--text-secondary);
  }
  .abas-visualizacao {
    display: flex; gap: 2px;
    background: rgba(0,0,0,0.3);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 3px;
  }
  .abas-visualizacao button {
    height: 30px; padding: 0 14px;
    border: none; border-radius: 6px;
    background: transparent; color: var(--text-secondary);
  }
  .abas-visualizacao button:hover { color: var(--text-primary); }
  .abas-visualizacao button:active { transform: translateY(1px); }
  .abas-visualizacao button.aba-ativa {
    background: var(--surface-1); color: var(--text-primary); font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(246,181,63,0.4) inset;
  }
  @media (prefers-reduced-motion: reduce) {
    .filtros select, #limpar-filtros, #atualizar-dashboard, .abas-visualizacao button, #atualizar-dashboard svg { transition: none; }
  }
  #secao-grafico {
    background: rgba(26,26,25,0.68); border-radius: 8px; padding: 16px 8px;
    position: relative; z-index: 1;
  }
  .grafico-svg { width: 100%; height: auto; display: block; }
  .grafico-painel { margin-bottom: 28px; }
  .grafico-painel:last-child { margin-bottom: 0; }
  .grafico-bloco-dimensao + .grafico-bloco-dimensao { margin-top: 28px; padding-top: 28px; border-top: 1px solid var(--border); }
  .grafico-titulo { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
  .grafico-eixo-texto { fill: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
  .grafico-gridline, .grafico-linha-guia { stroke: var(--gridline); stroke-width: 1; }
  .grafico-linha { stroke-linecap: round; stroke-linejoin: round; }
  .grafico-rotulo { fill: var(--text-secondary); font-size: 10px; font-variant-numeric: tabular-nums; }
  .grafico-rotulo-final { fill: var(--text-primary); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; paint-order: stroke; stroke: var(--page); stroke-width: 3px; stroke-linejoin: round; }
  .grafico-rotulo { paint-order: stroke; stroke: var(--page); stroke-width: 3px; stroke-linejoin: round; }
  .grafico-hit { cursor: pointer; pointer-events: all; }
  .grafico-marcador { pointer-events: none; }
  .grafico-tooltip {
    position: absolute; pointer-events: none;
    background: #0d0d0d; border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 10px; font-size: 12px; color: var(--text-primary);
    white-space: nowrap; z-index: 5; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .table-scroll { overflow-x: auto; border-radius: 8px; position: relative; z-index: 1; }
  table { width: 100%; border-collapse: collapse; background: rgba(26,26,25,0.68); }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--gridline); font-size: 13px; }
  td.num { font-variant-numeric: tabular-nums; }
  th {
    color: var(--text-secondary); font-weight: 600; background: #141412;
    position: sticky; top: 0; z-index: 1;
    box-shadow: 0 1px 0 var(--gridline), 0 2px 6px rgba(0,0,0,0.3);
  }
  /* Primeira coluna (SUP) fixa ao rolar a tabela pro lado -- especificidade
     igual à das regras de fundo por tipo de linha (.linha-total-sup td etc.)
     abaixo, então essas continuam ganhando por ordem (vêm depois no CSS) e
     a coluna fixa herda o tom certo em cada tipo de linha, em vez de travar
     num fundo genérico. */
  td:first-child, th:first-child { position: sticky; left: 0; z-index: 1; }
  td:first-child { background: var(--surface-1); }
  th:first-child { z-index: 2; }
  #corpo-tabela tr:hover { filter: brightness(1.14); }
  .tipologia-chip {
    display: inline-block;
    background: var(--chip-color); color: #fff;
    border-radius: 4px; padding: 2px 8px;
    font-size: 12px; font-weight: 600;
  }
  .tipologia-chip-total { background: rgba(26,26,25,0.6); color: var(--text-primary); border: 2px solid var(--text-secondary); }
  .celula-mes { white-space: nowrap; }
  .celula-total-linha { white-space: nowrap; font-weight: 700; border-left: 2px solid var(--border); }
  .serie-label { font-weight: 700; border-left: 4px solid transparent; padding-left: 10px; white-space: nowrap; }
  .linha-previsto-inicial .serie-label, .linha-previsto-inicial .celula-mes, .linha-previsto-inicial .celula-total-linha { color: #8b8a82; }
  .linha-previsto-inicial .serie-label { border-left-color: #8b8a82; }
  .linha-previsto .serie-label, .linha-previsto .celula-mes, .linha-previsto .celula-total-linha { color: #2f6ad0; }
  .linha-previsto .serie-label { border-left-color: #2f6ad0; }
  .linha-realizado .serie-label, .linha-realizado .celula-mes, .linha-realizado .celula-total-linha { color: #7fd858; }
  .linha-realizado .serie-label { border-left-color: #7fd858; }
  .linha-total .serie-label, .linha-total .celula-mes, .linha-total .celula-total-linha { color: #f6b53f; }
  .linha-total .serie-label { border-left-color: #f6b53f; }
  tr.linha-total td { border-bottom: 2px solid var(--gridline); }
  .linha-total-sup td { background: rgba(0,0,0,0.32); }
  .linha-total-geral td { background: rgba(246,181,63,0.10); }
  tr.linha-total.linha-total-geral td { border-bottom: 2px solid #f6b53f; }
  .linha-total-geral-tipologia td { background: rgba(255,255,255,0.03); }
  tr.linha-total.linha-total-geral-tipologia td { border-bottom: 1px solid var(--gridline); }
  .valor-repetido { color: rgba(255,255,255,0.14); }
  .filtros-alertas { margin-bottom: 16px; }
  .status-circulo {
    display: inline-block; width: 10px; height: 10px; border-radius: 50%;
    margin-right: 6px; vertical-align: middle;
  }
  .busca-alertas {
    display: block; width: 100%; max-width: 320px; box-sizing: border-box;
    margin-bottom: 12px; padding: 8px 10px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-primary); font-size: 13px;
  }
  .busca-alertas::placeholder { color: var(--text-secondary); }
  .busca-alertas:focus-visible { outline: 2px solid #f6b53f; outline-offset: 1px; }`;

// O CSS do dashboard, sem as tags <style> -- quem monta a página as escreve.
//
// O nome promete menos do que a função entrega, e isso é intencional por ora.
// Do literal acima, só uma parte é de fato compartilhável:
//
//   compartilhável  tokens de :root, reset, body/h1/.generated, .watermark,
//                   .header-bar*, .gate-senha*, .filtros*, .filtro-multi*,
//                   .abas-visualizacao*, @media (prefers-reduced-motion)
//   só do orçamento #limpar-filtros e #atualizar-dashboard (o markup dos dois
//                   ficou em render-dashboard.js, em MARKUP_ACOES);
//                   #secao-grafico, .grafico-*, table/th/td, .tipologia-chip*,
//                   .celula-*, .serie-label, .linha-*, .valor-repetido,
//                   .status-circulo, .busca-alertas*, .filtros-alertas
//
// A segunda parte são ~79 das 254 linhas, e quem chamar cssBase() herda todas
// -- CSS morto, mas inofensivo (são seletores que a página nova não usa).
//
// Não dividi o literal porque partir a string mudaria os bytes do HTML do
// orçamento, que já está publicado e é o que o golden protege
// (test/orcamento-html-inalterado.test.js). A divisão é possível, mas é
// trabalho próprio: separar em cssBase() + cssTabelaOrcamento(), conferir que
// a concatenação na ordem certa reproduz o texto atual e, só então, regenerar
// o golden DE PROPÓSITO, com o diff revisado linha a linha. Até lá, herdar o
// CSS inteiro é o preço de manter a prova de que o dashboard não mudou.
function cssBase() {
  return CSS_BASE;
}

// A header-bar: logo opcional à esquerda, título e subtítulo à direita.
// 'logo' é markup pronto (<img ...>) ou '' -- quando vazio a linha fica só
// com o recuo, exatamente como o template original, que interpolava uma
// string vazia ali.
//
// ESCAPE É DO CHAMADOR: 'titulo' e 'subtitulo' entram crus no HTML, sem
// passar por escapeHtml. É assim porque o orçamento já escapa o que precisa
// antes de chamar (o subtítulo tem data formatada), e escapar aqui mudaria o
// texto gerado. Quem passar valor vindo de planilha ou de usuário escapa
// antes.
function markupCabecalho({ titulo, subtitulo, logo, recuo }) {
  var r = recuo === undefined ? '' : recuo;
  var img = logo === undefined || logo === null ? '' : logo;
  return r + '<div class="header-bar">\n'
    + r + '  ' + img + '\n'
    + r + '  <div class="header-bar-title">\n'
    + r + '    <h1>' + titulo + '</h1>\n'
    + r + '    <div class="generated">' + subtitulo + '</div>\n'
    + r + '  </div>\n'
    + r + '</div>';
}

// A seta do gatilho de cada filtro multi-select. Idêntica nos 12 filtros do
// orçamento -- conferido antes da extração.
const SETA_FILTRO_MULTI = '<svg class="filtro-multi-seta" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Um filtro multi-select: gatilho com o rótulo do estado atual e o painel
// vazio, que o JS de cliente preenche com as opções. Interna: só markupFiltros
// chama -- não está no module.exports porque ninguém de fora precisa dela.
//
// ESCAPE É DO CHAMADOR, como em markupCabecalho: 'filtro.rotulo' entra cru.
function markupFiltroMulti(filtro) {
  return '<div class="filtro-multi" id="' + filtro.id + '">'
    + '<button type="button" class="filtro-multi-trigger">' + filtro.rotulo + SETA_FILTRO_MULTI + '</button>'
    + '<div class="filtro-multi-painel" hidden></div></div>';
}

// A barra de filtros inteira. 'filtros' vira a faixa .filtros-selecao;
// 'acoes' e 'extra' são markup pronto do chamador (já indentado por ele),
// porque o que entra ali é específico de cada página -- no orçamento, as
// abas + os botões de limpar/atualizar e a nota de premissa.
function markupFiltros(filtros, opcoes) {
  var op = opcoes || {};
  var r = op.recuo === undefined ? '' : op.recuo;
  var classes = op.classes ? 'filtros ' + op.classes : 'filtros';
  var linhas = [r + '<div class="' + classes + '">', r + '  <div class="filtros-selecao">'];
  (filtros || []).forEach(function (filtro) {
    linhas.push(r + '    ' + markupFiltroMulti(filtro));
  });
  linhas.push(r + '  </div>');
  if (op.acoes) linhas.push(op.acoes);
  if (op.extra) linhas.push(op.extra);
  linhas.push(r + '</div>');
  return linhas.join('\n');
}

// O seletor de abas. 'abas' é [{ id, rotulo, svg, ativa }], na ordem em que
// aparecem; só a que tem 'ativa' ganha a classe aba-ativa.
function markupAbas(abas, recuo) {
  var r = recuo === undefined ? '' : recuo;
  var linhas = [r + '<div class="abas-visualizacao">'];
  (abas || []).forEach(function (aba) {
    linhas.push(r + '  <button id="' + aba.id + '" type="button"'
      + (aba.ativa ? ' class="aba-ativa"' : '') + '>' + aba.svg + aba.rotulo + '</button>');
  });
  linhas.push(r + '</div>');
  return linhas.join('\n');
}

// A tabela inteira (linhas, filtros, cores de tipologia) é montada no
// navegador -- ver o comentário logo abaixo de SCRIPT_CLIENTE_INICIO. Este
// script SEMPRE roda (não depende de senha): implementa só o gate e, uma
// vez decifrado, delega pro segundo script (SCRIPT_CLIENTE_TABELA) que faz
// o trabalho de fato. Separados em duas strings só por legibilidade -- os
// dois rodam como um script só na página.
const SCRIPT_CLIENTE_GATE = `
function base64ParaBytes(base64) {
  var binario = atob(base64);
  var bytes = new Uint8Array(binario.length);
  for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// Espelha tools/orcamento/criptografia.js's decifrarComSenha, usando
// crypto.subtle (Web Crypto) no lugar de node:crypto -- mesmo algoritmo
// (PBKDF2-SHA256 pra derivar a chave, AES-256-GCM pra decifrar), mesmo
// formato de pacote (tag de autenticação concatenada no fim dos dados
// cifrados, que é o que crypto.subtle.decrypt espera por padrão).
async function decifrarComSenha(pacote, senha) {
  var salt = base64ParaBytes(pacote.salt);
  var iv = base64ParaBytes(pacote.iv);
  var dados = base64ParaBytes(pacote.dados);
  var chaveBase = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  var chave = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt, iterations: pacote.iteracoes, hash: 'SHA-256' },
    chaveBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  var textoPlanoBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, chave, dados);
  return new TextDecoder().decode(textoPlanoBuffer);
}

function mostrarErroSenha(msg) {
  var erro = document.getElementById('gate-senha-erro');
  erro.textContent = msg;
  erro.style.display = 'block';
}

async function tentarDesbloquear() {
  var campo = document.getElementById('campo-senha');
  var botao = document.getElementById('btn-desbloquear');
  var senha = campo.value;
  botao.disabled = true;
  botao.textContent = 'Verificando…';
  try {
    var jsonTexto = await decifrarComSenha(window.__DADOS_CIFRADOS__, senha);
    window.__REGISTROS__ = JSON.parse(jsonTexto);
    window.__REGISTROS__ = fecharTendenciaVigente(window.__REGISTROS__, window.__VIGENTE_IDX__);
    document.getElementById('gate-senha').style.display = 'none';
    document.getElementById('conteudo-protegido').style.display = '';
    montarDashboard(window.__REGISTROS__);
  } catch (e) {
    mostrarErroSenha('Senha incorreta.');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Abrir';
  }
}

document.getElementById('btn-desbloquear').addEventListener('click', tentarDesbloquear);
document.getElementById('campo-senha').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') tentarDesbloquear();
});
document.getElementById('campo-senha').focus();
`;

// O JS de cliente do gate de senha. Depende de a página definir
// window.__DADOS_CIFRADOS__ e, no sucesso, de existirem montarDashboard,
// fecharTendenciaVigente e window.__VIGENTE_IDX__ -- que ficam no script de
// conteúdo de cada página, não aqui.
function scriptDesbloqueio() {
  return SCRIPT_CLIENTE_GATE;
}

// Lógica de interação dos filtros multi-select (Set de valores selecionados
// por campo, indicesFiltrados, montarFiltroMulti). Extraída de
// tools/orcamento/render-dashboard.js na Fase 2 do Planejamento Semanal (ver
// docs/superpowers/specs/2026-07-29-planejamento-semanal-filtros-design.md)
// -- markupFiltros()/markupFiltroMulti() (acima) só geram o esqueleto HTML
// vazio; isto aqui é o que liga os checkboxes de verdade.
//
// Generalizado na extração (por isso o HTML do orçamento deixou de ser
// byte-a-byte idêntico ao golden anterior -- o golden foi regenerado de
// propósito, com o diff revisado linha a linha, ver
// test/orcamento-html-inalterado.test.js):
//   - `estado` (chave -> Set de valores marcados) é sempre parâmetro
//     explícito agora, nunca cai de volta pra um global fixo -- cada página
//     tem o seu (filtrosSelecionados/filtrosAlertas no orçamento).
//   - montarFiltroMulti ganhou `aoMudar(cfg)`, chamado no fim de toda
//     mudança de checkbox -- antes disso ficar recalcularTabela() e
//     recalcularAlertas() hardcoded, o que impedia qualquer outra página de
//     reusar a função (ela não tem Tabela nem Alertas).
const SCRIPT_CLIENTE_FILTROS = `
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var TIPOLOGIAS_SONDAGEM_ESPECIAL = { CPTU: true, BL: true, SH: true, VT: true };
function categoriaTipologia(tipologia) {
  var key = String(tipologia || '').trim().toUpperCase();
  if (key === 'LAB.C') return 'labConvencional';
  if (key === 'LAB.E') return 'labEspecial';
  if (TIPOLOGIAS_SONDAGEM_ESPECIAL[key]) return 'sondagemEspecial';
  return 'sondagemConvencional';
}

function linhasDistintas(registros, campo) {
  var vistos = {};
  var resultado = [];
  registros.forEach(function (r) {
    var v = r[campo];
    if (v && !vistos[v]) { vistos[v] = true; resultado.push(v); }
  });
  resultado.sort();
  return resultado;
}

function capitalizarPalavras(texto) {
  return (texto || '').toString().toLowerCase().split(' ').map(function (palavra) {
    return palavra ? palavra.charAt(0).toUpperCase() + palavra.slice(1) : palavra;
  }).join(' ');
}

// cfg.chave === 'tipologia' com estado.categoria não-vazio: cascata em
// relação à Categoria, listando só as tipologias que pertencem à(s)
// categoria(s) marcada(s). Só se aplica se a página tiver os dois campos
// (categoria e tipologia) na mesma config -- senão estado.categoria é
// undefined e o \`&&\` curto-circuita antes de acessar .size.
function opcoesFiltro(cfg, registros, estado) {
  if (cfg.opcoesFixas) return cfg.opcoesFixas;

  if (cfg.chave === 'tipologia' && estado.categoria && estado.categoria.size > 0) {
    var tipologiasDaCategoria = linhasDistintas(registros, 'tipologia').filter(function (t) {
      return estado.categoria.has(categoriaTipologia(t));
    });
    return tipologiasDaCategoria.map(function (v) { return { valor: v, rotulo: v }; });
  }

  if (cfg.rotuloComposto) {
    var vistoSup = {};
    var opcoes = [];
    registros.forEach(function (r) {
      if (!r[cfg.campo] || vistoSup[r[cfg.campo]]) return;
      vistoSup[r[cfg.campo]] = true;
      var partes = [r.tomador, r.escopo].filter(Boolean).join(' / ');
      opcoes.push({ valor: r[cfg.campo], rotulo: partes ? r[cfg.campo] + ' — ' + partes : r[cfg.campo] });
    });
    opcoes.sort(function (a, b) { return a.valor < b.valor ? -1 : a.valor > b.valor ? 1 : 0; });
    return opcoes;
  }

  if (cfg.rotuloCapitalizado) {
    return linhasDistintas(registros, cfg.campo).map(function (v) { return { valor: v, rotulo: capitalizarPalavras(v) }; });
  }

  return linhasDistintas(registros, cfg.campo).map(function (v) { return { valor: v, rotulo: v }; });
}

function atualizarRotuloFiltro(cfg, opcoes, estado) {
  var trigger = document.querySelector('#' + cfg.id + ' .filtro-multi-trigger');
  var seta = trigger.querySelector('.filtro-multi-seta');
  var selecionados = estado[cfg.chave];
  var texto;
  if (selecionados.size === 0) {
    texto = cfg.rotuloPadrao;
  } else if (selecionados.size === 1) {
    var valor = selecionados.values().next().value;
    var opcao = opcoes.filter(function (o) { return o.valor === valor; })[0];
    texto = opcao ? opcao.rotulo : valor;
  } else {
    texto = selecionados.size + ' selecionadas';
  }
  trigger.textContent = texto;
  trigger.appendChild(seta);
}

function normalizarBusca(texto) {
  var normalizado = (texto || '').toString().toLowerCase().normalize('NFD');
  var resultado = '';
  for (var i = 0; i < normalizado.length; i++) {
    var codigo = normalizado.charCodeAt(i);
    if (codigo < 768 || codigo > 879) resultado += normalizado[i];
  }
  return resultado;
}

function aplicarSelecaoExclusiva(estadoSet, valor) {
  estadoSet.clear();
  estadoSet.add(valor);
}

function filtroExclui(filtro, valor) {
  return !!(filtro && filtro.size > 0 && !filtro.has(valor));
}

function indicesFiltrados(registros, filtroTipologia, filtroCategoria, filtroGrupo, filtroSup, filtroOrigem) {
  var indices = [];
  registros.forEach(function (registro, indice) {
    if (filtroExclui(filtroTipologia, registro.tipologia)) return;
    if (filtroExclui(filtroCategoria, categoriaTipologia(registro.tipologia))) return;
    if (filtroExclui(filtroGrupo, registro.grupo)) return;
    if (filtroExclui(filtroSup, registro.sup)) return;
    if (filtroExclui(filtroOrigem, registro.origem)) return;
    indices.push(indice);
  });
  return indices;
}

// aoMudar(cfg): chamado 1x por mudança de checkbox, depois do Set/rótulo já
// atualizados (e depois do remount de exclusivo, se for o caso) -- é onde a
// página decide o que recalcular. estado é sempre obrigatório (chave ->
// Set); cada página passa o seu (não existe mais fallback pra um global).
function montarFiltroMulti(cfg, registros, estado, aoMudar) {
  var opcoes = opcoesFiltro(cfg, registros, estado);
  var valoresValidos = {};
  opcoes.forEach(function (o) { valoresValidos[o.valor] = true; });
  estado[cfg.chave].forEach(function (v) {
    if (!valoresValidos[v]) estado[cfg.chave].delete(v);
  });

  var painel = document.querySelector('#' + cfg.id + ' .filtro-multi-painel');
  var listaHtml = opcoes.length
    ? opcoes.map(function (o) {
        var marcado = estado[cfg.chave].has(o.valor) ? ' checked' : '';
        return '<label class="filtro-multi-item"><input type="checkbox" value="' + escapeHtml(o.valor) + '"' + marcado + '>' + escapeHtml(o.rotulo) + '</label>';
      }).join('')
    : '<div class="filtro-multi-vazio">Nenhuma opção</div>';
  painel.innerHTML =
    (opcoes.length ? '<input type="text" class="filtro-multi-busca" placeholder="Buscar..." autocomplete="off">' : '') +
    listaHtml +
    '<div class="filtro-multi-vazio filtro-multi-vazio-busca" hidden>Nenhum resultado</div>';

  var busca = painel.querySelector('.filtro-multi-busca');
  if (busca) {
    busca.addEventListener('input', function () {
      var termo = normalizarBusca(busca.value);
      var algumVisivel = false;
      painel.querySelectorAll('.filtro-multi-item').forEach(function (item) {
        var combina = normalizarBusca(item.textContent).indexOf(termo) !== -1;
        item.style.display = combina ? '' : 'none';
        if (combina) algumVisivel = true;
      });
      painel.querySelector('.filtro-multi-vazio-busca').hidden = algumVisivel || termo === '';
    });
  }

  painel.querySelectorAll('input[type="checkbox"]').forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
      if ((cfg.minimoUm || cfg.exclusivo) && !checkbox.checked && estado[cfg.chave].size === 1) {
        checkbox.checked = true;
        return;
      }
      if (checkbox.checked) {
        if (cfg.exclusivo) aplicarSelecaoExclusiva(estado[cfg.chave], checkbox.value);
        else estado[cfg.chave].add(checkbox.value);
      } else {
        estado[cfg.chave].delete(checkbox.value);
      }
      atualizarRotuloFiltro(cfg, opcoes, estado);
      if (cfg.exclusivo) montarFiltroMulti(cfg, registros, estado, aoMudar);
      aoMudar(cfg);
    });
  });
  atualizarRotuloFiltro(cfg, opcoes, estado);
}

function configurarAberturaFiltrosMulti() {
  document.querySelectorAll('.filtro-multi-trigger').forEach(function (trigger) {
    trigger.addEventListener('click', function (evento) {
      evento.stopPropagation();
      var container = trigger.closest('.filtro-multi');
      var jaAberto = container.classList.contains('aberto');
      document.querySelectorAll('.filtro-multi.aberto').forEach(function (el) {
        el.classList.remove('aberto');
        el.querySelector('.filtro-multi-painel').hidden = true;
      });
      if (!jaAberto) {
        container.classList.add('aberto');
        var painelAberto = container.querySelector('.filtro-multi-painel');
        painelAberto.hidden = false;
        var buscaAberto = painelAberto.querySelector('.filtro-multi-busca');
        if (buscaAberto) {
          buscaAberto.value = '';
          painelAberto.querySelectorAll('.filtro-multi-item').forEach(function (item) { item.style.display = ''; });
          var vazioBusca = painelAberto.querySelector('.filtro-multi-vazio-busca');
          if (vazioBusca) vazioBusca.hidden = true;
          buscaAberto.focus();
        }
      }
    });
  });
  document.querySelectorAll('.filtro-multi-painel').forEach(function (painel) {
    painel.addEventListener('click', function (evento) { evento.stopPropagation(); });
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.filtro-multi.aberto').forEach(function (el) {
      el.classList.remove('aberto');
      el.querySelector('.filtro-multi-painel').hidden = true;
    });
  });
}
`;

// O JS de cliente da lógica de filtros -- ver o comentário grande acima de
// SCRIPT_CLIENTE_FILTROS. Depende de a página já ter as <div class="filtro-multi">
// no HTML (markupFiltros, acima, já cuida disso) e de rodar ANTES de
// qualquer script que CHAME montarFiltroMulti/indicesFiltrados/etc.
function scriptFiltros() {
  return SCRIPT_CLIENTE_FILTROS;
}

module.exports = {
  cssBase,
  markupCabecalho,
  markupFiltros,
  markupAbas,
  scriptDesbloqueio,
  scriptFiltros,
};
