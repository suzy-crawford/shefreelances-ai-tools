// ---- findEmail ----

const SEARCH_TIMEOUT = 30_000;

// Web search fallback: asks the built-in AI to search for the email and the current website.
// The email is then checked against the page it says it came from.
// deno-lint-ignore no-explicit-any
async function searchForContact(base44: any, name: string, location: string, website: string, ms: number) {
  const raw = await withTimeout(
    base44.asServiceRole.integrations.Core.InvokeLLM({
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
    }),
    ms,
    'The search took too long. Please try again.'
  );
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export default async function (req: Request) {
  const left = makeDeadline(50_000);
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    let website = normalizeUrl(body?.website);
    const name = str(body?.name).slice(0, 120);
    const location = str(body?.location).slice(0, 80);
    const needSocial = body?.needSocial === true;

    let social = { instagram: '', facebook: '' };
    // An Instagram or Facebook link on file is a social link, not their website.
    if (website && isPlatform(website)) {
      social = { instagram: cleanInstagram(website), facebook: cleanFacebook(website) };
      website = '';
    }

    // 1. Their own website: homepage, then Contact, About, and Privacy pages.
    let siteWorks = false;
    let onSite = { email: '', email_source: '' };
    let movedTo = '';
    if (website) {
      const page = await openTheirSite(website, name, location, left(8000));
      siteWorks = page.ok;
      if (page.platformUrl) {
        social = { instagram: social.instagram || cleanInstagram(page.platformUrl), facebook: social.facebook || cleanFacebook(page.platformUrl) };
      }
      if (page.ok) {
        // The site moved to a new address of theirs: report it so the lead gets the address that works.
        if (domainOf(page.finalUrl) !== domainOf(website)) movedTo = new URL(page.finalUrl).origin;
        const s = socialLinks(page.html);
        social = { instagram: s.instagram || social.instagram, facebook: s.facebook || social.facebook };
        onSite = await findEmailOnSite(page.finalUrl, page.html, left(6000));
        const socialDone = !needSocial || (social.instagram && social.facebook);
        if (onSite.email && socialDone) {
          return Response.json({ ...onSite, email_verified: true, website_works: true, new_website: movedTo, ...social });
        }
      }
    }

    if (!name) {
      return Response.json({ ...onSite, email_verified: !!onSite.email, website_works: siteWorks, new_website: movedTo, ...social });
    }

    // 2. Web search for whatever is still missing.
    // deno-lint-ignore no-explicit-any
    let found: any = {};
    try {
      if (left(SEARCH_TIMEOUT) < 3000) throw new Error('The search took too long. Please try again.');
      found = await searchForContact(base44, name, location, website, left(SEARCH_TIMEOUT));
    } catch (e) {
      // Keep what their own website gave us; only fail when there's nothing to show.
      if (onSite.email || social.instagram || social.facebook) {
        return Response.json({ ...onSite, email_verified: !!onSite.email, website_works: siteWorks, new_website: movedTo, ...social });
      }
      throw e;
    }
    const instagram = social.instagram || cleanInstagram(found.instagram);
    const facebook = social.facebook || cleanFacebook(found.facebook);

    // Email already found on their own website: only the social links were missing.
    if (onSite.email) {
      return Response.json({ ...onSite, email_verified: true, website_works: true, new_website: movedTo, instagram, facebook });
    }

    // Their website on file doesn't work: use the one the search found, if it loads and is really theirs.
    let newWebsite = '';
    const foundSite = normalizeUrl(found.website);
    if (!siteWorks && foundSite && !isPlatform(foundSite) && domainOf(foundSite) !== domainOf(website) && left(8000) >= 3000) {
      const check = await fetchHtml(foundSite, left(8000));
      if (check.ok && !isPlatform(check.finalUrl) && pageIsTheirs(check.html, name, location, check.finalUrl)) {
        newWebsite = new URL(check.finalUrl).origin;
        // The new website may list the email itself.
        const fromNew = await findEmailOnSite(check.finalUrl, check.html, left(6000));
        const s = socialLinks(check.html);
        if (fromNew.email) {
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
    const emailDomain = email.split('@')[1] || '';
    if (!email || !VALID_EMAIL.test(email) || JUNK_EMAIL.test(email) || NOT_THE_BUSINESS.test(email) || isPlatform('https://' + emailDomain)) {
      return Response.json({ email: '', email_source: '', email_verified: false, website_works: siteWorks || !!newWebsite, new_website: newWebsite || movedTo, instagram, facebook });
    }

    // Double-check: the email is on their own domain, or the page it came from really shows it.
    const sourceUrl = normalizeUrl(found.email_source_url);
    let verified = [domainOf(website), domainOf(newWebsite)].filter(Boolean).some((d) => email.endsWith('@' + d));
    if (!verified && sourceUrl && left(8000) >= 2000) {
      const source = await fetchHtml(sourceUrl, left(8000));
      verified = source.ok && emailsIn(source.html).includes(email) && pageIsTheirs(source.html, name, location, source.finalUrl);
    }

    return Response.json({
      email,
      email_source: sourceUrl,
      email_verified: verified,
      website_works: siteWorks || !!newWebsite,
      new_website: newWebsite || movedTo,
      instagram,
      facebook,
    });
  } catch (error) {
    return Response.json({ error: (error as Error)?.message || 'Something went wrong.' }, { status: 500 });
  }
}
