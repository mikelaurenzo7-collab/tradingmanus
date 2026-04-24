const url = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/' + encodeURIComponent('United_States_presidential_election') + '/daily/20260401/20260422';

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15000);

try {
  const started = Date.now();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'laurenzo-dashboard/1.0 (sentiment research)'
    },
    signal: controller.signal,
  });
  const text = await response.text();
  console.log(JSON.stringify({
    ok: response.ok,
    status: response.status,
    elapsed_ms: Date.now() - started,
    preview: text.slice(0, 1000),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'UnknownError'
  }, null, 2));
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
