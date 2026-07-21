'use strict';
const { formatarMesAno } = require('./datas.js');
const { cifrarComSenha } = require('./criptografia.js');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderCabecalhoMeses(periodos) {
  return periodos.map(data => `<th>${formatarMesAno(data)}</th>`).join('');
}

// A tabela é renderizada inteiramente no navegador, depois que a senha
// certa decifra os registros -- ver o comentário grande antes de
// SCRIPT_CLIENTE. Por isso as opções de filtro (que listariam tipologia,
// grupo e SUP reais em texto puro) começam vazias aqui, só com o rótulo
// padrão, e são preenchidas pelo próprio script depois de decifrar.
function renderFiltroTipologia() {
  return `<select id="filtro-tipologia"><option value="">Todas as tipologias</option></select>`;
}
function renderFiltroContrato() {
  return `<select id="filtro-contrato"><option value="">Todos os contratos</option></select>`;
}
function renderFiltroSup() {
  return `<select id="filtro-sup"><option value="">Todos os SUP</option></select>`;
}
function renderFiltroSerie() {
  return `<select id="filtro-serie"><option value="">Todas as séries</option>` +
    `<option value="previsto">Previsto</option>` +
    `<option value="realizado">Realizado</option>` +
    `<option value="total">Tendência</option>` +
    `</select>`;
}
function renderSeletorDimensao() {
  return `<select id="seletor-dimensao">` +
    `<option value="equipes">Equipes</option>` +
    `<option value="volume">Volume</option>` +
    `<option value="financeiro">Financeiro</option>` +
    `<option value="produtividade">Produtividade</option>` +
    `<option value="ticketMedio">Ticket médio</option>` +
    `</select>`;
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

// Roda só DEPOIS que a senha certa decifra os registros (chamado por
// montarDashboard, no fim de SCRIPT_CLIENTE_GATE). Reimplementa em JS de
// navegador (sem require, HTML estático sem bundler) a mesma montagem de
// linhas/cores/filtros que antes rodava no servidor em
// tools/orcamento/render-dashboard.js -- precisa ser assim porque os
// PRÓPRIOS valores de SUP/Grupo/Tomador/Tipologia (não só os números
// mensais) são dados protegidos pela senha; se a tabela viesse pronta do
// servidor, esses nomes apareceriam em texto puro no código-fonte da
// página mesmo sem a senha certa.
const SCRIPT_CLIENTE_TABELA = `
function escapeHtml(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatarNumero(v) { return v === null || v === undefined ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR'); }
function somar(array) { return (array || []).reduce(function (a, b) { return a + (b || 0); }, 0); }
function somarArraysMensais(arrays) {
  var soma = new Array(12).fill(0);
  arrays.forEach(function (arr) {
    if (!arr) return;
    for (var i = 0; i < 12; i++) soma[i] += arr[i] || 0;
  });
  return soma;
}

var CAMPOS_RATIO = {
  produtividade: { numerador: 'volume', denominador: 'equipes' },
  ticketMedio: { numerador: 'financeiro', denominador: 'volume' },
};

// valoresLista: array de "valores" de UMA série (previsto/realizado/total),
// um item por registro agregado (lista de 1 item no caso normal de uma
// única tipologia; vários itens nas linhas de total por SUP/geral). Devolve
// os 12 valores mensais na dimensão escolhida. Previsto de produtividade/
// ticketMedio, quando é UMA ÚNICA tipologia, usa a premissa fixa da
// planilha (PROD./TICKET, nunca recalculada); quando agrega várias
// tipologias, não existe premissa própria do agregado, então usa a mesma
// razão-a-partir-da-soma que Realizado/Tendência (produtividade = Σvolume ÷
// Σequipes, ticketMedio = Σfinanceiro ÷ Σvolume -- fórmulas confirmadas com
// o usuário, estendidas aqui pra somar através das tipologias, não só dos
// meses).
function calcularMensal(valoresLista, serie, dimensao) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      var premissa = dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
      return new Array(12).fill((premissa === null || premissa === undefined) ? null : premissa);
    }
    var numeradorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.numerador]; }));
    var denominadorMensal = somarArraysMensais(lista.map(function (v) { return v[ratio.denominador]; }));
    return numeradorMensal.map(function (v, i) { return denominadorMensal[i] ? v / denominadorMensal[i] : null; });
  }
  return somarArraysMensais(lista.map(function (v) { return v[dimensao]; }));
}

// Coluna "Total" (soma do ano inteiro) da mesma linha -- soma os 12 meses
// pras 3 dimensões brutas; produtividade/ticketMedio recalculam a razão a
// partir da soma do numerador/denominador do ANO INTEIRO, nunca a soma das
// razões mensais (somar "R$/m³" de 12 meses não seria um número válido).
function calcularTotalAno(valoresLista, serie, dimensao) {
  var lista = valoresLista.filter(Boolean);
  if (!lista.length) return null;
  var ratio = CAMPOS_RATIO[dimensao];
  if (ratio) {
    if (serie === 'previsto' && lista.length === 1) {
      return dimensao === 'produtividade' ? lista[0].equipesResumo.prod : lista[0].volumeResumo.ticket;
    }
    var numeradorTotal = somar(lista.map(function (v) { return somar(v[ratio.numerador]); }));
    var denominadorTotal = somar(lista.map(function (v) { return somar(v[ratio.denominador]); }));
    return denominadorTotal ? numeradorTotal / denominadorTotal : null;
  }
  return somar(lista.map(function (v) { return somar(v[dimensao]); }));
}

function preencherLinha(linha, valoresLista, serie, dimensao) {
  var mensal = calcularMensal(valoresLista, serie, dimensao);
  var celulasMes = linha.querySelectorAll('.celula-mes');
  celulasMes.forEach(function (celula, idx) {
    celula.textContent = formatarNumero(mensal ? mensal[idx] : null);
  });
  var celulaTotal = linha.querySelector('.celula-total-linha');
  if (celulaTotal) celulaTotal.textContent = formatarNumero(calcularTotalAno(valoresLista, serie, dimensao));
}

// Dado um array de valores (na ordem das linhas visíveis de UMA coluna),
// devolve um array {valor, repetido} do mesmo tamanho -- repetido=true
// quando o valor é igual ao da linha visível anterior. O texto continua
// sempre visível (nunca vira '') -- quem decide como exibir isso (esmaecido
// quando repetido) é mesclarColunasRepetidas, não esta função. Função pura
// (sem DOM) pra poder testar sozinha.
function mesclarConsecutivos(valores) {
  var resultado = [];
  var anterior = null;
  valores.forEach(function (valor, i) {
    resultado.push({ valor: valor, repetido: i > 0 && valor === anterior });
    anterior = valor;
  });
  return resultado;
}

function mesclarColunasRepetidas() {
  ['col-sup', 'col-grupo', 'col-tomador'].forEach(function (classe) {
    var linhasVisiveis = Array.prototype.filter.call(
      document.querySelectorAll('#tabela-orcamento tbody tr'),
      function (tr) { return tr.style.display !== 'none'; }
    );
    var celulas = linhasVisiveis
      .map(function (tr) { return tr.querySelector('.' + classe); })
      .filter(Boolean);
    var valores = celulas.map(function (c) { return c.getAttribute('data-valor'); });
    var mesclados = mesclarConsecutivos(valores);
    celulas.forEach(function (c, i) {
      c.textContent = mesclados[i].valor;
      c.classList.toggle('valor-repetido', mesclados[i].repetido);
    });
  });
}

// Mesmo mapeamento de cores por tipologia da matriz de equipes
// (tools/matriz/render-dashboard.js's tipologiaColor), reimplementado aqui
// em JS de navegador pelo mesmo motivo do resto deste script: a própria
// tipologia é dado protegido por senha, não pode vir pronta do servidor.
var TIPOLOGIA_COLOR = {
  SP: '#3f851a', SM: '#2f6ad0', ST: '#8d6f00', PI: '#606060',
  BL: '#4a3aa7', CPTU: '#db244e', SH: '#e87ba4', VT: '#eda100',
  'SEGURANÇA': '#2775b8', ESPECIAIS: '#db244e', SSMA: '#2775b8',
};
var TIPOLOGIA_COMPOSTA_COLOR = {
  'CPTU / VT / SH': TIPOLOGIA_COLOR.CPTU,
  'SP/SM': TIPOLOGIA_COLOR.SP,
};
function tipologiaColor(tipologia) {
  var raw = String(tipologia || '').trim();
  var key = raw.toUpperCase();
  if (TIPOLOGIA_COLOR[key]) return TIPOLOGIA_COLOR[key];
  if (TIPOLOGIA_COMPOSTA_COLOR[key]) return TIPOLOGIA_COMPOSTA_COLOR[key];
  var parenMatch = raw.match(/\\(([^)]+)\\)\\s*$/);
  if (parenMatch) {
    var viaParen = TIPOLOGIA_COLOR[parenMatch[1].trim().toUpperCase()];
    if (viaParen) return viaParen;
  }
  var primeiroToken = key.split('/')[0].trim();
  if (TIPOLOGIA_COLOR[primeiroToken]) return TIPOLOGIA_COLOR[primeiroToken];
  return '#898781';
}

var SERIE_LABELS = { previsto: 'Previsto', realizado: 'Realizado', total: 'Tendência' };

function celulasMesVazias() {
  var html = '';
  for (var i = 0; i < 12; i++) html += '<td class="celula-mes num"></td>';
  return html;
}

function renderLinhaTabela(registro, indice) {
  var chipColor = tipologiaColor(registro.tipologia);
  var dataAttrs = 'data-tipologia="' + escapeHtml(registro.tipologia) + '" data-grupo="' + escapeHtml(registro.grupo) + '" data-sup="' + escapeHtml(registro.sup) + '" data-registro-indices="' + indice + '"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaSup = '<td class="col-mesclavel col-sup" data-valor="' + escapeHtml(registro.sup) + '">' + escapeHtml(registro.sup) + '</td>';
  var celulaGrupo = '<td class="col-mesclavel col-grupo" data-valor="' + escapeHtml(registro.grupo) + '">' + escapeHtml(registro.grupo) + '</td>';
  var celulaTomador = '<td class="col-mesclavel col-tomador" data-valor="' + escapeHtml(registro.tomador) + '">' + escapeHtml(registro.tomador) + '</td>';
  return '<tr class="linha-serie linha-previsto" data-serie="previsto" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador +
      '<td rowspan="3"><span class="tipologia-chip" style="--chip-color:' + chipColor + '">' + escapeHtml(registro.tipologia) + '</span></td>' +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado" data-serie="realizado" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total" data-serie="total" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

function renderLinhaTotalSup(sup, grupo, tomador, indices) {
  var dataAttrs = 'data-grupo="' + escapeHtml(grupo) + '" data-sup="' + escapeHtml(sup) + '" data-registro-indices="' + indices.join(',') + '" data-total-sup="1"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaSup = '<td class="col-mesclavel col-sup" data-valor="' + escapeHtml(sup) + '">' + escapeHtml(sup) + '</td>';
  var celulaGrupo = '<td class="col-mesclavel col-grupo" data-valor="' + escapeHtml(grupo) + '">' + escapeHtml(grupo) + '</td>';
  var celulaTomador = '<td class="col-mesclavel col-tomador" data-valor="' + escapeHtml(tomador) + '">' + escapeHtml(tomador) + '</td>';
  return '<tr class="linha-serie linha-previsto linha-total-sup" data-serie="previsto" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador +
      '<td rowspan="3"><span class="tipologia-chip tipologia-chip-total">TOTAL</span></td>' +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-sup" data-serie="realizado" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-sup" data-serie="total" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

function renderLinhaTotalGeral(totalRegistros) {
  var todosIndices = [];
  for (var i = 0; i < totalRegistros; i++) todosIndices.push(i);
  var dataAttrs = 'data-registro-indices="' + todosIndices.join(',') + '" data-total-geral="1"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  return '<tr class="linha-serie linha-previsto linha-total-geral" data-serie="previsto" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaVazia('col-grupo') + celulaVazia('col-tomador') +
      '<td rowspan="3"><span class="tipologia-chip tipologia-chip-total">TOTAL GERAL</span></td>' +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-geral" data-serie="realizado" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaVazia('col-grupo') + celulaVazia('col-tomador') +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-geral" data-serie="total" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaVazia('col-grupo') + celulaVazia('col-tomador') +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

// Total geral de UMA tipologia (soma através de TODOS os contratos/SUPs que
// têm essa tipologia, não só um) -- SUP/Grupo/Tomador ficam em branco (como
// o total geral) mas a Tipologia aparece de verdade e colorida, pra
// distinguir qual bloco é qual quando vários aparecem juntos no topo.
function renderLinhaTotalGeralTipologia(tipologia, indices) {
  var chipColor = tipologiaColor(tipologia);
  var dataAttrs = 'data-tipologia="' + escapeHtml(tipologia) + '" data-registro-indices="' + indices.join(',') + '" data-total-geral-tipologia="1"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  return '<tr class="linha-serie linha-previsto linha-total-geral" data-serie="previsto" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaVazia('col-grupo') + celulaVazia('col-tomador') +
      '<td rowspan="3"><span class="tipologia-chip" style="--chip-color:' + chipColor + '">' + escapeHtml(tipologia) + '</span></td>' +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-geral" data-serie="realizado" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaVazia('col-grupo') + celulaVazia('col-tomador') +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-geral" data-serie="total" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaVazia('col-grupo') + celulaVazia('col-tomador') +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

function renderCorpoTabela(registros) {
  var html = renderLinhaTotalGeral(registros.length);

  // Um total geral por tipologia, logo depois do total geral -- agrega
  // todos os registros daquela tipologia através de TODOS os SUPs (não só
  // do bloco de um contrato), em ordem alfabética (mesma ordem do filtro de
  // tipologia).
  var indicesPorTipologia = {};
  var ordemTipologias = [];
  registros.forEach(function (registro, indice) {
    if (!registro.tipologia) return;
    if (!indicesPorTipologia[registro.tipologia]) {
      indicesPorTipologia[registro.tipologia] = [];
      ordemTipologias.push(registro.tipologia);
    }
    indicesPorTipologia[registro.tipologia].push(indice);
  });
  ordemTipologias.sort();
  ordemTipologias.forEach(function (tipologia) {
    html += renderLinhaTotalGeralTipologia(tipologia, indicesPorTipologia[tipologia]);
  });

  var supAtual = null;
  var grupoAtual = null;
  var tomadorAtual = null;
  var indicesGrupoAtual = [];

  function fecharGrupo() {
    if (indicesGrupoAtual.length) {
      html += renderLinhaTotalSup(supAtual, grupoAtual, tomadorAtual, indicesGrupoAtual);
    }
  }

  registros.forEach(function (registro, indice) {
    if (supAtual !== null && registro.sup !== supAtual) {
      fecharGrupo();
      indicesGrupoAtual = [];
    }
    supAtual = registro.sup;
    grupoAtual = registro.grupo;
    tomadorAtual = registro.tomador;
    indicesGrupoAtual.push(indice);
    html += renderLinhaTabela(registro, indice);
  });
  fecharGrupo();
  return html;
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

function popularSelect(id, valores) {
  var select = document.getElementById(id);
  var opcaoPadrao = select.options[0];
  select.innerHTML = '';
  select.appendChild(opcaoPadrao);
  valores.forEach(function (v) {
    var opcao = document.createElement('option');
    opcao.value = v;
    opcao.textContent = v;
    select.appendChild(opcao);
  });
}

function popularFiltros(registros) {
  popularSelect('filtro-tipologia', linhasDistintas(registros, 'tipologia'));
  popularSelect('filtro-contrato', linhasDistintas(registros, 'grupo'));
  popularSelect('filtro-sup', linhasDistintas(registros, 'sup'));
}

function filtrarIndicesPorGrupoSup(indices, filtroContrato, filtroSup) {
  return indices.filter(function (idx) {
    var r = window.__REGISTROS__[idx];
    return (!filtroContrato || r.grupo === filtroContrato) && (!filtroSup || r.sup === filtroSup);
  });
}

function recalcularTabela() {
  var dimensao = document.getElementById('seletor-dimensao').value;
  var filtroTipologia = document.getElementById('filtro-tipologia').value;
  var filtroContrato = document.getElementById('filtro-contrato').value;
  var filtroSup = document.getElementById('filtro-sup').value;
  var filtroSerie = document.getElementById('filtro-serie').value;
  var linhas = document.querySelectorAll('#tabela-orcamento tbody tr');
  linhas.forEach(function (linha) {
    var combinaSerie = !filtroSerie || linha.dataset.serie === filtroSerie;
    var combinaGrupoSup = (!filtroContrato || linha.dataset.grupo === filtroContrato) &&
      (!filtroSup || linha.dataset.sup === filtroSup);
    var ehTotalGeral = linha.dataset.totalGeral === '1';
    var ehTotalGeralTipologia = linha.dataset.totalGeralTipologia === '1';
    var ehTotalSup = linha.dataset.totalSup === '1';
    var indices = linha.dataset.registroIndices.split(',').map(Number);
    var mostra;
    if (ehTotalGeral) {
      // Total geral: soma TODAS as tipologias, refiltrado por
      // contrato/SUP em vigor -- só aparece quando nenhuma tipologia
      // específica estiver selecionada (senão "todas as tipologias" perde
      // o sentido).
      indices = filtrarIndicesPorGrupoSup(indices, filtroContrato, filtroSup);
      mostra = indices.length > 0 && !filtroTipologia && combinaSerie;
    } else if (ehTotalGeralTipologia) {
      // Total geral de UMA tipologia através de todos os contratos/SUPs --
      // some sozinho igual às linhas normais quando outra tipologia
      // estiver selecionada, e também refiltra por contrato/SUP em vigor.
      indices = filtrarIndicesPorGrupoSup(indices, filtroContrato, filtroSup);
      mostra = indices.length > 0 && (!filtroTipologia || linha.dataset.tipologia === filtroTipologia) && combinaSerie;
    } else if (ehTotalSup) {
      mostra = combinaGrupoSup && !filtroTipologia && combinaSerie;
    } else {
      mostra = combinaGrupoSup && (!filtroTipologia || linha.dataset.tipologia === filtroTipologia) && combinaSerie;
    }
    linha.style.display = mostra ? '' : 'none';
    if (mostra) {
      var valoresLista = indices.map(function (idx) { return window.__REGISTROS__[idx][linha.dataset.serie]; });
      preencherLinha(linha, valoresLista, linha.dataset.serie, dimensao);
    }
  });
  mesclarColunasRepetidas();
}

function limparFiltros() {
  document.getElementById('filtro-tipologia').value = '';
  document.getElementById('filtro-contrato').value = '';
  document.getElementById('filtro-sup').value = '';
  document.getElementById('filtro-serie').value = '';
  recalcularTabela();
}

// Chamado uma vez, pelo gate de senha, assim que a senha certa decifra os
// registros -- monta a tabela inteira e liga os filtros/botões.
function montarDashboard(registros) {
  popularFiltros(registros);
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(registros);
  ['seletor-dimensao', 'filtro-tipologia', 'filtro-contrato', 'filtro-sup', 'filtro-serie'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', recalcularTabela);
  });
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltros);
  recalcularTabela();
}

document.getElementById('atualizar-dashboard').addEventListener('click', function () { location.reload(); });
`;

function renderDashboard({ registros, periodos, generatedAt, logoDataUri, iconDataUri, senha }) {
  if (!senha) {
    throw new Error('renderDashboard requer "senha" -- o conteúdo (SUP/Grupo/Tomador/Tipologia/valores) é cifrado com ela antes de ir pro HTML.');
  }
  const registrosJson = JSON.stringify(registros.map(r => ({
    sup: r.sup, grupo: r.grupo, tomador: r.tomador, tipologia: r.tipologia,
    previsto: r.previsto, realizado: r.realizado, total: r.total,
  })));
  const dadosCifrados = cifrarComSenha(registrosJson, senha);
  const dadosCifradosJson = JSON.stringify(dadosCifrados).replace(/<\/script/gi, '<\\/script');

  const logoImg = logoDataUri ? `<img src="${logoDataUri}" alt="Suporte Infra">` : '';
  const watermarkImg = iconDataUri ? `<img class="watermark" src="${iconDataUri}" alt="">` : '';

  // Mesmo sistema visual (tema escuro, header com logo, chips, tabela) da
  // matriz de equipes (tools/matriz/render-dashboard.js) -- cores, fonte e
  // classes principais copiadas de lá pra manter os dois dashboards
  // consistentes entre si. Diferença deliberada: o fundo da tabela aqui é
  // translúcido, pra a marca d'água central aparecer por trás -- pedido
  // explícito do usuário, a matriz de equipes não faz isso.
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>ORÇAMENTO — MATRIZ</title>
<style>
  :root {
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
  .filtros { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
  .filtros select {
    padding: 8px 10px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-primary);
    font-size: 13px;
  }
  #limpar-filtros {
    padding: 8px 14px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-primary);
    font-size: 13px; cursor: pointer;
  }
  #limpar-filtros:hover { border-color: #f6b53f; }
  #atualizar-dashboard {
    padding: 10px 16px;
    border: 2px solid #f6b53f; border-radius: 8px;
    background: var(--surface-1); color: var(--text-primary);
    font-size: 13px; font-weight: 600; cursor: pointer;
  }
  #atualizar-dashboard:hover { background: rgba(246,181,63,0.1); }
  .table-scroll { overflow-x: auto; position: relative; z-index: 1; }
  table { width: 100%; border-collapse: collapse; background: rgba(26,26,25,0.68); }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--gridline); font-size: 13px; }
  td.num { font-variant-numeric: tabular-nums; }
  th { color: var(--text-secondary); font-weight: 600; background: rgba(13,13,12,0.5); }
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
  .valor-repetido { color: rgba(255,255,255,0.14); }
