// Optional static file serving (STATIC_DIR) for the laptop "plan B": the built web app and /config.json
// are served by the game server itself. Path traversal is blocked; unknown paths fall back to index.html.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
};

export function contentTypeFor(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

async function fileInfo(path: string): Promise<{ size: number } | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? { size: s.size } : null;
  } catch {
    return null;
  }
}

/** Returns true when a response was sent. */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse, pathname: string, headers: Record<string, string> = {}): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (rel.includes('\0')) return false;
  const base = resolve(root);
  let file = resolve(join(base, normalize('/' + rel)));
  if (file !== base && !file.startsWith(base + sep)) return false;
  let info = rel.endsWith('/') ? null : await fileInfo(file);
  if (!info) {
    const asIndex = join(file, 'index.html');
    info = await fileInfo(asIndex);
    if (info) file = asIndex;
  }
  if (!info) {
    // SPA fallback only for navigations (no file extension); a missing asset or config.json is a 404.
    if (extname(rel) !== '') return false;
    file = join(base, 'index.html');
    info = await fileInfo(file);
    if (!info) return false;
  }
  const isHtml = extname(file).toLowerCase() === '.html';
  const hashedAsset = /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|jpg|svg|webp)$/.test(file);
  res.writeHead(200, {
    ...headers,
    'Content-Type': contentTypeFor(file),
    'Content-Length': info.size,
    'Cache-Control': isHtml || file.endsWith('config.json') ? 'no-cache' : hashedAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}
