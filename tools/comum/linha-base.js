'use strict';

// Reconciliação das chaves entre a MATRIZ viva e o estudo de linha de base.
//
// Esta lógica nasceu dentro de anexarPrevistoInicial (tools/orcamento/
// build-dashboard.js) e por isso NÃO era aplicada pela página do
// Planejamento Semanal: lá o cliente recebia a linha de base com as chaves
// ORIGINAIS do estudo e tools/semanal/compute-balanco.js (chaveBaseline)
// procurava `sup + '||' + tipologia` CRU, direto da MATRIZ. Só LAB.C e LAB.E
// já são 68 das 340 linhas da grade real, mais os 7 SUPs renomeados/renovados
// -- todas cairiam em semBase:true na base "Previsto Inicial",
// indistinguível de "o contrato entrou depois do estudo de linha de base",
// que é justamente o caso que a seção Riscos da spec exige que apareça de
// forma inconfundível. E faria as duas páginas discordarem sobre o mesmo
// número, que é o que a casca compartilhada existe para impedir.
//
// Por isso os dois mapas moram aqui, num lugar só, e as duas páginas passam
// por resolverChaveLinhaBase: o orçamento ao anexar previstoInicial em cada
// registro, o semanal ao serializar a linha de base para o cliente
// (baselineParaCliente), que assim entrega entradas JÁ CHAVEADAS PELA MATRIZ.
//
// Módulo de BUILD (Node, `const`/arrow à vontade): não entra em nenhum
// bundle de navegador -- quem roda no cliente (compute-balanco.js) já recebe
// a linha de base rechaveada e só precisa da chave crua.

// LAB.C/LAB.E (rótulo da MATRIZ viva) equivalem a LAB./LAB. ESPECIAL na
// linha de base (mesma tradução usada em toda a integração com arquivos
// externos deste projeto -- ver o Apps Script e a análise da MATRIZ real).
const TIP_MAP_LINHA_BASE = { 'LAB.C': 'LAB.', 'LAB.E': 'LAB. ESPECIAL' };

// SUP da MATRIZ viva -> nome/código correspondente na linha de base --
// preenchido cruzando manualmente com o usuário os 70 pares SUP+tipologia
// que não bateram por conta de renomeação/renovação de contrato desde o
// estudo original, ou porque a linha de base usa um nome descritivo em vez
// de um código SUP-nnnn-aa. Só entra em uso como FALLBACK (ver
// resolverChaveLinhaBase) -- nenhum destes tinha uma chave direta própria
// na linha de base, confirmado antes de mapear, então não existe risco de
// sobrescrever um match correto que já existisse.
const SUP_MAP_LINHA_BASE = {
  'SUP-8437-26': 'EPR - Iguaçu',
  'SUP-6830-23': 'SUP-6830-24',
  'SUP-8370-25': 'SUP-8224-25 (SR)',
  'SUP-8224-25': 'MOTIVA - BID 2.0',
  'Diversos': 'DIVERSOS',
  'SUP-8276-25': 'ECOVIAS - Nova Raposo - Lote 04',
  'SUP-8413-26': 'ECOVIAS - Nova Raposo - Pacote 02',
};

// Chave no espaço da MATRIZ: sup e tipologia CRUS, exatamente como
// parse-matriz.js os entrega. É a MESMA expressão de chaveBaseline em
// tools/semanal/compute-balanco.js -- de propósito: é o formato que o
// cliente recebe e procura.
function chaveMatriz(sup, tipologia) {
  return `${sup}||${tipologia}`;
}

// Chave correspondente na LINHA DE BASE para um par (sup, tipologia) da
// MATRIZ, ou null quando nenhuma das duas tentativas existe em porChave.
// Tenta o SUP da própria MATRIZ primeiro (já com a tipologia traduzida); só
// cai no nome mapeado em SUP_MAP_LINHA_BASE se a chave direta NÃO existir --
// o fallback nunca sobrescreve um match direto (ver
// test/orcamento-anexar-previsto-inicial.test.js).
function resolverChaveLinhaBase(porChave, sup, tipologia) {
  const tipologiaBaseline = TIP_MAP_LINHA_BASE[tipologia] || tipologia;
  const chaveDireta = `${sup}||${tipologiaBaseline}`;
  if (porChave.has(chaveDireta)) return chaveDireta;
  const supBaseline = SUP_MAP_LINHA_BASE[sup];
  if (supBaseline) {
    const chaveMapeada = `${supBaseline}||${tipologiaBaseline}`;
    if (porChave.has(chaveMapeada)) return chaveMapeada;
  }
  return null;
}

// registros da MATRIZ + porChave da linha de base (o Map de
// tools/orcamento/parse-baseline.js) -> { porChaveMatriz, chavesUsadas }.
//
// porChaveMatriz é a MESMA linha de base RECHAVEADA pelo par (sup,
// tipologia) da MATRIZ -- é isso que as duas páginas consomem daqui pra
// frente. Entradas do estudo que nenhum registro reivindicou ficam DE FORA:
// depois do rechaveamento elas são inalcançáveis por definição (nenhuma
// busca por chave da MATRIZ chegaria nelas), e mantê-las só inflaria o blob
// cifrado da página semanal.
//
// chavesUsadas guarda as chaves ORIGINAIS do estudo que algum registro
// reivindicou -- o complemento delas é exatamente a fatia da linha de base
// que ficou sem dono, que build() do orçamento loga para quem for
// reconciliar os ~110MM não achar que aquilo é zero de verdade.
function reconciliarLinhaBase(registros, porChave) {
  const porChaveMatriz = new Map();
  const chavesUsadas = new Set();
  (registros || []).forEach(registro => {
    if (!registro) return;
    const chaveBase = resolverChaveLinhaBase(porChave, registro.sup, registro.tipologia);
    if (chaveBase === null) return;
    chavesUsadas.add(chaveBase);
    porChaveMatriz.set(chaveMatriz(registro.sup, registro.tipologia), porChave.get(chaveBase));
  });
  return { porChaveMatriz, chavesUsadas };
}

module.exports = {
  TIP_MAP_LINHA_BASE, SUP_MAP_LINHA_BASE,
  chaveMatriz, resolverChaveLinhaBase, reconciliarLinhaBase,
};
