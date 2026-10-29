import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Meta Ads Builder, part 2: editing and what happens after the click, with their exact AI instructions and rules.
// task "rewrite": one piece of an ad. "more": the "make more versions" prompt. "form": the Instant Form.
// "page": landing page copy plus the Base44 prompt to build it. "pagebuild": that prompt again after edits.


const str = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u2013\u2014]/g, '-').trim() : '';

const plain = (s: unknown) => str(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function makeDeadline(totalMs: number) {
  const end = Date.now() + totalMs;
  return (want: number) => Math.max(0, Math.min(want, end - Date.now() - 500));
}

const AI_TIMEOUT = 75_000;
const TYPES = ['local', 'health_beauty', 'ecommerce', 'coaching', 'professional', 'other'];
const GOALS = ['leads', 'appointments', 'purchases', 'help'];

const HEALTH = /(med ?spa|aesthetic (clinic|medicine|center|studio|nurse|treatments?)|iv (hydration|infusion)|vitamin (injections?|shots?)|\bb12\b|neurotoxin|chemical peel|lip (filler|enhancement)|\baesthetics\b|medical aesthetic|aesthetician|esthetician|botox|\btox\b|dysport|filler|injectabl|injector|laser (hair|skin|treat|resurfac|facial|lipo)|dental|dentist|orthodont|invisalign|\bteeth\b|medical clinic|health clinic|wellness clinic|chiropract|physical therap|massage therap|wellness (center|clinic|spa)|medical wellness|weight loss|semaglutide|ozempic|wegovy|tirzepatide|mounjaro|\bglp|peptide|iv drip|iv therapy|hormone|testosterone|\btrt\b|dermatolog|skin ?care|facials?\b|hydrafacial|microneedl|body sculpt|coolsculpt|hair loss|hair restoration|medical spa|physician|\bnurses?\b|plastic surg|cosmetic surg|acupunct|\bmassage\b)/i;
const RX_DRUGS = /(semaglutide|ozempic|wegovy|tirzepatide|mounjaro|zepbound|\bglp-?1|botox|dysport|xeomin|jeuveau|daxxify|juvederm|restylane|sculptra|radiesse|kybella|testosterone|\btrt\b|phentermine)/i;
const WEIGHT_LOSS = /(weight ?loss|lose weight|semaglutide|ozempic|wegovy|tirzepatide|mounjaro|zepbound|\bglp|phentermine|fat loss|slim)/i;
const SPECIAL = /\b(loans?|mortgages?|credit (cards?|repair|scores?|union)|lending|lenders?|realtors?|realty|(homes?|(?<!bounce )houses?|condos?) for (sale|rent)|apartments? for rent|rental listings?|real estate (agents?|agency|listings?|brokerage|team|group|services|company)|buy(ing)? and sell(ing)? homes|property management|financial advis\w*|insurance agen\w*|auto financ\w*|now hiring|we're hiring|job openings?|careers)\b/i;
const SERVICE_SHOP = /\b(auto|body shop|repair|barber\w*|tattoo|print shop|machine shop|workshop|detailing|tailor)\b/i;
const WALK_IN = /\b(cafe|caf\u00e9|coffee|espresso|eatery|restaurant|bakery|bagels?|pizzeria|pizza|diner|bistro|brewery|pub|taproom|taqueria|tacos?|bbq|barbecue|burgers?|grill|food truck|ice cream|donuts?|deli|tea (house|shop)|boba|juice|smoothies?|(wine|juice|coffee|sports|cocktail) bar|bar (&|and) grill|boutique|florist|bookstore|gift shop|thrift|(shop|store|market))\b/i;

const raw = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const fixDashes = (v: string) => {
  const kept: string[] = [];
  const hold = (m: string) => `\u0000${kept.push(m) - 1}\u0000`;
  const out = v
    .replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[-.]\d{4}\b|\b\d{3}[-.]\d{4}\b|\b24\s*[-\u2013/]\s*7\b/g, hold)
    .replace(/(?<![\d\-\u2013\u2014])(\$?\d{1,4}(?:[ap]\.?m\.?)?)\s*[\u2013\u2014-]\s*(\$?\d{1,4}(?:[ap]\.?m\.?)?)(?![\d\-\u2013\u2014])/gi, '$1 to $2')
    .replace(/(\p{L})\s*\u2013\s*(\p{L})/gu, '$1 to $2')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/([^\s\d]) - ([^\s\d])/g, '$1, $2');
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)]);
};
const name = (v: unknown, max = 120) => raw(v).replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim().slice(0, max);
const url = (v: unknown, max = 300) => raw(v).trim().slice(0, max);
const SENSITIVE = /\b(health|medical (condition|history)|health condition|symptoms?|medications?|diagnos\w*|pregnan\w*|insurance|insured|income|salary|credit score|your age|how old are you|date of birth|birthday|religio\w*|ethnic\w*|sexual\w*|criminal|disabilit\w*)\b/i;
const HEALTH_Q = /\b(pain|hurt\w*|weight|pounds|skin concerns?|concerns?|conditions?|wrinkles?|acne|scars?|bleeding|gums|cavit\w*|treat(ed|ments?) before|problem areas?|bod(y|ies)|fat)\b/i;
const s = (v: unknown, max = 600) => fixDashes(raw(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const BOASTS = /(\bbest\b|most trusted|top[- ]rated|#1\b|number one|\bleading\b|industry[- ]leading|\bfavou?rite\b|\bpermanent|painless|pain[- ]free|no downtime|guarantee|lasts? (a lifetime|forever|\d+ years)|double the life)/i;
const noBoasts = (v: string) => v.split(/(?<=[.!?;])\s+/).filter((x) => !BOASTS.test(x)).join(' ').trim();
const list = (v: unknown, max = 8) => (Array.isArray(v) ? v : raw(v).split(/\n|;|,(?=\s)/)).map((x) => s(x, 200)).filter(Boolean).slice(0, max);
const NP = 'Not provided';
const or = (v: string) => v || NP;

// deno-lint-ignore no-explicit-any
function readCampaign(c: any) {
  return {
    business_name: name(c?.business_name, 120),
    website: url(c?.website, 200),
    location: s(c?.location, 120),
    business_type: TYPES.includes(str(c?.business_type)) ? str(c?.business_type) : '',
    business_description: s(c?.business_description, 600),
    product: s(c?.product, 200),
    services: list(c?.services),
    offer_text: s(c?.offer_text, 300),
    offer_help: c?.offer_help === true,
    goal: GOALS.includes(str(c?.goal)) ? str(c?.goal) : '',
    daily_budget: Math.max(1, Math.min(10000, Math.round(Number(raw(c?.daily_budget).replace(/[^0-9.]/g, '')) || 20))),
    radius_miles: Math.max(1, Math.min(50, Math.round(Number(raw(c?.radius_miles).replace(/[^0-9.]/g, '')) || 10))),
    area_type: ['region', 'country'].includes(str(c?.area_type)) ? str(c?.area_type) : 'radius',
    target_area: s(c?.target_area, 120),
    target_customer: s(c?.target_customer, 200),
    differentiators: noBoasts(s(c?.differentiators, 600)),
    proof_text: noBoasts(s(c?.proof_text, 600)),
    credentials_text: s(c?.credentials_text, 400),
    brand_colors: Array.isArray(c?.brand_colors) ? c.brand_colors.map((x: unknown) => s(x, 20)).join(', ') : s(c?.brand_colors, 120),
    brand_style: s(c?.brand_style, 200),
    assets_text: s(c?.assets_text, 400),
    site_details: list(c?.site_details, 6).map((x) => s(x, 200)),
    no_emojis: c?.no_emojis === true,
    funnel_type: ['instant_form', 'landing_page'].includes(str(c?.funnel_type)) ? str(c?.funnel_type) : '',
    cta_url: url(c?.cta_url, 300),
  };
}
type Campaign = ReturnType<typeof readCampaign>;

function today() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
}

function makePlan(c: Campaign) {
  const text = [c.business_name, c.business_type, c.business_description, c.product, c.services.join(' '), c.offer_text].join(' ');
  const health = c.business_type === 'health_beauty' || HEALTH.test(text) || RX_DRUGS.test(text);
  const walkIn = !['health_beauty', 'professional', 'coaching'].includes(c.business_type) && !health && WALK_IN.test(text) && !SERVICE_SHOP.test(text);
  const goal = c.goal === 'help' || !c.goal ? (c.business_type === 'ecommerce' ? 'purchases' : health ? 'appointments' : 'leads') : c.goal;
  const purchases = goal === 'purchases';
  const destination = purchases ? 'website' : c.funnel_type === 'landing_page' ? 'landing_page' : 'instant_form';
  const special = SPECIAL.test(text);
  const radius = special ? Math.max(15, c.radius_miles) : c.radius_miles;
  const wide = c.area_type !== 'radius';
  const area_label = c.area_type === 'country' ? `All of ${c.target_area || '[country]'}`
    : c.area_type === 'region' ? `All of ${c.target_area || '[state or region]'}`
    : `${c.location || '[city]'} + ${radius} miles`;
  const notes: string[] = [];
  if (purchases) notes.push('Sales campaigns need the Meta pixel on their website tracking purchases. Check this before launching.');
  if (destination === 'landing_page') notes.push('A landing page needs the Meta pixel sending a Lead event when the form is sent. If that is not set up, use an Instant Form instead.');
  if (health && destination !== 'website') notes.push('Meta limits how health and wellness businesses can track website actions. Instant Forms avoid most of these limits.');
  if (walkIn && !c.offer_text && destination === 'instant_form') notes.push("Lead ads need a reason to leave a name and number. For a cafe, restaurant or shop, add an offer people can claim (like a free item with their first order), or don't run this campaign.");
  if (special) notes.push(wide ? 'This may fall under a Meta special ad category (credit, housing or jobs). Meta will ask you to declare it.' : 'This may fall under a Meta special ad category (credit, housing or jobs). Meta will ask you to declare it, and the area must be at least 15 miles.');
  if (wide && c.business_type !== 'ecommerce' && (walkIn || health || ['local', 'health_beauty'].includes(c.business_type))) notes.push("A whole state or country is for businesses that serve or ship everywhere. If customers have to come to them or they travel to customers, use miles around the city so the budget isn't spent on people who can't buy.");
  const budget = c.daily_budget;
  const budget_note = budget < 10
    ? 'Under $10 a day, Meta has very little data to learn from. Results will be slow and noisy.'
    : budget < 25
    ? 'This is a small test budget. Keep it in one ad set so Meta learns faster.'
    : 'One campaign, one ad set, a few ads competing inside it.';
  const rules = [
    'No fake reviews, results, testimonials, credentials or scarcity.',
    'No guarantees ("guaranteed results", "lose 20 pounds").',
    'Never describe the viewer: no age, gender, body, health, money or fears ("Are you overweight?", "Nervous about the dentist?", "women in their 30s"). Meta rejects these.',
    'The ad and the form or page after the click must say the same thing.',
  ];
  if (health) {
    rules.push(
      "Don't name prescription drugs or brand-name injectables in the ad or image (Botox, Dysport, Juvederm, semaglutide, Ozempic, tirzepatide). Say \"wrinkle relaxer\", \"filler\" or \"medical weight loss program\". Meta only allows prescription drug ads from certified advertisers.",
      'Before and after photos: never for weight loss. For cosmetic treatments, only the business\'s own real results with the client\'s written permission.',
      'No promises about how someone will look ("Look 10 years younger").',
      'Lead with the offer and the experience, with confident, warm language.',
      'Only quote reviews about the staff or the experience, never reviews that describe results.',
      'Use real photos of the space and the team where possible. Never describe a person for an AI to generate.',
    );
    if (WEIGHT_LOSS.test(text)) rules.push('For weight loss: no body, scale, tape measure or before and after imagery, and no pounds or sizes.');
  }
  if (RX_DRUGS.test(text)) notes.push('They offer prescription treatments. Advertising those needs Meta certification (LegitScript), so advertise the consultation or the experience instead.');
  return {
    goal,
    health,
    walk_in: walkIn,
    special,
    objective: purchases ? 'Sales' : 'Leads',
    optimization: purchases ? 'Purchases' : 'Leads',
    destination,
    destination_label: destination === 'instant_form' ? 'Instant Form' : destination === 'landing_page' ? 'Landing page' : 'Website',
    structure: '1 campaign, 1 ad set, Advantage campaign budget, Advantage+ placements',
    audience: `Broad: people in ${area_label}, no interests or lookalikes`,
    area_type: c.area_type,
    area_label,
    radius_miles: radius,
    daily_budget: budget,
    ads_to_run: budget < 25 ? 2 : 3,
    budget_note,
    notes,
    rules,
  };
}
type Plan = ReturnType<typeof makePlan>;

function afterClick(plan: Plan, c: Campaign) {
  if (plan.destination === 'instant_form' && plan.walk_in) {
    return "An Instant Form inside Facebook or Instagram that asks for their name and phone. People don't book this business, so the form claims the offer: say what they get and how to use it (\"Leave your name and show the text at the counter\"). Never say \"we'll call to find a time\", \"book online\" or \"visit our site\".";
  }
  if (plan.destination === 'instant_form') {
    return "An Instant Form inside Facebook or Instagram that asks for their name, phone and email. The business then contacts them. Match this exactly: say what they leave and what happens next (\"Leave your number and we'll call to find a time\"). Never say \"pick your time\", \"book online\", \"see the menu\" or \"visit our site\".";
  }
  if (plan.destination === 'landing_page') {
    return `A landing page${c.cta_url ? ` (${c.cta_url})` : ''} built for this offer, with a short form. Match it: say what they'll find and what to do there.`;
  }
  return `Their website${c.website ? ` (${c.website})` : ''}, where they can buy. Match it: send them to shop or buy, not to fill out a form.`;
}

const NO_DASHES = 'No em dashes or en dashes anywhere.';
const VOICE = 'Write like the business owner explaining to one customer what they genuinely think, in calm, plain, spoken language with contractions, not like a copywriter.';
const FACTS_RULE = 'Anything about how the business works (for example hours, insurance, sessions, downtime, free estimates, kids, same-day, financing, warranties, response times; this includes any step of a visit or a job) must come from the answers above, or be left out, or be a [placeholder in square brackets]. At most 2 placeholders per ad, in primary text only, and never for reviews, ratings, results or customer counts. Headlines, descriptions and the text on the image never contain [brackets]: if one would need a blank, use a different structure.';
const PROOF_RULE = 'Verified proof means only the Proof and Credentials answers. Never use these words anywhere, whichever answer they come from: best, most trusted, top-rated, #1, leading, industry-leading, favorite, permanent, painless, pain-free, no downtime, guaranteed, or any promise of how long something lasts. If there is no verified proof, use the Process / what to expect angle instead of Trust. In Process, describe only steps given in the answers, plus the form step itself (they leave their details and the business gets in touch); anything else is a [placeholder] or left out.';
const URGENCY_RULE = 'Never say limited time, right now, ends soon, spots filling up, last chance or today only unless the offer gives a real end date. If the offer itself says limited time but gives no end date, leave those words out. Keep "up to", "from", "starting at" and every condition on the offer word for word. No fear hooks about storms, damage, decay, disease or getting worse.';
const VIEWER_RULE = 'Use the target customer only to choose angles. Never describe the viewer: no age, gender, body, health, fears or money. No questions about the viewer anywhere, including headlines and the text on the image. Talk about the service and what happens.';

function campaignBlock(c: Campaign, plan: Plan, forAds = false) {
  return [
    `Business: ${or(c.business_name)}`,
    `Type: ${or(c.business_type)}`,
    `Location: ${or(c.location)}`,
    c.area_type === 'radius' ? `Ads shown to: people near ${or(c.location)}` : `Ads shown to: people across ${c.target_area || 'a wide area'}. Don't write the ads as if everyone is near one city.`,
    `Website: ${or(c.website)}`,
    `What they do: ${or(c.business_description)}`,
    `Promoting: ${or(c.product)}`,
    `Services: ${or(c.services.join(', '))}`,
    c.offer_text
      ? `Offer: ${c.offer_text}`
      : c.offer_help && forAds
      ? 'Offer: not decided. Suggest one simple offer this business could run, with [blanks] for anything the owner must set, like "New patient exam and cleaning for [price]", and put it in suggested_offer only. Never mention the suggested offer in the ads: write all 3 about the service so they work without it, never state a price, percent, freebie or deadline that is not in these answers, and don\'t use the Direct offer angle.'
      : `Offer: none yet. Don't invent one; promote the service itself.`,
    `Goal: ${plan.goal}`,
    `After the click: ${plan.destination_label}`,
    `Target customer (only to choose angles, never to describe the viewer): ${or(c.target_customer)}`,
    `What makes them different: ${or(c.differentiators)}`,
    `Proof (verified, real only): ${or(c.proof_text)}`,
    `Credentials: ${or(c.credentials_text)}`,
    `Facts from their website: ${or(c.site_details.join('; '))}`,
    `Brand colors: ${or(c.brand_colors)}`,
    `Brand style: ${or(c.brand_style)}`,
    `Photos or videos they have: ${or(c.assets_text)}`,
  ].join('\n');
}

function emojiRule(c: Campaign) {
  return c.no_emojis ? 'No emojis anywhere.' : 'At most 1 or 2 emojis in the primary text, none in headlines.';
}

function imageRules(plan: Plan, c: Campaign, video = false) {
  const parts = [
    video
      ? 'This is the first frame of a vertical video: no text, logos or buttons on it. Photorealistic.'
      : 'If I uploaded a logo or website screenshot, use it for the brand style. Keep text readable on mobile. Create this as one finished 4:5 ad image, ready to upload to Meta, with all the text spelled exactly as written. No button shapes.',
    'Do not invent ratings, results, prices, urgency, guarantees, badges, award ribbons or credentials.',
    c.assets_text
      ? 'If you use my real photos, keep the people in them exactly as they are. Never add, change or generate a person.'
      : 'Show no people, faces or bodies: show the room, the equipment, the product, the food, the finished work or hands at work. Replace with a real photo of the business if you have one.',
  ];
  if (plan.health) parts.push('No before and after images, no bodies, scales or close-ups of skin, teeth or problem areas, and no one presented as a real client or patient.');
  return parts.join(' ');
}

const keepParas = (v: unknown, max: number) => fixDashes(raw(v)).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
function adText(ad: any) {
  // deno-lint-ignore no-explicit-any
  const a: any = ad || {};
  return [
    `Concept: ${s(a.name, 120)} (${s(a.angle, 80)})`,
    `Primary text: ${keepParas(a.primary || a.primary_short, 1500)}`,
    `Headline: ${s(a.headline || (a.headlines || [])[0], 120)}`,
    `Text on image: ${s(a.overlay, 120)}`,
    `Button: ${s(a.cta, 40)}`,
  ].join('\n');
}

function formPrompt(c: Campaign, plan: Plan, ad: unknown) {
  return `You are an expert Meta lead ads strategist. Write the Meta Instant Form that follows the ad below, for a local business.
${campaignBlock(c, plan)}

THE AD:
${adText(ad)}

WHERE THE CLICK GOES: ${afterClick(plan, c)}

Message match: the form headline continues the exact offer and promise from the ad. Keep it short. Ask only what the business needs to follow up. One or two qualifying questions at most, multiple choice where possible. Questions can ask what they want, when, and how to reach them. Never ask about health, symptoms, pain, medications, body, insurance, income or age.
If the business hasn't said how fast it calls back, write "[when we'll call]". privacy_note starts with "[link to their privacy policy]". Never invent prices, ratings, guarantees, policies, coupons, texts, saved offers or urgency. ${URGENCY_RULE} cta (the thank-you button): View Website or Call Business. Plain, warm language. ${NO_DASHES}
AD RULES:
${plan.rules.map((r) => '- ' + r).join('\n')}
Return JSON: form_headline (under 60 characters), intro, questions ({question, options}), contact_fields, privacy_note, thank_you_headline, thank_you_text (what happens next), cta, follow_up.`;
}
const FORM_SCHEMA = {
  type: 'object',
  properties: {
    form_headline: { type: 'string' }, intro: { type: 'string' },
    questions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question', 'options'] } },
    contact_fields: { type: 'array', items: { type: 'string' } }, privacy_note: { type: 'string' },
    thank_you_headline: { type: 'string' }, thank_you_text: { type: 'string' }, cta: { type: 'string' }, follow_up: { type: 'string' },
  },
  required: ['form_headline', 'intro', 'questions', 'contact_fields', 'privacy_note', 'thank_you_headline', 'thank_you_text', 'cta', 'follow_up'],
};

function pagePrompt(c: Campaign, plan: Plan, ad: unknown) {
  return `You are an expert direct-response landing page strategist and conversion copywriter. Write a single-page funnel that continues the exact promise made in the ad and moves the visitor toward one clear action.
${campaignBlock(c, plan)}

THE AD:
${adText(ad)}

Message match is non-negotiable. One page, one action. Choose the page type: Lead generation, Direct offer or High-ticket consultation. The hero says what this is, why care, what to do. Explain the real offer clearly. Benefits in customer language, no vague headings. Proof items come only from the Proof and Credentials answers; if there are none, write What You Can Expect points. ${PROOF_RULE} Never invent ratings, quotes, client counts, awards, scarcity or guarantees. Process: 3 steps, including what happens after the form. Answer the 3 to 5 biggest objections as FAQs; if an answer isn't in the information above, write it as a [placeholder for the owner], and never invent policies. The shortest form that still lets them follow up; never ask about health, insurance, income or age. ${NO_DASHES}
AD RULES:
${plan.rules.map((r) => '- ' + r).join('\n')}
Return JSON: page_type, headline, subheadline, cta, offer, benefits (3, "Title: one sentence"), proof, process, faqs ({q, a}), form_fields.`;
}
const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    page_type: { type: 'string' }, headline: { type: 'string' }, subheadline: { type: 'string' }, cta: { type: 'string' }, offer: { type: 'string' },
    benefits: { type: 'array', items: { type: 'string' } }, proof: { type: 'array', items: { type: 'string' } }, process: { type: 'array', items: { type: 'string' } },
    faqs: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] } },
    form_fields: { type: 'array', items: { type: 'string' } },
  },
  required: ['page_type', 'headline', 'subheadline', 'cta', 'offer', 'benefits', 'proof', 'process', 'faqs', 'form_fields'],
};

