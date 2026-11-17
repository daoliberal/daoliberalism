import { REQUEST_HEADERS, apiUrl, parseHello } from "./wire";
import type { LiveHello } from "./wire";

export type ProbeResult = { ok: true; hello: LiveHello } | { ok: false };

/**
 * Canlı model sunucusu var mı? `GET /api/hello`; ağ hatası, hatalı yanıt ya da zaman aşımı `{ ok: false }`.
 * Hata fırlatmaz. Zaman aşımı varsayılan 700 ms.
 */
export async function probeLive(baseUrl: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<ProbeResult> {
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProbeResult>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve({ ok: false });
    }, opts.timeoutMs ?? 700);
  });
  const attempt = (async (): Promise<ProbeResult> => {
    try {
      const res = await doFetch(apiUrl(baseUrl, "/hello"), { method: "GET", headers: REQUEST_HEADERS, signal: ctrl.signal });
      if (!res.ok) return { ok: false };
      return { ok: true, hello: parseHello(await res.json()) };
    } catch {
      return { ok: false };
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
