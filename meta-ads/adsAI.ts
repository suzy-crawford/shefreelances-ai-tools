import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Meta Ads Builder, part 1: the plan, the ads and the launch message, with their exact AI instructions and rules.
// task "plan": the campaign plan, decided in code. "fill": facts from their website text. "ads": 3 ad concepts.
// "practice": a made-up practice business. "launch": the message to paste into Claude or ChatGPT.


const str = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u2013\u2014]/g, '-').trim() : '';

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
const WRITER = 'claude-sonnet-5';
const NICHE_LIB: [string, RegExp, string, string[][]][] = [
  ["med_spa", /(med ?spa|aesthetic|botox|filler|injectable|laser|facial|skin ?care|derma|lash|brow|body sculpt|hydrafacial)/i, "Some cosmetic procedure ads have extra platform restrictions. Use consented imagery, avoid personal-attribute assumptions, and never imply guaranteed medical results.", [["Transformation", "A look at our real client results.", ""], ["First-Time Offer", "Your first facial, $49 (regularly $120).", ""], ["The Process Video", "Come behind the scenes of a HydraFacial appointment.", ""], ["The Myth Buster", "Botox doesn't freeze your face.", "Claims must be qualified, medically accurate and appropriate to the actual procedure."], ["Social Proof", "I've been coming here for 2 years and my skin has never looked better.", ""], ["Event / Season", "Get wedding-ready with our bridal glow package.", ""]]],
  ["dental", /(dent|orthodont|invisalign|implant|teeth|smile|veneer)/i, "Avoid assumptions about someone's health or appearance. Testimonials, imagery, financing language and treatment claims must meet healthcare advertising and privacy rules.", [["Smile Transformation", "See the smile transformations happening at [Practice Name].", ""], ["The Consultation Offer", "Considering dental implants? Book a consultation to explore your options.", ""], ["Treatment Myth Buster", "How long does Invisalign actually take?", ""], ["Patient Experience", "Here's what patients say about their experience at [Practice Name].", ""], ["Meet Your Dentist", "Meet Dr. [Name] and the team behind [Practice Name].", ""], ["The Financing Explainer", "Exploring dental implants? Learn about our payment options.", "Never invent financing terms."]]],
  ["chiro", /(chiro|spinal|posture|physio|physical therapy)/i, "No cure claims or unsupported medical promises, and never assume the viewer has a medical condition.", [["New Patient Special", "New to [Clinic Name]? Ask about our introductory consultation.", ""], ["The Educational Explainer", "What actually happens during your first chiropractic appointment?", ""], ["The Adjustment Process", "Ever wondered what happens during a chiropractic visit?", ""], ["Patient Testimonial", "A closer look at the patient experience at [Clinic Name].", ""], ["The Desk Worker Angle", "Three simple ways to make your desk setup more comfortable.", ""], ["Meet Your Chiropractor", "I'm Dr. [Name]. Here's what to expect when you visit our clinic.", ""]]],
  ["fitness", /(gym|fitness|yoga|pilates|crossfit|boxing|personal train|barre|spin class|cycle studio|bootcamp)/i, "Member results must be genuine, in context, and never presented as typical or guaranteed.", [["Free Trial Class", "First class free. No commitment. Just show up.", ""], ["Transformation Story", "Meet the members making progress at [Gym].", ""], ["Community Vibe", "This is what a morning at [Studio] looks like.", ""], ["The No-Gym Person", "Hate the gym? Us too. That's why we built something different.", ""], ["New Year / Season", "January special: $0 enrollment and your first month 50% off.", ""], ["Coach / Trainer Intro", "I'm [Name], and here's what we do differently at our studio.", ""]]],
  ["restaurant", /(restaurant|cafe|coffee|pizza|\bbar\b|grill|bakery|kitchen|taco|sushi|brunch|food|diner|bistro)/i, "", [["The Hero Shot", "This is what everyone's ordering at [Restaurant Name].", ""], ["The Deal", "2 large pizzas for $24.99 this week only.", ""], ["The Review", "Don't take our word for it. Here's what our customers are saying.", ""], ["Behind the Kitchen", "Come behind the scenes while we make our best-selling pizza.", ""], ["The Did You Know", "Did you know there's a pizza shop 5 minutes from you that hand-makes every pie?", ""], ["The Event / Season", "Game day plans? We've got your food covered.", ""]]],
  ["real_estate", /(real ?estate|realtor|brokerage|homes? for sale|listing|property management)/i, "Housing ads must use Meta's Housing Special Ad Category, which limits location, age and targeting options. Use verified local market numbers only.", [["Just Listed", "Just listed in [City]. See it before it's gone.", ""], ["Home Valuation", "What's your home worth right now? Get a free valuation.", ""], ["Market Update", "What's actually happening with home prices in [City]?", "Use verified local market statistics only."], ["Video Walkthrough", "Come take a quick tour of this home in [City].", ""], ["First-Time Buyer", "Think you can't afford a home? Homes in [City] start at $X.", ""], ["Sold Testimonial", "Sold in 5 days, $15K over asking.", ""]]],
  ["roofing", /(roof|storm damage|shingle|gutter|siding)/i, "Only mention storms that really hit the area. Insurance messages must be conditional: never promise free replacements or waived deductibles. Only advertise warranty terms the contractor can back up.", [["Storm Damage", "Recent storms hit [City]. Hidden roof damage is common.", ""], ["Insurance Replacement", "Your insurance may cover a new roof. We handle the claim paperwork.", ""], ["Free Drone Inspection", "We spot what you can't see from the ground.", ""], ["Before / After", "One roof replacement. A completely different-looking home.", ""], ["Lifetime Warranty", "Roofs built to last, with a lifetime warranty included.", ""], ["Local Crew", "Licensed, bonded and insured. A local crew in [City].", ""]]],
  ["home_services", /(plumb|hvac|heating|cooling|\bac\b|clean|landscap|lawn|paint|pressure wash|electric|remodel|contractor|handyman|garage door|pool|insulation|spray foam|solar|window)/i, "", [["Before / After", "This driveway hadn't been pressure washed in 8 years. Two hours later, it looks brand new.", ""], ["Seasonal Urgency", "Get your AC tuned up before the summer heat arrives.", ""], ["The Review Stack", "See why homeowners across [City] choose our team.", ""], ["The Problem", "Weird noise coming from your AC? It could be a small fix or a big one.", ""], ["The Crew", "Meet the team taking care of homes across [City].", ""], ["Free Estimate", "Free estimate in 24 hours. No hidden fees. Licensed and insured.", ""]]],
  ["pest", /(pest|termite|mosquito|rodent|exterminat|bug)/i, "", [["Seasonal Pest Alert", "Mosquito season is coming to [City]. Explore our yard treatments.", ""], ["Free Inspection", "Not sure what's happening around your home? Schedule a pest inspection.", ""], ["The Hidden Problem", "Three places termites can go unnoticed around a home.", ""], ["Customer Review Stack", "See why homeowners across [City] choose [Business Name].", ""], ["The Prevention Plan", "Here's what's included in our preventative pest plan.", ""], ["Meet the Technician", "Meet the local team helping [City] homeowners with unwanted pests.", ""]]],
  ["auto_detailing", /(detail|ceramic coat|paint correction|car wash|auto spa|ppf)/i, "", [["The Satisfying Transformation", "Watch us bring this car back to life.", ""], ["The Protection Angle", "What does ceramic coating actually do for your paint?", ""], ["The Package Offer", "Interior and exterior detail packages starting at $X.", ""], ["The Satisfying Process", "30 seconds of the most satisfying detail you'll see today.", ""], ["Premium Care", "A premium car deserves more than a quick rinse.", ""], ["Mobile Convenience", "Professional car detailing, right in your driveway.", ""]]],
  ["pet", /(pet|dog|cat|groom|daycare|boarding|kennel|vet)/i, "", [["The Grooming Transformation", "Wait until you see this pup's transformation.", ""], ["First-Time Grooming Offer", "New to [Business Name]? Ask about our first-visit grooming package.", ""], ["The Happy Pet Experience", "A behind-the-scenes look at a day at [Business Name].", ""], ["Meet the Groomer", "Meet [Name], the groomer behind some of our cutest transformations.", ""], ["Mobile Grooming", "Your dog's grooming appointment, right outside your front door.", ""], ["Seasonal Grooming", "Holiday grooming appointments are now open.", ""]]],
  ["clothing", /(clothing|apparel|boutique|fashion|streetwear|athleisure|jewelry|accessor|online store|ecommerce|shop)/i, "Only real scarcity: never say something sold out unless it did.", [["Hero Product", "This is the piece we're known for.", ""], ["First-Order Discount", "20% off your first order, taken off at checkout.", ""], ["UGC Try-On", "Let's try on three pieces from the new collection.", ""], ["Founder Story", "I started this brand because I couldn't find...", ""], ["Restock / Sold Out", "Back in stock. Our last drop sold out in 48 hours.", ""], ["Drop / Collection", "New summer drop. Friday at 9 AM. Get notified.", ""]]],
];
const ANGLE_CATS: string[][] = [["Offer & Incentive", "Give someone a compelling reason to act", "Your first HydraFacial for just $49."], ["Transformation & Results", "Demonstrate the potential outcome", "Two hours completely transformed this driveway."], ["Social Proof", "Show that other people trust the business", "See why homeowners across [City] choose our team."], ["Education & Myth Busting", "Answer questions and remove uncertainty", "What actually happens during your first Botox appointment?"], ["Process & Demonstration", "Show the product or service in action", "Come behind the scenes of a HydraFacial appointment."], ["Authority & Trust", "Establish credibility and expertise", "I'm Dr. [Name], and here's what you can expect at our practice."], ["Problem & Solution", "Connect an existing problem to a solution", "That strange noise coming from your AC might be worth checking."], ["Seasonal & Urgency", "Create timely, legitimate reasons to act", "Get your AC serviced before the summer heat arrives."], ["Convenience & Accessibility", "Make the decision feel easier", "Professional car detailing, right in your driveway."], ["Product & Service Showcase", "Make the offering itself desirable", "This is our best-selling dish, and it's easy to see why."]];
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
      'Use real photos of the space and the team where possible. AI images can show people during a visit, never as a result or as a real client.',
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
    return "An Instant Form inside Facebook or Instagram that asks for their name, phone and email. The business then contacts them. The call to action must match this: say what they leave and that the business gets in touch, in your own words (for example \"Leave your number and we'll call to set it up\" or \"Pop your details in and we'll text you a time\"). Never say \"pick your time\", \"book online\", \"see the menu\" or \"visit our site\".";
  }
  if (plan.destination === 'landing_page') {
    return `A landing page${c.cta_url ? ` (${c.cta_url})` : ''} built for this offer, with a short form. Match it: say what they'll find and what to do there.`;
  }
  return `Their website${c.website ? ` (${c.website})` : ''}, where they can buy. Match it: send them to shop or buy, not to fill out a form.`;
}

