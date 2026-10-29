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
