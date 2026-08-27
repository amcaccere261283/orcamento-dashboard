'use strict';
const { parseCsvGrid } = require('./parse-matriz-cliente.js');

// Este módulo roda tanto no Node (build/fetcher) quanto embrulhado no
// navegador via browser-bundle -- por isso 'var'/'function', não
// 'const'/arrow (mesma convenção de equipes-alocaveis.js/classificar-dia-equipe.js).
//
// ATIVAS DA ABA PESSOAS (mesma planilha da EQ, aba diferente)
// ============================================================================
// Pedido do dono do projeto (2026-08-27): o quadro da Alocação Equipes passa a
// mostrar só quem está com ATV=TRUE na aba PESSOAS -- coluna B, checkbox
// marcado manualmente. Tudo o mais (líder, serviços/coluna, veículo, popup,
// disponibilidade da semana) continua vindo da aba EQ, como já era --
// PESSOAS decide só QUEM aparece no quadro, não como cada um aparece.
//
// Só líder/id da equipe interessa aqui -- motivo/futura/desmobilizado etc.
// (que tools/matriz/parse-pessoas.js já calcula, planilha irmã deste projeto)
// não são usados nesta função, de propósito: não dá para requerer aquele
// módulo daqui (repositórios diferentes -- mesma razão que
// compute-equipes-ativo-matriz.js já documentava para não reimplementar o
// pipeline inteiro do Matriz), e a única coisa que a Alocação precisa por
// enquanto é a lista de ids ativos.
//
// Cada pessoa é uma linha; só a do LÍDER da equipe tem ID e ATV preenchidos --
// auxiliares seguem com ID vazio (mesma estrutura de blocos que parsePessoas
// já documenta). Resolvido por NOME de cabeçalho, não posição -- a aba já
// mudou de layout antes (ver comentário equivalente em parsePessoas).
function parsePessoasAtivas(csvText) {
  var linhas = parseCsvGrid(csvText || '');
  if (!linhas.length) return new Set();
  var header = linhas[0];
  var colId = header.indexOf('ID');
  var colAtv = header.indexOf('ATV');
  var ativos = new Set();
  if (colId === -1 || colAtv === -1) return ativos;
  for (var i = 1; i < linhas.length; i++) {
    var linha = linhas[i];
    var id = String(linha[colId] || '').trim();
    if (!id) continue;
    var atv = String(linha[colAtv] || '').trim().toUpperCase() === 'TRUE';
    if (atv) ativos.add(id);
  }
  return ativos;
}

// Mesmo filtro de parsePessoasAtivas, mas devolve COLABORADOR/LÍDER por id em
// vez de só o Set -- para o aviso de "ativa na PESSOAS mas sem linha na EQ"
// (equipesDoQuadro): sem o nome, o aviso mostraria só um id cru, difícil de
// achar na planilha. Duplica o parse em vez de reaproveitar
// parsePessoasAtivas de propósito -- é a MESMA função square (csv -> map por
// id), só que devolvendo mais colunas; extrair um Set a partir do Map aqui
// obrigaria os dois requires desnecessariamente nos poucos lugares que só
// querem o Set.
function detalhesPessoasAtivas(csvText) {
  var linhas = parseCsvGrid(csvText || '');
  var detalhes = new Map();
  if (!linhas.length) return detalhes;
  var header = linhas[0];
  var colId = header.indexOf('ID');
  var colAtv = header.indexOf('ATV');
  var colColaborador = header.indexOf('COLABORADOR');
  var colLider = header.indexOf('LÍDER');
  var colServico = header.indexOf('SERVIÇO');
  if (colId === -1 || colAtv === -1) return detalhes;
  for (var i = 1; i < linhas.length; i++) {
    var linha = linhas[i];
    var id = String(linha[colId] || '').trim();
    if (!id) continue;
    var atv = String(linha[colAtv] || '').trim().toUpperCase() === 'TRUE';
    if (!atv) continue;
    detalhes.set(id, {
      colaborador: colColaborador === -1 ? '' : String(linha[colColaborador] || '').trim(),
      lider: colLider === -1 ? '' : String(linha[colLider] || '').trim(),
      servico: colServico === -1 ? '' : String(linha[colServico] || '').trim(),
    });
  }
  return detalhes;
}

module.exports = { parsePessoasAtivas, detalhesPessoasAtivas };
