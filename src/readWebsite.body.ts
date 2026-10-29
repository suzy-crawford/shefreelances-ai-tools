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
