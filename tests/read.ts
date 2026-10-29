// Scenario tests for readWebsite (Meta Ads Builder).
// Run: deno run --allow-read --import-map=import_map.json read.ts
import readWebsite from '../meta-ads/readWebsite.ts';

const g = globalThis as any;
let pass = 0;
const fails: string[] = [];
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) pass++;
  else fails.push(`${name}${detail === undefined ? '' : `  -> ${JSON.stringify(detail)?.slice(0, 400)}`}`);
}
const pad = (s: string) => s + '<p>' + 'We help our neighbors every day. '.repeat(60) + '</p>';
const SITES: Record<string, { status?: number; html?: string; redirectTo?: string; hang?: boolean; type?: string }> = {
  'https://glow.com/': { html: pad(`<html><head><title>Glow Med Spa &amp; Laser</title><meta name="description" content="Botox &amp; facials in Austin"><meta name="theme-color" content="#a3c"><style>.a{color:#c86bfa}.b{color:#c86bfa}.c{color:#ffffff}.d{color:#123456}</style></head><body>
    <a href="https://other.com/services">Partner services</a><a href="/services">Our Services</a><a href="/pricing/">Pricing</a><a href="/blog/x">Blog</a><a href="/menu.pdf">Menu PDF</a>
    <a href="https://www.vagaro.com/glow">Book Now</a><a href="tel:5125550100">Call Us</a><a href="/c">Get a Free Consultation</a>
    <a href="https://www.instagram.com/glowmedspa/">IG</a><script>var secret="should not appear"</script></body></html>`) },
  'https://glow.com/services': { html: pad('<h1>Services</h1><p>HydraFacial, Botox, Laser Hair Removal</p>') },
  'https://glow.com/pricing/': { html: pad('<h1>Pricing</h1><p>Botox $12 per unit. New client special $99 HydraFacial.</p>') },
  'https://other.com/services': { html: pad('<p>OTHER COMPANY TEXT</p>') },
  'https://blocked.com/': { status: 403 },
  'https://down.com/': { status: 500 },
  'https://hang.com/': { hang: true },
  'https://parked.com/': { html: pad('This domain is for sale!') },
  'https://soon.com/': { html: '<html><head><title>Coming Soon</title></head><body>' + 'x '.repeat(900) + '</body></html>' },
  'https://pdf.com/': { html: '%PDF', type: 'application/pdf' },
  'https://tolinktree.com/': { redirectTo: 'https://linktr.ee/x' },
  'https://linktr.ee/x': { html: pad('<title>x | Linktree</title>') },
  'https://moved.com/': { redirectTo: 'https://www.newglow.com/' },
  'https://www.newglow.com/': { html: pad('<title>Glow Med Spa</title> Welcome to Glow Med Spa') },
  'https://boisearts.com/': { redirectTo: 'https://www.boisedentist.com/' },
  'https://www.boisedentist.com/': { html: pad('<title>Boise Family Dental Care</title> Your smile starts here.') },
  'https://wixcolors.com/': { html: pad('<html><head><meta name="theme-color" content="#ffffff"><style>.a{color:#116dff}.b{color:#116dff}.c{color:#cf2e2e}.d{color:#b94512}</style><title>Wix Colors</title></head><body></body></html>') },
  'https://jsonly.com/': { html: '<html><head><title>JS Only</title></head><body><div id="root"></div><script src="/a.js"></script></body></html>' },
  'https://www.squarespace.com/': { html: pad('<title>Squarespace</title><a href="/services">Services</a>') },
  'https://samename.com/': { html: pad('<title>Barnett Roofing Michigan</title> Serving Detroit') },
  'https://wrongaddr.com/': { html: pad('<title>Totally Different Bakery</title> cakes and bread') },
  'https://expired.com/': { redirectTo: 'https://www.randomplumber.com/' },
  'https://www.randomplumber.com/': { html: pad('<title>Random Plumber Inc</title>') },
};
g.fetch = (input: string, init: any = {}) => {
  const url = String(input);
  const site = SITES[url] || SITES[url + '/'];
  return new Promise((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    if (!site) return reject(new TypeError('dns'));
    if (site.hang) return;
    if (site.redirectTo) {
      const r = new Response(SITES[site.redirectTo].html, { status: 200, headers: { 'content-type': 'text/html' } });
      Object.defineProperty(r, 'url', { value: site.redirectTo });
      return resolve(r);
    }
    const r = new Response(site.html ?? '', { status: site.status ?? 200, headers: { 'content-type': site.type ?? 'text/html' } });
    Object.defineProperty(r, 'url', { value: url });
    resolve(r);
  });
};
g.__mock = { user: { id: 'u' }, calls: [], llm: () => ({}) };
async function call(body: unknown, raw = false) {
  const res = await readWebsite(new Request('https://fn/', { method: 'POST', body: raw ? (body as string) : JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}

g.__mock.user = null;
let r = await call({ url: 'glow.com' });
check('401 when not logged in', r.status === 401, r);
g.__mock.user = { id: 'u' };

r = await call({});
check('no url -> ok:false "No website on file."', r.status === 200 && r.data.ok === false && r.data.error === 'No website on file.', r);
r = await call('bad', true);
check('broken body -> ok:false, no crash', r.status === 200 && r.data.ok === false, r);

r = await call({ url: 'glow.com', name: 'Glow Med Spa' });
const d = r.data;
check('reads site: ok, url, title decoded', d.ok === true && d.url === 'https://glow.com' && d.title === 'Glow Med Spa & Laser', d);
check('meta description decoded', d.meta_description === 'Botox & facials in Austin', d.meta_description);
check('button wording found', ['Book Now', 'Call Us', 'Get a Free Consultation'].every((x) => d.cta_links.includes(x)), d.cta_links);
check('social link found', d.social_links.includes('https://www.instagram.com/glowmedspa/'), d.social_links);
check('theme color first, grays skipped', d.colors[0] === '#aa33cc' && d.colors.includes('#c86bfa') && !d.colors.includes('#ffffff'), d.colors);
check('script text never in page text', !d.text.includes('should not appear'), null);
check('services page appended', /\[PAGE: https:\/\/glow\.com\/services\]/.test(d.text) && d.text.includes('HydraFacial, Botox'), null);
check('pricing page appended', d.text.includes('$99 HydraFacial'), null);
check('other site\'s "services" page NOT read', !d.text.includes('OTHER COMPANY TEXT'), null);
check('PDF menu not read as a page', !/\[PAGE: [^\]]*\.pdf\]/.test(d.text), null);
check('homepage text capped at 9000 + 2 pages', d.text.length <= 9000 + 2 * 5100, d.text.length);
check('text has no em/en dashes', !/[–—]/.test(JSON.stringify(d)), null);

r = await call({ url: 'https://www.instagram.com/glowmedspa/' });
check('Instagram link -> not their website', r.data.ok === false && /isn't their own website/.test(r.data.error), r.data);
r = await call({ url: 'https://tolinktree.com', name: 'Glow' });
check('domain forwarding to Linktree -> not their website', r.data.ok === false && /isn't their own website/.test(r.data.error), r.data);
r = await call({ url: 'https://tolinktree.com' });
check('...also without a business name', r.data.ok === false && /isn't their own website/.test(r.data.error), r.data);
r = await call({ url: 'https://blocked.com' });
check('403 -> "blocked our check"', r.data.ok === false && /blocked our check/.test(r.data.error), r.data);
r = await call({ url: 'https://down.com' });
check('500 -> "didn\'t load"', r.data.ok === false && r.data.error === "Their website didn't load.", r.data);
r = await call({ url: 'https://parked.com' });
check('parked -> not ok', r.data.ok === false, r.data);
r = await call({ url: 'https://soon.com' });
check('"Coming Soon" -> not ok', r.data.ok === false, r.data);
r = await call({ url: 'https://pdf.com' });
check('PDF -> not ok', r.data.ok === false, r.data);
r = await call({ url: 'https://moved.com', name: 'Glow Med Spa' });
check('moved to their own new domain -> ok with new url', r.data.ok === true && r.data.url === 'https://www.newglow.com/', r.data.url);
r = await call({ url: 'https://expired.com', name: 'Glow Med Spa' });
check('forwards to another business -> says so', r.data.ok === false && /different business/.test(r.data.error), r.data);
r = await call({ url: 'https://boisearts.com', name: 'Boise Dental Arts' });
check('"Boise Dental Arts" forwarding to "Boise Family Dental Care" -> different business', r.data.ok === false && /different business/.test(r.data.error), r.data);
r = await call({ url: 'https://wixcolors.com', name: 'Wix Colors' });
check('builder default colors and white theme color skipped', JSON.stringify(r.data.colors) === JSON.stringify(['#b94512']), r.data.colors);
r = await call({ url: 'https://jsonly.com', name: 'JS Only' });
check('page built by code (no readable text) -> says so', r.data.ok === false && /can't read/.test(r.data.error), r.data);
r = await call({ url: 'squarespace.com', name: 'Glow Spa' });
check('website builder homepage -> not their website', r.data.ok === false && /isn't their own website/.test(r.data.error), r.data);
r = await call({ url: 'https://wrongaddr.com', name: 'Glow Med Spa', location: 'Austin' });
check('address whose page never mentions the business -> "doesn\'t seem to mention"', r.data.ok === false && /doesn't seem to mention/.test(r.data.error), r.data);
r = await call({ url: 'https://wrongaddr.com' });
check('...without a name it still reads (nothing to compare)', r.data.ok === true, r.data);
const t0 = Date.now();
r = await call({ url: 'https://hang.com' });
const secs = (Date.now() - t0) / 1000;
check('hanging site -> "took too long" within ~10s', r.data.ok === false && /too long/.test(r.data.error) && secs < 12, { secs, d: r.data });

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const x of fails) console.log('FAIL: ' + x);
Deno.exit(fails.length ? 1 : 0);
