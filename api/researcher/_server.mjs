/**
 * Fail-closed researcher API listener.
 *
 * Does not enable live collection. Does not load browser credentials.
 * Refuses research data unless RESEARCHER_API_ENABLED=true and durable
 * OIDC, session, MFA-assurance, and rate-limit configuration are present.
 * Missing production dependencies stay fail-closed. There is no in-memory
 * production fallback and no mock login. The production query adapter is
 * created only when DATABASE_URL is a least-privilege postgres URL.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createResearcherApp } from './_lib/app.mjs';
import { loadConfig } from './_lib/config.mjs';
import { createProductionQueryAdapter } from './_lib/query.mjs';

export function startResearcherApi({ port = 8787 } = {}) {
  const config = loadConfig();
  const query = createProductionQueryAdapter(config);
  const app = createResearcherApp({ config, query });
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const host = req.headers.host || '127.0.0.1';
    const result = await app.handle({
      method: req.method,
      url: `http://${host}${req.url}`,
      headers: req.headers,
      body,
      ip: req.socket?.remoteAddress,
    });
    const cookies = result.headers['Set-Cookie'];
    const headers = { ...result.headers };
    delete headers['Set-Cookie'];
    res.writeHead(result.status, cookies ? { ...headers, 'Set-Cookie': cookies } : headers);
    res.end(result.body);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const port = Number(process.env.PORT) || 8787;
  startResearcherApi({ port });
  // eslint-disable-next-line no-console
  console.log(`Researcher API scaffold listening on 127.0.0.1:${port} (fail-closed)`);
}
