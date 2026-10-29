import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Meta Ads Builder, part 1: the plan, the ads and the launch message, with their exact AI instructions and rules.
// task "plan": the campaign plan, decided in code. "fill": facts from their website text. "ads": 3 ad concepts.
// "practice": a made-up practice business. "launch": the message to paste into Claude or ChatGPT.


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

function adsPrompt(c: Campaign, plan: Plan) {
  return `You are an expert direct-response advertising strategist, copywriter, and creative strategist. Create 3 strong, distinct Meta ad concepts specific to this business, offer, target customer, goal, market, proof and creative assets. Do not create generic ad copy. Each ad uses a genuinely different reason the customer may care.
Today is ${today()}.

${campaignBlock(c, plan, true)}

WHERE THE CLICK GOES: ${afterClick(plan, c)}

Use the supplied information first. Use general niche knowledge only to choose angles and formats, never as facts about this business.
Choose the strongest 3 angle families: Direct offer, Desired outcome, Problem/solution (everyday problems, never exaggerated), Trust/credibility (verified proof only), Process/what to expect, Education, Transformation, Experience/lifestyle, Convenience, Local relevance (only when location matters). The 3 must use different angles, not repeat a hook structure, and never fabricate pain, urgency, scarcity, pricing, testimonials, ratings or results.
${VIEWER_RULE}
${FACTS_RULE}
${PROOF_RULE}
${URGENCY_RULE}

For each concept: name (simple internal name like First-Time Offer); angle (family name); why (1 to 2 sentences on the motivation); primary_short (about 60 words, 40 to 80) and primary_medium (about 120 words, 100 to 150): lead with something relevant, explain the offer clearly, use the business name where natural, make the action obvious, no filler, no clever or hype copy, no fake quotes. Short paragraphs separated by a blank line, hook first on its own line, call to action last on its own line. ${VOICE}
headlines: 5, each under 40 characters. Pick 5 structures you can fill with the facts above: direct offer, desired outcome (no promised results), curiosity (no clickbait), problem/solution (everyday, no fear), location (natural), convenience, benefit stack, direct action (match where the click goes). Use freebie only if the offer says free, social proof only with verified proof, urgency only with a real end date.
descriptions: 3, each under 30 characters. cta: the best Meta button for where the click goes (for an Instant Form it must be Sign Up, Get Quote or Learn More; for a website Shop Now, Learn More or Book Now), cta_why in one sentence. overlay: text on the image, 8 words or fewer. image_prompt: a complete prompt to paste into ChatGPT for the finished 4:5 ad image: business name, offer, overlay text, brand colors and style, scene, layout and typography direction, verified proof only. No people, faces or bodies: show the room, the equipment, the product, the food, the finished work or hands at work. If they listed real photos, say "use my photo of" what it shows instead of describing a person.
format: "static" or "video", whichever fits the concept and their assets best (static if they listed no videos). creative_direction: one line on the visual. If video: video {format (UGC, talking head, B-roll, process or montage), duration, opening_visual, hook (first 1 to 3 seconds), body, cta, shots (array)}, image_prompt becomes a photorealistic vertical first-frame still, and motion_prompt says what the subject does, camera movement and pacing (no new people, objects, claims or branding). For static, video is null and motion_prompt is empty.
${emojiRule(c)} ${NO_DASHES}

AD RULES FOR THIS BUSINESS:
${plan.rules.map((r) => '- ' + r).join('\n')}

Return JSON: concepts (exactly 3) and suggested_offer (the offer you suggested, or empty).`;
}

