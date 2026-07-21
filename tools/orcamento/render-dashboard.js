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
function renderFiltroGrupo() {
  return `<select id="filtro-grupo"><option value="">Todos os grupos</option></select>`;
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
    `<option value="financeiro" selected>Financeiro</option>` +
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

// Soma corrida mês a mês -- acumulado[i] = mensal[0]+...+mensal[i]. Trata
// null/undefined como 0 (não dá pra "acumular" um mês sem dado, mas
// também não pode quebrar a soma corrida dos meses seguintes).
function calcularAcumulado(mensal) {
  var soma = 0;
  return mensal.map(function (v) {
    soma += v || 0;
    return soma;
  });
}

// Devolve os índices de \`registros\` que combinam com os filtros de
// tipologia/grupo/SUP atuais (AND, não OR) -- mesma regra usada linha a
// linha em recalcularTabela, calculada aqui direto sobre os registros
// crus, sem depender de uma linha <tr> já renderizada, pra o gráfico
// poder agregar o recorte atual sem precisar de uma linha "molde" no DOM.
function indicesFiltrados(registros, filtroTipologia, filtroGrupo, filtroSup) {
  var indices = [];
  registros.forEach(function (registro, indice) {
    if (filtroTipologia && registro.tipologia !== filtroTipologia) return;
    if (filtroGrupo && registro.grupo !== filtroGrupo) return;
    if (filtroSup && registro.sup !== filtroSup) return;
    indices.push(indice);
  });
  return indices;
}

var SERIE_COR = { previsto: '#2f6ad0', realizado: '#7fd858', total: '#f6b53f' };
var DIMENSOES_RAZAO = ['produtividade', 'ticketMedio'];
var MESES_ABREVIADOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

var GRAFICO_LARGURA = 1000;
var GRAFICO_ALTURA = 380;
var GRAFICO_MARGEM = { topo: 24, baixo: 36, esquerda: 64, direita: 64 };

// Mapeia um valor pra uma distância em pixels dentro de [0, pixelMax],
// proporcional a valorMax -- 0 quando valorMax é 0 (evita divisão por
// zero quando não há nenhum dado no recorte filtrado).
function escalaLinear(valor, valorMax, pixelMax) {
  if (!valorMax) return 0;
  return (valor / valorMax) * pixelMax;
}

function construirEixoXSvg(larguraMes, alturaPlot) {
  var svg = '';
  for (var mes = 0; mes < 12; mes++) {
    var x = GRAFICO_MARGEM.esquerda + mes * larguraMes + larguraMes / 2;
    var y = GRAFICO_MARGEM.topo + alturaPlot + 18;
    svg += '<text class="grafico-eixo-texto" x="' + x.toFixed(1) + '" y="' + y + '" text-anchor="middle">' + MESES_ABREVIADOS[mes] + '</text>';
  }
  return svg;
}

var GRAFICO_NUM_TICKS = 4;
function construirTicksEixoY(valorMax, alturaPlot, ladoDireita) {
  var svg = '';
  for (var i = 0; i <= GRAFICO_NUM_TICKS; i++) {
    var fracao = i / GRAFICO_NUM_TICKS;
    var y = GRAFICO_MARGEM.topo + alturaPlot - fracao * alturaPlot;
    var valor = fracao * valorMax;
    var x = ladoDireita ? (GRAFICO_LARGURA - GRAFICO_MARGEM.direita + 8) : (GRAFICO_MARGEM.esquerda - 8);
    var ancora = ladoDireita ? 'start' : 'end';
    svg += '<text class="grafico-eixo-texto" x="' + x + '" y="' + (y + 4) + '" text-anchor="' + ancora + '">' + formatarNumero(valor) + '</text>';
    if (!ladoDireita) {
      svg += '<line class="grafico-gridline" x1="' + GRAFICO_MARGEM.esquerda + '" y1="' + y + '" x2="' + (GRAFICO_LARGURA - GRAFICO_MARGEM.direita) + '" y2="' + y + '"/>';
    }
  }
  return svg;
}

function construirLegendaSvg(dadosPorSerie) {
  var svg = '';
  dadosPorSerie.forEach(function (d, i) {
    var x = GRAFICO_MARGEM.esquerda + i * 130;
    var y = 10;
    svg += '<circle cx="' + x + '" cy="' + y + '" r="5" fill="' + SERIE_COR[d.serie] + '"/>';
    svg += '<text class="grafico-eixo-texto" x="' + (x + 10) + '" y="' + (y + 4) + '" text-anchor="start">' + SERIE_LABELS[d.serie] + '</text>';
  });
  return svg;
}

// dadosPorSerie: [{ serie, mensal: number[12], acumulado: number[12]|null }],
// já filtrado só com as séries visíveis (respeita filtro-serie) e com
// valores mensais nunca-nulos (null já virou 0 antes de chegar aqui --
// ver montarGrafico). ehRazao=true pras dimensões Produtividade/Ticket
// médio: nesse caso não faz sentido "acumular" uma razão, então só a
// linha do valor mensal aparece, sem barras e sem eixo secundário.
function construirGraficoSvg(dadosPorSerie, ehRazao) {
  var larguraPlot = GRAFICO_LARGURA - GRAFICO_MARGEM.esquerda - GRAFICO_MARGEM.direita;
  var alturaPlot = GRAFICO_ALTURA - GRAFICO_MARGEM.topo - GRAFICO_MARGEM.baixo;
  var larguraMes = larguraPlot / 12;
  var numSeries = dadosPorSerie.length;

  var maxMensal = 0;
  dadosPorSerie.forEach(function (d) { d.mensal.forEach(function (v) { if (v > maxMensal) maxMensal = v; }); });
  var maxAcumulado = 0;
  if (!ehRazao) {
    dadosPorSerie.forEach(function (d) { d.acumulado.forEach(function (v) { if (v > maxAcumulado) maxAcumulado = v; }); });
  }

  var svg = '';
  svg += construirTicksEixoY(maxMensal, alturaPlot, false);
  if (!ehRazao) svg += construirTicksEixoY(maxAcumulado, alturaPlot, true);
  svg += construirEixoXSvg(larguraMes, alturaPlot);

  if (!ehRazao) {
    var larguraBarra = (larguraMes * 0.7) / (numSeries || 1);
    for (var mes = 0; mes < 12; mes++) {
      var inicioMes = GRAFICO_MARGEM.esquerda + mes * larguraMes + larguraMes * 0.15;
      dadosPorSerie.forEach(function (d, i) {
        var valor = d.mensal[mes];
        var alturaBarra = escalaLinear(valor, maxMensal, alturaPlot);
        var x = inicioMes + i * larguraBarra;
        var y = GRAFICO_MARGEM.topo + alturaPlot - alturaBarra;
        svg += '<rect class="grafico-barra" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + larguraBarra.toFixed(1) + '" height="' + alturaBarra.toFixed(1) + '" fill="' + SERIE_COR[d.serie] + '"><title>' + SERIE_LABELS[d.serie] + ': ' + formatarNumero(valor) + '</title></rect>';
      });
    }
  }

  dadosPorSerie.forEach(function (d) {
    var serieValores = ehRazao ? d.mensal : d.acumulado;
    var maxEixo = ehRazao ? maxMensal : maxAcumulado;
    var pontos = serieValores.map(function (valor, mes) {
      var x = GRAFICO_MARGEM.esquerda + mes * larguraMes + larguraMes / 2;
      var y = GRAFICO_MARGEM.topo + alturaPlot - escalaLinear(valor, maxEixo, alturaPlot);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var tracejado = ehRazao ? '' : ' stroke-dasharray="5,4"';
    svg += '<polyline class="grafico-linha" points="' + pontos.join(' ') + '" fill="none" stroke="' + SERIE_COR[d.serie] + '" stroke-width="2"' + tracejado + '/>';
  });

  svg += construirLegendaSvg(dadosPorSerie);

  return '<svg viewBox="0 0 ' + GRAFICO_LARGURA + ' ' + GRAFICO_ALTURA + '" class="grafico-svg">' + svg + '</svg>';
}

// Recalcula e redesenha o gráfico a partir dos MESMOS filtros/dimensão da
// tabela -- chamado toda vez que recalcularTabela roda, então nunca fica
// desatualizado mesmo se o usuário estiver na aba Tabela quando muda um
// filtro e só depois troca pra aba Gráfico.
function montarGrafico(registros, filtroTipologia, filtroGrupo, filtroSup, filtroSerie, dimensao) {
  var indices = indicesFiltrados(registros, filtroTipologia, filtroGrupo, filtroSup);
  var seriesTodas = ['previsto', 'realizado', 'total'];
  var seriesVisiveis = seriesTodas.filter(function (s) { return !filtroSerie || filtroSerie === s; });
  var ehRazao = DIMENSOES_RAZAO.indexOf(dimensao) !== -1;

  var dadosPorSerie = seriesVisiveis.map(function (serie) {
    var valoresLista = indices.map(function (idx) { return registros[idx][serie]; });
    var mensalBruto = calcularMensal(valoresLista, serie, dimensao) || new Array(12).fill(null);
    var mensal = mensalBruto.map(function (v) { return v === null ? 0 : v; });
    return { serie: serie, mensal: mensal, acumulado: ehRazao ? null : calcularAcumulado(mensal) };
  });

  document.getElementById('grafico-svg-container').innerHTML = construirGraficoSvg(dadosPorSerie, ehRazao);
}

function alternarAba(aba) {
  document.getElementById('secao-tabela').style.display = aba === 'tabela' ? '' : 'none';
  document.getElementById('secao-grafico').style.display = aba === 'grafico' ? '' : 'none';
  document.getElementById('aba-tabela').classList.toggle('aba-ativa', aba === 'tabela');
  document.getElementById('aba-grafico').classList.toggle('aba-ativa', aba === 'grafico');
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

// Nunca reescreve o conteúdo da célula (só a classe que esmaece) -- a coluna
// Tipologia guarda um <span class="tipologia-chip"> colorido, e sobrescrever
// com textContent destruiria esse HTML. Pro mesmo motivo, sup/grupo/tomador
// também pararam de ter o conteúdo reescrito (era sempre o mesmo valor já
// presente, um no-op).
function mesclarColunasRepetidas() {
  var linhasVisiveis = Array.prototype.filter.call(
    document.querySelectorAll('#tabela-orcamento tbody tr'),
    function (tr) { return tr.style.display !== 'none'; }
  );

  // SUP > Grupo > Tomador é uma hierarquia, não 3 colunas independentes --
  // Grupo só pode contar como repetido se o SUP acima também não tiver
  // mudado (senão um SUP novo que por coincidência tem o mesmo Grupo do
  // anterior ficaria com o nome apagado, escondendo que um bloco novo
  // começou; mesmo raciocínio pra Tomador exigir Grupo+SUP inalterados).
  // Por isso cada nível usa uma CHAVE que inclui todos os níveis acima, não
  // só seu próprio texto -- reaproveita mesclarConsecutivos (já testada)
  // aplicando-a a essas chaves compostas em vez do texto puro.
  var celulasSup = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-sup'); });
  var celulasGrupo = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-grupo'); });
  var celulasTomador = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-tomador'); });
  var valoresSup = celulasSup.map(function (c) { return c.getAttribute('data-valor'); });
  var valoresGrupo = celulasGrupo.map(function (c) { return c.getAttribute('data-valor'); });
  var valoresTomador = celulasTomador.map(function (c) { return c.getAttribute('data-valor'); });
  // Chave = array [niveis acima..., proprio valor] serializado em JSON, em
  // vez de uma string concatenada com separador -- evita qualquer risco de
  // colisao entre valores que por acaso contenham o proprio separador.
  var chavesGrupo = valoresSup.map(function (sup, i) { return JSON.stringify([sup, valoresGrupo[i]]); });
  var chavesTomador = valoresSup.map(function (sup, i) { return JSON.stringify([sup, valoresGrupo[i], valoresTomador[i]]); });

  var mescladosSup = mesclarConsecutivos(valoresSup);
  var mescladosGrupo = mesclarConsecutivos(chavesGrupo);
  var mescladosTomador = mesclarConsecutivos(chavesTomador);
  celulasSup.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosSup[i].repetido); });
  celulasGrupo.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosGrupo[i].repetido); });
  celulasTomador.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosTomador[i].repetido); });

  // Tipologia (e os selos TOTAL/TOTAL GERAL) mesclam por GRUPO de linha
  // (as 3 linhas P/R/T de um mesmo bloco compartilham o mesmo
  // data-registro-indices), não por valor de texto -- se comparasse por
  // texto, duas tipologias iguais vindas de blocos diferentes (ex.: dois
  // SUPs distintos, ambos "SM") se mesclariam entre si, o que nunca foi o
  // comportamento pretendido.
  var celulasTipologia = linhasVisiveis.map(function (tr) { return tr.querySelector('.col-tipologia'); }).filter(Boolean);
  var chavesTipologia = linhasVisiveis.map(function (tr) { return tr.dataset.registroIndices; });
  var mescladosTipologia = mesclarConsecutivos(chavesTipologia);
  celulasTipologia.forEach(function (c, i) { c.classList.toggle('valor-repetido', mescladosTipologia[i].repetido); });
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
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip" style="--chip-color:' + chipColor + '">' + escapeHtml(registro.tipologia) + '</span></td>';
  return '<tr class="linha-serie linha-previsto" data-serie="previsto" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado" data-serie="realizado" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total" data-serie="total" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
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
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip tipologia-chip-total">TOTAL</span></td>';
  return '<tr class="linha-serie linha-previsto linha-total-sup" data-serie="previsto" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-sup" data-serie="realizado" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-sup" data-serie="total" ' + dataAttrs + '>' +
      celulaSup + celulaGrupo + celulaTomador + celulaTipologia +
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
  var celulaTodos = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="Todos">Todos</td>'; };
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip tipologia-chip-total">TOTAL GERAL</span></td>';
  return '<tr class="linha-serie linha-previsto linha-total-geral" data-serie="previsto" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-geral" data-serie="realizado" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-geral" data-serie="total" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.total + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>';
}