const LIMITS: Record<string, string> = {
  headline: 'under 40 characters',
  description: 'under 30 characters',
  overlay: '8 words or fewer',
  primary: 'short paragraphs, hook first, call to action last',
  video: 'spoken words for a short vertical video, plain and natural',
};
const STYLES: Record<string, string> = {
  shorter: 'Make it shorter.',
  punchier: 'Make it punchier and more direct.',
  warmer: 'Make it warmer and friendlier.',
  clearer: 'Make the next step clearer and more direct. Never add limited, filling up, last chance, today only or don\'t wait unless the offer has a real end date.',
};

function rewritePrompt(c: Campaign, plan: Plan, ad: unknown, field: string, text: string, style: string, how: string) {
  const kind = field.startsWith('headline') ? 'headline' : field.startsWith('description') ? 'description' : field === 'overlay' ? 'overlay' : field.startsWith('video_') ? 'video' : 'primary';
  return `Rewrite this one piece of a Meta ad for ${or(c.business_name)}.
${campaignBlock(c, plan)}

THE AD:
${adText(ad)}

WHERE THE CLICK GOES: ${afterClick(plan, c)}

THE TEXT TO REWRITE (${kind}, ${LIMITS[kind]}):
${text}

HOW: ${how ? how : STYLES[style] || STYLES.punchier}
Keep the same offer, prices, facts and angle. Never invent reviews, ratings, results, prices, deadlines, guarantees or credentials. ${URGENCY_RULE} ${VIEWER_RULE} Keep every [placeholder in square brackets] exactly as written. ${VOICE} ${emojiRule(c)} ${NO_DASHES}
AD RULES:
${plan.rules.map((r) => '- ' + r).join('\n')}
Return JSON: text.`;
}

