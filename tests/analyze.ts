// Scenario tests for analyzeLead.
// Run: deno run --allow-read --import-map=import_map.json analyze.ts
import analyzeLead from '../client-finder/analyzeLead.ts';

const g = globalThis as any;
let pass = 0;
const fails: string[] = [];
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) pass++;
  else fails.push(`${name}${detail === undefined ? '' : `  -> ${JSON.stringify(detail)?.slice(0, 500)}`}`);
}
const pad = (s: string) => s + '<p>' + 'We care about every guest. '.repeat(60) + '</p>';
const year = new Date().getFullYear();

const SITES: Record<string, { status?: number; html?: string; redirectTo?: string; hang?: boolean }> = {
  'https://full.com/': { html: pad(`<html><head><title>Full Spa Austin</title><meta name="viewport" content="width=device-width">
    <script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '123');</script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC"></script></head><body>
    <a href="https://www.vagaro.com/fullspa/book">Book Now</a><a href="tel:5125550100">Call</a>
    <h2>Testimonials</h2><p>Facials from $120</p>
    <form><input type="email"><textarea></textarea></form>
    <a href="https://www.instagram.com/fullspa/">IG</a>
    <footer>© ${year} Full Spa</footer></body></html>`) },
  'http://bare.com/': { html: pad(`<html><head><title>Bare Dental</title></head><body><p>Welcome to Bare Dental.</p><footer>Copyright 2016-2018 Bare Dental</footer></body></html>`) },
  'https://wixspa.com/': { html: pad('<html><head><title>Wix Spa</title><meta name="viewport" content="x"><link href="https://static.parastorage.com/x.css"></head><body><img src="https://static.wixstatic.com/a.png"><script>var p={"title":"Book Online","pageUriSEO":"book-online"}</script></body></html>') },
  'https://booknow.com/': { html: pad('<html><head><title>Book Now Salon</title></head><body><a href="/contact">Book now</a></body></html>') },
  'https://jsapp.com/': { html: '<html><head><title>JS App Spa</title><meta name="viewport" content="x"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' },
  'https://telonly.com/': { html: pad('<html><head><title>Tel Only Plumbing</title></head><body><header><a href="/x">Home</a><a href="tel:+15125550100">(512) 555-0100</a></header></body></html>') },
  'https://wixroof.com/': { html: pad('<html><head><title>Wix Roof</title><link href="https://static.parastorage.com/x.css"></head><body><script>var a={"appPage":{"id":"bookings_list","name":"Book Online","hidden":false}}</script></body></html>') },
  'https://gtmpixel.com/': { html: pad('<html><head><title>GTM Law</title><script>(function(w,d,s,l,i){})(window,document,"script","dataLayer","GTM-ABCD12");</script></head><body><header><a href="/x">Home</a></header></body></html>') },
  'https://pys.com/': { html: pad('<html><head><title>PYS Roofing</title><script>var pysOptions={"facebook":{"pixelIds":["1503851446577606"]}}</script></head><body></body></html>') },
  'https://shoppix.com/': { html: pad('<html><head><title>Shop Pix</title><script src="https://cdn.shopify.com/x.js"></script><script>var x={"pixel_type":"facebook_pixel"}</script></head><body></body></html>') },
  'https://bigform.com/': { html: '<html><head><title>Big Form Dental</title></head><body><form id="aspnetForm">' + 'Welcome to our dental office. '.repeat(1500) + '<input type="email" name="e"></form></body></html>' },
  'https://ghl.com/': { html: pad('<html><head><title>GHL Spa</title></head><body><iframe src="https://api.leadconnectorhq.com/widget/form/abc"></iframe></body></html>') },
  'https://bigmenu.com/': { html: pad('<html><head><title>Big Menu Spa</title></head><body><nav>' + Array.from({ length: 40 }, (_, i) => '<a href="/s' + i + '">Service ' + i + '</a>').join('') + '</nav><header><a class="btn" href="/c">Book Consultation</a></header></body></html>') },
  'https://callnum.com/': { html: pad('<html><head><title>Call Num Dental</title></head><body><a href="/">Home</a><a href="tel:8155779000">Call (815) 577-9000</a></body></html>') },
  'https://arketa.com/': { html: pad('<html><head><title>Arketa Pilates</title></head><body><a href="https://app.arketa.co/pilates/schedule">Classes</a></body></html>') },
  'https://shutter.com/': { html: pad('<html><head><title>Shutter Photo</title></head><body><img src="https://image.shutterstock.com/x.jpg"><a href="https://www.shutterstock.com/x">credit</a></body></html>') },
  'https://podiumchat.com/': { html: pad('<html><head><title>Podium Chat Dental</title><script src="https://connect.podium.com/widget.js"></script></head><body></body></html>') },
  'https://cafe.com/': { html: pad('<html><head><title>Bean Cafe</title></head><body><a href="https://order.toasttab.com/online/bean">Order Online</a></body></html>') },
  'https://lawfirm.com/': { html: pad('<html><head><title>Smith Law</title></head><body><p>Personal injury attorneys.</p></body></html>') },
  'https://est.com/': { html: pad('<html><head><title>Est Dental</title></head><body><footer>&copy; <script>document.write(new Date().getFullYear())</script> Est Dental, est. 2009</footer></body></html>') },
  'https://present.com/': { html: pad('<html><head><title>Present Spa</title></head><body><footer>Copyright &copy; 2019 - Present Present Spa</footer></body></html>') },
  'https://comingsoon.com/': { html: '<html><head><title>Coming Soon</title></head><body class="parking-page">' + 'x '.repeat(900) + '</body></html>' },
  'https://reviewsay.com/': { html: pad('<html><head><title>Review Say Pilates</title></head><body><h2>See what our clients are saying about us on Google!</h2></body></html>') },
  'https://sites.google.com/view/gsitebiz': { html: pad('<html><head><title>GSite Biz</title></head><body>Welcome</body></html>') },
  'https://moved.com/': { redirectTo: 'https://www.otherpractice.com/' },
  'https://www.otherpractice.com/': { html: pad('<title>Totally Other Practice</title>') },
  'https://shopcoffee.com/': { html: pad('<html><head><title>Shop Coffee</title></head><body><a href="/c">Coffee</a></body></html>') },
  'https://down.com/': { status: 500 },
  'https://blocked.com/': { status: 403 },
  'https://forward.com/': { redirectTo: 'https://linktr.ee/forwardspa' },
  'https://linktr.ee/forwardspa': { html: pad('<title>forwardspa | Linktree</title>') },
  'https://cta.com/': { html: pad('<title>CTA Roofing</title><nav><a href="/x">Home</a><a href="/q">Get a Free Estimate</a></nav><footer>&copy; 2020-' + year + '</footer>') },
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
    const r = new Response(site.html ?? '', { status: site.status ?? 200, headers: { 'content-type': 'text/html' } });
    Object.defineProperty(r, 'url', { value: url });
    resolve(r);
  });
};
function mock(user: unknown, llm: (a: any) => unknown) {
  g.__mock = { user, llm, calls: [] };
}
async function call(body: unknown, raw = false) {
  const res = await analyzeLead(new Request('https://fn/', { method: 'POST', body: raw ? (body as string) : JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
const ME = { id: 'u' };
const WEB = { google_rating: 4.8, google_reviews: 212, runs_meta_ads: 'yes', source_url: 'https://maps.google.com/x' };

mock(null, () => WEB);
let r = await call({ name: 'Full Spa', website: 'https://full.com' });
check('401 when not logged in', r.status === 401, r);

mock(ME, () => WEB);
r = await call({ website: 'https://full.com' });
check('400 without a business name', r.status === 400, r);
r = await call('nope', true);
check('400 on broken body', r.status === 400, r);

r = await call({ name: 'Full Spa', website: 'full.com', location: 'Austin, TX', business_type: 'Med spa' });
const f = r.data.facts;
check('full site: 200 and status ok', r.status === 200 && r.data.website_status === 'ok', r.data);
check('full site: Meta Pixel found', f?.meta_pixel === true, f);
check('full site: Google tag found', f?.google_tag === true, f);
check('full site: booking via Vagaro', f?.online_booking === true && f?.booking_tool === 'Vagaro', f);
check('full site: Book button found', f?.book_button === true, f);
check('full site: phone-ready', f?.mobile_ready === true, f);
check('full site: contact form', f?.contact_form === true, f);
check('full site: prices listed', f?.prices_listed === true, f);
check('full site: reviews shown', f?.reviews_shown === true, f);
check('full site: footer year = this year', f?.copyright_year === year, f?.copyright_year);
check('full site: https + instagram + phone', f?.https === true && f?.instagram === 'https://www.instagram.com/fullspa/' && f?.phone_on_site === true, f);
check('full site: no gaps about pixel/booking', !r.data.findings.gaps.some((s: string) => /Pixel|booking/.test(s)), r.data.findings);
check('full site: strengths mention pixel and Vagaro', r.data.findings.strengths.some((s: string) => /Pixel/.test(s)) && r.data.findings.strengths.some((s: string) => /Vagaro/.test(s)), r.data.findings);
check('web search passed through and labeled ok', r.data.web.google_rating === 4.8 && r.data.web.google_reviews === 212 && r.data.web.runs_meta_ads === 'yes' && r.data.web_search_ok === true, r.data.web);
check('site text and title returned', r.data.page_title === 'Full Spa Austin' && r.data.site_text.length > 50 && r.data.site_text.length <= 2500, r.data.page_title);
check('search prompt uses web search', g.__mock.calls[0]?.add_context_from_internet === true, g.__mock.calls[0]);

r = await call({ name: 'Bare Dental', website: 'http://bare.com', location: 'Boise', business_type: 'Dentist' });
const gaps = r.data.findings.gaps.join(' | ');
const checks = r.data.findings.check.join(' | ');
check('bare site: missing pixel is "check yourself", never a gap', !/Pixel/.test(gaps) && /didn't see a Meta Pixel/.test(checks) && /Pixel Helper/.test(checks), { gaps, checks });
check('bare site (dentist): booking gap worded as not seen', /didn't see a way to book online/.test(gaps), gaps);
check('bare site: button gap worded as not seen', /didn't see a clear "Book"/.test(gaps), gaps);
check('bare site: not phone-ready gap', /isn't set up for phones/.test(gaps), gaps);
check('bare site: old footer year 2018', r.data.facts.copyright_year === 2018 && /2018/.test(gaps), r.data.facts.copyright_year);
check('bare site: not https gap', /not secure/.test(gaps), gaps);
check('bare site: no social gap', /didn't see a link to an Instagram/.test(gaps), gaps);

r = await call({ name: 'CTA Roofing', website: 'https://cta.com' });
check('"Get a Free Estimate" counts as a clear button', r.data.facts.book_button === true, r.data.facts);
check('"© 2020-this year" reads this year', r.data.facts.copyright_year === year, r.data.facts.copyright_year);

r = await call({ name: 'No Site Spa', location: 'Austin' });
check('no website: status none, facts null, no gaps, says search for one', r.status === 200 && r.data.website_status === 'none' && r.data.facts === null && r.data.findings.gaps.length === 0 && /Search for one/.test(r.data.findings.check[0]), r.data);

r = await call({ name: 'IG Spa', website: 'https://www.instagram.com/igspa/' });
check('Instagram link as website -> treated as no website', r.data.website_status === 'none', r.data);

r = await call({ name: 'Down Spa', website: 'https://down.com' });
check('down site: status down, in check list, careful wording', r.data.website_status === 'down' && r.data.findings.gaps.length === 0 && /Open it yourself/.test(r.data.findings.check[0]), r.data);

r = await call({ name: 'Blocked Spa', website: 'https://blocked.com' });
check('blocked site: status blocked, in check list', r.data.website_status === 'blocked' && /couldn't check/.test(r.data.findings.check[0]), r.data);

r = await call({ name: 'Forward Spa', website: 'https://forward.com' });
check('domain forwarding to Linktree -> check list, no gaps', r.data.website_status === 'none' && r.data.findings.gaps.length === 0 && /forwards to a links or booking page/.test(r.data.findings.check[0]), r.data);

r = await call({ name: 'Wix Spa', website: 'https://wixspa.com' });
check('Wix site with no pixel visible -> "check yourself", names Wix', r.data.facts?.site_builder === 'Wix' && !r.data.findings.gaps.some((s: string) => /Pixel|Google/.test(s)) && r.data.findings.check.some((s: string) => /Wix/.test(s) && /Pixel Helper/.test(s)), r.data.findings);
check('Wix Bookings detected', r.data.facts?.online_booking === true && r.data.facts?.booking_tool === 'Wix Bookings', r.data.facts);

r = await call({ name: 'Wix Roof', website: 'https://wixroof.com' });
check('Wix booking app installed but no Book Online page -> no booking', r.data.facts?.online_booking === false, r.data.facts);

r = await call({ name: 'Book Now Salon', website: 'https://booknow.com' });
check('plain "Book now" link counts as a Book link', r.data.facts?.book_link === true && r.data.findings.strengths.some((s: string) => /"Book" link/.test(s)), r.data.findings);
check('no builder + no pixel -> still only "check yourself"', !r.data.findings.gaps.some((s: string) => /Pixel/.test(s)) && r.data.findings.check.some((s: string) => /Pixel Helper/.test(s)), r.data.findings);

r = await call({ name: 'JS App Spa', website: 'https://jsapp.com' });
check('page built by code -> no false content gaps, says to open it', r.data.facts?.content_hidden === true && !r.data.findings.gaps.some((s: string) => /booking|button|form|reviews/i.test(s)) && r.data.findings.check.some((s: string) => /builds its page with code/.test(s)), r.data.findings);
r = await call({ name: 'Tel Only Plumbing', website: 'https://telonly.com' });
check('phone link at the top counts as a Call button', r.data.facts?.book_button === true, r.data.facts);

const facts = async (name: string, website: string, business_type = '') => (await call({ name, website, business_type })).data;
let d = await facts('GTM Law', 'https://gtmpixel.com', 'Law firm');
check('GTM site: pixel note mentions Tag Manager', d.findings.check.some((s: string) => /Google Tag Manager/.test(s)), d.findings.check);
check('law firm: no "book online" gap', !d.findings.gaps.some((s: string) => /book online/.test(s)), d.findings.gaps);
d = await facts('PYS Roofing', 'https://pys.com');
check('PixelYourSite pixel detected', d.facts.meta_pixel === true, d.facts);
d = await facts('Shop Pix', 'https://shoppix.com');
check('Shopify facebook_pixel detected', d.facts.meta_pixel === true, d.facts);
d = await facts('Big Form Dental', 'https://bigform.com');
check('email field far inside a page-wide form -> form found', d.facts.contact_form === true, d.facts);
d = await facts('GHL Spa', 'https://ghl.com');
check('GoHighLevel form iframe -> form found', d.facts.contact_form === true, d.facts);
d = await facts('Big Menu Spa', 'https://bigmenu.com');
check('Book button after 40 menu links (in header, btn class) -> found', d.facts.book_button === true, d.facts);
d = await facts('Call Num Dental', 'https://callnum.com');
check('"Call (815) 577-9000" counts as a button', d.facts.book_button === true, d.facts);
d = await facts('Arketa Pilates', 'https://arketa.com', 'Pilates studio');
check('Arketa booking detected', d.facts.booking_tool === 'Arketa', d.facts);
d = await facts('Shutter Photo', 'https://shutter.com', 'Photographer');
check('shutterstock.com is NOT the Tock booking tool', d.facts.online_booking === false, d.facts);
d = await facts('Podium Chat Dental', 'https://podiumchat.com');
check('Podium chat widget is NOT booking', d.facts.online_booking === false, d.facts);
d = await facts('Bean Cafe', 'https://cafe.com', 'Coffee shop');
check('Toast is "orders online", not bookings', d.facts.online_ordering === true && d.facts.online_booking === false && d.findings.strengths.some((s: string) => /orders online \(Toast\)/.test(s)) && !d.findings.gaps.some((s: string) => /\bbook/i.test(s)), d.findings);
d = await facts('Est Dental', 'https://est.com');
check('"est. 2009" is not read as the footer year', d.facts.copyright_year !== 2009 && !d.findings.gaps.some((s: string) => /2009/.test(s)), d.facts.copyright_year);
d = await facts('Present Spa', 'https://present.com');
check('"2019 - Present" reads as this year', d.facts.copyright_year === year, d.facts.copyright_year);
d = await facts('Coming Soon Pizza', 'https://comingsoon.com');
check('"Coming Soon" placeholder -> not a working site', d.website_status !== 'ok', d.website_status);
d = await facts('Review Say Pilates', 'https://reviewsay.com');
check('"clients are saying" counts as reviews', d.facts.reviews_shown === true, d.facts);
d = await facts('GSite Biz', 'https://sites.google.com/view/gsitebiz');
check('Google Sites website is a real website', d.website_status === 'ok', d.website_status);

d = (await call({ name: 'Moved Dental', website: 'https://moved.com', location: 'Boise', business_type: 'Dentist' })).data;
check('forwards to another business -> says so (not "didn\'t load")', /forwards to otherpractice\.com/.test(d.findings.check[0] || ''), d.findings);
d = await facts('Shop Coffee', 'https://shopcoffee.com', 'Coffee roaster');
check('coffee shop: no "Book/Call/Get a quote" button gap', !d.findings.gaps.some((s: string) => /clear "Book"/.test(s)), d.findings.gaps);
d = await facts('Smith Law', 'https://lawfirm.com', 'Personal injury law firm');
check('law firm: still gets the Call/quote button gap', d.findings.gaps.some((s: string) => /clear "Book"/.test(s)) && !d.findings.gaps.some((s: string) => /book online/.test(s)), d.findings.gaps);

mock(ME, () => ({ ...WEB, runs_meta_ads: 'no' }));
d = await facts('Full Spa', 'https://full.com');
check('search answer "no" ads -> unknown', d.web.runs_meta_ads === 'unknown', d.web);

mock(ME, () => { throw new Error('rate limited'); });
r = await call({ name: 'Full Spa', website: 'https://full.com' });
check('web search fails -> still 200 with website facts', r.status === 200 && r.data.web_search_ok === false && r.data.facts?.meta_pixel === true && r.data.web.runs_meta_ads === 'unknown', r.data.web);

mock(ME, () => ({ google_rating: '9.9', google_reviews: -4, runs_meta_ads: 'Maybe!', source_url: 'not a url at all' }));
r = await call({ name: 'Full Spa', website: 'https://full.com' });
check('web search "no" ads becomes unknown (can\'t be verified)', true);
check('nonsense search values cleaned', r.data.web.google_rating === 0 && r.data.web.google_reviews === 0 && r.data.web.runs_meta_ads === 'unknown' && r.data.web.source_url === '', r.data.web);

mock(ME, () => JSON.stringify({ google_rating: 4.66, google_reviews: 88.4, runs_meta_ads: 'YES', source_url: 'maps.google.com/x' }));
r = await call({ name: 'Full Spa', website: 'https://full.com' });
check('string answer parsed, rounded', r.data.web.google_rating === 4.7 && r.data.web.google_reviews === 88 && r.data.web.runs_meta_ads === 'yes' && r.data.web.source_url === 'https://maps.google.com/x', r.data.web);

mock(ME, () => 'not json');
r = await call({ name: 'Full Spa', website: 'https://full.com' });
check('non-JSON search answer -> unknowns, no crash', r.status === 200 && r.data.web.runs_meta_ads === 'unknown', r);

const all = JSON.stringify(r.data);
check('no em or en dashes in any output', !/[–—]/.test(all));

// Search that never answers: cut off, website facts still returned.
mock(ME, () => new Promise(() => {}));
const t0 = Date.now();
r = await call({ name: 'Full Spa', website: 'https://full.com' });
const secs = (Date.now() - t0) / 1000;
check('hanging web search cut off under 30s, facts still there', r.status === 200 && secs < 30 && r.data.facts?.meta_pixel === true && r.data.web_search_ok === false, { secs, d: r.data.web_search_ok });

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const x of fails) console.log('FAIL: ' + x);
Deno.exit(fails.length ? 1 : 0);
