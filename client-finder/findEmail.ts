import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Client Finder: finds a business's contact info (email, Instagram, Facebook Page).
// First on its own website (homepage, Contact, About, Privacy pages), then with a web search
// that is double-checked against the source page. Never guesses an email.
// Also finds the right website when the one on file doesn't work.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JUNK_EMAIL = /(example\.|sentry|wixpress|domain\.com|email\.com|yourname|@\d|\.(png|jpe?g|gif|webp|svg)$)/i;
const VALID_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

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
    (e) => VALID_EMAIL.test(e) && !JUNK_EMAIL.test(e)
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

// Web search fallback: asks the built-in AI to search for the email and the current website.
// The email is then checked against the page it says it came from.
async function searchForContact(base44, name: string, location: string, website: string) {
  const raw = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: [
      `Find the contact email address and the official website for this business:`,
      `Business: ${name}`,
      `Location: ${location || 'unknown'}`,
      website ? `Website on file (may be wrong or out of date): ${website}` : `No website on file.`,
      `Return: email (the business's contact email, or empty string), email_source_url (the exact web page where that email appears, or empty string), website (their current official website, full URL, or empty string), instagram (their Instagram profile URL, or empty string), facebook (their Facebook Page URL, or empty string).`,
      `Only return an email you actually saw on a web page. Never guess or build one from the domain name.`,
    ].join('\n'),
    add_context_from_internet: true,
    response_json_schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        email_source_url: { type: 'string' },
        website: { type: 'string' },
        instagram: { type: 'string' },
        facebook: { type: 'string' },
      },
      required: ['email', 'email_source_url', 'website', 'instagram', 'facebook'],
    },
  });
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const website = normalizeUrl(body?.website);
    const name = str(body?.name);
    const location = str(body?.location);
    const needSocial = body?.needSocial === true;

    // 1. Their own website: homepage, then Contact, About, and Privacy pages.
    let siteWorks = false;
    let social = { instagram: '', facebook: '' };
    let onSite = { email: '', email_source: '' };
    if (website) {
      const page = await fetchHtml(website);
      siteWorks = page.ok;
      if (page.ok) {
        social = socialLinks(page.html);
        onSite = await findEmailOnSite(page.finalUrl, page.html);
        const socialDone = !needSocial || (social.instagram && social.facebook);
        if (onSite.email && socialDone) {
          return Response.json({ ...onSite, email_verified: true, website_works: true, new_website: '', ...social });
        }
      }
    }

    if (!name) {
      return Response.json({ ...onSite, email_verified: !!onSite.email, website_works: siteWorks, new_website: '', ...social });
    }

    // 2. Web search for whatever is still missing.
    const found = await searchForContact(base44, name, location, website);
    const instagram = social.instagram || cleanInstagram(found.instagram);
    const facebook = social.facebook || cleanFacebook(found.facebook);

    // Email already found on their own website: only the social links were missing.
    if (onSite.email) {
      return Response.json({ ...onSite, email_verified: true, website_works: true, new_website: '', instagram, facebook });
    }

    // Their website on file doesn't work: use the one the search found, if it loads.
    let newWebsite = '';
    const foundSite = normalizeUrl(found.website);
    if (!siteWorks && foundSite && domainOf(foundSite) !== domainOf(website)) {
      const check = await fetchHtml(foundSite);
      if (check.ok) {
        newWebsite = check.finalUrl;
        // The new website may list the email itself.
        const fromNew = await findEmailOnSite(check.finalUrl, check.html);
        if (fromNew.email) {
          const s = socialLinks(check.html);
          return Response.json({
            ...fromNew,
            email_verified: true,
            website_works: true,
            new_website: newWebsite,
            instagram: instagram || s.instagram,
            facebook: facebook || s.facebook,
          });
        }
      }
    }

    const email = str(found.email).toLowerCase();
    if (!email || !VALID_EMAIL.test(email) || JUNK_EMAIL.test(email) || NOT_THE_BUSINESS.test(email)) {
      return Response.json({ email: '', email_source: '', email_verified: false, website_works: siteWorks || !!newWebsite, new_website: newWebsite, instagram, facebook });
    }

    // Double-check: the email is on their own domain, or the page it came from really shows it.
    const sourceUrl = normalizeUrl(found.email_source_url);
    let verified = [domainOf(website), domainOf(newWebsite)].filter(Boolean).some((d) => email.endsWith('@' + d));
    if (!verified && sourceUrl) {
      const source = await fetchHtml(sourceUrl, 8000);
      verified = source.ok && emailsIn(source.html).includes(email);
    }

    return Response.json({
      email,
      email_source: sourceUrl,
      email_verified: verified,
      website_works: siteWorks || !!newWebsite,
      new_website: newWebsite,
      instagram,
      facebook,
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Something went wrong.' }, { status: 500 });
  }
}
