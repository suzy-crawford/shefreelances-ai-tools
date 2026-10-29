// Scenario tests for the AI Client Finder backend functions.
// Run: deno run --allow-read --import-map=import_map.json scenarios.ts
import findBusinesses from '../client-finder/findBusinesses.ts';
import findEmail from '../client-finder/findEmail.ts';
import generateWithAI from '../client-finder/generateWithAI.ts';

const g = globalThis as any;
let pass = 0;
const fails: string[] = [];
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) pass++;
  else fails.push(`${name}${detail === undefined ? '' : `  -> ${JSON.stringify(detail)?.slice(0, 400)}`}`);
}

// ---------- fake websites ----------
const pad = (s: string) => s + '<p>' + 'Welcome to our studio. '.repeat(80) + '</p>';
const SITES: Record<string, { status?: number; html?: string; hang?: boolean; throws?: boolean; redirectTo?: string }> = {
  'https://good.com/': { html: pad('<title>Good Spa | Austin</title><script>var x="secret@script.com"</script><a href="https://www.instagram.com/goodspa/">IG</a><a href="https://www.instagram.com/p/abc123/">post</a><a href="https://www.facebook.com/sharer.php?u=x">share</a><a href="https://facebook.com/goodspaatx">FB</a><a href="mailto:Info@Good.com">Email us</a>') },
  'https://contactonly.com/': { html: pad('<title>Contact Only</title><a href="/contact-us">Get in touch</a><a href="/about">About</a>') },
  'https://contactonly.com/contact-us': { html: pad('<a href="mailto:hello@contactonly.com?subject=Hi">hello</a>') },
  'https://contactonly.com/about': { html: pad('nothing here') },
  'https://parked.com/': { html: pad('<h1>This domain is for sale!</h1>') },
  'https://stub.com/': { html: '<script>window.location.href="https://ads.example/"</script>' },
  'https://slow.com/': { hang: true },
  'https://down.com/': { status: 500 },
  'https://dnsfail.com/': { throws: true },
  'https://chain.com/': { html: pad('<title>Glow Spa | 25 Locations Nationwide</title>') },
  'https://badmailto.com/': { html: pad('<a href="mailto:%E0%A4%A">x</a> write to team@badmailto.com') },
  'https://junk.com/': { html: pad('sentry@abc.ingest.sentry.io logo@2x.png user@example.com you@email.com 12@3.com') },
  'https://mixed.com/': { html: pad('owner.personal@gmail.com and also info@mixed.com') },
  'https://redirects.com/': { redirectTo: 'https://www.redirected-final.com/' },
  'https://www.redirected-final.com/': { html: pad('<title>Final</title> contact: front@redirected-final.com') },
  'https://newsite.com/': { html: pad('<title>New</title><a href="https://instagram.com/newsite_ig">ig</a> email booking@newsite.com') },
  'https://directory.com/listing/42': { html: pad('Listed email: owner@somewhere.net phone 555') },
  'https://directory.com/listing/43': { html: pad('No email here') },
  'https://socialonly.com/': { html: pad('<title>Social only</title> info@socialonly.com') },
  'https://pixel.com/': { html: pad('<title>Amy&#039;s &amp; Co &ndash; Ice Cream</title><script>fbq("init","1",{"em":"graham@designer-agency.com"})</script><!-- dev@old.com --> Call us!') },
  'https://schema.com/': { html: pad('<script type="application/ld+json">{"@type":"LocalBusiness","email":"hello@schema.com"}</script><script>var dev="dev@agency.io"</script>') },
  'https://devmail.com/': { html: pad('Site by dev@antrimcreek.com and support@wellthy-other.com. <a href="https://www.facebook.com/p/Dev-Mail-Spa-100088817231261/">fb</a>') },
  'https://glowspa.com/': { html: pad('Email info@glowspaaustin.com or webmaster@glowspa.com') },
  'https://inbox.com/': { html: pad('Owner: jane.doe@inbox.com, general questions info@inbox.com, partner pr@agency.io') },
  'https://freemail.com/': { html: pad('Website by contact@webstudio.design. Email the shop: sweetshop@gmail.com') },
  'https://directory.com/listing/44': { html: pad('<script>var e="hidden@somewhere.net"</script> nothing visible') },
};
const fetched: string[] = [];
g.fetch = (input: string, init: any = {}) => {
  const url = String(input);
  const site = SITES[url] || SITES[url + '/'] || SITES[url.replace(/\/$/, '')];
  fetched.push(url);
  return new Promise((resolve, reject) => {
    const signal: AbortSignal | undefined = init.signal;
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    if (!site) return reject(new TypeError('dns error: ' + url));
    if (site.throws) return reject(new TypeError('network error'));
    if (site.hang) return; // only the timeout ends this
    if (site.redirectTo) {
      const final = SITES[site.redirectTo];
      const r = new Response(final.html, { status: 200 });
      Object.defineProperty(r, 'url', { value: site.redirectTo });
      return resolve(r);
    }
    const r = new Response(site.html ?? '', { status: site.status ?? 200 });
    Object.defineProperty(r, 'url', { value: url });
    resolve(r);
  });
};

