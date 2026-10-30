'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const MAX_SKIN_BYTES = 100 * 1024 * 1024;

async function importBinFiles(filePaths, directory) {
  if (!Array.isArray(filePaths)) throw new TypeError('Ожидался список выбранных BIN-файлов');
  await fs.mkdir(directory, { recursive: true });
  const result = { canceled: false, selected: filePaths.length, imported: [], skipped: [], failed: [] };
  const seen = new Set();

  for (const source of filePaths) {
    const filename = typeof source === 'string' ? path.basename(source) : String(source || 'неизвестный файл');
    try {
      if (typeof source !== 'string' || path.extname(source).toLowerCase() !== '.bin') {
        throw new Error('поддерживаются только файлы .bin');
      }
      const sourcePath = await fs.realpath(source);
      const data = await fs.readFile(sourcePath);
      if (!data.length || data.length > MAX_SKIN_BYTES) throw new Error('файл пустой или превышает 100 МБ');
      const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
      const id = 'user-' + hash;
      const name = path.basename(source, path.extname(source)).slice(0, 100) || hash;

      if (seen.has(id)) {
        result.skipped.push({ file: filename, id, reason: 'duplicate-selection' });
        continue;
      }
      seen.add(id);

      let alreadyStored = false;
      try {
        await fs.writeFile(path.join(directory, hash + '.bin'), data, { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        alreadyStored = true;
      }
      if (alreadyStored) {
        result.skipped.push({ file: filename, id, reason: 'already-imported' });
        continue;
      }
      await fs.writeFile(path.join(directory, hash + '.json'), JSON.stringify({ name, source: sourcePath }), { flag: 'wx' });
      result.imported.push({ id, name });
    } catch (error) {
      result.failed.push({ file: filename, error: error.message || String(error) });
    }
  }
  return result;
}

async function saveGeneratedBin(encoded, requestedName, directory) {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Некорректные данные BIN для сохранения');
  }
  const data = Buffer.from(encoded, 'base64');
  if (!data.length || data.length > MAX_SKIN_BYTES || data.toString('base64') !== encoded) {
    throw new Error('BIN пустой, повреждён или превышает 100 МБ');
  }
  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  const id = 'user-' + hash, name = String(requestedName || 'Раздвинутый прибор').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) || hash;
  await fs.mkdir(directory, { recursive: true });
  const binPath = path.join(directory, hash + '.bin'), metaPath = path.join(directory, hash + '.json');
  try {
    await fs.writeFile(binPath, data, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await fs.readFile(binPath);
    if (!existing.equals(data)) throw new Error('Коллизия идентификатора BIN; исходный файл не изменён');
  }
  await fs.writeFile(metaPath, JSON.stringify({ name }));
  return { id, name };
}

async function deleteBinSkins(ids, directory, trashOriginal) {
  if (!Array.isArray(ids)) throw new TypeError('Ожидался список идентификаторов BIN-скинов');
  const result = { selected: ids.length, deleted: [], failed: [] };
  for (const id of new Set(ids)) {
    if (typeof id !== 'string' || !/^user-[a-f0-9]{16}$/i.test(id)) {
      result.failed.push({ id: String(id), error: 'некорректный идентификатор BIN-скина' });
      continue;
    }
    const hash = id.slice(5), binPath = path.join(directory, hash + '.bin'), metaPath = path.join(directory, hash + '.json');
    try {
      let stored = null, meta = {};
      try { stored = await fs.readFile(binPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { meta = JSON.parse(await fs.readFile(metaPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      await fs.rm(binPath, { force: true });
      await fs.rm(metaPath, { force: true });

      let source = 'not-tracked', sourceError;
      if (stored && typeof meta.source === 'string' && path.isAbsolute(meta.source) && path.extname(meta.source).toLowerCase() === '.bin' && path.resolve(meta.source) !== path.resolve(binPath)) {
        try {
          const original = await fs.readFile(meta.source);
          if (!original.equals(stored)) source = 'modified-preserved';
          else if (typeof trashOriginal !== 'function') source = 'trash-unavailable';
          else {
            try { await trashOriginal(meta.source); source = 'recycle-bin'; }
            catch (error) { source = 'trash-error'; sourceError = error.message || String(error); }
          }
        } catch (error) {
          if (error.code === 'ENOENT') source = 'not-found';
          else { source = 'trash-error'; sourceError = error.message || String(error); }
        }
      }
      result.deleted.push({ id, source, ...(sourceError ? { sourceError } : {}) });
    } catch (error) {
      result.failed.push({ id, error: error.message || String(error) });
    }
  }
  return result;
}

module.exports = { importBinFiles, saveGeneratedBin, deleteBinSkins, MAX_SKIN_BYTES };
