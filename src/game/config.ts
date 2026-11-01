// Where the API lives. The operator can point phones at a backup server by editing /config.json:
//   { "apiBase": "https://backup.example.com" }
// Without the file (or with an empty apiBase) the app talks to the origin it was loaded from.

let apiBase = '';
let loaded: Promise<string> | null = null;

export interface RuntimeConfig {
  apiBase?: string;
  publicUrl?: string;
}

let runtime: RuntimeConfig = {};

/** Load /config.json once. Never throws: a missing or broken file means "same origin". */
export function loadRuntimeConfig(): Promise<string> {
  if (loaded) return loaded;
  loaded = (async () => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch('/config.json', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('json')) {
          const j = (await res.json()) as RuntimeConfig;
          if (j && typeof j === 'object') {
            runtime = j;
            if (typeof j.apiBase === 'string') apiBase = j.apiBase.trim().replace(/\/+$/, '');
          }
        }
      }
    } catch {
      /* same origin */
    }
    return apiBase;
  })();
  return loaded;
}

export function getApiBase(): string {
  return apiBase;
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtime;
}

export function apiUrl(path: string): string {
  return apiBase + path;
}
