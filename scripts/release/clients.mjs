// Native clients keep credentials out of command arguments and error payloads.
export function dokployBase(value) {
  if (!value) throw new Error('DOKPLOY_API_URL is required (DOKPLOY_API is the local fallback).');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Dokploy requires an HTTPS URL without credentials or query parameters.');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/(?:\/api)+$/, '') + '/api/';
  return url.href;
}

export function createDokploy({ url, key, fetchImpl = fetch }) {
  const base = dokployBase(url);
  if (!key) throw new Error('DOKPLOY_API_KEY is required.');
  return {
    async call(endpoint, parameters = {}, method = 'GET') {
      if (!/^[a-z]+\.[A-Za-z]+$/.test(endpoint)) throw new Error('Invalid Dokploy endpoint.');
      const target = new URL(endpoint, base);
      if (method === 'GET') for (const [name, value] of Object.entries(parameters)) if (value != null) target.searchParams.set(name, String(value));
      const response = await fetchImpl(target, {
        method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'x-api-key': key, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(parameters) } : {}),
      });
      if (!response.ok) throw new Error(`Dokploy ${endpoint}: HTTP ${response.status}.`);
      return response.json();
    },
  };
}

export function createGitHub(token, fetchImpl = fetch) {
  if (!token) throw new Error('GH_TOKEN is required.');
  return {
    async request(route, parameters = {}) {
      const [method, template] = route.split(' ');
      const remaining = { ...parameters };
      const path = template.replace(/\{([^}]+)\}/g, (_, key) => {
        if (remaining[key] == null) throw new Error(`Missing GitHub parameter: ${key}.`);
        const value = encodeURIComponent(remaining[key]); delete remaining[key]; return value;
      });
      if (method !== 'GET' || !path.startsWith('/repos/')) throw new Error('Only repository GET requests are allowed.');
      const url = new URL(path, 'https://api.github.com');
      for (const [key, value] of Object.entries(remaining)) if (value != null) url.searchParams.set(key, String(value));
      const response = await fetchImpl(url, {
        redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (!response.ok) throw new Error(`GitHub ${template}: HTTP ${response.status}.`);
      return { data: await response.json() };
    },
  };
}