function moreVersionsText(c: Campaign, plan: Plan, ad: unknown) {
  return `Create 6 new versions of this ad while keeping the same offer and core strategic angle.

${adText(ad)}

The business: ${or(c.business_name)}, ${or(c.location)}. Offer: ${or(c.offer_text)}. Verified proof: ${or(c.proof_text)}. Credentials: ${or(c.credentials_text)}. Facts from their website: ${or(c.site_details.join('; '))}.
${FACTS_RULE}

Change only one major variable at a time: 2 new headline treatments, 2 new visual layouts, 1 different CTA treatment, 1 alternative proof or trust treatment (only if verified proof is available; if not, make a third headline treatment instead). Keep the audience, offer, positioning, and campaign goal consistent. Do not invent new proof, pricing, guarantees, urgency, testimonials, ratings, or results. Headlines under 40 characters, descriptions under 30, text on image 8 words or fewer. Keep every [placeholder]. No before and after layouts. ${NO_DASHES} For each version, explain exactly what changed.

For every new visual layout: ${imageRules(plan, c)}

Ad rules:
${plan.rules.map((r) => '- ' + r).join('\n')}`;
}

function pageBuildText(c: Campaign, plan: Plan, ad: unknown, page: unknown) {
  // deno-lint-ignore no-explicit-any
  const p: any = page || {};
  // deno-lint-ignore no-explicit-any
  const lines = (v: unknown) => items(v).map((x: any) => (typeof x === 'object' && x ? `${s(x.q)}: ${s(x.a)}` : s(x))).filter(Boolean).join('\n');
  return `Build this landing page as a one-page app here in Base44, for a Meta ad campaign I'm running for ${or(c.business_name)}.

${campaignBlock(c, plan)}

THE AD IT FOLLOWS:
${adText(ad)}

THE PAGE COPY:
Type: ${s(p.page_type)}
Headline: ${s(p.headline)}
Subheadline: ${s(p.subheadline)}
Button: ${s(p.cta)}
Offer: ${s(p.offer)}
Benefits:
${lines(p.benefits)}
Proof:
${lines(p.proof)}
How it works:
${lines(p.process)}
FAQs:
${lines(p.faqs)}
Form fields: ${lines(p.form_fields)}

One public page, no login. Every button scrolls to the form. Save every submission with the date and any utm_ values, then show a thank-you screen saying what happens next. A private admin page of leads with a status (New, Contacted, Booked) and CSV export. Add the Meta Pixel base code in the page head with this ID: [Meta Pixel ID], and fire a Lead event when the form is sent. No fake customers or staff; labeled placeholders where a real photo belongs. Claim nothing not written here. ${NO_DASHES}

Ad rules:
${plan.rules.map((r) => '- ' + r).join('\n')}`;
}

