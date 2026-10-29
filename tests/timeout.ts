// One of the 3 web searches never answers: the other two must still come back.
import findBusinesses from '../client-finder/findBusinesses.ts';
const g = globalThis as any;
g.fetch = () => Promise.reject(new TypeError('offline'));
const biz = (name: string) => ({ name, website: '', phone: '', address: '', instagram: '', facebook: '', source_url: '', is_chain: false });
g.__mock = { user: { id: 'u' }, calls: [], llm: (_a: any, n: number) => n === 2 ? new Promise(() => {}) : { businesses: [biz('Search ' + n)] } };
const t0 = Date.now();
const res = await findBusinesses(new Request('https://x/', { method: 'POST', body: JSON.stringify({ businessType: 'spa', location: 'Austin' }) }));
const d = await res.json();
const secs = (Date.now() - t0) / 1000;
const ok = res.status === 200 && d.businesses.length === 2 && d.failed_searches === 1 && secs < 45;
console.log(ok ? 'PASS' : 'FAIL', 'status', res.status, 'businesses', d.businesses?.length, 'failed', d.failed_searches, 'secs', secs);
Deno.exit(0);
