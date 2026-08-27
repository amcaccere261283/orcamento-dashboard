# Handoff: traçado real das rodovias sem geometria (ANTT × DNIT)

**Data:** 2026-08-27
**Status:** aguardando quem assumir (Kairo) — não é continuação automática de sessão anterior

## Onde isso vive

Aba Mapa da página Alocação Equipes (`docs/alocacao-equipes.html`), seletor
"Rodovias". Fonte de dados: `tools/semanal/concessoes-rodovias.js`
(extração/merge, testado em `test/semanal-concessoes-rodovias.test.js`) +
`tools/semanal/atualizar-concessoes-rodovias.js` (script manual que gera
`dist/concessoes-rodovias.json`, publicado em `docs/concessoes-rodovias.json`).
Leia `docs/superpowers/specs/2026-08-27-alocacao-mapa-camada-rodovias-design.md`
pro desenho completo da feature antes de mexer em qualquer coisa aqui —
este documento é só o problema específico que ficou aberto, não repete o
resto.

## O problema

De 81 concessionárias no seletor, **22 não têm traçado** (`geojson: null`)
e aparecem com checkbox desabilitado + "(sem traçado)" ao lado do nome
(comportamento correto e já testado — não mexer nisso). Uma é
"Ecovias Raposo Castello" (`id: "40"`, veio da ABCR mas sem trecho
publicado no site fonte). As outras 21 vieram de uma lista **manual**
coletada da ANTT (constante `CONCESSIONARIAS_EXTRA_ANTT` em
`concessoes-rodovias.js`), que desde o início nunca teve geometria —
só o nome:

```
Autopista Fluminense, Autopista Litoral Sul, Autopista Planalto Sul,
Autopista Regis Bittencourt, Ecovias das Gerais, Elovias, EPR Paraná,
Motiva Minas SP, Motiva Pantanal, Motiva Paraná, Motiva RioSP,
Motiva ViaCosteira, Motiva ViaSul, Rota Verde Goiás, Triunfo Concebra,
Triunfo Transbrasiliana, Via Araucária, Via Campo, Way-153, Way-262,
Way-364
```

(ids correspondentes: `antt-<nome-em-slug>`, ex. `antt-via-araucaria`)

**A tarefa: conseguir o traçado (LineString/MultiLineString) real de cada
uma dessas 21 e colocar em produção**, mantendo a 22ª (Raposo Castello) de
fora do escopo por enquanto — essa é um problema diferente (conferir se a
ABCR tem o trecho dela em algum lugar que o scraper atual não captura).

## O que já foi investigado e DESCARTADO (não repetir)

1. **Relatório Power BI da ANTT** ("Mapa das Concessões",
   `app.powerbi.com/view?r=eyJrIjoiMzc2OGVkZjYtY2JhNC00MzhhLTg4OTItY2JkM2E2NDljN2ZjIiwidCI6Ijg3YmJlOWRlLWE4OTItNGNkZS1hNDY2LTg4Zjk4MmZiYzQ5MCJ9`).
   A tabela visível é `Concessionária / Código-SNV / Rodovia-UF / km
   inicial / km final / Extensão` — sem coordenada. A API interna
   (`.../public/reports/querydata`) devolve os dados num formato
   comprimido proprietário (DSR: dicionário de valores + RLE), sem
   documentação oficial. Decifrar isso do zero é caro e frágil — **não
   é o caminho recomendado**, mesmo que pareça ter algo parecido com
   coordenada em alguns campos brutos.
2. **Portal de dados abertos da ANTT** (`dados.antt.gov.br`, dataset
   `trecho-concedido`). Confirmado ao vivo via API CKAN
   (`dados.antt.gov.br/api/3/action/package_show?id=trecho-concedido`):
   os CSVs/JSONs oficiais (`informacoes-sobre-os-trechos-concedidosN_2026.csv`)
   têm exatamente os mesmos campos do Power BI —
   `concessionaria;ano_do_pnv_snv;tipo_de_rodovia;rodovia;uf;km_m_inicial;
   km_m_final;direcao;sentido` — **sem coordenada nenhuma**. É referência
   linear por km (posição ao longo da rodovia), não geometria.

