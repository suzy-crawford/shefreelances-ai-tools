import readWebsite from '../meta-ads/readWebsite.ts';
const g = globalThis as any;
g.__mock = { user: { id: 'u' }, calls: [], llm: () => ({}) };
await Promise.all(Deno.args.map(async (a) => {
  const [url, name] = a.split('|');
  const t0 = Date.now();
  const res = await readWebsite(new Request('https://x/', { method: 'POST', body: JSON.stringify({ url, name }) }));
  const d = await res.json();
  const pages = (d.text || '').match(/\[PAGE: [^\]]+\]/g) || [];
  console.log(`${url.replace(/https?:\/\/(www\.)?/, '')} [${Date.now() - t0}ms] ${d.ok ? 'OK' : 'FAIL: ' + d.error} ${d.ok ? `| title="${d.title.slice(0, 35)}" | text=${d.text.length} | pages=${pages.map((p: string) => p.replace(/\[PAGE: https?:\/\/[^/]+/, '').replace(']', '')).join(',')} | cta=${d.cta_links.slice(0, 4).join('/')} | colors=${d.colors.join(',')}` : ''}`);
}));