const post = (body: unknown, raw = false) =>
  new Request('https://fn.test/', { method: 'POST', body: raw ? (body as string) : JSON.stringify(body) });
async function call(fn: (r: Request) => Promise<Response>, body: unknown, raw = false) {
  const res = await fn(post(body, raw));
  return { status: res.status, data: await res.json() };
}
function mock(user: unknown, llm: (args: any, n: number) => unknown) {
  g.__mock = { user, llm, calls: [] };
  fetched.length = 0;
}
const ME = { id: 'u1', email: 'm@x.com' };
const biz = (o: Record<string, unknown>) => ({ name: '', website: '', phone: '', address: '', instagram: '', facebook: '', source_url: '', is_chain: false, ...o });

// ================= generateWithAI =================
mock(null, () => 'x');
let r = await call(generateWithAI, { prompt: 'hi' });
check('AI: not logged in -> 401', r.status === 401, r);

mock(ME, () => 'x');
r = await call(generateWithAI, {});
check('AI: missing prompt -> 400', r.status === 400, r);
r = await call(generateWithAI, 'not json', true);
check('AI: broken JSON body -> 400', r.status === 400, r);
r = await call(generateWithAI, { prompt: 'x'.repeat(60001) });
check('AI: prompt too long -> 400', r.status === 400, r);

mock(ME, () => ({ a: 1 }));
r = await call(generateWithAI, { prompt: 'hi', response_json_schema: { type: 'object' }, file_urls: ['https://f/1.png', 'javascript:alert(1)', 5, ...Array(10).fill('https://f/x.png')] });
const aiArgs = g.__mock.calls[0];
check('AI: returns {result}', r.status === 200 && r.data.result?.a === 1, r);
check('AI: passes schema', aiArgs.response_json_schema?.type === 'object', aiArgs);
check('AI: keeps only http(s) file urls, max 8', aiArgs.file_urls.length === 8 && aiArgs.file_urls.every((u: string) => u.startsWith('https://')), aiArgs.file_urls);
mock(ME, () => 'plain');
await call(generateWithAI, { prompt: 'hi' });
check('AI: no file_urls/schema keys when not given', !('file_urls' in g.__mock.calls[0]) && !('response_json_schema' in g.__mock.calls[0]), g.__mock.calls[0]);
mock(ME, () => { throw new Error('Out of credits'); });
r = await call(generateWithAI, { prompt: 'hi' });
check('AI: AI failure -> 500 with message', r.status === 500 && r.data.error === 'Out of credits', r);

// ================= findBusinesses =================
mock(null, () => ({ businesses: [] }));
r = await call(findBusinesses, { businessType: 'med spa', location: 'Austin' });
check('FB: not logged in -> 401', r.status === 401, r);