</style>
</head>
<body>
  ${watermarkImg}
  <main>
  <div class="header-bar">
    ${logoImg}
    <div class="header-bar-title">
      <h1>ORÇAMENTO — Previsto x Realizado x Tendência</h1>
      <div class="generated">Gerado em ${escapeHtml(generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</div>
    </div>
  </div>

  <div id="gate-senha" class="gate-senha">
    <div class="gate-senha-box">
      <h2>Digite a senha para abrir o dashboard</h2>
      <input type="password" id="campo-senha" autocomplete="off" placeholder="Senha">
      <button id="btn-desbloquear" type="button">Abrir</button>
      <div id="gate-senha-erro" class="gate-senha-erro" style="display:none"></div>
    </div>
  </div>

  <div id="conteudo-protegido" style="display:none">
    <div class="filtros">
      ${renderFiltroTipologia()}
      ${renderFiltroContrato()}
      ${renderFiltroSup()}
      ${renderFiltroSerie()}
      ${renderSeletorDimensao()}
      <button id="limpar-filtros" type="button">Limpar filtros</button>
      <button id="atualizar-dashboard" type="button">Atualizar dados</button>
    </div>
    <div class="table-scroll">
    <table id="tabela-orcamento">
      <thead><tr><th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Série</th>${renderCabecalhoMeses(periodos)}<th>Total</th></tr></thead>
      <tbody id="corpo-tabela"></tbody>
    </table>
    </div>
  </div>
  </main>
  <script>window.__DADOS_CIFRADOS__ = ${dadosCifradosJson};</script>
  <script>${SCRIPT_CLIENTE_GATE}</script>
  <script>${SCRIPT_CLIENTE_TABELA}</script>
</body>
</html>`;
}

module.exports = { renderDashboard };
