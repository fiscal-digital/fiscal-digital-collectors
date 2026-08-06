// Testes da lógica pura do ingestor de pacotes (node:test — roda no plan.yml).
//
// O que está protegido: a camada raw é IMUTÁVEL e alimentada uma única vez.
// Um parse errado aqui não quebra um request — grava lixo permanente no S3
// que todo o processamento futuro vai derivar. Por isso cada transformação
// (data, unescape, chave por hash) tem teste antes do primeiro run real.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toIsoDate, unescapeXml, extractTag, parseAggregateXml, sha256,
  txtKey, zipS3Key, manifestS3Key, cityIdFromXmlName,
  shouldSkipCityYear, parseYears, MANIFEST_SCHEMA_VERSION,
} from './ingest-aggregates.mjs'

test('toIsoDate converte data BR e rejeita inválidas', () => {
  assert.equal(toIsoDate('18/07/2025'), '2025-07-18')
  assert.equal(toIsoDate('01/01/2021'), '2021-01-01')
  assert.equal(toIsoDate('29/02/2024'), '2024-02-29') // bissexto
  assert.equal(toIsoDate('31/02/2025'), null)          // dia impossível
  assert.equal(toIsoDate('2025-07-18'), null)          // já ISO — formato errado
  assert.equal(toIsoDate(''), null)
  assert.equal(toIsoDate(undefined), null)
})

test('unescapeXml desfaz as 5 entidades e nada mais', () => {
  assert.equal(unescapeXml('a &amp; b &lt;x&gt; &quot;q&quot; &apos;s&apos;'), `a & b <x> "q" 's'`)
  // Conteúdo RAW não sofre nenhuma outra transformação (acentos, quebras).
  assert.equal(unescapeXml('Gravataí\r\n  espaços   preservados'), 'Gravataí\r\n  espaços   preservados')
})

test('extractTag é linear e devolve null quando a tag não fecha', () => {
  assert.equal(extractTag('<a>x</a>', 'a'), 'x')
  assert.equal(extractTag('<a>x', 'a'), null)
  assert.equal(extractTag('sem tag', 'a'), null)
})

const XML = `<root>
  <meta>
    <uf>RS</uf>
    <ano_publicacao>2025</ano_publicacao>
    <municipio>Caxias do Sul</municipio>
    <municipio_codigo_ibge>4305108</municipio_codigo_ibge>
  </meta>
  <diarios>
    <diario>
      <meta_diario>
        <url_arquivo_original>https://ex.com/d?x=1&amp;y=2</url_arquivo_original>
        <poder>executive</poder>
        <edicao_extra>Não</edicao_extra>
        <numero_edicao>101</numero_edicao>
        <data_publicacao>02/01/2025</data_publicacao>
      </meta_diario>
      <conteudo>Dispensa de licitação &amp; aditivo nº 4 &lt;teste&gt;</conteudo>
    </diario>
    <diario>
      <meta_diario>
        <poder>executive_legislative</poder>
        <edicao_extra>Sim</edicao_extra>
        <numero_edicao>102</numero_edicao>
        <data_publicacao>03/01/2025</data_publicacao>
      </meta_diario>
      <conteudo>Edição extra com conteúdo íntegro.</conteudo>
    </diario>
    <diario>
      <meta_diario>
        <numero_edicao>103</numero_edicao>
        <data_publicacao>data quebrada</data_publicacao>
      </meta_diario>
      <conteudo>Não deve entrar — data inválida.</conteudo>
    </diario>
  </diarios>
</root>`

test('parseAggregateXml extrai diários com data ISO, unescape e flags', () => {
  const { territoryId, diarios, skipped } = parseAggregateXml(XML)
  assert.equal(territoryId, '4305108')
  assert.equal(diarios.length, 2)
  assert.equal(skipped, 1) // o de data quebrada não derruba o run — é contado

  assert.equal(diarios[0].date, '2025-01-02')
  assert.equal(diarios[0].edicao, '101')
  assert.equal(diarios[0].isExtra, false)
  assert.equal(diarios[0].urlOriginal, 'https://ex.com/d?x=1&y=2')
  assert.equal(diarios[0].conteudo, 'Dispensa de licitação & aditivo nº 4 <teste>')

  assert.equal(diarios[1].isExtra, true)
  assert.equal(diarios[1].poder, 'executive_legislative')
})

test('chaves do S3 são determinísticas e derivadas do conteúdo', () => {
  const sha = sha256('texto do diário')
  assert.equal(sha, sha256('texto do diário'))            // estável
  assert.notEqual(sha, sha256('texto do diário '))        // sensível a 1 char
  assert.equal(txtKey('4305108', '2025-01-02', sha), `raw/txt/4305108/2025-01-02/${sha.slice(0, 16)}.txt`)
  assert.equal(zipS3Key('RS', '2025'), 'raw/aggregates/RS/RS_2025.zip')
  assert.equal(manifestS3Key('4305108', '2025'), 'raw/manifests/4305108/2025.json')
})

test('cityIdFromXmlName extrai o IBGE do nome do arquivo', () => {
  assert.equal(cityIdFromXmlName('rscaxiassul_4305108_2025.xml'), '4305108')
  assert.equal(cityIdFromXmlName('rsportoalegre_4314902_2021.xml'), '4314902')
  assert.equal(cityIdFromXmlName('leiame.txt'), null)
  assert.equal(cityIdFromXmlName(undefined), null)
})

test('shouldSkipCityYear: só pula com manifesto íntegro do MESMO zip', () => {
  const ok = { schemaVersion: MANIFEST_SCHEMA_VERSION, sourceZipHash: 'abc', entries: [] }
  assert.equal(shouldSkipCityYear(ok, 'abc'), true)
  // QD regenerou o pacote → hash muda → reingere (o QD corrige dados às vezes)
  assert.equal(shouldSkipCityYear(ok, 'outro'), false)
  // Manifesto de schema antigo nunca é confiado
  assert.equal(shouldSkipCityYear({ ...ok, schemaVersion: 0 }, 'abc'), false)
  assert.equal(shouldSkipCityYear(null, 'abc'), false)
  assert.equal(shouldSkipCityYear({ ...ok, entries: undefined }, 'abc'), false)
})

test('parseYears aceita ano único e faixa, rejeita o resto', () => {
  assert.deepEqual(parseYears('2025'), ['2025'])
  assert.deepEqual(parseYears('2021-2023'), ['2021', '2022', '2023'])
  assert.deepEqual(parseYears('2025-2021'), []) // faixa invertida
  assert.deepEqual(parseYears('21-23'), [])
  assert.deepEqual(parseYears(undefined), [])
})
