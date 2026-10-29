// deno-lint-ignore-file no-unused-vars
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Client Finder: finds real local businesses with the built-in AI web search.
// Runs 3 searches at once, removes duplicates, flags chains, checks that every website
// actually loads (so made-up businesses are easy to spot), and looks for an email on the
// business's own website. An email is never guessed.

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
  return !!host && PLATFORMS.some((d) => host === d || host.endsWith('.' + d));
}

function nameKey(name: unknown) {
  return str(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

// Words in a business name that identify it (not "the", "spa", "dental", or the city), to make sure a page is really theirs.
const GENERIC = /^(the|and|for|med|medical|spa|spas|dental|dentist|dentistry|family|clinic|studio|salon|beauty|aesthetics|wellness|center|centre|group|company|services|service|llc|inc|corp|roofing|plumbing|construction|cosmetic|skin|care|health|fitness|home|homes|realty|law|firm|cafe|restaurant|bar|grill|shop|store|co|north|south|east|west|downtown)$/i;
const plain = (s: unknown) => str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function nameWords(name: unknown, location: unknown = '') {
  const place = new Set(plain(location).split(/[^a-z0-9]+/).filter(Boolean));
  return plain(name).replace(/&/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.test(w) && !place.has(w));
}
function pageIsTheirs(html: string, name: unknown, location: unknown = '', url = '') {
  const text = plain(decodeEntities(stripBlocks(html.slice(0, 400_000), ['script', 'style', 'noscript', 'svg', 'template', '!--']).replace(/<[^>]*>/g, ' ')));
  const words = nameWords(name, location);
  if (words.length) return words.some((w) => text.includes(w));
  // Only generic words (like "Spa 7" or "TOC Medical Spa"): the whole name must be in the page title or the domain.
  const whole = nameKey(plain(name));
  if (whole.length < 3) return false;
  return nameKey(plain(pageTitle(html))).includes(whole) || domainOf(url).replace(/[^a-z0-9]/g, '').includes(whole);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...' };
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
  if (!page.ok) return { ...page, platformUrl: '' };
  if (domainOf(page.finalUrl) !== domainOf(url)) {
    if (isPlatform(page.finalUrl)) return { ok: false, status: 'none', html: '', finalUrl: page.finalUrl, platformUrl: page.finalUrl };
    if (!pageIsTheirs(page.html, name, location, page.finalUrl)) return { ok: false, status: 'down', html: '', finalUrl: page.finalUrl, platformUrl: '' };
  }
  return { ...page, platformUrl: '' };
}

// One clock for the whole request, so every step fits inside the time the platform allows.
function makeDeadline(totalMs: number) {
  const end = Date.now() + totalMs;
  return (want: number) => Math.max(0, Math.min(want, end - Date.now() - 500));
}

// ---- findBusinesses ----

const MAX_RESULTS = 35;
const SEARCH_TIMEOUT = 40_000;

const SCHEMA = {
  type: 'object',
  properties: {
    businesses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          website: { type: 'string' },
          phone: { type: 'string' },
          address: { type: 'string' },
          instagram: { type: 'string' },
          facebook: { type: 'string' },
          source_url: { type: 'string' },
          is_chain: { type: 'boolean' },
        },
        required: ['name', 'website', 'phone', 'address', 'instagram', 'facebook', 'source_url', 'is_chain'],
      },
    },
  },
  required: ['businesses'],
};

function searchPrompt(focus: string, term: string, location: string, exclude: string[]) {
  return [
    `Find up to 12 real, currently operating ${term} in ${location}. Focus: ${focus}.`,
    exclude.length ? `Skip these businesses, they are already on the list: ${exclude.join('; ')}.` : '',
    `Only include businesses you found in actual search results.`,
    `For each one give: name, website (the business's own website, full URL, or empty string if none), phone (or empty string), address, instagram (profile URL or empty string if you did not see one), facebook (their Facebook Page URL or empty string), source_url (the web page where you found this business), and is_chain (true if it is a franchise or part of a chain with more than 3 locations).`,
    `Never invent a business, a website, a phone number, or a URL. If you cannot find 12 real ones, return fewer.`,
  ].filter(Boolean).join('\n');
}

const NO_CHECK = { website_checked: false, website_status: 'none', page_title: '', site_text: '', email: '', email_source: '', site_instagram: '', site_facebook: '', final_url: '', platform_url: '' };

