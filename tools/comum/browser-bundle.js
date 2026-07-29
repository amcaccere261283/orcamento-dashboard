'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Concatena um conjunto de módulos Node reais (testados no Node) num único
// escopo de MODULOS para rodar no navegador -- mesmo padrão já em produção
// em tools/matriz/browser-bundle.js e tools/medicoes/browser-bundle.js do
// repositório irmão, só que aqui a lista de arquivos e a ordem não são
// fixas: quem chama passa `arquivosEmOrdem`, porque cada página deste
// repositório (orçamento, e futuramente planejamento semanal) tem seu
// próprio conjunto de módulos.
//
// Não existe resolvedor de dependências: a ORDEM da lista é o contrato. Um
// arquivo só pode aparecer depois de tudo que ele consome via require(),
// já que a versão para navegador concatena tudo num único escopo (MODULOS)
// -- se um módulo precisar de outro que ainda não foi registrado, o
// require reescrito (ver transformaModulo) vai ler `undefined` de MODULOS.

// Troca `const { X, Y } = require('./arquivo.js');` por uma leitura do
// registro MODULOS, e `module.exports = {...};` por um `return`, para que o
// mesmo arquivo, sem nenhuma outra mudança, funcione tanto no Node (build)
// quanto embrulhado numa IIFE dentro do navegador (atualização ao vivo).
function transformaModulo(codigoFonte) {
  let codigo = codigoFonte.replace(/^'use strict';\r?\n/, '');
  codigo = codigo.replace(
    /const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\/([^'"]+)['"]\);?\r?\n/g,
    (match, nomes, dependencia) => `const {${nomes.trim()}} = MODULOS['${dependencia}'];\n`
  );
  // Dependência FORA do diretório do bundle (ex.: tools/semanal/compute-
  // balanco.js consumindo tools/comum/calculo-equipes.js) -- buildBrowserBundle
  // só concatena UM diretório (ver comentário no topo do arquivo), então isso
  // nunca vira uma entrada de MODULOS; nem poderia sempre virar uma, porque
  // alguns desses arquivos (caso de calculo-equipes.js) têm `require('node:fs')`
  // no próprio topo, e bundlar isso como um MODULOS comum executaria aquele
  // require na hora zero da IIFE, quebrando o bundle inteiro com
  // ReferenceError no navegador -- não só este módulo, TODOS os que vierem
  // depois dele no mesmo <script>.
  //
  // Em vez disso, a linha inteira é REMOVIDA: assume-se que os nomes
  // destruturados já existem como função global na página antes deste bundle
  // rodar -- mesmo padrão que tools/orcamento/render-dashboard.js já usa pra
  // calculo-equipes.js hoje (fonteParaCliente(), injetado num <script>
  // anterior). O require em si continua funcionando no Node normalmente, que
  // nunca passa por esta função.
  codigo = codigo.replace(
    /const\s*\{[^}]+\}\s*=\s*require\(['"]\.\.\/[^'"]+['"]\);?\r?\n/g,
    ''
  );
  codigo = codigo.replace(/module\.exports\s*=\s*([\s\S]*?);\s*$/, 'return $1;');
  return codigo;
}

// Impede que um "</script" literal dentro do código bundlado (algum dos
// módulos pode gerar HTML com tags <script>...</script>, como
// render-dashboard.js) feche prematuramente a tag <script> real que vai
// embutir esse bundle na página.
function protegeFechamentoScript(codigo) {
  return codigo.replace(/<\/script/gi, '<\\/script');
}

// dir: diretório onde estão os arquivos de arquivosEmOrdem (default:
// __dirname, ou seja, o próprio tools/comum).
// arquivosEmOrdem: nomes de arquivo relativos a dir, na ordem de
// dependência descrita acima -- responsabilidade de quem chama, este
// módulo não descobre dependências sozinho.
function buildBrowserBundle(dir, arquivosEmOrdem) {
  const baseDir = dir || __dirname;
  const modulosSrc = arquivosEmOrdem.map(nome => {
    // fs.readFileSync não normaliza quebra de linha, e este repositório
    // roda com core.autocrlf=true: sem o replace abaixo, um bundle gerado
    // a partir de um checkout Windows carregaria \r\n nos módulos e um
    // checkout Linux carregaria \n -- o HTML publicado passaria a depender
    // de como o repositório foi clonado. Mesmo raciocínio (e mesmo fix) de
    // trechosParaCliente() em calculo-equipes.js.
    const bruto = fs.readFileSync(path.join(baseDir, nome), 'utf8').replace(/\r\n/g, '\n');
    const transformado = transformaModulo(bruto);
    return `MODULOS['${nome}'] = (function() {\n${transformado}\n})();`;
  }).join('\n\n');

  const nucleo = `var MODULOS = {};

${modulosSrc}
`;

  return protegeFechamentoScript(nucleo);
}

module.exports = { buildBrowserBundle };
