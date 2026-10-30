'use strict';
/* Dependency-free Electron ASAR writer/reader. Runtime assets only; never skins,
 * machine profiles, build outputs, or development dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BLOCK_SIZE = 4 * 1024 * 1024;
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const safeName = name => typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[\\/\0:]/.test(name);

function collectRuntimeFiles(source) {
  source = path.resolve(source);
  const files = [];
  function add(directory, relative) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (!safeName(entry.name) || entry.isSymbolicLink()) throw new Error('Unsafe runtime entry: ' + relative + entry.name);
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { if (relative || entry.name === 'assets') add(path.join(directory, entry.name), name); }
      else if (entry.isFile() && (relative || /\.(?:js|css|html)$/.test(entry.name) || entry.name === 'package.json')) files.push(name);
    }
  }
  add(source, '');
  for (const required of ['main.js', 'preload.js', 'index.html', 'package.json']) if (!files.includes(required)) throw new Error('Missing runtime file: ' + required);
  return files;
}

function packArchive(source, destination, names = collectRuntimeFiles(source)) {
  source = path.resolve(source); destination = path.resolve(destination);
  const header = { files: {} }, buffers = [];
  let offset = 0;
  for (const name of [...names].sort()) {
    const parts = name.split('/');
    if (!parts.length || !parts.every(safeName)) throw new Error('Unsafe ASAR name: ' + name);
    const file = path.join(source, ...parts);
    if (path.resolve(file) === destination || fs.lstatSync(file).isSymbolicLink()) throw new Error('ASAR cannot include output or symlinks');
    const buffer = fs.readFileSync(file), blocks = [];
    for (let at = 0; at < buffer.length; at += BLOCK_SIZE) blocks.push(digest(buffer.subarray(at, at + BLOCK_SIZE)));
    // Chromium's integrity format includes an empty block for an empty file.
    if (!blocks.length) blocks.push(digest(Buffer.alloc(0)));
    let directory = header.files;
    for (const part of parts.slice(0, -1)) {
      directory[part] ||= { files: {} };
      if (!directory[part].files) throw new Error('ASAR file/directory collision');
      directory = directory[part].files;
    }
    if (directory[parts.at(-1)]) throw new Error('Duplicate ASAR entry: ' + name);
    directory[parts.at(-1)] = { size: buffer.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: digest(buffer), blockSize: BLOCK_SIZE, blocks } };
    buffers.push(buffer); offset += buffer.length;
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const payloadSize = (4 + json.length + 3) & ~3;
  const headerPickle = Buffer.alloc(4 + payloadSize);
  headerPickle.writeUInt32LE(payloadSize, 0); headerPickle.writeUInt32LE(json.length, 4); json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8); sizePickle.writeUInt32LE(4, 0); sizePickle.writeUInt32LE(headerPickle.length, 4);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '.tmp-' + crypto.randomBytes(6).toString('hex');
  try {
    fs.writeFileSync(temporary, Buffer.concat([sizePickle, headerPickle, ...buffers]));
    const verified = inspectArchive(temporary, true);
    fs.renameSync(temporary, destination);
    return { path: destination, fileCount: verified.entries.length, bytes: verified.bytes, sha256: verified.sha256 };
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function inspectArchive(archive, verify = true) {
  const data = fs.readFileSync(archive);
  if (data.length < 16 || data.readUInt32LE(0) !== 4) throw new Error('Invalid ASAR size pickle');
  const headerSize = data.readUInt32LE(4), jsonSize = data.readUInt32LE(12), base = 8 + headerSize;
  if (headerSize < 8 || base > data.length || 8 + jsonSize > headerSize || data.readUInt32LE(8) + 4 !== headerSize) throw new Error('Invalid ASAR header bounds');
  const header = JSON.parse(data.subarray(16, 16 + jsonSize).toString('utf8')), entries = [];
  function walk(files, prefix = '') {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Invalid ASAR directory');
    for (const [name, entry] of Object.entries(files)) {
      if (!safeName(name) || !entry || typeof entry !== 'object') throw new Error('Unsafe ASAR entry');
      const filename = prefix + name;
      if (entry.files) walk(entry.files, filename + '/');
      else {
        if (entry.link || entry.unpacked) throw new Error('Unsupported ASAR link/unpacked file');
        const offset = Number(entry.offset), size = entry.size;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || base + offset + size > data.length) throw new Error('Invalid ASAR payload bounds: ' + filename);
        const content = data.subarray(base + offset, base + offset + size);
        if (verify && entry.integrity) {
          const integrity = entry.integrity;
          if (integrity.algorithm !== 'SHA256' || digest(content) !== integrity.hash || !Number.isSafeInteger(integrity.blockSize) || integrity.blockSize <= 0) throw new Error('ASAR integrity mismatch: ' + filename);
          const expected = [];
          for (let at = 0; at < content.length; at += integrity.blockSize) expected.push(digest(content.subarray(at, at + integrity.blockSize)));
          if (!expected.length) expected.push(digest(Buffer.alloc(0)));
          if (JSON.stringify(expected) !== JSON.stringify(integrity.blocks)) throw new Error('ASAR block mismatch: ' + filename);
        }
        entries.push({ name: filename, size, sha256: digest(content), content });
      }
    }
  }
  walk(header.files);
  return { header, entries, bytes: data.length, sha256: digest(data) };
}

module.exports = { packArchive, inspectArchive, collectRuntimeFiles };
if (require.main === module) {
  try {
    const [operation, source, destination] = process.argv.slice(2);
    if (operation === 'pack' && source && destination) console.log(JSON.stringify(packArchive(source, destination), null, 2));
    else if (operation === 'verify' && source) { const result = inspectArchive(source, true); console.log(JSON.stringify({ fileCount: result.entries.length, bytes: result.bytes, sha256: result.sha256 }, null, 2)); }
    else throw new Error('Usage: node tools/pack_asar.cjs pack <source-dir> <app.asar> | verify <app.asar>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