async function checkWebsite(url: string, name: string, location: string, left: (ms: number) => number) {
  if (!url) return NO_CHECK;
  try {
    const page = await openTheirSite(url, name, location, left(7000));
    if (!page.ok) return { ...NO_CHECK, website_status: page.status, platform_url: page.platformUrl };
    const social = socialLinks(page.html);
    const found = await findEmailOnSite(page.finalUrl, page.html, left(5000));
    return {
      website_checked: true,
      website_status: 'ok',
      page_title: pageTitle(page.html),
      site_text: pageText(page.html),
      ...found,
      site_instagram: social.instagram,
      site_facebook: social.facebook,
      final_url: page.finalUrl,
      platform_url: '',
    };
  } catch {
    return { ...NO_CHECK, website_status: 'down' };
  }
}

export default async function (req: Request) {
  const started = Date.now();
  const left = makeDeadline(52_000);
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const term = str(body?.businessType).replace(/\s+/g, ' ').slice(0, 80);
    const location = str(body?.location).replace(/\s+/g, ' ').slice(0, 80);
    const exclude = (Array.isArray(body?.exclude) ? body.exclude : [])
      .map((n: unknown) => str(n).replace(/[\s;]+/g, ' ').slice(0, 80).trim())
      .filter(Boolean)
      .slice(0, 60);
    if (!term || !location) return Response.json({ error: 'Business type and location are required.' }, { status: 400 });

    const focuses = [
      'independent, locally owned businesses',
      'businesses with strong customer reviews',
      'businesses in different neighborhoods and nearby suburbs',
    ];
    const runs = await Promise.allSettled(
      focuses.map((focus) =>
        withTimeout(
          base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: searchPrompt(focus, term, location, exclude),
            add_context_from_internet: true,
            response_json_schema: SCHEMA,
          }),
          left(SEARCH_TIMEOUT),
          'The search took too long. Please try again.'
        )
      )
    );

    const seen = new Set();
    const merged = [];
    let failedSearches = 0;
    let firstError = '';
    for (const run of runs) {
      let data;
      try {
        if (run.status !== 'fulfilled') throw run.reason;
        data = typeof run.value === 'string' ? JSON.parse(run.value) : run.value;
      } catch (e) {
        failedSearches++;
        firstError = firstError || (e as Error)?.message || 'The search failed.';
        continue;
      }
      for (const b of Array.isArray(data?.businesses) ? data.businesses : []) {
        const name = str(b?.name);
        if (!name) continue;
        let website = normalizeUrl(b.website);
        let instagram = str(b.instagram);
        let facebook = str(b.facebook);
        // An Instagram, Facebook, booking or directory link is not their own website.
        if (website && isPlatform(website)) {
          if (!instagram && cleanInstagram(website)) instagram = website;
          if (!facebook && cleanFacebook(website)) facebook = website;
          website = '';
        }
        const keys = [domainOf(website), nameKey(name)].filter(Boolean);
        if (keys.some((k) => seen.has(k))) continue;
        keys.forEach((k) => seen.add(k));
        merged.push({
          name,
          website,
          phone: str(b.phone),
          address: str(b.address),
          instagram,
          facebook,
          source_url: str(b.source_url),
          is_chain: b.is_chain === true,
          dedupe_key: domainOf(website) || nameKey(name),
        });
      }
    }
    if (failedSearches === focuses.length) throw new Error(firstError || 'The search failed.');

    const limited = merged.slice(0, MAX_RESULTS);
    const checks = await Promise.all(limited.map((b) => checkWebsite(b.website, b.name, location, left)));
    const businesses = limited.map((b, i) => {
      const { site_instagram, site_facebook, final_url, platform_url, ...check } = checks[i];
      const looksLikeChain = /\b\d{2,}\+?\s+locations\b/i.test(check.page_title);
      // Moved to a new address: keep the one that works, so the email and website match.
      // Their domain forwards to Linktree, Instagram...: that's a social link, not a website.
      const website = platform_url ? '' : final_url && domainOf(final_url) !== domainOf(b.website) ? new URL(final_url).origin : b.website;
      return {
        ...b,
        ...check,
        website,
        // Links found on their own website win over search results.
        instagram: site_instagram || cleanInstagram(b.instagram) || cleanInstagram(platform_url),
        facebook: site_facebook || cleanFacebook(b.facebook) || cleanFacebook(platform_url),
        is_chain: b.is_chain || looksLikeChain,
      };
    });

    // Independent businesses first, then ones with a working website.
    businesses.sort((a, b) => Number(a.is_chain) - Number(b.is_chain) || Number(b.website_checked) - Number(a.website_checked));

    return Response.json({ businesses, failed_searches: failedSearches, elapsed_ms: Date.now() - started });
  } catch (error) {
    return Response.json({ error: (error as Error)?.message || 'The search failed.', elapsed_ms: Date.now() - started }, { status: 500 });
  }
}
