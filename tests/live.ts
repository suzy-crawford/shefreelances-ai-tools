// Real internet, fake AI search: checks fetching, parked detection and email finding on live sites.
import findBusinesses from '../client-finder/findBusinesses.ts';
import findEmail from '../client-finder/findEmail.ts';
const g = globalThis as any;
const biz = (name: string, website: string) => ({ name, website, phone: '', address: '', instagram: '', facebook: '', source_url: '', is_chain: false });
g.__mock = { user: { id: 'u' }, calls: [], llm: (_a: any, n: number) => n === 1 ? { businesses: [
  biz("Franklin Barbecue", "franklinbbq.com"), biz("Amy's Ice Creams", "https://www.amysicecreams.com"),
  biz("Uchi Austin", "https://uchirestaurants.com"), biz("Example", "https://example.com"),
  biz("Dead Domain Test", "https://this-domain-should-not-exist-xyz123.com"), biz("Kerbey Lane Cafe", "https://www.kerbeylanecafe.com"),
] } : { businesses: [] } };
const t0 = Date.now();
const res = await findBusinesses(new Request('https://x/', { method: 'POST', body: JSON.stringify({ businessType: 'restaurants', location: 'Austin, TX' }) }));
const d = await res.json();
console.log('status', res.status, 'took', Date.now() - t0, 'ms');
for (const b of d.businesses) console.log(JSON.stringify({ n: b.name, ok: b.website_checked, title: b.page_title.slice(0, 50), email: b.email, src: b.email_source, ig: b.instagram, fb: b.facebook, chain: b.is_chain, text: b.site_text.length }));
g.__mock.llm = () => ({ email: '', email_source_url: '', website: '', instagram: '', facebook: '' });
const r2 = await findEmail(new Request('https://x/', { method: 'POST', body: JSON.stringify({ website: 'https://www.kerbeylanecafe.com', name: 'Kerbey Lane Cafe', location: 'Austin, TX', needSocial: true }) }));
console.log('findEmail', r2.status, JSON.stringify(await r2.json()));