mock(ME, () => ({ businesses: [] }));
r = await call(findBusinesses, { businessType: 'med spa' });
check('FB: missing location -> 400', r.status === 400, r);
r = await call(findBusinesses, { businessType: '   ', location: 'Austin' });
check('FB: blank type -> 400', r.status === 400, r);
r = await call(findBusinesses, '{bad', true);
check('FB: broken JSON body -> 400', r.status === 400, r);

mock(ME, () => { throw new Error('Search service down'); });
r = await call(findBusinesses, { businessType: 'med spa', location: 'Austin' });
check('FB: all 3 searches fail -> 500 with the real reason', r.status === 500 && r.data.error === 'Search service down', r);
check('FB: ran exactly 3 searches', g.__mock.calls.length === 3, g.__mock.calls.length);

mock(ME, () => ({ businesses: [] }));
r = await call(findBusinesses, { businessType: 'med spa', location: 'Austin' });
check('FB: no businesses -> 200 with empty list', r.status === 200 && Array.isArray(r.data.businesses) && r.data.businesses.length === 0, r);

// Main scenario: duplicates, junk fields, chains, parked, slow, broken sites.
const exclude = Array.from({ length: 70 }, (_, i) => `Saved Business ${i} ` + 'x'.repeat(100));
mock(ME, (args, n) => {
  if (n === 1) return JSON.stringify({ businesses: [
    biz({ name: 'Good Spa', website: 'good.com', instagram: 'https://instagram.com/wrong', is_chain: 'true' }),
    biz({ name: 'Contact Only Studio', website: 'https://contactonly.com' }),
    biz({ name: 'Parked Place', website: 'https://parked.com' }),
    biz({ name: 'Stub Redirect', website: 'https://stub.com' }),
    biz({ name: 'Slow Site', website: 'https://slow.com' }),
  ] });
  if (n === 2) return '{"businesses": [ broken json';
  return { businesses: [
    biz({ name: 'GOOD SPA', website: 'https://www.good.com/' }), // duplicate by domain and name
    biz({ name: 'Down Spa', website: 'https://down.com' }),
    biz({ name: 'DNS Fail', website: 'https://dnsfail.com' }),
    biz({ name: 'Glow Spa', website: 'https://chain.com' }),
    biz({ name: 'Bad Mailto', website: 'https://badmailto.com' }),
    biz({ name: 'Junk Emails', website: 'https://junk.com' }),
    biz({ name: 'Mixed Emails', website: 'https://mixed.com' }),
    biz({ name: 'Redirects Co', website: 'https://redirects.com', facebook: 'https://facebook.com/profile.php?id=12345' }),
    biz({ name: 'Pixel Shop', website: 'https://pixel.com' }),
    biz({ name: 'Inbox Co', website: 'https://inbox.com' }),
    biz({ name: 'Dev Mail', website: 'https://devmail.com' }),
    biz({ name: 'Glow Spa Austin', website: 'https://glowspa.com' }),
    biz({ name: 'Schema Co', website: 'https://schema.com' }),
    biz({ name: 'Freemail Shop', website: 'https://freemail.com' }),
    biz({ name: 'No Website & Co', website: '', instagram: 'https://www.instagram.com/reel/xyz/' }),
    biz({ name: 'No Website and Co', website: '' }), // duplicate by name key
    biz({ name: 'Spaces Site', website: 'not a url at all' }),
    biz({ name: 42, website: null, phone: 5551234 }),
    biz({ name: '', website: 'https://ghost.com' }),
    null,
    'garbage',
  ] };
});
const t0 = Date.now();
r = await call(findBusinesses, { businessType: 'med spa', location: 'Austin, TX', exclude });
const took = Date.now() - t0;
const list = r.data.businesses || [];
const byName = (n: string) => list.find((b: any) => b.name === n);
check('FB: 200 even when 1 of 3 searches returns broken JSON', r.status === 200, r.data);
check('FB: failed_searches = 1', r.data.failed_searches === 1, r.data.failed_searches);
check('FB: prompt has exclude list capped at 60 names x 80 chars', (() => { const p = g.__mock.calls[0].prompt; const line = p.split('\n').find((l: string) => l.startsWith('Skip these')); return line && line.split('; ').length === 60 && line.split('; ').every((s: string) => s.replace(/^Skip these businesses, they are already on the list: /, '').replace(/\.$/, '').length <= 80); })(), null);
check('FB: searches use web search + schema', g.__mock.calls.every((c: any) => c.add_context_from_internet === true && c.response_json_schema), null);
check('FB: duplicate "GOOD SPA" (www, case) removed', list.filter((b: any) => /good spa/i.test(b.name)).length === 1, list.map((b: any) => b.name));
check('FB: duplicate by name ("&" vs "and") removed', list.filter((b: any) => /^No Website/.test(b.name)).length === 1, list.map((b: any) => b.name));
check('FB: empty/garbage entries skipped', !list.some((b: any) => b.website === 'https://ghost.com'), list.map((b: any) => b.name));
check('FB: numeric name coerced to text', !!byName('42'), list.map((b: any) => b.name));
const good = byName('Good Spa');
check('FB: adds https:// to bare website', good?.website === 'https://good.com', good);
check('FB: good site checked', good?.website_checked === true, good);
check('FB: email from mailto, lowercased', good?.email === 'info@good.com', good);
check('FB: script emails ignored in site_text', !!good && !good.site_text.includes('secret@script.com') && good.site_text.includes('Welcome to our studio'), good?.site_text?.slice(0, 80));
check('FB: site_text max 2500 chars', good?.site_text.length <= 2500, good?.site_text.length);
check('FB: title captured', good?.page_title === 'Good Spa | Austin', good);
check('FB: own-site Instagram beats search, post links skipped', good?.instagram === 'https://www.instagram.com/goodspa/', good?.instagram);
check('FB: Facebook share link skipped, page kept', good?.facebook === 'https://www.facebook.com/goodspaatx', good?.facebook);
check('FB: is_chain "true" string is NOT treated as chain', good?.is_chain === false, good?.is_chain);
check('FB: dedupe_key is domain', good?.dedupe_key === 'good.com', good?.dedupe_key);
const contact = byName('Contact Only Studio');
check('FB: email found on Contact page', contact?.email === 'hello@contactonly.com' && contact?.email_source === 'https://contactonly.com/contact-us', contact);
check('FB: parked domain -> not checked, no email', byName('Parked Place')?.website_checked === false && byName('Parked Place')?.email === '', byName('Parked Place'));
check('FB: tiny redirect stub -> not checked', byName('Stub Redirect')?.website_checked === false, byName('Stub Redirect'));
check('FB: slow site times out -> not checked (no crash)', byName('Slow Site')?.website_checked === false, byName('Slow Site'));
check('FB: whole search under 10s with a hanging site', took < 10000, took);
check('FB: 500 site -> not checked', byName('Down Spa')?.website_checked === false, byName('Down Spa'));
check('FB: network error -> not checked', byName('DNS Fail')?.website_checked === false, byName('DNS Fail'));
check('FB: "25 Locations" title -> chain', byName('Glow Spa')?.is_chain === true, byName('Glow Spa'));
check('FB: bad %-encoded mailto does not crash, real email found', byName('Bad Mailto')?.email === 'team@badmailto.com', byName('Bad Mailto'));
check('FB: junk emails all dropped', byName('Junk Emails')?.email === '', byName('Junk Emails')?.email);
check('FB: same-domain email preferred over gmail', byName('Mixed Emails')?.email === 'info@mixed.com', byName('Mixed Emails')?.email);
const red = byName('Redirects Co');
check('FB: redirect followed, email from final site', red?.email === 'front@redirected-final.com' && red?.email_source === 'https://www.redirected-final.com/', red);
check('FB: facebook profile.php?id kept', red?.facebook === 'https://www.facebook.com/profile.php?id=12345', red?.facebook);
const nows = byName('No Website & Co');
check('FB: no website -> unchecked, dedupe_key = name key, reel link dropped', nows?.website_checked === false && nows?.dedupe_key === 'nowebsiteandco' && nows?.instagram === '', nows);
check('FB: "not a url" website blanked', byName('Spaces Site')?.website === '', byName('Spaces Site'));
check('FB: every result has every field as the right type', list.every((b: any) =>
  ['name', 'website', 'phone', 'address', 'instagram', 'facebook', 'source_url', 'dedupe_key', 'page_title', 'site_text', 'email', 'email_source'].every((k) => typeof b[k] === 'string') &&
  ['is_chain', 'website_checked'].every((k) => typeof b[k] === 'boolean')), list.find((b: any) => !(typeof b.site_text === 'string')));