const items = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n+/) : []);

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const noEmoji = (v: string) => v.replace(EMOJI, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1').replace(/\n[ \t]+/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
function clean(v: unknown, max = 2000) {
  return fixDashes(raw(v))
    .replace(/[ \t]+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, max);
}
const ABBR = /(\b(Dr|Mr|Mrs|Ms|St|Mt|Ave|Rd|Blvd|Ste|Inc|Co|Jr|Sr|vs|No|approx|etc)\.|\b[A-Z]\.|\b[ap]\.m\.)$/i;
function sentences(text: string) {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]["')\]]*\s+(?=["'(\[]?[A-Z0-9$])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].trimEnd().length;
    if (ABBR.test(text.slice(start, end))) continue;
    out.push(text.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}
function paragraphs(text: string) {
  const t = clean(text, 3000).replace(/\r/g, '');
  if (/\n\s*\n/.test(t)) return t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).join('\n\n');
  if (/\n/.test(t)) return t.split(/\n/).map((p) => p.trim()).filter(Boolean).join('\n\n');
  const parts = sentences(t);
  if (parts.length <= 2) return t;
  const out = [parts[0]];
  const middle = parts.slice(1, -1);
  for (let i = 0; i < middle.length; i += 2) out.push(middle.slice(i, i + 2).join(' '));
  out.push(parts[parts.length - 1]);
  return out.join('\n\n');
}
const arr = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n+/) : []).map((x) => clean(x, max).replace(/^\s*(?:[-*\u2022]\s+|\d{1,2}[.)]\s+)/, '')).filter(Boolean).slice(0, n);
const words = (v: string) => v.split(/\s+/).filter(Boolean).length;