const NO_DASHES = 'No em dashes or en dashes anywhere.';
const VOICE = 'Write like a real person texting a friend about a place they like, not a copywriter writing a brochure: contractions, short sentences, fragments where natural, specific numbers and details over general claims. Never use: elevate, transform, unlock, seamless, revolutionize, game-changer, journey, tranquil, serene, personalized approach, tailored, state-of-the-art, "we are located", "our team is ready". No "Not X, it\'s Y" contrasts, no lists of three ("X. Y. And Z."), no "Imagine" or "Picture this" openers, no "Tired of X? We have the solution." question-then-answer cadence.';
const FACTS_RULE = 'Facts about THIS business (prices, hours, staff, how they work, insurance, financing, warranties, how fast they respond, results, reviews, customer counts) must come from the answers above, or be a [placeholder in square brackets] (at most 2 per ad, in primary text only, never for reviews, ratings, results or customer counts), or be left out. General facts that are true of the service everywhere are fine and make the copy real (for example "wrinkle relaxers take about 2 weeks to settle", "most roof inspections take under an hour"), said as general facts, never as this business\'s promise. Never invent stories, quotes or claims about their customers ("our patients tell us", "every week someone walks in", "the #1 thing we hear"). A clearly hypothetical "Say you..." scenario is fine. Headlines, descriptions and the text on the image never contain [brackets].';
const PROOF_RULE = 'Verified proof means only the Proof and Credentials answers. Never use these anywhere: best, most trusted, top-rated, #1, number one, leading, guaranteed, permanent, painless, pain-free, no downtime, or a promise of how long a result lasts. If there is no verified proof, don\'t write a trust or social proof ad.';
const URGENCY_RULE = 'No fake urgency: never limited time, ends soon, spots filling up, last chance or today only unless the offer gives a real end date. Real calendar timing is fine ("holiday photos are about 6 weeks out", "before summer"). Keep "up to", "from", "starting at" and who the offer is for (like new patients only) exactly; a list of exclusions can be shortened to "some exclusions apply". No scare tactics or worst-case scenarios.';
const VIEWER_RULE = 'Meta rejects ads that state or imply the viewer\'s personal traits. Never say or ask what the viewer is, has or feels about their body, health, weight, age, money, relationships or fears ("Are you overweight?", "You look tired", "Nervous about the dentist?", "women in their 40s"). Talk about situations, moments and the service instead ("Holiday photos coming up?", "Roof leaking again?", "Lunch-break appointment"). Use the target customer only to choose what matters, never to describe them.';

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