## Caminho recomendado, ainda NÃO tentado

Cruzar essa referência por km contra a **malha física do DNIT** (Sistema
Nacional de Viação, SNV), que tem a geometria real de cada trecho de
rodovia federal. Exportável via **VGeo** (`servicos.dnit.gov.br/vgeo/`) em
Shapefile/GeoJSON/KML/CSV — a ferramenta permite gerar trechos por atributo
(rodovia, UF, km) de qualquer rodovia cadastrada no SNV.

Passos esperados (não testados, primeira sessão vai precisar validar cada
um):

1. Descobrir o formato de export real do VGeo pras 21 rodovias em questão
   (provavelmente Shapefile — precisa converter pra GeoJSON; ver se dá pra
   filtrar só as UFs/rodovias relevantes em vez de baixar o Brasil
   inteiro).
2. Pra cada uma das 21 concessionárias, achar o(s) registro(s) de
   `informacoes-sobre-os-trechos-concedidos*.csv` da ANTT (rodovia + UF +
   km_m_inicial + km_m_final) que correspondem a ela.
3. Casar (rodovia, UF, faixa de km) contra a malha do DNIT e recortar só o
   trecho correspondente como `LineString`/`MultiLineString`.
4. **Verificar se a malha do SNV cobre as 21 rodovias** — pode não cobrir
   todas (algumas concessões são estaduais, não federais; o SNV é malha
   FEDERAL). Se uma rodovia for estadual, a fonte certa muda (seria o DER
   do estado correspondente, não o DNIT) — não assumir que todas resolvem
   pela mesma fonte.

## Formato de saída esperado

Mesmo shape que o resto de `dist/concessoes-rodovias.json`:

```json
{ "id": "antt-via-araucaria", "nome": "Via Araucária", "slug": null, "cor": null,
  "geojson": { "type": "FeatureCollection", "features": [
    { "type": "Feature", "properties": {}, "geometry": { "type": "LineString", "coordinates": [[lon, lat], ...] } }
  ] } }
```

Coordenadas arredondadas a 5 casas decimais — reaproveitar
`simplificarCoordenadas` (já existe em `concessoes-rodovias.js`, testada)
em vez de reimplementar.

## Como isso entra em produção (não editar o JSON à mão)

O `geojson` resolvido tem que ficar **disponível pro pipeline**, não só
colado uma vez no `dist/concessoes-rodovias.json` — senão a próxima vez que
alguém rodar `atualizar-concessoes-rodovias.js` (que só raspa a ABCR e
mescla `CONCESSIONARIAS_EXTRA_ANTT`) apaga o traçado em silêncio. Padrão
recomendado: acrescentar o `geojson` resolvido dentro de
`CONCESSIONARIAS_EXTRA_ANTT` (ou um novo módulo que resolve isso e é
mesclado do mesmo jeito) — igual ao alerta que já existe no comentário
daquela constante. Cobrir com teste (mesmo padrão dos outros: função pura,
fixture pequena, sem rede na suíte `node --test`).

## Convenções do repositório a seguir

- `tools/semanal/*.js` Node-only (scripts `atualizar-*.js`, módulos que só
  o build lê) podem usar `const`/arrow normalmente — isso NÃO é módulo
  dual/bundle de navegador.
- Nunca lançar por dado ausente/malformado nesta camada — mesma filosofia
  de `coordenadas-sup.js`/`concessoes-rodovias.js`: sem traçado pra uma
  rodovia é estado normal, não erro.
- Rodar `node --test test/*.test.js` inteiro depois de qualquer mudança —
  suíte tem que ficar 100% verde (só a falha pré-existente e documentada de
  `test/semanal-demandas-planilha-real.test.js`, sobre colunas do Link 1,
  é aceitável e não relacionada a isto).
- CLAUDE.md do repositório (raiz) tem a regra de sempre publicar depois de
  reconstruir — mas ver a memória sobre o Pages: **nunca usar a API
  `pages/builds` legada**, o deploy agora é via `.github/workflows/pages.yml`
  (dispara sozinho em qualquer push que toque `docs/**`).
