'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const p = address.split('.').map(Number), [a, b] = p;
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))) return false;
    return true;
  }
  if (family === 6) {
    const v = address.toLowerCase();
    return !(v === '::' || v === '::1' || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('::ffff:'));
  }
  return false;
}
async function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('Введите корректный HTTPS-адрес изображения'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.port && url.port !== '443') throw new Error('Разрешены только публичные HTTPS-ссылки без логина и пароля');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Локальные адреса не разрешены');
  const addresses = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Адрес ведёт в локальную или зарезервированную сеть');
  return url;
}
async function collectBody(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error('Изображение превышает лимит 20 МБ');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Сервер не передал содержимое изображения');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Изображение превышает лимит 20 МБ'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}
async function downloadSkinImage(input) {
  let target = await validateUrl(input);
  for (let redirects = 0; redirects <= 4; redirects++) {
    // Resolve and reject private destinations before each request and every redirect.
    target = await validateUrl(target.href);
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'AVPro-Skin-Creator/1.0', Accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); if (!location) throw new Error('Сервер вернул перенаправление без адреса');
      if (redirects === 4) throw new Error('Слишком много перенаправлений');
      target = new URL(location, target); continue;
    }
    if (!response.ok) throw new Error(`Не удалось скачать изображение: HTTP ${response.status}`);
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(mime)) throw new Error('Ссылка должна вести непосредственно на PNG, JPG, WEBP, GIF или BMP');
    const data = await collectBody(response);
    if (data.length < 16) throw new Error('Сервер вернул пустой или повреждённый файл');
    return { mime, data: data.toString('base64'), name: decodeURIComponent(target.pathname.split('/').filter(Boolean).pop() || 'dial-image').slice(0, 120) };
  }
  throw new Error('Не удалось получить изображение по ссылке');
}
module.exports = { downloadSkinImage, MAX_IMAGE_BYTES };