const CONCEPT = {
  type: 'object',
  properties: {
    name: { type: 'string' }, angle: { type: 'string' }, why: { type: 'string' },
    primary_short: { type: 'string' }, primary_medium: { type: 'string' },
    headlines: { type: 'array', items: { type: 'string' } }, descriptions: { type: 'array', items: { type: 'string' } },
    cta: { type: 'string' }, cta_why: { type: 'string' }, overlay: { type: 'string' }, image_prompt: { type: 'string' },
    format: { type: 'string' }, creative_direction: { type: 'string' }, motion_prompt: { type: 'string' },
    video: {
      type: ['object', 'null'],
      properties: { format: { type: 'string' }, duration: { type: 'string' }, opening_visual: { type: 'string' }, hook: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' }, shots: { type: 'array', items: { type: 'string' } } },
    },
  },
  required: ['name', 'angle', 'why', 'primary_short', 'primary_medium', 'headlines', 'descriptions', 'cta', 'cta_why', 'overlay', 'image_prompt', 'format', 'creative_direction'],
};
const ADS_SCHEMA = { type: 'object', properties: { concepts: { type: 'array', items: CONCEPT }, suggested_offer: { type: 'string' } }, required: ['concepts', 'suggested_offer'] };

function fillPrompt(siteText: string) {
  return `You are helping a beginner freelance marketer plan a Meta ad campaign for a local business. Read the website text below and pull out the facts she needs. Only use what is on the website. Never invent offers, prices, reviews, credentials or services. If the text is a domain-for-sale, coming soon or placeholder page, return every field empty.
Return:
business_name; business_type: one of local (restaurants, gyms, home services, shops), health_beauty (med spas, salons, dentists, clinics, wellness), ecommerce (sells products online), coaching, professional (law, accounting, agencies) or other;
location: city and state, or empty if the site lists more than one location;
services: up to 6, 1 to 4 words each, in the customer's words;
offers: up to 3. Only a promotion the site describes in a sentence saying what the customer gets. A menu link, button or page title alone is not an offer. Giveaways, contests, charity programs, memberships and financing are not offers. Copy the wording and conditions exactly; never add "regularly" or a before price.
goal: appointments if they push booking, purchases if they sell online, leads if they ask people to get in touch, else help;
description: one sentence; target_customer: who the site says it serves, without guessing age or gender;
differentiators; proof: only specific, checkable facts copied exactly (years, counts, named awards with the year, licenses, short review quotes with a first name). Leave out "most trusted", "best", "top-rated" and any medical or results claim. If two numbers disagree, leave both out. Never finish a cut-off quote.
credentials: exactly as written; never add DDS, MD, RN or anything not on the site.
details: up to 6 concrete facts copied exactly (named items with prices, hours, service area, license number, payment or insurance notes).
brand_style: a few words. ${NO_DASHES}

WEBSITE TEXT:
${siteText}`;
}
const STR = { type: 'string' };
const STRS = { type: 'array', items: { type: 'string' } };
const FILL_SCHEMA = {
  type: 'object',
  properties: {
    business_name: STR, business_type: STR, location: STR, goal: STR, description: STR, target_customer: STR,
    differentiators: STR, proof: STR, credentials: STR, brand_style: STR, services: STRS, offers: STRS, details: STRS,
  },
  required: ['business_name', 'business_type', 'location', 'services', 'offers', 'goal', 'description', 'target_customer', 'differentiators', 'proof', 'credentials', 'details', 'brand_style'],
};

// deno-lint-ignore no-explicit-any
const keepParas = (v: unknown, max: number) => fixDashes(raw(v)).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

const items = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n+/) : []);
// deno-lint-ignore no-explicit-any
function questionText(q: any) {
  if (typeof q === 'string') return s(q, 200);
  const opts = items(q?.options).map((o) => s(o, 80)).filter(Boolean).join(' / ');
  return `${s(q?.question, 200)}${opts ? ` (${opts})` : ''}`;
}

