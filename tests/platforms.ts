import findBusinesses from '../client-finder/findBusinesses.ts';
const g = globalThis as any;
const biz = (name: string, website: string) => ({ name, website, phone: '', address: '', instagram: '', facebook: '', source_url: '', is_chain: false });
const list = [
  biz('IG Spa One', 'https://www.instagram.com/glowskinatx/'),
  biz('IG Spa Two', 'https://www.instagram.com/skinbyjess/'),
  biz('FB Spa One', 'https://www.facebook.com/glowskinatx'),
  biz('FB Spa Two', 'https://www.facebook.com/skinbyjessatx'),
  biz('Vagaro One', 'https://www.vagaro.com/glowskin'),
  biz('Vagaro Two', 'https://www.vagaro.com/skinbyjess'),
  biz('Yelp One', 'https://www.yelp.com/biz/franklin-barbecue-austin'),
  biz('Linktree One', 'https://linktr.ee/glowskin'),
  biz('Linktree Two', 'https://linktr.ee/skinbyjess'),
  biz('Booksy One', 'https://booksy.com/en-us/'),
  biz('Gmaps', 'https://maps.google.com/?cid=123'),
];
g.__mock = { user: { id: 'u' }, calls: [], llm: (_a: any, n: number) => n === 1 ? { businesses: list } : { businesses: [] } };
const t0 = Date.now();
const res = await findBusinesses(new Request('https://x/', { method: 'POST', body: JSON.stringify({ businessType: 'med spas', location: 'Austin, TX' }) }));
const d = await res.json();
console.log('status', res.status, Date.now() - t0, 'ms; in', list.length, 'out', d.businesses.length);
for (const b of d.businesses) console.log(JSON.stringify({ n: b.name, key: b.dedupe_key, ok: b.website_checked, title: b.page_title.slice(0, 60), email: b.email, src: b.email_source, ig: b.instagram, fb: b.facebook, txt: b.site_text.slice(0, 80) }));
