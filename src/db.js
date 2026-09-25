const Database = require('better-sqlite3');
const path = require('node:path');
const { config } = require('./config');
const logger = require('./logger');

const db = new Database(config.infra.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS anuncios (
  appid INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  preco_original TEXT NOT NULL DEFAULT '',
  canal_id TEXT NOT NULL,
  mensagem_id TEXT NOT NULL,
  publicado_em INTEGER NOT NULL,
  expirado_em INTEGER
);

CREATE TABLE IF NOT EXISTS estatisticas (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anuncios_expirado ON anuncios(expirado_em);
`);

// Migração suave para BDs antigas: colunas novas com defaults (v2: modo cartas)
(function migrar() {
  const colunas = db.pragma('table_info(anuncios)').map((c) => c.name);
  if (!colunas.includes('tipo')) db.exec("ALTER TABLE anuncios ADD COLUMN tipo TEXT NOT NULL DEFAULT 'gratis'");
  if (!colunas.includes('detalhe')) db.exec('ALTER TABLE anuncios ADD COLUMN detalhe TEXT');
})();

// ── Anúncios ─────────────────────────────────────────────────
// Uma linha por appid: nunca se repete uma oferta já anunciada, e a mensagem
// fica guardada para ser APAGADA quando a promoção acaba.
const insertAnuncio = db.prepare(
  `INSERT OR IGNORE INTO anuncios (appid, nome, preco_original, canal_id, mensagem_id, publicado_em, tipo, detalhe)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

function anuncioGuardar(appid, nome, canalId, mensagemId, precoOriginal = '', tipo = 'gratis', detalhe = null) {
  return insertAnuncio.run(appid, nome, precoOriginal, String(canalId), String(mensagemId), Date.now(), tipo, detalhe).changes > 0;
}

function anuncioDetalhe(appid) {
  const row = db.prepare('SELECT detalhe FROM anuncios WHERE appid = ?').get(appid);
  if (!row?.detalhe) return null;
  try { return JSON.parse(row.detalhe); } catch { return null; }
}

function anuncioConhecido(appid) {
  return !!db.prepare('SELECT 1 FROM anuncios WHERE appid = ?').get(appid);
}

/** Ofertas anunciadas e ainda não expiradas (promoção supostamente ativa). */
function anunciosAtivos() {
  return db
    .prepare('SELECT appid, nome, preco_original, canal_id, mensagem_id, publicado_em, tipo, detalhe FROM anuncios WHERE expirado_em IS NULL ORDER BY publicado_em DESC')
    .all();
}

/** Anúncios ativos de um tipo ('gratis' | 'cartas'). */
function anunciosAtivosPorTipo(tipo) {
  return db
    .prepare('SELECT appid, nome, preco_original, canal_id, mensagem_id, publicado_em, detalhe FROM anuncios WHERE expirado_em IS NULL AND tipo = ? ORDER BY publicado_em DESC')
    .all(tipo);
}

function anuncioMarcarExpirado(appid) {
  db.prepare('UPDATE anuncios SET expirado_em = ? WHERE appid = ? AND expirado_em IS NULL').run(Date.now(), appid);
}

function anunciosCount() {
  return {
    total: db.prepare('SELECT COUNT(*) n FROM anuncios').get().n,
    ativos: db.prepare('SELECT COUNT(*) n FROM anuncios WHERE expirado_em IS NULL').get().n,
  };
}

function anunciosRecentes(limite = 15) {
  return db
    .prepare('SELECT appid, nome, preco_original, publicado_em, expirado_em FROM anuncios ORDER BY publicado_em DESC LIMIT ?')
    .all(limite);
}

// ── Estatísticas ─────────────────────────────────────────────
function estatisticaGet(chave, def = '0') {
  const row = db.prepare('SELECT valor FROM estatisticas WHERE chave = ?').get(chave);
  return row ? row.valor : def;
}
function estatisticaSet(chave, valor) {
  db.prepare(
    'INSERT INTO estatisticas (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor',
  ).run(chave, String(valor));
}

// ── Meta (estado interno) ────────────────────────────────────
function metaGet(chave, def = null) {
  const row = db.prepare('SELECT valor FROM meta WHERE chave = ?').get(chave);
  return row ? row.valor : def;
}
function metaSet(chave, valor) {
  db.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(
    chave,
    String(valor),
  );
}
function metaDel(chave) {
  db.prepare('DELETE FROM meta WHERE chave = ?').run(chave);
}

logger.info(`Base de dados pronta em ${path.resolve(config.infra.dbPath)}`);

module.exports = {
  db,
  anuncioGuardar,
  anuncioConhecido,
  anuncioDetalhe,
  anunciosAtivos,
  anunciosAtivosPorTipo,
  anuncioMarcarExpirado,
  anunciosCount,
  anunciosRecentes,
  estatisticaGet,
  estatisticaSet,
  metaGet,
  metaSet,
  metaDel,
};