check('FB: phone number coerced to text', byName('42')?.phone === '5551234', byName('42'));
const firstChain = list.findIndex((b: any) => b.is_chain);
const lastIndie = list.map((b: any) => b.is_chain).lastIndexOf(false);
check('FB: chains sorted after independents', firstChain === -1 || firstChain > lastIndie, list.map((b: any) => [b.name, b.is_chain]));
const indie = list.filter((b: any) => !b.is_chain);
const firstUnchecked = indie.findIndex((b: any) => !b.website_checked);
check('FB: working websites first among independents', firstUnchecked === -1 || indie.slice(firstUnchecked).every((b: any) => !b.website_checked), indie.map((b: any) => [b.name, b.website_checked]));

check('FB: email hidden in a tracking script is ignored', byName('Pixel Shop')?.email === '', byName('Pixel Shop')?.email);
check('FB: title symbols decoded', byName('Pixel Shop')?.page_title === "Amy's & Co - Ice Cream", byName('Pixel Shop')?.page_title);
check('FB: general inbox on own domain preferred', byName('Inbox Co')?.email === 'info@inbox.com', byName('Inbox Co')?.email);
check('FB: free email preferred over web designer domain', byName('Freemail Shop')?.email === 'sweetshop@gmail.com', byName('Freemail Shop')?.email);
check('FB: email from schema.org business data kept, script email ignored', byName('Schema Co')?.email === 'hello@schema.com', byName('Schema Co')?.email);
check('FB: developer / other-company emails dropped', byName('Dev Mail')?.email === '', byName('Dev Mail')?.email);
check('FB: new facebook.com/p/ page link kept', byName('Dev Mail')?.facebook === 'https://www.facebook.com/p/Dev-Mail-Spa-100088817231261/', byName('Dev Mail')?.facebook);
check('FB: related business domain kept, webmaster@ dropped', byName('Glow Spa Austin')?.email === 'info@glowspaaustin.com', byName('Glow Spa Austin')?.email);
// Cap at 35 results.
mock(ME, (args, n) => ({ businesses: Array.from({ length: 30 }, (_, i) => biz({ name: `Biz ${n}-${i}` })) }));
r = await call(findBusinesses, { businessType: 'roofers', location: 'Dallas' });
check('FB: capped at 35 results', r.data.businesses.length === 35, r.data.businesses.length);
check('FB: no exclude line when nothing saved', !g.__mock.calls[0].prompt.includes('Skip these'), g.__mock.calls[0].prompt);

