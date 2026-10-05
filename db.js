// Acceso a la base de la bitácora (SQLite + FTS5, incluido en Node >= 22.13).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const RUTA_DB = process.env.BITACORA_DB || join(homedir(), '.bitacora', 'bitacora.db');

export function abrir(ruta = RUTA_DB) {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;

    -- Memorias curadas: hechos, decisiones, tareas, notas, resúmenes, preferencias.
    CREATE VIRTUAL TABLE IF NOT EXISTS memorias USING fts5(
      texto, tags,
      proyecto UNINDEXED, tipo UNINDEXED, creado UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Historial crudo de conversaciones importado de los transcripts.
    CREATE VIRTUAL TABLE IF NOT EXISTS mensajes USING fts5(
      texto,
      rol UNINDEXED, sesion UNINDEXED, proyecto UNINDEXED, ts UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Hasta qué línea se importó cada transcript (importación incremental).
    CREATE TABLE IF NOT EXISTS importaciones (
      archivo TEXT PRIMARY KEY,
      lineas  INTEGER NOT NULL
    );

    -- Documentación en markdown (wikis, docs, ADRs), troceada por sección.
    CREATE VIRTUAL TABLE IF NOT EXISTS documentos USING fts5(
      texto, titulo,
      ruta UNINDEXED, fuente UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Carpetas o archivos de markdown registrados para reindexar solos.
    CREATE TABLE IF NOT EXISTS fuentes (
      ruta      TEXT PRIMARY KEY,
      nombre    TEXT NOT NULL,
      indexado  TEXT
    );

    -- Estado de cada archivo indexado, para reindexar solo lo que cambió.
    CREATE TABLE IF NOT EXISTS docs_archivos (
      ruta       TEXT PRIMARY KEY,
      fuente     TEXT NOT NULL,
      mtime      REAL NOT NULL,
      fragmentos INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS estado (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );
  `);
  return db;
}

// Un proyecto se identifica por la raíz de su repositorio git, para que abrir Claude en una
// subcarpeta comparta la misma memoria. Fuera de un repo, se usa la carpeta tal cual.
const cacheRaices = new Map();
export function raizProyecto(dir) {
  if (!dir) return '';
  if (cacheRaices.has(dir)) return cacheRaices.get(dir);
  let raiz = resolve(dir);
  for (let d = raiz; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) { raiz = d; break; }
    if (dirname(d) === d) break;
  }
  cacheRaices.set(dir, raiz);
  return raiz;
}

// Palabras vacías: con OR, una coincidencia en "de" o "la" bastaría para traer cualquier documento.
const VACIAS = new Set((
  'a al algo con contra cual cuando de del desde donde el ella ellos en entre era es esa ese eso esta este esto fue ' +
  'ha hay la las le les lo los mas me mi muy no nos o para pero por que se sea ser si sin sobre su sus tambien te tu un una ' +
  'uno unos y ya yo como hacer hace qué cómo ' +
  'an and are as at be by for from how in is it of on or that the this to was what when where which with'
).split(' '));

// Convierte texto libre en una consulta FTS5 segura: cada palabra entre comillas, unidas con OR, sin palabras vacías
// (salvo que la consulta tenga solo palabras vacías). El ranking BM25 deja arriba lo que coincide con más palabras.
export function consultaFts(texto) {
  const palabras = String(texto).match(/[\p{L}\p{N}_]+/gu) || [];
  const utiles = palabras.filter(p => !VACIAS.has(p.toLowerCase()));
  return (utiles.length ? utiles : palabras).map(p => `"${p}"`).join(' OR ');
}

export function guardar(db, { texto, tipo = 'nota', proyecto = '', tags = '' }) {
  const r = db.prepare(
    'INSERT INTO memorias (texto, tags, proyecto, tipo, creado) VALUES (?, ?, ?, ?, ?)'
  ).run(texto, tags, proyecto, tipo, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

// Los documentos no se filtran por proyecto: una wiki suele servir a varios repos.
export function buscar(db, { consulta, proyecto, limite = 10, incluirHistorial = true, incluirDocumentos = true }) {
  const q = consultaFts(consulta);
  if (!q) return { memorias: [], mensajes: [], documentos: [] };
  const filtro = proyecto ? 'AND proyecto = ?' : '';
  const args = proyecto ? [q, proyecto, limite] : [q, limite];

  const memorias = db.prepare(`
    SELECT rowid AS id, tipo, proyecto, creado, tags, texto
    FROM memorias WHERE memorias MATCH ? ${filtro}
    ORDER BY bm25(memorias) LIMIT ?`).all(...args);

  const mensajes = incluirHistorial ? db.prepare(`
    SELECT rowid AS id, rol, sesion, proyecto, ts,
           snippet(mensajes, 0, '«', '»', ' … ', 40) AS fragmento
    FROM mensajes WHERE mensajes MATCH ? ${filtro}
    ORDER BY bm25(mensajes) LIMIT ?`).all(...args) : [];

  // El título pesa más que el cuerpo en el ranking.
  const documentos = incluirDocumentos ? db.prepare(`
    SELECT x.*, f.nombre FROM (
      SELECT rowid AS id, titulo, ruta, fuente, bm25(documentos, 1.0, 3.0) AS rango,
             snippet(documentos, 0, '«', '»', ' … ', 40) AS fragmento
      FROM documentos WHERE documentos MATCH ? ORDER BY rango LIMIT ?
    ) x LEFT JOIN fuentes f ON f.ruta = x.fuente ORDER BY x.rango`).all(q, limite) : [];

  return { memorias, mensajes, documentos };
}

export function recientes(db, { proyecto, limite = 15 }) {
  const filtro = proyecto ? 'WHERE proyecto = ?' : '';
  const args = proyecto ? [proyecto, limite] : [limite];
  return db.prepare(`
    SELECT rowid AS id, tipo, proyecto, creado, tags, texto
    FROM memorias ${filtro} ORDER BY creado DESC LIMIT ?`).all(...args);
}

export function olvidar(db, id) {
  return Number(db.prepare('DELETE FROM memorias WHERE rowid = ?').run(id).changes);
}
