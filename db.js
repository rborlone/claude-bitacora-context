// Acceso a la base de memoria (SQLite + FTS5, incluido en Node >= 22.13).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const RUTA_DB = process.env.MEMORIA_DB || join(homedir(), '.memoria', 'memoria.db');

export function abrir(ruta = RUTA_DB) {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;

    -- Memorias curadas: hechos, decisiones, tareas, notas, resúmenes.
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
  `);
  return db;
}

// Convierte texto libre en una consulta FTS5 segura: cada palabra entre comillas, unidas con OR.
// El ranking BM25 deja arriba los resultados que coinciden con más palabras.
export function consultaFts(texto) {
  const palabras = String(texto).match(/[\p{L}\p{N}_]+/gu) || [];
  return palabras.map(p => `"${p}"`).join(' OR ');
}

export function guardar(db, { texto, tipo = 'nota', proyecto = '', tags = '' }) {
  const r = db.prepare(
    'INSERT INTO memorias (texto, tags, proyecto, tipo, creado) VALUES (?, ?, ?, ?, ?)'
  ).run(texto, tags, proyecto, tipo, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function buscar(db, { consulta, proyecto, limite = 10, incluirHistorial = true }) {
  const q = consultaFts(consulta);
  if (!q) return { memorias: [], mensajes: [] };
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

  return { memorias, mensajes };
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
