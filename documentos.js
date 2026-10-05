// Indexa documentación en markdown (wikis, docs, ADRs) en la tabla `documentos`, troceada por sección.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const MAX = 4000;
const IGNORAR = new Set(['node_modules', 'bin', 'obj', 'dist', 'build']);

// Título legible a partir del nombre de archivo. Las wikis de Azure DevOps usan '-' por espacio y %XX para el resto.
export function tituloDeArchivo(ruta) {
  const base = basename(ruta).replace(/\.md$/i, '');
  let t = base.replace(/-/g, ' ');
  try { t = decodeURIComponent(t); } catch {}
  return t.trim();
}

// Divide un markdown en fragmentos por título (#, ##, ###), ignorando los que están dentro de bloques de código.
// Cada fragmento queda con un título tipo "Página › Sección"; los muy largos se cortan por párrafos.
export function trocear(md, tituloPagina) {
  const secciones = [];
  let actual = { titulo: tituloPagina, lineas: [] };
  let enCodigo = false;
  for (const linea of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(linea)) enCodigo = !enCodigo;
    const m = !enCodigo && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(linea);
    if (m) {
      if (actual.lineas.join('').trim()) secciones.push(actual);
      const encabezado = m[2].trim();
      actual = { titulo: encabezado === tituloPagina ? tituloPagina : `${tituloPagina} › ${encabezado}`, lineas: [linea] };
    } else {
      actual.lineas.push(linea);
    }
  }
  if (actual.lineas.join('').trim()) secciones.push(actual);

  const fragmentos = [];
  for (const s of secciones) {
    const texto = s.lineas.join('\n').trim();
    if (texto.length <= MAX) { fragmentos.push({ titulo: s.titulo, texto }); continue; }
    let trozo = '';
    for (const parrafo of texto.split(/\n\s*\n/)) {
      if (trozo && trozo.length + parrafo.length > MAX) { fragmentos.push({ titulo: s.titulo, texto: trozo }); trozo = ''; }
      trozo = trozo ? `${trozo}\n\n${parrafo}` : parrafo;
    }
    if (trozo) fragmentos.push({ titulo: s.titulo, texto: trozo.slice(0, MAX * 2) });
  }
  return fragmentos;
}

function listarMarkdown(ruta) {
  const st = statSync(ruta);
  if (st.isFile()) return /\.md$/i.test(ruta) ? [ruta] : [];
  const archivos = [];
  for (const e of readdirSync(ruta, { withFileTypes: true })) {
    if (e.name.startsWith('.') || IGNORAR.has(e.name)) continue; // .git, .attachments, .order…
    const r = join(ruta, e.name);
    if (e.isDirectory()) archivos.push(...listarMarkdown(r));
    else if (e.isFile() && /\.md$/i.test(e.name)) archivos.push(r);
  }
  return archivos;
}

// Registra (si hace falta) e indexa una fuente de forma incremental: solo procesa archivos nuevos o modificados
// y quita del índice los que ya no existen.
export function indexarFuente(db, ruta, nombre) {
  const fuente = resolve(ruta);
  const archivos = listarMarkdown(fuente);
  const previo = db.prepare('SELECT nombre FROM fuentes WHERE ruta = ?').get(fuente);
  const nombreFinal = nombre || previo?.nombre || basename(fuente);

  const estadoArchivo = db.prepare('SELECT mtime FROM docs_archivos WHERE ruta = ?');
  const borrarDocs = db.prepare('DELETE FROM documentos WHERE ruta = ?');
  const insertarDoc = db.prepare('INSERT INTO documentos (texto, titulo, ruta, fuente) VALUES (?, ?, ?, ?)');
  const guardarArchivo = db.prepare(`INSERT INTO docs_archivos (ruta, fuente, mtime, fragmentos) VALUES (?, ?, ?, ?)
    ON CONFLICT(ruta) DO UPDATE SET fuente = excluded.fuente, mtime = excluded.mtime, fragmentos = excluded.fragmentos`);

  const r = { fuente, nombre: nombreFinal, archivos: archivos.length, actualizados: 0, eliminados: 0, fragmentos: 0 };
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO fuentes (ruta, nombre, indexado) VALUES (?, ?, ?)
      ON CONFLICT(ruta) DO UPDATE SET nombre = excluded.nombre, indexado = excluded.indexado`)
      .run(fuente, nombreFinal, new Date().toISOString());

    const vistos = new Set(archivos);
    for (const archivo of archivos) {
      const mtime = statSync(archivo).mtimeMs;
      if (estadoArchivo.get(archivo)?.mtime === mtime) continue;
      const pagina = archivos.length === 1 && archivo === fuente
        ? tituloDeArchivo(archivo)
        : relative(fuente, archivo).split('/').map(tituloDeArchivo).join(' / ');
      const fragmentos = trocear(readFileSync(archivo, 'utf8'), pagina);
      borrarDocs.run(archivo);
      for (const f of fragmentos) insertarDoc.run(f.texto, f.titulo, archivo, fuente);
      guardarArchivo.run(archivo, fuente, mtime, fragmentos.length);
      r.actualizados++;
      r.fragmentos += fragmentos.length;
    }
    for (const { ruta: archivo } of db.prepare('SELECT ruta FROM docs_archivos WHERE fuente = ?').all(fuente)) {
      if (vistos.has(archivo)) continue;
      borrarDocs.run(archivo);
      db.prepare('DELETE FROM docs_archivos WHERE ruta = ?').run(archivo);
      r.eliminados++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return r;
}

// Quita una fuente y todo lo que se indexó de ella.
export function quitarFuente(db, ruta) {
  const fuente = resolve(ruta);
  db.prepare('DELETE FROM documentos WHERE fuente = ?').run(fuente);
  db.prepare('DELETE FROM docs_archivos WHERE fuente = ?').run(fuente);
  return Number(db.prepare('DELETE FROM fuentes WHERE ruta = ?').run(fuente).changes);
}

export function listarFuentes(db) {
  return db.prepare(`
    SELECT f.ruta, f.nombre, f.indexado, COUNT(a.ruta) AS archivos, COALESCE(SUM(a.fragmentos), 0) AS fragmentos
    FROM fuentes f LEFT JOIN docs_archivos a ON a.fuente = f.ruta
    GROUP BY f.ruta ORDER BY f.nombre`).all();
}

// Reindexa todas las fuentes registradas. Las que ya no existen en disco se omiten (no se borran: puede ser un disco desmontado).
export function reindexarTodo(db) {
  const resultados = [];
  for (const { ruta } of db.prepare('SELECT ruta FROM fuentes').all()) {
    try { resultados.push(indexarFuente(db, ruta)); } catch (e) { resultados.push({ fuente: ruta, error: e.message }); }
  }
  return resultados;
}
