import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Meta Ads Builder: reads a business's own website for "Fill it in for me". No AI here.
// Returns the page text (plus up to 2 services, menu or pricing pages on the same site), the title,
// button wording, social links and brand colors. Won't read social, links or booking pages, parked or
// placeholder domains, or a domain that forwards to a different business.

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

function pageTitle(html: string) {
  return decodeEntities(html.match(/<title[^>]*>([^<]{0,500})<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

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

// ---- readWebsite ----

const CTA_WORDS = /\b(book\w*|schedul\w*|call|contact|consult\w*|buy|shop|get started|appointments?|reserv\w*|quotes?|estimates?|sign up|join|order\w*)\b/i;
const PAGE_WORDS = /(service|treatment|menu|pricing|prices|price list|specials|offers|packages|what we do|procedures)/i;

function fullText(html: string, max: number) {
  return decodeEntities(stripBlocks(html, ['script', 'style', 'noscript', 'svg', 'template', '!--']).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Default colors that come with website builders, plugins and cookie banners, not the brand.
const DEFAULT_COLORS = new Set(['#116dff', '#1863dc', '#0693e3', '#abb8c3', '#f78da7', '#cf2e2e', '#ff6900', '#fcb900', '#7bdcb5', '#00d084', '#8ed1fc', '#9b51e0', '#32373c', '#0073aa', '#2271b1', '#007cba', '#003388', '#003399', '#1a73e8', '#4285f4']);
const isNeutral = (h: string) => {
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 24; // black, white and grays
};

// When a site forwards to a different domain, every distinctive word of the business name must be on the new
// site (stricter than a single word, so "Boise Dental Arts" doesn't match "Boise Family Dental Care").
function forwardIsTheirs(html: string, url: string, name: string, location: string) {
  const words = nameWords(name, location);
  if (!words.length) return pageIsTheirs(html, name, location, url);
  const text = plain(decodeEntities(stripBlocks(html.slice(0, 400_000), ['script', 'style', 'noscript', 'svg', 'template', '!--']).replace(/<[^>]*>/g, ' '))) + ' ' + domainOf(url).replace(/[^a-z0-9]/g, ' ');
  return words.every((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(text) || domainOf(url).replace(/[^a-z0-9]/g, '').includes(w));
}

// Brand colors: the theme color plus the most-used non-neutral hex colors in the page's styles.
function brandColors(html: string) {
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]*content=["'](#[0-9a-f]{3,6})["']/i)?.[1] || '';
  const counts: Record<string, number> = {};
  for (const m of html.slice(0, 1_500_000).matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (Math.max(r, g, b) - Math.min(r, g, b) < 24 || DEFAULT_COLORS.has('#' + h)) continue; // skip neutrals and defaults
    counts['#' + h] = (counts['#' + h] || 0) + 1;
  }
  let t = theme.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(t)) t = '#' + t.slice(1).split('').map((x) => x + x).join('');
  if (!/^#[0-9a-f]{6}$/.test(t) || isNeutral(t) || DEFAULT_COLORS.has(t)) t = '';
  return [...new Set([t, ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([h]) => h)].filter(Boolean))].slice(0, 4);
}

// Website builders' own homepages (a member's site on them, like name.squarespace.com, is fine).
const BUILDER_HOMES = new Set(['wix.com', 'squarespace.com', 'godaddy.com', 'wordpress.com', 'wordpress.org', 'weebly.com', 'shopify.com', 'webflow.com', 'duda.co', 'showit.com', 'framer.com', 'base44.com', 'carrd.co', 'google.com']);

const FAIL: Record<string, string> = {
  none: "That address isn't their own website (it goes to a social, links or booking page).",
  blocked: 'Their website blocked our check. Open it yourself and fill in the answers below.',
  down: "Their website didn't load.",
  other: 'That address forwards to what looks like a different business.',
  notTheirs: "That website doesn't seem to mention this business. Check the address, or fill in the answers below yourself.",
  timeout: 'Their website took too long to load.',
};

export default async function (req: Request) {
  const left = makeDeadline(40_000);
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const url = normalizeUrl(body?.url);
    const name = str(body?.name).slice(0, 120);
    const location = str(body?.location).slice(0, 80);
    if (!url) return Response.json({ ok: false, error: 'No website on file.' });
    if (isPlatform(url) || BUILDER_HOMES.has(domainOf(url))) return Response.json({ ok: false, error: FAIL.none });

    const started = Date.now();
    // With a business name we can also make sure a redirect didn't land on another business.
    const page = name ? await openTheirSite(url, name, location, left(10000)) : { ...(await fetchHtml(url, left(10000))), platformUrl: '', otherUrl: '' };
    if (!page.ok) {
      if (page.platformUrl) return Response.json({ ok: false, error: FAIL.none });
      if (page.otherUrl) return Response.json({ ok: false, error: FAIL.other });
      if (page.status === 'blocked') return Response.json({ ok: false, error: FAIL.blocked });
      return Response.json({ ok: false, error: Date.now() - started >= 9500 ? FAIL.timeout : FAIL.down });
    }
    if (isPlatform(page.finalUrl)) return Response.json({ ok: false, error: FAIL.none });
    if (BUILDER_HOMES.has(domainOf(page.finalUrl))) return Response.json({ ok: false, error: FAIL.none });
    // With a business name: the page has to be theirs (stricter when the address forwarded to another domain).
    if (name) {
      const moved = domainOf(page.finalUrl) !== domainOf(url);
      if (moved ? !forwardIsTheirs(page.html, page.finalUrl, name, location) : !pageIsTheirs(page.html, name, location, page.finalUrl)) {
        return Response.json({ ok: false, error: moved ? FAIL.other : FAIL.notTheirs });
      }
    }

    const html = page.html;
    const finalUrl = page.finalUrl;
    const links = [...html.matchAll(/<a\s[^>]*href=["']([^"']{1,500})["'][^>]*>([^]{0,400}?)<\/a>/gi)].map((m) => ({
      href: m[1],
      text: fullText(m[2], 80),
    }));
    const cta_links = [...new Set(links.filter((l) => l.text && l.text.length <= 40 && CTA_WORDS.test(l.text)).map((l) => l.text))].slice(0, 15);
    const social = socialLinks(html);
    let text = fullText(html, 9000);

    // Also read up to 2 services, menu or pricing pages on their own site.
    const host = domainOf(finalUrl);
    const seen = new Set([new URL(finalUrl).pathname.replace(/\/+$/, '')]);
    const pages: string[] = [];
    for (const l of links) {
      if (pages.length >= 2) break;
      if (!PAGE_WORDS.test(`${l.text} ${l.href}`)) continue;
      let u: URL;
      try {
        u = new URL(l.href, finalUrl);
      } catch {
        continue;
      }
      const path = u.pathname.replace(/\/+$/, '');
      if (!/^https?:$/.test(u.protocol) || domainOf(u.toString()) !== host || seen.has(path) || /\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(path)) continue;
      seen.add(path);
      pages.push(u.toString());
    }
    if (pages.length && left(6000) >= 2000) {
      const extra = await Promise.all(pages.map((p) => fetchHtml(p, left(6000))));
      extra.forEach((r, i) => {
        if (r.ok) text += `\n\n[PAGE: ${pages[i]}]\n` + fullText(r.html, 5000);
      });
    }

    // Almost nothing readable: the site builds its page with code we can't run.
    if (text.replace(/\[PAGE: [^\]]*\]/g, '').replace(/\s+/g, ' ').trim().length < 300) {
      return Response.json({ ok: false, error: "Their website builds its page in a way we can't read. Fill in the answers below yourself." });
    }

    return Response.json({
      ok: true,
      url: finalUrl,
      title: pageTitle(html),
      meta_description: decodeEntities(html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,500})["']/i)?.[1] || '').replace(/\s+/g, ' ').trim(),
      cta_links,
      social_links: [social.instagram, social.facebook].filter(Boolean),
      colors: brandColors(html),
      text,
    });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error)?.message || "Their website didn't load." }, { status: 500 });
  }
}