function imageRules(plan: Plan, c: Campaign) {
  const parts = ['No logos, watermarks or signs with words. Do not invent ratings, results, prices, badges, award ribbons or credentials.'];
  if (c.assets_text) parts.push('If I attached my real photos, build from them and keep any people in them exactly as they are.');
  if (plan.health) {
    parts.push('People are fine during the visit (relaxing in a treatment chair, talking with a provider), natural and realistic, but no close-ups of skin, faces, teeth or bodies, nothing that looks like a result, no before and after, and no one presented as a real client or patient.');
    if (WEIGHT_LOSS.test([c.business_description, c.product, c.services.join(' '), c.offer_text].join(' '))) parts.push('No bodies, scales, tape measures or clothing sizes.');
  } else {
    parts.push('Any people should look like real local customers or staff in a natural moment, not posed stock models. No before and after unless it is built from my own real photos.');
  }
  return parts.join(' ');
}

// deno-lint-ignore no-explicit-any
function imagePrompts(x: any, c: Campaign, plan: Plan, overlay: string, video: boolean) {
  // deno-lint-ignore no-explicit-any
  const p: any = x?.photo && typeof x.photo === 'object' ? x.photo : {};
  const pos = /top/i.test(str(p.text_space)) ? 'top' : 'bottom';
  const bits = [clean(p.subject, 200) + (clean(p.setting, 200) ? ` in ${clean(p.setting, 200)}` : ''), clean(p.action, 200), clean(p.mood, 120), clean(p.lighting, 120), clean(p.angle, 120)].filter(Boolean);
  const scene = bits.length > 1 ? bits.join(', ') : clean(x?.creative_direction, 300) || clean(x?.image_prompt, 600);
  const details = clean(p.details, 400);
  const rules = imageRules(plan, c);
  const photo = video
    ? `${scene}, photorealistic, vertical 9:16, like a real phone photo. ${details} This is the first frame of a video: no text anywhere. ${rules}`
    : `${scene}, photorealistic, vertical 4:5 format for a Facebook and Instagram feed ad, like a real phone photo taken locally, not stock. ${details} Leave clean empty space in the ${pos} third for a text overlay. No text, words or letters anywhere in the image. ${rules}`;
  const design = `Design a 4:5 Facebook and Instagram feed ad for ${c.business_name || '[business name]'}${c.location ? ` in ${c.location}` : ''}. Background: a realistic photo of ${scene}. ${details} Text on the ad, spelled exactly: "${overlay}". Make it big and easy to read on a phone, in the ${pos} third, with a simple clean layout. Brand colors: ${c.brand_colors || 'pick one that fits the business'}.${c.brand_style ? ` Style: ${c.brand_style}.` : ''} No other text, no buttons, no logo (I'll add anything else in Canva). ${rules}`;
  const broll = `An 8-second vertical 9:16 video clip, photorealistic, like it was filmed on a phone at the business: ${scene}. ${clean(x?.motion, 400) || clean(x?.motion_prompt, 400) || 'Slow, steady push in.'} ${details} No text, captions or logos. ${rules}`;
  const tidy = (v: string) => v.replace(/\s{2,}/g, ' ').replace(/ \./g, '.').trim();
  return { photo: tidy(photo), design: tidy(design), broll: tidy(broll) };
}

