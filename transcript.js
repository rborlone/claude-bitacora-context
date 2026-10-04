// Importa transcripts JSONL de Claude Code a la tabla `mensajes`, de forma incremental.
import { readFileSync } from 'node:fs';

const MAX = 4000;
const corto = (s, n = MAX) => (s.length > n ? s.slice(0, n) + ' …[truncado]' : s);

// Resumen de una llamada a herramienta: nombre + lo más descriptivo de su input.
function resumenHerramienta(b) {
  const i = b.input || {};
  const detalle = i.description || i.file_path || i.command || i.pattern || i.query || i.url || i.prompt || '';
  return `[${b.name}] ${corto(String(detalle), 300)}`;
}

// Extrae el texto útil de una línea del transcript; null si no aporta (thinking, tool_result, meta…).
export function extraer(o) {
  if (o.isMeta || o.isSidechain) return null;
  const c = o.message?.content;
  if (o.type === 'user') {
    if (typeof c === 'string') return { rol: 'user', texto: c };
    if (Array.isArray(c)) {
      const t = c.filter(b => b.type === 'text').map(b => b.text).join('\n');
      return t ? { rol: 'user', texto: t } : null;
    }
  }
  if (o.type === 'assistant' && Array.isArray(c)) {
    const partes = c.map(b => b.type === 'text' ? b.text : b.type === 'tool_use' ? resumenHerramienta(b) : '')
                    .filter(Boolean);
    return partes.length ? { rol: 'assistant', texto: partes.join('\n') } : null;
  }
  return null;
}

// Importa las líneas nuevas de `archivo` desde la última importación. Devuelve cuántos mensajes agregó.
export function importarTranscript(db, archivo) {
  let contenido;
  try { contenido = readFileSync(archivo, 'utf8'); } catch { return 0; }
  const lineas = contenido.split('\n');
  // La última línea puede estar a medio escribir: solo se cuentan las terminadas en \n.
  const completas = lineas.length - 1;
  const previo = db.prepare('SELECT lineas FROM importaciones WHERE archivo = ?').get(archivo)?.lineas ?? 0;
  if (completas <= previo) return 0;

  const insertar = db.prepare(
    'INSERT INTO mensajes (texto, rol, sesion, proyecto, ts) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  db.exec('BEGIN');
  try {
    for (let i = previo; i < completas; i++) {
      if (!lineas[i]) continue;
      let o; try { o = JSON.parse(lineas[i]); } catch { continue; }
      const m = extraer(o);
      if (!m || !m.texto.trim()) continue;
      insertar.run(corto(m.texto), m.rol, o.sessionId || '', o.cwd || '', o.timestamp || '');
      n++;
    }
    db.prepare(`INSERT INTO importaciones (archivo, lineas) VALUES (?, ?)
                ON CONFLICT(archivo) DO UPDATE SET lineas = excluded.lineas`).run(archivo, completas);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return n;
}
