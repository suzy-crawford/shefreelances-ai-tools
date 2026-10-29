// deno-lint-ignore-file no-unused-vars
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Client Finder: gathers facts for the AI Lead Analyzer without screenshots. Reads the business's
// own website for things it can confirm (Meta Pixel, Google tag, online booking, a clear Book button,
// phone-ready, contact form, prices, reviews, footer year, https, social links), and runs one web
// search for their Google rating and whether they run Meta ads, which the app labels "double-check".

// ---- Shared helpers (findBusinesses and findEmail carry identical copies; edit src/helpers.ts and run build.py) ----

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_PAGE = 1_500_000;

// Text from the AI or a form, never an object; dashes the brand doesn't use become hyphens.
const str = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u2013\u2014]/g, '-').trim() : '';

function normalizeUrl(url: unknown) {
  const u = str(url);
  if (!u || /\s/.test(u)) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function domainOf(url: unknown) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// Sites many businesses share (social, booking, directories). A link to one of these is not the
// business's own website: its emails belong to the platform, and its domain can't tell businesses apart.
const PLATFORMS = [
  'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'tiktok.com', 'twitter.com', 'x.com', 'youtube.com', 'linkedin.com', 'pinterest.com',
  'linktr.ee', 'beacons.ai', 'linkin.bio', 'lnk.bio', 'campsite.bio', 'taplink.cc', 'allmylinks.com',
  'yelp.com', 'google.com', 'goo.gl', 'g.page', 'nextdoor.com', 'thumbtack.com', 'angi.com', 'angieslist.com', 'homeadvisor.com', 'houzz.com', 'bbb.org', 'yellowpages.com', 'tripadvisor.com', 'mapquest.com',
  'vagaro.com', 'booksy.com', 'glossgenius.com', 'styleseat.com', 'fresha.com', 'schedulicity.com', 'mindbodyonline.com', 'mindbody.io', 'boulevard.io', 'joinblvd.com', 'zenoti.com', 'acuityscheduling.com', 'calendly.com', 'setmore.com', 'squareup.com', 'opentable.com', 'resy.com', 'doordash.com', 'ubereats.com', 'grubhub.com', 'zocdoc.com', 'healthgrades.com',
];
function isPlatform(url: unknown) {
  const host = domainOf(url);
  if (host === 'sites.google.com') return false; // a real website, built with Google Sites
  return !!host && PLATFORMS.some((d) => host === d || host.endsWith('.' + d));
}

function nameKey(name: unknown) {
  return str(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

// Words in a business name that identify it (not "the", "spa", "dental", or the city), to make sure a page is really theirs.
const GENERIC = /^(the|and|for|med|medical|spa|spas|dental|dentist|dentistry|family|clinic|studio|salon|beauty|aesthetics|wellness|center|centre|group|company|services|service|llc|inc|corp|roofing|plumbing|construction|cosmetic|skin|care|health|fitness|home|homes|realty|law|firm|cafe|restaurant|bar|grill|shop|store|co|north|south|east|west|downtown)$/i;
const plain = (s: unknown) => str(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function nameWords(name: unknown, location: unknown = '') {
  const place = new Set(plain(location).split(/[^a-z0-9]+/).filter(Boolean));
  return plain(name).replace(/&/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.test(w) && !place.has(w));
}
function pageIsTheirs(html: string, name: unknown, location: unknown = '', url = '') {
  const text = plain(decodeEntities(stripBlocks(html.slice(0, 400_000), ['script', 'style', 'noscript', 'svg', 'template', '!--']).replace(/<[^>]*>/g, ' ')));
  const words = nameWords(name, location);
  if (words.length) return words.some((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(text));
  // Only generic words (like "Spa 7" or "TOC Medical Spa"): the whole name must be in the page title or the domain.
  const whole = nameKey(plain(name));
  if (whole.length < 3) return false;
  return nameKey(plain(pageTitle(html))).includes(whole) || domainOf(url).replace(/[^a-z0-9]/g, '').includes(whole);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...', copy: '\u00a9', reg: '', trade: '' };
function decodeEntities(s: string) {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(code); } catch { return m; }
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[\u2013\u2014]/g, '-');
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Removes <script>, <style>... blocks without regex backtracking (safe on huge or broken pages).
function stripBlocks(html: string, tags: string[]) {
  const lower = html.toLowerCase();
  let out = '';
  let i = 0;
  while (i < html.length) {
    let next = -1;
    let tag = '';
    for (const t of tags) {
      const at = lower.indexOf('<' + t, i);
      if (at !== -1 && (next === -1 || at < next)) { next = at; tag = t; }
    }
    if (next === -1) { out += html.slice(i); break; }
    out += html.slice(i, next) + ' ';
    const end = tag === '!--' ? lower.indexOf('-->', next + 4) : lower.indexOf('</' + tag, next + 1);
    if (end === -1) break; // unclosed block: drop the rest
    const close = lower.indexOf('>', end);
    i = close === -1 ? html.length : close + 1;
  }
  return out;
}

// Email addresses hidden by Cloudflare's email protection.
function cloudflareEmails(html: string) {
  return [...html.matchAll(/data-cfemail=["']([0-9a-f]{4,})["']/gi)].map((m) => {
    const hex = m[1];
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out;
  });
}

const VALID_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const JUNK_EMAIL = /(@([a-z0-9-]+\.)*(sentry\.io|wixpress\.com|example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|yourname\.com|company\.com|mysite\.com)$|^(yourname|youremail|name|email|user|test|someone)@|@\d|\.(png|jpe?g|gif|webp|svg|css|js)$)/i;

// Pulls emails out of text one word at a time (fast on any page). "hi@shop.com.We" loses the stuck-on word.
function emailsInText(text: string) {
  const found: string[] = [];
  for (const raw of text.split(/[\s<>"'(),;:[\]{}|\\]+/)) {
    if (raw.length > 254 || raw.indexOf('@') < 1) continue;
    let e = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    e = e.replace(/\.(com|net|org|co|us|io|biz|info|me|ca|uk|au)\.[A-Z][A-Za-z]*$/, '.$1');
    found.push(e);
  }
  return found;
}

// Only what a visitor can see, plus the business details the site publishes for Google (schema.org).
// Emails inside scripts (tracking pixels, plugins) are usually the web designer's or a vendor's.
function emailsIn(html: string) {
  const listing = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([^<]{0,20000})<\/script>/gi)].map((m) => m[1]).join(' ');
  const visible = stripBlocks(html, ['script', 'style', 'noscript', 'template', '!--']);
  const fromMailto = [...visible.matchAll(/mailto:([^"'?\s>]{3,254})/gi)].map((m) => safeDecode(m[1]));
  const fromText = emailsInText(decodeEntities(visible.replace(/<[^>]*>/g, ' ') + ' ' + listing));
  return [...new Set([...fromMailto, ...cloudflareEmails(html), ...fromText].map((e) => e.trim().toLowerCase()))].filter(
    (e) => VALID_EMAIL.test(e) && !JUNK_EMAIL.test(e)
  );
}

// Best first: a general inbox on their own domain, then any address on their own domain, then a free
// email account (many small businesses use one). Another company's domain is only used when it clearly
// carries the business's own name, because it is usually the web designer's or a software vendor's.
const INBOX = /^(info|hello|hi|contact|office|admin|team|booking|bookings|book|appointments|reservations|frontdesk|reception|studio|support|sales|inquiries|enquiries|mail)@/;
const FREE_MAIL = /@(gmail|yahoo|ymail|outlook|hotmail|icloud|aol|live|msn|me|mac|proton|protonmail|comcast|att|sbcglobal|verizon)\./;
const NOT_THE_BUSINESS = /^(dev|developer|webmaster|web|wordpress|wp|hosting|seo|design|designer|noreply|no-reply|donotreply|privacy|abuse|postmaster|press|media)@/;
function baseName(host: string) {
  const parts = host.split('.');
  return (parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2] || '').replace(/[^a-z0-9]/g, '');
}
function sameBusinessDomain(a: string, b: string) {
  const x = baseName(a);
  const y = baseName(b);
  if (x.length < 5 || y.length < 5) return x === y && !!x;
  return x.includes(y) || y.includes(x);
}
function pickEmail(emails: string[], siteUrl: string) {
  const host = domainOf(siteUrl);
  if (!host || isPlatform(siteUrl)) return '';
  const usable = emails.filter((e) => !NOT_THE_BUSINESS.test(e) && !isPlatform('https://' + e.split('@')[1]));
  const own = (e: string) => e.endsWith('@' + host) || e.endsWith('.' + host);
  const related = (e: string) => sameBusinessDomain(e.split('@')[1], host);
  return (
    usable.find((e) => own(e) && INBOX.test(e)) ||
    usable.find(own) ||
    usable.find((e) => related(e) && INBOX.test(e)) ||
    usable.find((e) => FREE_MAIL.test(e)) ||
    usable.find(related) ||
    ''
  );
}

// Contact, About and Privacy pages on the business's own site only.
function emailPageUrls(html: string, siteUrl: string) {
  const host = domainOf(siteUrl);
  const links = [...html.matchAll(/<a\s[^>]*href=["']([^"'#]{1,500})["'][^>]*>([^]{0,2000}?)<\/a>/gi)];
  const urls: string[] = [];
  for (const pattern of [/contact/i, /about/i, /privacy/i]) {
    for (const m of links) {
      if (!(pattern.test(m[1]) || pattern.test(m[2].replace(/<[^>]*>/g, '')))) continue;
      try {
        const url = new URL(m[1], siteUrl);
        if (!/^https?:$/.test(url.protocol) || domainOf(url.toString()) !== host) continue;
        if (url.pathname.replace(/\/+$/, '') === new URL(siteUrl).pathname.replace(/\/+$/, '')) continue;
        if (!urls.includes(url.toString())) urls.push(url.toString());
        break;
      } catch { /* ignore */ }
    }
  }
  return urls;
}

// Profile links only: skips share buttons, tracking pixels, and links to single posts.
function cleanInstagram(url: unknown) {
  const m = str(url).match(/instagram\.com\/([A-Za-z0-9_.]+)\/?/i);
  if (!m || /^(p|reel|reels|explore|stories|accounts|share|tv|rsrc\.php|about|developer|legal|direct|web)$/i.test(m[1])) return '';
  return `https://www.instagram.com/${m[1]}/`;
}

function cleanFacebook(url: unknown) {
  const u = str(url);
  const id = u.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
  if (id) return `https://www.facebook.com/profile.php?id=${id[1]}`;
  // Newer page addresses: facebook.com/p/Business-Name-100012345678/
  const p = u.match(/facebook\.com\/p\/([A-Za-z0-9_.-]+)\/?/i);
  if (p) return `https://www.facebook.com/p/${p[1]}/`;
  // Older page addresses: facebook.com/pages/.../Business-Name-123456789/
  const legacy = u.match(/facebook\.com\/(pages\/[^?#]*?\d{6,})\/?/i);
  if (legacy) return `https://www.facebook.com/${legacy[1]}/`;
  const m = u.match(/facebook\.com\/(?:pg\/)?([A-Za-z0-9_.-]+)\/?/i);
  if (!m || /^(pages|sharer|sharer\.php|share|tr|plugins|dialog|login|events|groups|watch|hashtag|people|policies|privacy|help|business|rsrc\.php|marketplace|gaming|reel|photo\.php|photo|video\.php|story\.php|permalink\.php|l\.php)$/i.test(m[1])) return '';
  return `https://www.facebook.com/${m[1]}`;
}

function socialLinks(html: string) {
  const hrefs = [...html.matchAll(/href=["']([^"']{1,500})["']/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  return {
    instagram: hrefs.map(cleanInstagram).find(Boolean) || '',
    facebook: hrefs.map(cleanFacebook).find(Boolean) || '',
  };
}

// Parked or placeholder domains load fine but aren't a real business website.
function looksParked(html: string) {
  if (html.length < 1500 && /location\.(href|replace)|http-equiv=["']refresh/i.test(html)) return true;
  if (/parking-page|<title>\s*(coming soon|under construction|website coming soon|site (is )?under construction)\s*</i.test(html.slice(0, 20_000))) return true;
  return /(this domain (is|may be) for sale|buy this domain|domain parking|parked free|hugedomains|sedoparking|godaddy\.com\/domainsearch)/i.test(html.slice(0, 200_000));
}

// Reads at most MAX_PAGE bytes, in the page's own character set.
async function readPage(res: Response) {
  const type = res.headers.get('content-type') || '';
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (size < MAX_PAGE) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(Math.min(size, MAX_PAGE));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.length, bytes.length - at));
    bytes.set(part, at);
    at += part.length;
    if (at >= bytes.length) break;
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const charset = (type.match(/charset=([\w-]+)/i) || head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// status: "ok" (a real page), "blocked" (the site turned our check away, so it may well work),
// "down" (doesn't load, errors, parked, or isn't a web page).
async function fetchHtml(url: string, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } });
    const finalUrl = res.url || url;
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      const status = [401, 403, 406, 429, 503].includes(res.status) ? 'blocked' : 'down';
      return { ok: false, status, html: '', finalUrl };
    }
    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml|text\/plain/i.test(type)) {
      res.body?.cancel().catch(() => {});
      return { ok: false, status: 'down', html: '', finalUrl };
    }
    const html = await readPage(res);
    if (/<title>\s*(just a moment|attention required|access denied|please wait)/i.test(html.slice(0, 5000))) return { ok: false, status: 'blocked', html: '', finalUrl };
    if (looksParked(html)) return { ok: false, status: 'down', html: '', finalUrl };
    return { ok: true, status: 'ok', html, finalUrl };
  } catch {
    return { ok: false, status: 'down', html: '', finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

// Looks for an email on the homepage, then the Contact, About, and Privacy pages. Never guesses.
async function findEmailOnSite(siteUrl: string, html: string, ms = 6000) {
  const onHome = pickEmail(emailsIn(html), siteUrl);
  if (onHome) return { email: onHome, email_source: siteUrl };
  const pages = emailPageUrls(html, siteUrl);
  if (ms < 1500) return { email: '', email_source: '' };
  const results = await Promise.all(pages.map((u) => fetchHtml(u, ms)));
  for (let i = 0; i < pages.length; i++) {
    const found = results[i].ok ? pickEmail(emailsIn(results[i].html), siteUrl) : '';
    if (found) return { email: found, email_source: pages[i] };
  }
  return { email: '', email_source: '' };
}

// The visible words on the page, for the outreach and analysis prompts.
function pageText(html: string) {
  return decodeEntities(stripBlocks(html, ['script', 'style', 'noscript', 'svg', 'template', '!--']).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500);
}

function pageTitle(html: string) {
  return decodeEntities(html.match(/<title[^>]*>([^<]{0,500})<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

// Ends a slow AI web search so one stuck search can't hold up the rest.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Their website, if we can trust it: a redirect to a platform (Linktree, Instagram...) means no website of
// their own, and a redirect to another business's domain (expired domains often forward) isn't theirs.
async function openTheirSite(url: string, name: unknown, location: unknown, ms = 8000) {
  const page = await fetchHtml(url, ms);
  if (!page.ok) return { ...page, platformUrl: '', otherUrl: '' };
  if (domainOf(page.finalUrl) !== domainOf(url)) {
    if (isPlatform(page.finalUrl)) return { ok: false, status: 'none', html: '', finalUrl: page.finalUrl, platformUrl: page.finalUrl, otherUrl: '' };
    if (!pageIsTheirs(page.html, name, location, page.finalUrl)) return { ok: false, status: 'down', html: '', finalUrl: page.finalUrl, platformUrl: '', otherUrl: page.finalUrl };
  }
  return { ...page, platformUrl: '', otherUrl: '' };
}

// One clock for the whole request, so every step fits inside the time the platform allows.
function makeDeadline(totalMs: number) {
  const end = Date.now() + totalMs;
  return (want: number) => Math.max(0, Math.min(want, end - Date.now() - 500));
}

// ---- analyzeLead ----

const SEARCH_TIMEOUT = 25_000;

// Booking tools, matched on the address a link points to (never on any text in the page).
const BOOKING_TOOLS: [string[], string][] = [
  [['vagaro.com'], 'Vagaro'], [['booksy.com'], 'Booksy'], [['glossgenius.com'], 'GlossGenius'], [['styleseat.com'], 'StyleSeat'],
  [['fresha.com'], 'Fresha'], [['schedulicity.com'], 'Schedulicity'], [['mindbodyonline.com', 'mindbody.io'], 'Mindbody'],
  [['joinblvd.com', 'boulevard.io', 'blvd.co'], 'Boulevard'], [['zenoti.com'], 'Zenoti'], [['acuityscheduling.com', 'squarespacescheduling.com', 'as.me'], 'Acuity'],
  [['calendly.com'], 'Calendly'], [['setmore.com'], 'Setmore'], [['janeapp.com'], 'Jane'], [['zocdoc.com'], 'Zocdoc'],
  [['nexhealth.com'], 'NexHealth'], [['localmed.com'], 'LocalMed'], [['opentable.com'], 'OpenTable'], [['resy.com'], 'Resy'],
  [['exploretock.com', 'tock.com'], 'Tock'], [['housecallpro.com'], 'Housecall Pro'], [['getjobber.com', 'jobber.com'], 'Jobber'],
  [['servicetitan.com'], 'ServiceTitan'], [['simplybook.me', 'simplybook.it'], 'SimplyBook'], [['booker.com'], 'Booker'],
  [['genbook.com'], 'Genbook'], [['patientpop.com', 'tebra.com'], 'Tebra'], [['arketa.co', 'arketa.com'], 'Arketa'],
  [['mangomint.com'], 'Mangomint'], [['joinmoxie.com', 'moxie.com'], 'Moxie'], [['modento.io'], 'Modento'], [['momence.com'], 'Momence'],
  [['wellnessliving.com'], 'WellnessLiving'], [['marianatek.com'], 'Mariana Tek'], [['phorest.com'], 'Phorest'], [['meevo.com', 'meevo2.com'], 'Meevo'],
  [['scheduleengine.com'], 'Schedule Engine'], [['book.squareup.com', 'app.squareup.com'], 'Square Appointments'],
  [['clinicsense.com'], 'ClinicSense'], [['noterro.com'], 'Noterro'], [['chiromatrix.com'], 'ChiroMatrix'],
];
// Online ordering tools (restaurants, cafes, shops): "they take orders online", not bookings.
const ORDER_TOOLS: [string[], string][] = [
  [['toasttab.com'], 'Toast'], [['square.site', 'squareup.com'], 'Square'], [['clover.com'], 'Clover'], [['doordash.com'], 'DoorDash'],
  [['ubereats.com'], 'Uber Eats'], [['grubhub.com'], 'Grubhub'], [['chownow.com'], 'ChowNow'], [['olo.com'], 'Olo'], [['bentobox.com', 'getbento.com'], 'BentoBox'],
];
// Businesses where a visitor's next step is to call or ask for a quote (law, trades, home services).
const SERVICE_BUSINESS = /(law|attorney|lawyer|legal|roof|plumb|hvac|heating|cooling|air condition|electric|contractor|construction|remodel|renovat|repair|clean|maid|janitor|landscap|lawn|tree|pest|exterminat|solar|insurance|real estate|realt|mortgage|loan|account|cpa|bookkeep|tax|financ|consult|agency|marketing|paint|floor|window|door|garage|fence|pool|moving|movers|storage|towing|auto|mechanic|body shop|detail|locksmith|security|alarm|concrete|paving|foundation|siding|gutter|insulat|spray foam|drywall|handyman|appliance|septic|well|water|restoration|mold|flood|junk|dumpster|catering|event|wedding|photograph|video|design|architect|engineer|it service|computer|web)/i;
// Businesses where clients book a time slot. For others (law firms, roofers, shops), "no online booking" isn't a gap.
const APPOINTMENT_BUSINESS = /(spa|dent|ortho|salon|hair|barber|nail|lash|brow|wax|beauty|aesthet|skin|derm|massage|chiro|physio|physical therap|acupunct|therap|counsel|wellness|clinic|medical|doctor|optom|eye care|vet|groom|pet|fitness|gym|pilates|yoga|crossfit|trainer|studio|tattoo|photograph|tutor|music lesson|driving school|piercing|botox|injector|iv |laser|weight loss|med spa)/i;
const CTA = /\b(book( now| online| an appointment| a consult\w*| a visit| your\b[\w ]{0,20})?|schedule( now| an appointment| a consult\w*| online| a visit)?|request (an )?(appointment|quote|estimate|consult\w*)|get a (free )?(quote|estimate)|free (quote|estimate|consult\w*|case (review|consult\w*))|call (us|now|today)|reserve|order( online| now| ahead| in advance)|make an appointment|contact us|get started|shop now)\b/i;
const CALL_TEXT = /^(call( us)?[\s:]*)?\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/i;
const BOOK_LINK = /\b(book( now| online| an appointment| a consult\w*| a visit| your (visit|appointment|treatment))|schedule( now| online| an appointment| a consult\w*| your (visit|appointment))|make an appointment|reserve (a table|now))\b/i;
const FORM_TOOLS = /(jotform|typeform|hsforms|hubspot\.com\/forms|wpforms|gravityforms|gform_|formstack|cognitoforms|docs\.google\.com\/forms|forms\.gle|wix-forms|sqs-block-form|ninja-forms|contact-form-7|wpcf7|leadconnectorhq\.com\/widget\/form|msgsndr|fluentform|forminator|elementor-form|formspree|123formbuilder|paperform|tally\.so|fillout|getform|netlify-form|data-netlify)/i;
const REVIEW_WORDS = /\b(testimonials?|reviews?|what (our|my) (clients|customers|patients|guests)( are)? say(ing)?|(clients|customers|patients|guests) are saying|5[- ]stars?|five[- ]star|rated \d(\.\d)? (out of|stars))\b|\u2605/i;
const REVIEW_WIDGETS = /elfsight|trustindex|birdeye|reviewsonmywebsite|grade\.us|trustpilot|google-reviews|reviews-widget|widget\.reviews|embedsocial/i;
const PIXEL = /fbq\(\s*['"]init['"]|connect\.facebook\.net\/[^"'\s]*\/fbevents\.js|"pixelIds"\s*:\s*\[\s*"\d|pixelyoursite|"pixel_type"\s*:\s*"facebook_pixel"|facebook-pixel|"facebookPixelId"\s*:\s*"\d|fb_pixel_id|meta-pixel/i;
const GOOGLE_TAG = /googletagmanager\.com\/(gtag\/js|gtm\.js)|gtag\(\s*['"]config['"]|google-analytics\.com\/(analytics|ga)\.js|\bGTM-[A-Z0-9]{4,}\b|"googleAnalyticsAccountId"\s*:\s*"[^"]|\bG-[A-Z0-9]{6,}\b/;

// Website builders that can load tracking from their own settings, out of sight of the page code.
const BUILDERS: [RegExp, string][] = [
  [/wixstatic\.com|static\.parastorage\.com/i, 'Wix'], [/static1\.squarespace\.com|squarespace-cdn\.com/i, 'Squarespace'],
  [/cdn\.shopify\.com|myshopify\.com/i, 'Shopify'], [/website-files\.com|webflow\.(com|io)\//i, 'Webflow'],
  [/img1\.wsimg\.com/i, 'GoDaddy'], [/showit\.(co|com)/i, 'Showit'], [/framerusercontent\.com/i, 'Framer'],
  [/multiscreensite\.com|dudamobile|irp\.cdn-website\.com/i, 'Duda'], [/editmysite\.com|weebly\.com/i, 'Square Online'],
  [/creatorlink\.net/i, 'Creatorlink'], [/leadconnectorhq\.com|msgsndr\.com/i, 'GoHighLevel'],
];

function visibleText(html: string) {
  return decodeEntities(stripBlocks(html, ['script', 'style', 'noscript', 'svg', 'template', '!--']).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function hostMatches(href: string, domains: string[]) {
  if (!/^(https?:)?\/\//i.test(href.trim())) return false;
  const host = domainOf(href.trim().replace(/^\/\//, 'https://'));
  return !!host && domains.some((d) => host === d || host.endsWith('.' + d));
}

// The copyright year in the footer: "\u00a9 2019", "\u00a9 2016-2024", "Copyright \u00a9 2021 - Present". Not "est. 2009".
function footerYear(text: string, year: number) {
  const found: number[] = [];
  for (const m of text.matchAll(/(?:\u00a9|\(c\)|copyright)(?:\s*(?:\u00a9|copyright|\(c\)))?\s*((?:19|20)\d{2})(?:\s*[-,]\s*((?:19|20)\d{2}|present|now|today))?/gi)) {
    found.push(Number(m[1]));
    if (m[2]) found.push(/^\d/.test(m[2]) ? Number(m[2]) : year);
  }
  const ok = found.filter((y) => y >= 1995 && y <= year + 1);
  return ok.length ? Math.max(...ok) : 0;
}

// Facts read straight from their website. Only what the page itself shows; nothing guessed.
function siteFacts(html: string, finalUrl: string, year: number) {
  const text = visibleText(html);
  const hrefs = [...html.matchAll(/href=["']([^"']{1,500})["']/gi)].map((m) => m[1]);
  const links = [...html.matchAll(/<(a|button)\b([^>]*)>([^]{0,400}?)<\/\1>/gi)].map((m) => ({ attrs: m[2], text: visibleText(m[3]) })).filter((l) => l.text);
  const header = html.match(/<header\b[^>]*>([^]*?)<\/header>/i)?.[1] || '';
  const headerLinks = [...header.matchAll(/<(a|button)\b[^>]*>([^]{0,400}?)<\/\1>/gi)].map((m) => visibleText(m[2]));
  const isCta = (t: string) => t.length <= 45 && (CTA.test(t) || CALL_TEXT.test(t.trim()));
  const booking = BOOKING_TOOLS.find(([d]) => hrefs.some((h) => hostMatches(h, d)));
  const wixBooking = /"pageUriSEO"\s*:\s*"book-online"/i.test(html) || hrefs.some((h) => /\/book-online\/?($|\?)/i.test(h));
  const ordering = ORDER_TOOLS.find(([d]) => hrefs.some((h) => hostMatches(h, d)));
  const builder = BUILDERS.find(([re]) => re.test(html));
  const social = socialLinks(html);
  return {
    meta_pixel: PIXEL.test(html),
    tag_manager: /\bGTM-[A-Z0-9]{4,}\b|googletagmanager\.com\/gtm\.js/.test(html),
    google_tag: GOOGLE_TAG.test(html),
    online_booking: !!booking || wixBooking,
    booking_tool: booking ? booking[1] : wixBooking ? 'Wix Bookings' : '',
    book_link: links.some((l) => l.text.length <= 45 && BOOK_LINK.test(l.text)),
    online_ordering: !!ordering,
    ordering_tool: ordering ? ordering[1] : '',
    book_button:
      links.slice(0, 25).some((l) => isCta(l.text)) ||
      headerLinks.some(isCta) ||
      links.slice(0, 80).some((l) => /class=["'][^"']*\b(btn|button|cta)\b/i.test(l.attrs) && isCta(l.text)),
    mobile_ready: /<meta[^>]+name=["']viewport["']/i.test(html),
    contact_form: /type=["']?email\b|<textarea\b/i.test(html) || FORM_TOOLS.test(html),
    prices_listed: /\$\s?\d{2,}/.test(text),
    reviews_shown: REVIEW_WORDS.test(text) || REVIEW_WIDGETS.test(html),
    copyright_year: footerYear(text, year),
    site_builder: builder ? builder[1] : '',
    content_hidden: text.length < 300,
    https: /^https:/i.test(finalUrl),
    instagram: social.instagram,
    facebook: social.facebook,
    phone_on_site: /href=["']tel:/i.test(html),
  };
}

// Plain-English findings, written by code from the facts above.
// strengths: confirmed on their site. gaps: things we didn't see on their homepage (worded that way).
// check: anything we can't be sure of; the member opens the site and checks before mentioning it.
function findingsFrom(f: ReturnType<typeof siteFacts>, year: number, businessType: string) {
  const gaps: string[] = [];
  const strengths: string[] = [];
  const check: string[] = [];
  if (f.meta_pixel) strengths.push('They have the Meta Pixel on their website, so they are set up to track Facebook and Instagram ads.');
  else check.push(`We didn't see a Meta Pixel in their homepage code. ${f.tag_manager ? 'They use Google Tag Manager, which can load it out of sight' : f.site_builder ? `Their site is built on ${f.site_builder}, which can load it out of sight` : 'Some sites load it out of sight'}, so check with the free Meta Pixel Helper before mentioning it.`);
  if (!f.google_tag) check.push("We didn't see Google Analytics or a Google tag in their homepage code. Don't mention it unless you've checked.");
  if (f.content_hidden) {
    check.push("Their website builds its page with code we can't read, so we couldn't check their booking, buttons, forms, prices or reviews. Open it yourself.");
  } else {
    if (f.online_booking) strengths.push(f.booking_tool ? `They take bookings online (${f.booking_tool}).` : 'They have a "Book" link on their website.');
    else if (f.book_link) strengths.push('They have a "Book" link on their website.');
    if (f.online_ordering) strengths.push(`They take orders online (${f.ordering_tool}).`);
    const books = f.online_booking || f.book_link;
    if (!books && !f.online_ordering && APPOINTMENT_BUSINESS.test(businessType)) gaps.push("I didn't see a way to book online on their homepage.");
    if (!f.book_button && !books && (!businessType || APPOINTMENT_BUSINESS.test(businessType) || SERVICE_BUSINESS.test(businessType))) gaps.push(`I didn't see a clear "Book", "Call" or "Get a quote" button near the top of their homepage.`);
    if (!f.contact_form) gaps.push("I didn't see a contact form on their homepage (it may be on another page).");
    if (f.reviews_shown) strengths.push('They show reviews or testimonials on their website.');
    else gaps.push("I didn't see reviews or testimonials on their homepage.");
  }
  if (!f.mobile_ready) gaps.push("Their homepage isn't set up for phones (it has no mobile setting).");
  if (f.copyright_year && f.copyright_year <= year - 3) gaps.push(`Their website footer says \u00a9 ${f.copyright_year}, so it may not have been updated in a while.`);
  if (!f.https) gaps.push('Their website is not secure (no https), so browsers may warn visitors.');
  if (!f.instagram && !f.facebook) gaps.push("I didn't see a link to an Instagram or Facebook page on their homepage.");
  return { gaps, strengths, check };
}

// deno-lint-ignore no-explicit-any
async function searchReviewsAndAds(base44: any, name: string, location: string, website: string, ms: number) {
  const raw = await withTimeout(
    base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        `Look up this local business:`,
        `Business: ${name}`,
        `Location: ${location || 'unknown'}`,
        website ? `Website: ${website}` : `No website on file.`,
        `Return: google_rating (their Google rating as a number like 4.7, or 0 if you did not see it), google_reviews (their number of Google reviews, or 0 if you did not see it), runs_meta_ads ("yes" only if you saw them running Facebook or Instagram ads right now, otherwise "unknown"), source_url (the page where you saw the rating, or empty string).`,
        `Only report what you actually saw on a web page for this exact business. Never guess.`,
      ].join('\n'),
      add_context_from_internet: true,
      response_json_schema: {
        type: 'object',
        properties: {
          google_rating: { type: 'number' },
          google_reviews: { type: 'number' },
          runs_meta_ads: { type: 'string' },
          source_url: { type: 'string' },
        },
        required: ['google_rating', 'google_reviews', 'runs_meta_ads', 'source_url'],
      },
    }),
    ms,
    'The web search took too long.'
  );
  // deno-lint-ignore no-explicit-any
  let d: any = {};
  try {
    d = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  } catch {
    d = {};
  }
  const rating = Number(d.google_rating);
  const reviews = Math.round(Number(d.google_reviews));
  return {
    google_rating: rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : 0,
    google_reviews: reviews > 0 && reviews < 100000 ? reviews : 0,
    // A web search can't really see "no ads", so only "yes" is kept.
    runs_meta_ads: str(d.runs_meta_ads).toLowerCase() === 'yes' ? 'yes' : 'unknown',
    source_url: normalizeUrl(d.source_url),
  };
}

export default async function (req: Request) {
  const left = makeDeadline(45_000);
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    let website = normalizeUrl(body?.website);
    const name = str(body?.name).slice(0, 120);
    const location = str(body?.location).slice(0, 80);
    const businessType = str(body?.business_type).slice(0, 80);
    if (!name) return Response.json({ error: 'The business name is required.' }, { status: 400 });
    if (website && isPlatform(website)) website = '';

    // Their website (facts only) and the web search for reviews and ads, at the same time.
    const openSite = async () => {
      if (!website) return null;
      const first = await openTheirSite(website, name, location, left(10000));
      // Some working sites fail our secure connection check; try once more without it before saying "down".
      if (!first.ok && first.status === 'down' && /^https:/i.test(website) && left(6000) >= 3000) {
        const again = await openTheirSite(website.replace(/^https:/i, 'http:'), name, location, left(6000));
        if (again.ok) return again;
      }
      return first;
    };
    const [page, web] = await Promise.all([
      openSite(),
      searchReviewsAndAds(base44, name, location, website, left(SEARCH_TIMEOUT)).catch(() => null),
    ]);

    const year = new Date().getFullYear();
    let website_status = website ? 'down' : 'none';
    let facts = null;
    let findings = { gaps: [] as string[], strengths: [] as string[], check: [] as string[] };
    let page_title = '';
    let site_text = '';
    if (page?.ok) {
      website_status = 'ok';
      facts = siteFacts(page.html, page.finalUrl, year);
      findings = findingsFrom(facts, year, businessType);
      page_title = pageTitle(page.html);
      site_text = pageText(page.html);
    } else if (page) {
      website_status = page.status;
      if (page.status === 'down') {
        findings.check.push(page.otherUrl
          ? `Their website address forwards to ${domainOf(page.otherUrl)}, which looks like a different business. Check before mentioning it.`
          : "Their website didn't load when we checked. Open it yourself before mentioning it.");
      }
      if (page.status === 'blocked') findings.check.push("We couldn't check their website automatically. Open it yourself.");
      if (page.status === 'none') findings.check.push("Their website address forwards to a links or booking page, so we didn't find a website of their own. Check before mentioning it.");
    } else {
      findings.check.push("We didn't find a website for them. Search for one before mentioning it.");
    }

    return Response.json({
      website_status,
      page_title,
      site_text,
      facts,
      findings,
      web: web || { google_rating: 0, google_reviews: 0, runs_meta_ads: 'unknown', source_url: '' },
      web_search_ok: !!web,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: (error as Error)?.message || 'The analysis failed.' }, { status: 500 });
  }
}