// deno-lint-ignore no-explicit-any
function launchText(c: Campaign, plan: Plan, ads: any[], funnel: any, mode: string) {
  const month = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'America/Chicago' });
  const name = c.business_name || '[business name]';
  const area = c.location || '[city]';
  // deno-lint-ignore no-explicit-any
  const f: any = funnel && typeof funnel === 'object' ? funnel : {};
  let where = '';
  if (plan.destination === 'instant_form') {
    const form = f.instant_form && typeof f.instant_form === 'object' ? f.instant_form : null;
    where = form
      ? `An Instant Form. Headline: ${s(form.form_headline)}. Intro: ${s(form.intro)}. Questions: ${items(form.questions).map(questionText).filter(Boolean).join('; ') || 'none'}. Contact fields: ${items(form.contact_fields).map((x) => s(x, 40)).filter(Boolean).join(', ') || 'name, phone, email'}. Privacy policy link: ${s(form.privacy_note)}. Thank-you screen: ${s(form.thank_you_headline)}. ${s(form.thank_you_text)}`
      : 'An Instant Form with name, phone and email, a privacy policy link, and a short thank-you screen saying the business will be in touch.';
  } else if (plan.destination === 'landing_page') {
    where = `The landing page ${c.cta_url || '(ask me for the page link)'}.${f.landing_page?.headline ? ` The page headline is "${s(f.landing_page.headline)}", so the ads and page match.` : ''} Conversion location: Website. It needs the Meta pixel with a Lead event when the form is sent. If that isn't set up, help me set it up or switch to an Instant Form.`;
  } else {
    where = `Their website ${c.website || '(ask me for the link)'}. Conversion location: Website, optimized for purchases. It needs the Meta pixel tracking purchases; check that first.`;
  }
  const adLines = (Array.isArray(ads) ? ads : []).slice(0, 3).map((a: any) =>
    `Ad "${name} - ${s(a?.name, 80)} - ${/video/i.test(str(a?.format)) ? 'Video' : 'Image'}"
Primary text:
${keepParas(a?.primary, 1500)}
Headline: ${s(a?.headline, 120)}
Description: ${s(a?.description, 80)}
Button: ${plan.destination === 'instant_form' && !/^(sign up|get quote|learn more)$/i.test(s(a?.cta, 40)) ? (/quote|estimate/i.test(s(a?.cta, 40)) ? 'Get Quote' : 'Sign Up') : s(a?.cta, 40)}`
  ).join('\n\n');
  const settings = `Campaign: "${name} - ${plan.goal} - ${month}". Objective: ${plan.objective}. Advantage campaign budget: $${plan.daily_budget} a day.
Ad set: "${name} - ${plan.area_type === 'radius' ? area : plan.area_label.replace(/^All of /, '')} - Broad". Optimize for ${plan.optimization}. ${plan.audience}. Advantage+ placements.${plan.special ? (plan.area_type === 'radius' ? ' Declare the special ad category; the area must be at least 15 miles.' : ' Declare the special ad category.') : ''}
Where ads send people: ${where}

Ads:
${adLines || '(none switched on)'}

If any ad text still has [square brackets], ask me to fill it in first.

Ad rules:
${plan.rules.map((r) => '- ' + r).join('\n')}`;
  if (mode === 'claude') {
    return `I'm a freelance marketer. Use your Meta Ads connector to set up this campaign for my client, ${name} in ${area}, in their ad account. Everything must be created PAUSED: never turn anything on. First list the ad accounts and Pages you can see and ask me which ones to use. I'll attach the ad images (or videos) in this chat; ask me for any you need. Create the campaign, ad set, ${plan.destination === 'instant_form' ? 'Instant Form (if your connector can; if not, tell me and I will build the form by hand), ' : ''}and ads exactly as below, then give me a short summary of what you created and the preview links, and tell me anything you couldn't do so I can do it by hand in Ads Manager.

${settings}`;
  }
  return `I'm a freelance marketer launching a Meta ad campaign for my client, ${name} in ${area}. I'm building it myself in Meta Ads Manager. Walk me through it one step at a time: exactly where to click and what to type, then wait for me to say done. If I send a screenshot, tell me what to change. Everything stays off until my client approves. Start by checking I'm in the right ad account and Facebook Page.

${settings}`;
}

const PRACTICE = {
  business_name: 'Glow Aesthetics', website: '', location: 'Austin, TX', business_type: 'health_beauty',
  business_description: 'A small med spa offering facials, laser hair removal and wrinkle relaxer treatments.',
  product: 'HydraFacial', services: ['HydraFacial', 'Laser hair removal', 'Wrinkle relaxers', 'Chemical peels'],
  offer_text: '$50 off your first HydraFacial', offer_help: false, goal: 'appointments', daily_budget: 20, radius_miles: 10,
  target_customer: 'People nearby who want a fresh, natural glow', differentiators: 'Nurse-led treatments in a calm, private studio.',
  proof_text: '', credentials_text: 'Licensed registered nurses', brand_colors: '#c9a27e, #2f2a26', brand_style: 'calm, warm, minimal',
  assets_text: '', no_emojis: false, site_details: [],
};

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

// deno-lint-ignore no-explicit-any
function cleanConcept(x: any, plan: Plan, c: Campaign) {
  const isVideo = /^video$/i.test(str(x?.format)) && x?.video && typeof x.video === 'object';
  const strip = (v: string) => (c.no_emojis ? noEmoji(v) : v);
  const video = isVideo
    ? {
      format: clean(x.video.format, 40), duration: clean(x.video.duration, 40), opening_visual: clean(x.video.opening_visual, 300),
      hook: strip(clean(x.video.hook, 300)), body: strip(clean(x.video.body, 1200)), cta: strip(clean(x.video.cta, 200)), shots: arr(x.video.shots, 8, 300),
    }
    : null;
  let cta = clean(x?.cta, 40);
  if (plan.destination === 'instant_form' && !/^(sign up|get quote|learn more)$/i.test(cta)) cta = /quote|estimate/i.test(cta) ? 'Get Quote' : 'Sign Up';
  const concept = {
    name: clean(x?.name, 80), angle: clean(x?.angle, 80), why: clean(x?.why, 400),
    primary_short: strip(paragraphs(raw(x?.primary_short))), primary_medium: strip(paragraphs(raw(x?.primary_medium))),
    headlines: arr(x?.headlines, 5, 120).map(strip), descriptions: arr(x?.descriptions, 3, 80).map(strip),
    cta, cta_why: clean(x?.cta_why, 300), overlay: strip(clean(x?.overlay, 120)),
    image_prompt: `${clean(x?.image_prompt, 3000)}\n\n${imageRules(plan, c, !!video)}`,
    format: video ? 'video' : 'static', creative_direction: clean(x?.creative_direction, 300),
    motion_prompt: video ? `${clean(x?.motion_prompt, 1200)}\n\n${imageRules(plan, c, true)}` : '',
    video,
    warnings: [] as string[],
  };
  concept.headlines.forEach((h, i) => { if (h.length >= 40) concept.warnings.push(`Headline ${i + 1} is ${h.length} characters (keep it under 40).`); });
  concept.descriptions.forEach((d, i) => { if (d.length >= 30) concept.warnings.push(`Description ${i + 1} is ${d.length} characters (keep it under 30).`); });
  if (words(concept.overlay) > 8) concept.warnings.push(`The text on the image is ${words(concept.overlay)} words (keep it to 8 or fewer).`);
  if ([...concept.headlines, ...concept.descriptions, concept.overlay].some((v) => /\[[^\]]*\]/.test(v))) concept.warnings.push('A headline, description or the text on the image has a [blank]. Fill it or pick another.');
  return concept;
}

