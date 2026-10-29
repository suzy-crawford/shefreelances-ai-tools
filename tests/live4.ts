import analyzeLead from '../client-finder/analyzeLead.ts';
const g = globalThis as any;
g.__mock = { user: { id: 'u' }, calls: [], llm: () => ({ google_rating: 0, google_reviews: 0, runs_meta_ads: 'unknown', source_url: '' }) };
await Promise.all(Deno.args.map(async (a) => {
  const [website, name, type] = a.split('|');
  const res = await analyzeLead(new Request('https://x/', { method: 'POST', body: JSON.stringify({ website, name, location: a.split('|')[3] || '', business_type: type || '' }) }));
  const d = await res.json();
  const f = d.facts || {};
  console.log(`\n## ${website} [${d.website_status}] builder=${f.site_builder || '-'} pixel=${f.meta_pixel} gtm=${f.tag_manager} form=${f.contact_form} cta=${f.book_button} booking=${f.booking_tool || f.online_booking} order=${f.ordering_tool || '-'} reviews=${f.reviews_shown} yr=${f.copyright_year}`);
  for (const s of d.findings.gaps) console.log('  GAP  ' + s);
  for (const s of d.findings.check) console.log('  CHK  ' + s.slice(0, 110));
}));