// ================= findEmail =================
mock(null, () => ({}));
r = await call(findEmail, { website: 'good.com', name: 'Good Spa' });
check('FE: not logged in -> 401', r.status === 401, r);

mock(ME, () => { throw new Error('should not search'); });
r = await call(findEmail, { website: 'good.com', name: 'Good Spa', location: 'Austin' });
check('FE: email on own site, no social needed -> verified, no web search', r.status === 200 && r.data.email === 'info@good.com' && r.data.email_verified === true && g.__mock.calls.length === 0, r);
check('FE: returns website_works true and empty new_website', r.data.website_works === true && r.data.new_website === '', r.data);

mock(ME, () => ({ email: 'wrong@x.com', email_source_url: '', website: '', instagram: 'https://instagram.com/social_only', facebook: 'https://www.facebook.com/socialonlypage/' }));
r = await call(findEmail, { website: 'https://socialonly.com', name: 'Social Only', location: 'Austin', needSocial: true });
check('FE: needSocial -> keeps site email, fills social from search', r.data.email === 'info@socialonly.com' && r.data.email_verified === true && r.data.instagram === 'https://www.instagram.com/social_only/' && r.data.facebook === 'https://www.facebook.com/socialonlypage', r.data);

mock(ME, () => ({ email: '', email_source_url: '', website: 'https://newsite.com', instagram: '', facebook: '' }));
r = await call(findEmail, { website: 'https://down.com', name: 'Moved Spa', location: 'Austin' });
check('FE: broken site -> new working website found and its email used', r.data.new_website === 'https://newsite.com' && r.data.email === 'booking@newsite.com' && r.data.email_verified === true && r.data.website_works === true, r.data);
check('FE: new site Instagram picked up', r.data.instagram === 'https://www.instagram.com/newsite_ig/', r.data.instagram);

