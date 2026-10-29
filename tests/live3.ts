import analyzeLead from '../client-finder/analyzeLead.ts';
const g = globalThis as any;
g.__mock = { user: { id: 'u' }, calls: [], llm: () => ({ google_rating: 0, google_reviews: 0, runs_meta_ads: 'unknown', source_url: '' }) };
await Promise.all(Deno.args.map(async (a) => {
  const [website, name] = a.split('|');
  const t0 = Date.now();
  const res = await analyzeLead(new Request('https://x/', { method: 'POST', body: JSON.stringify({ website, name, location: '' }) }));
  const d = await res.json();
  const f = d.facts || {};
  const yes = (k: string, l: string) => (f[k] ? l : '-' + l);
  console.log(`${website.replace(/https?:\/\/(www\.)?/, '')} [${d.website_status} ${Date.now() - t0}ms] ` + (d.facts ? [yes('meta_pixel', 'pixel'), yes('google_tag', 'gtag'), f.online_booking ? 'book:' + f.booking_tool : '-booking', yes('book_button', 'cta'), yes('mobile_ready', 'mobile'), yes('contact_form', 'form'), yes('prices_listed', '$'), yes('reviews_shown', 'reviews'), 'yr:' + f.copyright_year].join(' ') : '') + ' | gaps ' + d.findings.gaps.length);
}));
