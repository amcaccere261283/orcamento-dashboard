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