function nicheHints(c: Campaign) {
  const text = [c.business_name, c.business_description, c.product, c.services.join(' ')].join(' ');
  const n = NICHE_LIB.find((x) => x[1].test(text)) || (c.business_type === 'ecommerce' ? NICHE_LIB.find((x) => x[0] === 'clothing') : undefined);
  const cats = ANGLE_CATS.map((a) => `- ${a[0]} (${a[1]}), e.g. "${a[2]}"`).join('\n');
  if (!n) return `ANGLE CATEGORIES (pick from these):\n${cats}`;
  return `ANGLES THAT WORK FOR THIS KIND OF BUSINESS (example lines show the style, never copy their facts):\n${n[3].map((a) => `- ${a[0]}: "${a[1]}"${a[2] ? ` (Caution: ${a[2]})` : ''}`).join('\n')}${n[2] ? `\nNiche caution: ${n[2]}` : ''}\n\nOTHER ANGLE CATEGORIES:\n${cats}`;
}

function adsPrompt(c: Campaign, plan: Plan) {
  return `You are a world-class direct response copywriter writing 3 Meta ads (Facebook and Instagram) for a local or small business. Today is ${today()}.

${campaignBlock(c, plan, true)}

WHERE THE CLICK GOES: ${afterClick(plan, c)}

${nicheHints(c)}

HOW TO WRITE THEM
1. First pick 3 completely different reasons a real customer would buy from this business: a specific moment or situation, not a category (good: "holiday photos are 6 weeks out", "can only get away on a lunch break", "scared it'll look overdone"; bad: "Process and expectation", "Location convenience", "Desired outcome"). One ad = one reason.
2. Ad 1 uses Problem, Agitate, Solve. Ad 2 uses Before, After, Bridge. Ad 3 is a short "Say you..." scenario or a direct offer ad.
3. ${c.offer_text ? `Every ad names the offer (${c.offer_text}) in natural words, like a person would say it ("20% off your first treatment"), never pasted in brackets. Mention exclusions at most once, briefly.` : 'There is no offer: sell the service and the next step.'}
4. Include specific numbers and concrete details wherever the answers or general service facts allow.
5. Every ad ends with a clear call to action that matches where the click goes, worded differently in each ad.
6. The hook makes the reader feel the moment (the photo, the busy week, the nerves before a first visit) without describing them. Write it the way you'd tell a friend about it, with some warmth and personality.

${VOICE}
${VIEWER_RULE}
${FACTS_RULE}
${PROOF_RULE}
${URGENCY_RULE}

For each concept: name (2 to 5 words naming the reason, like "Holiday photos" or "Lunch-break visit"); angle (the framework: Problem Agitate Solve, Before After Bridge, Scenario or Direct offer); why (1 to 2 sentences: the customer's real motivation); primary_short (40 to 70 words) and primary_medium (90 to 140 words), both the same reason: hook first on its own line, short paragraphs separated by a blank line, call to action last on its own line, use the business name where natural.
headlines: 5, each under 40 characters, specific to this ad's reason (offer-led, outcome, curiosity, situation, direct action). Freebie only if the offer says free, social proof only with verified proof.
descriptions: 3, each under 30 characters. cta: the best Meta button for where the click goes (for an Instant Form only Sign Up, Get Quote or Learn More; for a website Shop Now, Learn More or Book Now), cta_why in one sentence. overlay: text on the image, 8 words or fewer, punchy and specific (the offer or the reason), never a slogan like "Your Goals, Our Expertise".
creative_direction: one line naming the shot. photo: the image for this ad, one concrete scene a phone could capture at this business, matching this ad's reason (good: a family sharing a pizza at a brick-walled table; a roofer laying shingles on a sunny morning; a woman relaxing in a treatment chair with eyes closed while a provider talks; bad: "imagery that conveys trust"). Fill: subject (who or what), setting (where, with 1 or 2 real details), action (what is happening), mood (2 to 4 words), lighting, angle (camera angle and distance), details (1 sentence of extra details that make it feel real and local), text_space ("top" or "bottom", whichever the scene leaves empty). People are welcome when they make it real. No text, signs, logos or before and after in the scene. motion: 1 sentence for an 8-second video clip of that scene: what moves and how the camera moves.
format: "static" or "video", whichever fits the concept and their assets (static if they listed no videos). If video: video {format (UGC, talking head, B-roll, process or montage), duration, opening_visual, hook (first 1 to 3 seconds), body, cta, shots (array)}, photo is the first frame. For static, video is null.
${emojiRule(c)} ${NO_DASHES}

AD RULES FOR THIS BUSINESS (these win over everything above):
${plan.rules.map((r) => '- ' + r).join('\n')}

Return JSON: concepts (exactly 3) and suggested_offer (the offer you suggested, or empty).`;
}

