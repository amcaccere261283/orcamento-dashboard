'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parseia um subconjunto simples de YAML: uma lista plana sob `contratos:`,
 * mapas de 1 nível, valores escalares string/bool/int, comentários `#`.
 * Extrai só os campos usados: cliente, numero_contrato, contrato_id, ativo.
 *
 * @param {string} texto - Conteúdo bruto do arquivo contratos.yaml
 * @returns {Array<{cliente: string, numeroContrato: string, contratoId: number, ativo: boolean}>}
 */
function parseContratosYaml(texto) {
  const linhas = texto.split('\n');
  const contratos = [];
  let emListaDeContratos = false;
  let contratoAtual = null;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    // Remove comentário (tudo depois de #), mas preserva # dentro de string
    // Estratégia: procura por # que não está dentro de aspas
    const linhaLimpa = removerComentario(linha);
    const linhaSemEspacoAnt = linhaLimpa.replace(/^\s+/, '');
    const indentacao = linhaLimpa.length - linhaSemEspacoAnt.length;

    // Linha vazia
    if (!linhaSemEspacoAnt) {
      continue;
    }

    // Detecta `contratos:` na raiz (indentação 0)
    if (indentacao === 0 && linhaSemEspacoAnt.startsWith('contratos:')) {
      emListaDeContratos = true;
      continue;
    }

    // Se não estamos em lista, ignora
    if (!emListaDeContratos) {
      continue;
    }

    // Detecta início de um novo item da lista: `- slug:`
    if (linhaSemEspacoAnt.startsWith('- ')) {
      // Se temos um contrato anterior, o salvamos
      if (contratoAtual) {
        if (temCamposEssenciais(contratoAtual)) {
          contratos.push(normalizarContrato(contratoAtual));
        } else {
          console.warn('Contrato incompleto descartado (faltam cliente, contrato_id ou numero_contrato):', contratoAtual);
        }
      }
      contratoAtual = {};
      // Processa a linha do próprio `- chave: valor`
      processarLinhaDeChaveValor(linhaSemEspacoAnt.slice(2), contratoAtual);
      continue;
    }

    // Linha que começa com espaço (dentro de um item da lista)
    if (indentacao > 0 && contratoAtual) {
      processarLinhaDeChaveValor(linhaSemEspacoAnt, contratoAtual);
      continue;
    }
  }

  // Salva o último contrato se válido
  if (contratoAtual) {
    if (temCamposEssenciais(contratoAtual)) {
      contratos.push(normalizarContrato(contratoAtual));
    } else {
      console.warn('Contrato incompleto descartado (faltam cliente, contrato_id ou numero_contrato):', contratoAtual);
    }
  }

  return contratos;
}

/**
 * Remove comentários: tudo depois de # que não está dentro de aspas.
 */
function removerComentario(linha) {
  let emAspas = false;
  let emAspasSimples = false;
  for (let i = 0; i < linha.length; i++) {
    const char = linha[i];
    if (char === '"' && (i === 0 || linha[i - 1] !== '\\')) {
      emAspas = !emAspas;
    } else if (char === "'" && (i === 0 || linha[i - 1] !== '\\')) {
      emAspasSimples = !emAspasSimples;
    } else if (char === '#' && !emAspas && !emAspasSimples) {
      return linha.slice(0, i);
    }
  }
  return linha;
}

/**
 * Parseia uma linha `chave: valor` e adiciona ao objeto contratoAtual.
 * Suporta strings quoted/unquoted, booleans (true/false), e números inteiros.
 */
function processarLinhaDeChaveValor(linha, obj) {
  const idx = linha.indexOf(':');
  if (idx === -1) return;

  const chave = linha.slice(0, idx).trim();
  let valor = linha.slice(idx + 1).trim();

  if (!chave) return;

  // Parse do valor
  let valorParsado;
  if (valor.startsWith('"') && valor.endsWith('"')) {
    // String com aspas duplas
    valorParsado = valor.slice(1, -1);
  } else if (valor.startsWith("'") && valor.endsWith("'")) {
    // String com aspas simples
    valorParsado = valor.slice(1, -1);
  } else if (valor === 'true') {
    valorParsado = true;
  } else if (valor === 'false') {
    valorParsado = false;
  } else if (/^\d+$/.test(valor)) {
    // Número inteiro
    valorParsado = parseInt(valor, 10);
  } else if (valor) {
    // String não-quoted (bare string)
    valorParsado = valor;
  } else {
    valorParsado = null;
  }

  obj[chave] = valorParsado;
}

/**
 * Verifica se um contrato tem os campos essenciais para incluir.
 * `numero_contrato` é a chave de join usada por todo o funil (chaveMatriz
 * casa registro.sup com numero_contrato) -- faltando, vira `undefined`,
 * flui em silêncio pro CSV como célula vazia e produz uma linha do funil
 * chaveada tipo "||SP" sem nenhum aviso. Exigir aqui, junto com cliente e
 * contrato_id, faz o mesmo contrato incompleto ser descartado com o mesmo
 * aviso já existente, em vez de vazar adiante.
 */
function temCamposEssenciais(contrato) {
  return contrato.cliente && contrato.contrato_id !== undefined && contrato.numero_contrato;
}

/**
 * Normaliza um contrato parseado: converte chaves snake_case para camelCase JS.
 */
function normalizarContrato(contrato) {
  return {
    cliente: contrato.cliente,
    numeroContrato: contrato.numero_contrato,
    contratoId: contrato.contrato_id,
    ativo: contrato.ativo !== false, // Padrão true se ausente
  };
}

/**
 * Lê um arquivo YAML de contratos e retorna os contratos parseados.
 *
 * @param {string} caminhoArquivo - Caminho absoluto do arquivo
 * @returns {Array<{cliente: string, numeroContrato: string, contratoId: number, ativo: boolean}>}
 */
function lerContratos(caminhoArquivo) {
  const conteudo = fs.readFileSync(caminhoArquivo, 'utf8');
  return parseContratosYaml(conteudo);
}

module.exports = { parseContratosYaml, lerContratos };