// deno-lint-ignore no-explicit-any
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

    if (task === 'plan') return Response.json({ plan });

    if (task === 'fill') {
      const site = str(body?.site_text).slice(0, 20_000);
      if (site.length < 100) return Response.json({ error: "There wasn't enough text on their website to fill anything in." }, { status: 400 });
      const d = await ask(base44, fillPrompt(site), FILL_SCHEMA, left(AI_TIMEOUT));
      const fields = {
        business_name: clean(d.business_name, 120),
        business_type: TYPES.includes(str(d.business_type)) ? str(d.business_type) : '',
        location: clean(d.location, 120),
        goal: GOALS.includes(str(d.goal)) ? str(d.goal) : '',
        business_description: clean(d.description, 600),
        target_customer: clean(d.target_customer, 200),
        differentiators: noBoasts(clean(d.differentiators, 600)),
        proof_text: noBoasts(clean(d.proof, 600)).split(/(?<=[.!?;])\s+/).filter((x) => !(HEALTH.test(site) && /(after \d+|results?|difference|lost \d|pounds|years younger|transform)/i.test(x))).join(' ').trim(),
        credentials_text: clean(d.credentials, 400),
        brand_style: clean(d.brand_style, 200),
      };
      const services = arr(d.services, 6, 60);
      const offers = arr(d.offers, 8, 300)
        .map((o) => o.replace(/^(limited[- ]time( offer)?|special offer|offer)\s*[:,\-]\s*/i, ''))
        .filter((o) => !/\b(regularly|reg\.?|was)\s*\$\d|\b(see|view) our\b|\bcheck out\b|\$\d[\d,.]*\s+\$\d/i.test(o) && words(o) >= 3 && /(free|\boff\b|%|\$\d|discount|save|complimentary|bonus|gift|included|buy one|get one|\d for \d|two for one|half (price|off))/i.test(o))
        .slice(0, 3);
      const details = arr(d.details, 6, 200).filter((x) => !/\$\d[\d,.]*\s+\$\d/.test(x));
      const rx = services.filter((x) => RX_DRUGS.test(x));
      const warnings = rx.length
        ? [`${rx.join(', ')}: advertising prescription treatments needs Meta certification (LegitScript). Promote the consultation or the experience instead.`]
        : [];
      return Response.json({ fields, services, offers, details, warnings });
    }

    if (task === 'ads') {
      if (!c.business_name || !(c.product || c.services.length || c.offer_text)) {
        return Response.json({ error: 'Add the business name and what you are promoting first.' }, { status: 400 });
      }
      const d = await ask(base44, adsPrompt(c, plan), ADS_SCHEMA, left(AI_TIMEOUT));
      const concepts = (Array.isArray(d.concepts) ? d.concepts : []).slice(0, 3).map((x: unknown) => cleanConcept(x, plan, c));
      if (concepts.length < 3) throw new Error('The AI wrote fewer than 3 ads. Try again.');
      if (concepts.some((x: { headlines: string[]; primary_short: string }) => !x.headlines.length || !x.primary_short)) throw new Error('The AI left an ad unfinished. Try again.');
      const suggested_offer = c.offer_text || !c.offer_help ? '' : clean(d.suggested_offer, 300);
      return Response.json({ concepts, suggested_offer, plan });
    }

    if (task === 'practice') return Response.json({ campaign: PRACTICE });
    if (task === 'launch') return Response.json({ text: launchText(c, plan, Array.isArray(body?.ads) ? body.ads : [], body?.funnel, str(body?.mode)) });

    return Response.json({ error: 'Unknown task.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error)?.message || 'That didn\'t work. Try again.' }, { status: 500 });
  }
}