const CONCEPT = {
  type: 'object',
  properties: {
    name: { type: 'string' }, angle: { type: 'string' }, why: { type: 'string' },
    primary_short: { type: 'string' }, primary_medium: { type: 'string' },
    headlines: { type: 'array', items: { type: 'string' } }, descriptions: { type: 'array', items: { type: 'string' } },
    cta: { type: 'string' }, cta_why: { type: 'string' }, overlay: { type: 'string' },
    photo: {
      type: 'object',
      properties: { subject: { type: 'string' }, setting: { type: 'string' }, action: { type: 'string' }, mood: { type: 'string' }, lighting: { type: 'string' }, angle: { type: 'string' }, details: { type: 'string' }, text_space: { type: 'string' } },
      required: ['subject', 'setting', 'action', 'mood', 'lighting', 'angle', 'details', 'text_space'],
    },
    format: { type: 'string' }, creative_direction: { type: 'string' }, motion: { type: 'string' },
    video: {
      type: ['object', 'null'],
      properties: { format: { type: 'string' }, duration: { type: 'string' }, opening_visual: { type: 'string' }, hook: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' }, shots: { type: 'array', items: { type: 'string' } } },
    },
  },
  required: ['name', 'angle', 'why', 'primary_short', 'primary_medium', 'headlines', 'descriptions', 'cta', 'cta_why', 'overlay', 'photo', 'motion', 'format', 'creative_direction'],
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
  const overlay = strip(clean(x?.overlay, 120));
  const prompts = imagePrompts(x, c, plan, overlay, !!video);
  const concept = {
    name: clean(x?.name, 80), angle: clean(x?.angle, 80), why: clean(x?.why, 400),
    primary_short: strip(paragraphs(raw(x?.primary_short))), primary_medium: strip(paragraphs(raw(x?.primary_medium))),
    headlines: arr(x?.headlines, 5, 120).map(strip), descriptions: arr(x?.descriptions, 3, 80).map(strip),
    cta, cta_why: clean(x?.cta_why, 300), overlay,
    image_prompt: prompts.photo, design_prompt: prompts.design, broll_prompt: prompts.broll,
    format: video ? 'video' : 'static', creative_direction: clean(x?.creative_direction, 300),
    motion_prompt: video ? `${prompts.broll}${video.shots.length ? `\nShots, one clip each: ${video.shots.join('; ')}.` : ''}` : '',
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
async function ask(base44: any, prompt: string, schema: unknown, ms: number, model = '') {
  const call = (m: string) => withTimeout(base44.asServiceRole.integrations.Core.InvokeLLM(m ? { prompt, response_json_schema: schema, model: m } : { prompt, response_json_schema: schema }), m ? ms : Math.min(ms, 45_000), 'The AI took too long. Try again.');
  const start = Date.now();
  let raw;
  try {
    raw = await call(model);
  } catch (e) {
    if (!model || Date.now() - start > ms - 30_000) throw e;
    raw = await call('');
  }
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
      const d = await ask(base44, adsPrompt(c, plan), ADS_SCHEMA, left(AI_TIMEOUT), WRITER);
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