// Total geral de UMA tipologia (soma através de TODOS os grupos/SUPs que
// têm essa tipologia, não só um) -- SUP fica em branco (como o total
// geral), Grupo/Tomador mostram "Todos" (não há um grupo/tomador único pra
// exibir aqui), mas a Tipologia aparece de verdade e colorida, pra
// distinguir qual bloco é qual quando vários aparecem juntos no topo.
function renderLinhaTotalGeralTipologia(tipologia, indices) {
  var chipColor = tipologiaColor(tipologia);
  var dataAttrs = 'data-tipologia="' + escapeHtml(tipologia) + '" data-registro-indices="' + indices.join(',') + '" data-total-geral-tipologia="1"';
  var celulaTotalLinha = '<td class="celula-total-linha num"></td>';
  var celulaVazia = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="">—</td>'; };
  var celulaTodos = function (classe) { return '<td class="col-mesclavel ' + classe + '" data-valor="Todos">Todos</td>'; };
  var celulaTipologia = '<td class="col-mesclavel col-tipologia"><span class="tipologia-chip" style="--chip-color:' + chipColor + '">' + escapeHtml(tipologia) + '</span></td>';
  return '<tr class="linha-serie linha-previsto linha-total-geral linha-total-geral-tipologia" data-serie="previsto" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.previsto + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-realizado linha-total-geral linha-total-geral-tipologia" data-serie="realizado" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
      '<td class="serie-label">' + SERIE_LABELS.realizado + '</td>' +
      celulasMesVazias() + celulaTotalLinha +
    '</tr>' +
    '<tr class="linha-serie linha-total linha-total-geral linha-total-geral-tipologia" data-serie="total" ' + dataAttrs + '>' +
      celulaVazia('col-sup') + celulaTodos('col-grupo') + celulaTodos('col-tomador') + celulaTipologia +
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
  popularSelect('filtro-grupo', linhasDistintas(registros, 'grupo'));
  popularSelect('filtro-sup', linhasDistintas(registros, 'sup'));
}