async function ask(base44: any, prompt: string, schema: unknown, ms: number) {
  const raw = await withTimeout(base44.asServiceRole.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }), ms, 'The AI took too long. Try again.');
  if (typeof raw !== 'string') return raw || {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('The AI sent back something unreadable. Try again.');
  }
}

export default async function (req: Request) {
  const left = makeDeadline(85_000);
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const task = str(body?.task);
    const c = readCampaign(body?.campaign);
    const plan = makePlan(c);

    if (task === 'rewrite') {
      const text = str(body?.text).slice(0, 3000);
      const field = str(body?.field);
      if (!text) return Response.json({ error: 'Nothing to rewrite.' }, { status: 400 });
      if (field === 'image_prompt' || field === 'motion_prompt') return Response.json({ error: 'Edit this one by hand.' }, { status: 400 });
      const d = await ask(base44, rewritePrompt(c, plan, body?.ad, field, text, str(body?.style), s(body?.how, 300)), { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, left(AI_TIMEOUT));
      let out = field.startsWith('primary') ? paragraphs(raw(d.text)) : field.startsWith('video_') ? clean(d.text, 1200) : clean(d.text, 400);
      if (c.no_emojis) out = noEmoji(out);
      return Response.json({ text: out });
    }

    if (task === 'form') {
      const d = await ask(base44, formPrompt(c, plan, body?.ad), FORM_SCHEMA, left(AI_TIMEOUT));
      return Response.json({
        instant_form: {
          form_headline: clean(d.form_headline, 80), intro: clean(d.intro, 600),
          // deno-lint-ignore no-explicit-any
          questions: (Array.isArray(d.questions) ? d.questions : [])
            .map((q: any) => ({ question: clean(q?.question, 200), options: arr(q?.options, 6, 80) }))
            .filter((q: { question: string; options: string[] }) => q.question && !SENSITIVE.test([q.question, ...q.options].join(' ')) && !(plan.health && HEALTH_Q.test([q.question, ...q.options].join(' '))))
            .slice(0, 2),
          contact_fields: arr(d.contact_fields, 5, 40), privacy_note: clean(d.privacy_note, 300),
          thank_you_headline: clean(d.thank_you_headline, 120), thank_you_text: clean(d.thank_you_text, 600),
          cta: clean(d.cta, 40), follow_up: clean(d.follow_up, 600),
        },
      });
    }

    if (task === 'page') {
      const d = await ask(base44, pagePrompt(c, plan, body?.ad), PAGE_SCHEMA, left(AI_TIMEOUT));
      const landing_page = {
        page_type: clean(d.page_type, 60), headline: clean(d.headline, 160), subheadline: clean(d.subheadline, 300), cta: clean(d.cta, 60), offer: clean(d.offer, 600),
        benefits: arr(d.benefits, 3, 300), proof: arr(d.proof, 6, 300), process: arr(d.process, 4, 300),
        // deno-lint-ignore no-explicit-any
        faqs: (Array.isArray(d.faqs) ? d.faqs : []).slice(0, 5).map((f: any) => ({ q: clean(f?.q, 200), a: clean(f?.a, 600) })).filter((f: { q: string }) => f.q),
        form_fields: arr(d.form_fields, 6, 40).filter((x) => !SENSITIVE.test(x)),
      };
      return Response.json({ landing_page, build_prompt: pageBuildText(c, plan, body?.ad, landing_page) });
    }

    if (task === 'pagebuild') return Response.json({ build_prompt: pageBuildText(c, plan, body?.ad, body?.landing_page) });
    if (task === 'more') return Response.json({ text: moreVersionsText(c, plan, body?.ad) });
    return Response.json({ error: 'Unknown task.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error)?.message || 'That didn\'t work. Try again.' }, { status: 500 });
  }
}
