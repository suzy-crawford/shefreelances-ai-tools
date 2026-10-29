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
