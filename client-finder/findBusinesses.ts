import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Client Finder: finds real local businesses with the built-in AI web search.
// Runs 3 searches at once, removes duplicates, flags chains, checks that every website
// actually loads (so made-up businesses are easy to spot), and looks for an email on the
// business's own website. An email is never guessed.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_RESULTS = 35;

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

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

function normalizeUrl(url: string) {
  const u = str(url);
  if (!u || /\s/.test(u)) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function domainOf(url: string) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function nameKey(name: string) {
  return str(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JUNK_EMAIL = /(example\.|sentry|wixpress|domain\.com|email\.com|yourname|@\d|\.(png|jpe?g|gif|webp|svg)$)/i;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: ',', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...' };
function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Only what a visitor can see: emails inside scripts (tracking pixels, plugins) are often
// the web designer's or a developer's, not the business's.
function emailsIn(html: string) {
  const visible = html.replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const fromMailto = [...visible.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => safeDecode(m[1]));
  // Business details the site publishes for Google (schema.org) are the business's own.
  const listing = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(' ');
  const fromText = decodeEntities(visible.replace(/<[^>]+>/g, ' ') + ' ' + listing).match(EMAIL_RE) || [];
  return [...new Set([...fromMailto, ...fromText].map((e) => e.trim().toLowerCase()))].filter(
    (e) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e)
  );
}

// Best first: a general inbox on their own domain, then any address on their own domain,
// then a free email account (many small businesses use one). An address on some other
// company's domain is only used when that domain clearly belongs to the same business,
// because it is usually the web designer's or a software vendor's.
const INBOX = /^(info|hello|hi|contact|office|admin|team|booking|bookings|book|appointments|reservations|frontdesk|reception|studio|support|sales|inquiries|enquiries|mail)@/;
const FREE_MAIL = /@(gmail|yahoo|outlook|hotmail|icloud|aol|live|msn|me|mac|proton|protonmail)\./;
const NOT_THE_BUSINESS = /^(dev|developer|webmaster|web|wordpress|wp|hosting|seo|design|designer|noreply|no-reply|donotreply|privacy|abuse|postmaster)@/;
function baseName(host: string) {
  const parts = host.split('.');
  return (parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2] || '').replace(/[^a-z0-9]/g, '');
}
function sameBusinessDomain(a: string, b: string) {
  const x = baseName(a), y = baseName(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  for (let i = 0; i + 6 <= x.length; i++) if (y.includes(x.slice(i, i + 6))) return true;
  return false;
}
function pickEmail(emails: string[], siteUrl: string) {
  const host = domainOf(siteUrl);
  const usable = emails.filter((e) => !NOT_THE_BUSINESS.test(e));
  const own = (e: string) => !!host && (e.endsWith('@' + host) || e.endsWith('.' + host));
  const related = (e: string) => !!host && sameBusinessDomain(e.split('@')[1], host);
  return (
    usable.find((e) => own(e) && INBOX.test(e)) ||
    usable.find(own) ||
    usable.find((e) => FREE_MAIL.test(e)) ||
    usable.find(related) ||
    ''
  );
}

// Pages that often list an email: contact, about, privacy policy.
function emailPageUrls(html: string, siteUrl: string) {
  const links = [...html.matchAll(/<a[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const urls: string[] = [];
  for (const pattern of [/contact/i, /about/i, /privacy/i]) {
    const hit = links.find((m) => pattern.test(m[1]) || pattern.test(m[2].replace(/<[^>]+>/g, '')));
    if (!hit) continue;
    try {
      const url = new URL(hit[1], siteUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      if (!urls.includes(url.toString())) urls.push(url.toString());
    } catch { /* ignore */ }
  }
  return urls;
}

// Profile links only: skips share buttons, tracking pixels, and links to single posts.
function cleanInstagram(url: string) {
  const m = str(url).match(/instagram\.com\/([A-Za-z0-9_.]+)\/?/i);
  if (!m || /^(p|reel|reels|explore|stories|accounts|share|tv)$/i.test(m[1])) return '';
  return `https://www.instagram.com/${m[1]}/`;
}

function cleanFacebook(url: string) {
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
  if (!m || /^(pages|sharer|sharer\.php|share|tr|plugins|dialog|login|events|groups|watch|hashtag|people|policies|privacy|help|business)$/i.test(m[1])) return '';
  return `https://www.facebook.com/${m[1]}`;
}

function socialLinks(html: string) {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  return {
    instagram: hrefs.map(cleanInstagram).find(Boolean) || '',
    facebook: hrefs.map(cleanFacebook).find(Boolean) || '',
  };
}

// The visible words on the page, for the outreach and analysis prompts.
function pageText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, (m) => decodeEntities(m))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500);
}

// Parked or placeholder domains load fine but aren't a real business website.
function looksParked(html: string) {
  if (html.length < 1500 && /location\.(href|replace)|http-equiv=["']refresh/i.test(html)) return true;
  return /(this domain (is|may be) for sale|buy this domain|domain parking|parked free|hugedomains|sedoparking|godaddy\.com\/domainsearch)/i.test(html);
}

async function fetchHtml(url: string, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': UA } });
    const html = res.ok ? (await res.text()).slice(0, 1_500_000) : '';
    return { ok: res.ok && !looksParked(html), html, finalUrl: res.url || url };
  } catch {
    return { ok: false, html: '', finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

// Looks for an email on the homepage, then the Contact, About, and Privacy pages. Never guesses.
async function findEmailOnSite(siteUrl: string, html: string) {
  const onHome = pickEmail(emailsIn(html), siteUrl);
  if (onHome) return { email: onHome, email_source: siteUrl };
  const pages = emailPageUrls(html, siteUrl);
  const results = await Promise.all(pages.map((u) => fetchHtml(u, 6000)));
  for (let i = 0; i < pages.length; i++) {
    const found = results[i].ok ? pickEmail(emailsIn(results[i].html), siteUrl) : '';
    if (found) return { email: found, email_source: pages[i] };
  }
  return { email: '', email_source: '' };
}

const EMPTY_CHECK = { website_checked: false, page_title: '', site_text: '', email: '', email_source: '', site_instagram: '', site_facebook: '' };

async function checkWebsite(url: string) {
  if (!url) return EMPTY_CHECK;
  try {
    const page = await fetchHtml(url);
    if (!page.ok) return EMPTY_CHECK;
    const social = socialLinks(page.html);
    const title = decodeEntities(page.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const found = await findEmailOnSite(page.finalUrl, page.html);
    return {
      website_checked: true,
      page_title: title,
      site_text: pageText(page.html),
      ...found,
      site_instagram: social.instagram,
      site_facebook: social.facebook,
    };
  } catch {
    return EMPTY_CHECK;
  }
}

export default async function (req) {
  const started = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const term = str(body?.businessType);
    const location = str(body?.location);
    const exclude = (Array.isArray(body?.exclude) ? body.exclude : []).map((n) => str(n).slice(0, 80)).filter(Boolean).slice(0, 60);
    if (!term || !location) return Response.json({ error: 'Business type and location are required.' }, { status: 400 });

    const focuses = [
      'independent, locally owned businesses',
      'businesses with strong customer reviews',
      'businesses in different neighborhoods and nearby suburbs',
    ];
    const runs = await Promise.allSettled(
      focuses.map((focus) =>
        base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: searchPrompt(focus, term, location, exclude),
          add_context_from_internet: true,
          response_json_schema: SCHEMA,
        })
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
        firstError = firstError || e?.message || 'The search failed.';
        continue;
      }
      for (const b of Array.isArray(data?.businesses) ? data.businesses : []) {
        const name = str(b?.name);
        if (!name) continue;
        const website = normalizeUrl(b.website);
        const keys = [domainOf(website), nameKey(name)].filter(Boolean);
        if (keys.some((k) => seen.has(k))) continue;
        keys.forEach((k) => seen.add(k));
        merged.push({
          name,
          website,
          phone: str(b.phone),
          address: str(b.address),
          instagram: str(b.instagram),
          facebook: str(b.facebook),
          source_url: str(b.source_url),
          is_chain: b.is_chain === true,
          dedupe_key: domainOf(website) || nameKey(name),
        });
      }
    }
    if (failedSearches === focuses.length) throw new Error(firstError || 'The search failed.');

    const limited = merged.slice(0, MAX_RESULTS);
    const checks = await Promise.all(limited.map((b) => checkWebsite(b.website)));
    const businesses = limited.map((b, i) => {
      const { site_instagram, site_facebook, ...check } = checks[i];
      const looksLikeChain = /\b\d{2,}\+?\s+locations\b/i.test(check.page_title);
      return {
        ...b,
        ...check,
        // Links found on their own website win over search results.
        instagram: site_instagram || cleanInstagram(b.instagram),
        facebook: site_facebook || cleanFacebook(b.facebook),
        is_chain: b.is_chain || looksLikeChain,
      };
    });

    // Independent businesses first, then ones with a working website.
    businesses.sort((a, b) => Number(a.is_chain) - Number(b.is_chain) || Number(b.website_checked) - Number(a.website_checked));

    return Response.json({ businesses, failed_searches: failedSearches, elapsed_ms: Date.now() - started });
  } catch (error) {
    return Response.json({ error: error?.message || 'The search failed.', elapsed_ms: Date.now() - started }, { status: 500 });
  }
}