mock(ME, () => ({ email: 'Owner@Somewhere.net', email_source_url: 'https://directory.com/listing/42', website: '', instagram: '', facebook: '' }));
r = await call(findEmail, { website: '', name: 'No Site Spa', location: 'Austin' });
check('FE: search email confirmed on its source page -> verified', r.data.email === 'owner@somewhere.net' && r.data.email_verified === true && r.data.email_source === 'https://directory.com/listing/42', r.data);

mock(ME, () => ({ email: 'made.up@guess.com', email_source_url: 'https://directory.com/listing/43', website: '', instagram: '', facebook: '' }));
r = await call(findEmail, { name: 'No Site Spa', location: 'Austin' });
check('FE: email NOT on its source page -> returned but NOT verified', r.data.email === 'made.up@guess.com' && r.data.email_verified === false, r.data);

mock(ME, () => ({ email: 'hidden@somewhere.net', email_source_url: 'https://directory.com/listing/44', website: '', instagram: '', facebook: '' }));
r = await call(findEmail, { name: 'Hidden', location: 'Austin' });
check('FE: email only inside a script on source page -> NOT verified', r.data.email === 'hidden@somewhere.net' && r.data.email_verified === false, r.data);

mock(ME, () => ({ email: 'you@email.com', email_source_url: '', website: '', instagram: '', facebook: '' }));
r = await call(findEmail, { name: 'Junk', location: 'Austin' });
check('FE: junk email from search dropped', r.data.email === '' && r.data.email_verified === false, r.data);

mock(ME, () => ({ email: 'webmaster@somewhere.net', email_source_url: 'https://directory.com/listing/42', website: '', instagram: '', facebook: '' }));
r = await call(findEmail, { name: 'Dev', location: 'Austin' });
check('FE: webmaster@ from search dropped', r.data.email === '', r.data);

mock(ME, () => 'this is not json');
r = await call(findEmail, { name: 'Weird', location: 'Austin' });
check('FE: AI returns non-JSON -> empty result, no crash', r.status === 200 && r.data.email === '', r);

mock(ME, () => { throw new Error('Search service down'); });
r = await call(findEmail, { name: 'Err', location: 'Austin' });
check('FE: search fails -> 500 with message', r.status === 500 && r.data.error === 'Search service down', r);

mock(ME, () => { throw new Error('should not search'); });
r = await call(findEmail, {});
check('FE: no website, no name -> empty answer, no search', r.status === 200 && r.data.email === '' && g.__mock.calls.length === 0, r);

mock(ME, () => ({ email: '', email_source_url: '', website: 'https://parked.com', instagram: '', facebook: '' }));
r = await call(findEmail, { website: 'https://slow.com', name: 'Slow', location: 'Austin' });
check('FE: search suggests a parked site -> not used as new website', r.data.new_website === '' && r.data.website_works === false, r.data);

mock(ME, () => ({}));
r = await call(findEmail, 'garbage', true);
check('FE: broken JSON body -> no crash', r.status === 200, r);

// ---------- report ----------
console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('FAIL: ' + f);
if (fails.length) Deno.exit(1);