function recalcularTabela() {
  var dimensao = document.getElementById('seletor-dimensao').value;
  var filtroTipologia = document.getElementById('filtro-tipologia').value;
  var filtroGrupo = document.getElementById('filtro-grupo').value;
  var filtroSup = document.getElementById('filtro-sup').value;
  var filtroSerie = document.getElementById('filtro-serie').value;
  var linhas = document.querySelectorAll('#tabela-orcamento tbody tr');
  linhas.forEach(function (linha) {
    var combinaSerie = !filtroSerie || linha.dataset.serie === filtroSerie;
    var combinaGrupoSup = (!filtroGrupo || linha.dataset.grupo === filtroGrupo) &&
      (!filtroSup || linha.dataset.sup === filtroSup);
    var ehTotalGeral = linha.dataset.totalGeral === '1';
    var ehTotalGeralTipologia = linha.dataset.totalGeralTipologia === '1';
    var ehTotalSup = linha.dataset.totalSup === '1';
    var indices = linha.dataset.registroIndices.split(',').map(Number);
    var mostra;
    if (ehTotalGeral) {
      // Total geral (a visão-resumo de TUDO): só aparece na visão sem
      // nenhum recorte -- some assim que qualquer filtro (tipologia,
      // grupo ou SUP) restringe os dados, porque nesse ponto o total
      // por SUP (ou a própria linha do registro) já cobre o recorte atual.
      mostra = !filtroGrupo && !filtroSup && !filtroTipologia && combinaSerie;
    } else if (ehTotalGeralTipologia) {
      // Total de UMA tipologia através de todos os grupos/SUPs -- mesma
      // regra do total geral (some com filtro de grupo/SUP), mas o
      // filtro de tipologia escolhe QUAL bloco aparece em vez de escondê-lo.
      mostra = !filtroGrupo && !filtroSup && (!filtroTipologia || linha.dataset.tipologia === filtroTipologia) && combinaSerie;
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
  montarGrafico(window.__REGISTROS__, filtroTipologia, filtroGrupo, filtroSup, filtroSerie, dimensao);
}

function limparFiltros() {
  document.getElementById('filtro-tipologia').value = '';
  document.getElementById('filtro-grupo').value = '';
  document.getElementById('filtro-sup').value = '';
  document.getElementById('filtro-serie').value = '';
  recalcularTabela();
}

// Chamado uma vez, pelo gate de senha, assim que a senha certa decifra os
// registros -- monta a tabela inteira e liga os filtros/botões.
function montarDashboard(registros) {
  popularFiltros(registros);
  document.getElementById('corpo-tabela').innerHTML = renderCorpoTabela(registros);
  ['seletor-dimensao', 'filtro-tipologia', 'filtro-grupo', 'filtro-sup', 'filtro-serie'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', recalcularTabela);
  });
  document.getElementById('limpar-filtros').addEventListener('click', limparFiltros);
  document.getElementById('aba-tabela').addEventListener('click', function () { alternarAba('tabela'); });
  document.getElementById('aba-grafico').addEventListener('click', function () { alternarAba('grafico'); });
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
  .abas-visualizacao { display: flex; gap: 8px; }
  .abas-visualizacao button {
    padding: 8px 16px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1); color: var(--text-secondary);
    font-size: 13px; cursor: pointer;
  }
  .abas-visualizacao button.aba-ativa { border-color: #f6b53f; color: var(--text-primary); font-weight: 600; }
  #secao-grafico {
    background: rgba(26,26,25,0.68); border-radius: 8px; padding: 16px 8px;
    position: relative; z-index: 1;
  }
  .grafico-svg { width: 100%; height: auto; display: block; }
  .grafico-eixo-texto { fill: var(--text-secondary); font-size: 11px; }
  .grafico-gridline { stroke: var(--gridline); stroke-width: 1; }
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
  .linha-total-geral-tipologia td { background: rgba(255,255,255,0.03); }
  tr.linha-total.linha-total-geral-tipologia td { border-bottom: 1px solid var(--gridline); }
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
      ${renderFiltroGrupo()}
      ${renderFiltroSup()}
      ${renderFiltroSerie()}
      ${renderSeletorDimensao()}
      <div class="abas-visualizacao">
        <button id="aba-tabela" type="button" class="aba-ativa">Tabela</button>
        <button id="aba-grafico" type="button">Gráfico</button>
      </div>
      <button id="limpar-filtros" type="button">Limpar filtros</button>
      <button id="atualizar-dashboard" type="button">Atualizar dados</button>
    </div>
    <div id="secao-tabela">
    <div class="table-scroll">
    <table id="tabela-orcamento">
      <thead><tr><th>SUP</th><th>Grupo</th><th>Tomador</th><th>Tipologia</th><th>Série</th>${renderCabecalhoMeses(periodos)}<th>Total</th></tr></thead>
      <tbody id="corpo-tabela"></tbody>
    </table>
    </div>
    </div>
    <div id="secao-grafico" style="display:none">
      <div id="grafico-svg-container"></div>
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
