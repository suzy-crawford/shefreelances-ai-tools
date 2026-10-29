// Scenario tests for adsAI (Meta Ads Builder).
// Run: deno run --allow-read --import-map=import_map.json adsai.ts
import adsAI from '../meta-ads/adsAI.ts';
import adsExtra from '../meta-ads/adsExtra.ts';

const g = globalThis as any;
let pass = 0;
const fails: string[] = [];
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) pass++;
  else fails.push(`${name}${detail === undefined ? '' : `  -> ${JSON.stringify(detail)?.slice(0, 500)}`}`);
}
function mock(user: unknown, llm: (a: any) => unknown) {
  g.__mock = { user, llm, calls: [] };
}
async function call(body: unknown, raw = false) {
  const task = !raw && body && typeof body === 'object' ? (body as any).task : '';
  const fn = ['rewrite', 'more', 'form', 'page', 'pagebuild'].includes(task) ? adsExtra : adsAI;
  const res = await fn(new Request('https://fn/', { method: 'POST', body: raw ? (body as string) : JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
const ME = { id: 'u' };
const lastPrompt = () => g.__mock.calls[g.__mock.calls.length - 1]?.prompt || '';
const base = { business_name: 'Glow Med Spa', location: 'Austin, TX', product: 'HydraFacial', daily_budget: 30, radius_miles: 10, goal: 'appointments' };
const plan = async (c: Record<string, unknown>) => (await call({ task: 'plan', campaign: c })).data.plan;
const dash = /[–—]/;

// ---- access ----
mock(null, () => ({}));
let r = await call({ task: 'plan', campaign: base });
check('401 when not logged in', r.status === 401, r);
mock(ME, () => ({}));
r = await call({ task: 'nope', campaign: base });
check('unknown task -> 400', r.status === 400, r);
r = await call('garbage', true);
check('broken body -> 400 unknown task, no crash', r.status === 400, r);

// ---- plan (code-decided) ----
let p = await plan(base);
check('med spa is health', p.health === true, p);
check('appointments -> Leads + Instant Form by default', p.objective === 'Leads' && p.destination === 'instant_form', p);
check('health notes and drug rule present', p.notes.some((n: string) => /Instant Forms avoid/.test(n)) && p.rules.some((x: string) => /prescription drugs/.test(x)), p);
p = await plan({ ...base, business_name: 'Bright Smiles Family Dentistry', product: 'family checkups' });
check('"Dentistry" counts as health', p.health === true, p);
p = await plan({ business_name: 'Smile Co', business_type: 'health_beauty', product: 'x' });
check('business_type health_beauty counts as health', p.health === true, p);
p = await plan({ business_name: 'Kelly Roofing', product: 'roof replacement', goal: 'help' });
check('roofer + help -> leads, not health', p.goal === 'leads' && p.health === false && p.destination === 'instant_form', p);
p = await plan({ business_name: 'Shop Co', business_type: 'ecommerce', product: 'candles', goal: 'help' });
check('ecommerce + help -> purchases to website, Sales', p.goal === 'purchases' && p.destination === 'website' && p.objective === 'Sales', p);
p = await plan({ ...base, funnel_type: 'landing_page' });
check('landing page only when chosen, with pixel Lead note', p.destination === 'landing_page' && p.notes.some((n: string) => /Lead event/.test(n)), p);
p = await plan({ ...base, goal: 'purchases', funnel_type: 'landing_page' });
check('purchases always go to the website', p.destination === 'website', p);
p = await plan({ business_name: 'Peak Home Loans', product: 'home loans and mortgages', radius_miles: 5 });
check('home loans -> special category, radius at least 15', p.special === true && p.radius_miles === 15 && p.notes.some((n: string) => /special ad category/.test(n)), p);
p = await plan({ business_name: 'Slim Clinic', product: 'semaglutide weight loss program' });
check('semaglutide -> weight loss rule + certification note', p.rules.some((x: string) => /For weight loss/.test(x)) && p.notes.some((n: string) => /LegitScript/.test(n)), p);
p = await plan({ ...base, daily_budget: 8 });
check('under $10 note, 2 ads', /Under \$10/.test(p.budget_note) && p.ads_to_run === 2, p);
p = await plan({ ...base, daily_budget: 'abc' });
check('bad budget -> default 20', p.daily_budget === 20, p);
check('plan text has no dashes', !dash.test(JSON.stringify(await plan({ ...base, product: 'semaglutide with financing' }))));

// ---- ads ----
const concept = (i: number, extra: Record<string, unknown> = {}) => ({
  name: 'Concept ' + i, angle: 'Direct offer', why: 'Because — reasons.',
  primary_short: 'Meet Glow. Your skin, refreshed. We take time with you. You leave glowing. Tap below to leave your number.',
  primary_medium: 'Para one.\n\nPara two – more.\n\nLeave your number.',
  headlines: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'], descriptions: ['D1', 'D2', 'D3', 'D4'],
  cta: 'Sign Up', cta_why: 'Form.', overlay: 'Fresh skin', image_prompt: 'A calm spa room',
  format: 'static', creative_direction: 'Room shot', motion_prompt: 'x', video: { hook: 'should be dropped' }, ...extra,
});
mock(ME, () => ({ concepts: [concept(1), concept(2, { format: 'video', video: { format: 'UGC', duration: '15s', opening_visual: 'door', hook: 'h', body: 'b', cta: 'c', shots: ['a', 'b'] }, motion_prompt: 'slow push' }), concept(3), concept(4)], suggested_offer: 'Free consult' }));
r = await call({ task: 'ads', campaign: { ...base, offer_help: true } });
const ads = r.data;
const prompt = lastPrompt();
check('ads: 200 with exactly 3 concepts', r.status === 200 && ads.concepts?.length === 3, r);
check('ads: 5 headlines, 3 descriptions kept', ads.concepts[0].headlines.length === 5 && ads.concepts[0].descriptions.length === 3, ads.concepts[0]);
check('ads: em/en dashes replaced, no " ,"', !dash.test(JSON.stringify(ads)) && !/ ,/.test(ads.concepts[0].why), ads.concepts[0].why);
check('ads: primary text split into paragraphs (hook first, action last)', ads.concepts[0].primary_short.split('\n\n').length >= 3 && /Tap below/.test(ads.concepts[0].primary_short.split('\n\n').pop()), ads.concepts[0].primary_short);
check('ads: static concept has no video', ads.concepts[0].format === 'static' && ads.concepts[0].video === null && ads.concepts[0].motion_prompt === '', ads.concepts[0]);
check('ads: video concept kept with script', ads.concepts[1].format === 'video' && ads.concepts[1].video.shots.length === 2 && ads.concepts[1].motion_prompt.startsWith('slow push') && /first frame of a vertical video/.test(ads.concepts[1].motion_prompt), ads.concepts[1]);
check('ads: image rules appended (health + no real photos)', /No before and after images/.test(ads.concepts[0].image_prompt) && /Show no people, faces or bodies/.test(ads.concepts[0].image_prompt), ads.concepts[0].image_prompt);
check('ads: suggested offer returned when offer_help', ads.suggested_offer === 'Free consult', ads.suggested_offer);
check('ads prompt: today\'s date', /Today is [A-Z][a-z]+ \d{1,2}, \d{4}\./.test(prompt), prompt.slice(0, 300));
check('ads prompt: says where the click goes (form, no "pick your time")', /WHERE THE CLICK GOES: An Instant Form/.test(prompt) && /Never say "pick your time"/.test(prompt), null);
check('ads prompt: suggested offer kept out of the ads', /suggested_offer only/.test(prompt) && /Never mention the suggested offer in the ads/.test(prompt), null);
check('ads prompt: never describe the viewer', /Never describe the viewer/.test(prompt), null);
check('ads prompt: health rules + prescription rule included', /AD RULES FOR THIS BUSINESS/.test(prompt) && /Meta only allows prescription drug ads/.test(prompt), null);
check('ads prompt: proof, facts and urgency rules', /Verified proof means only/.test(prompt) && /must come from the answers above/.test(prompt) && /real end date/.test(prompt), null);
check('ads prompt: no dashes', !dash.test(prompt), null);
mock(ME, () => ({ concepts: [concept(1)], suggested_offer: '' }));
r = await call({ task: 'ads', campaign: { ...base, offer_text: '$99 HydraFacial' } });
check('ads: fewer than 3 concepts -> 500 with plain message', r.status === 500 && /fewer than 3/.test(r.data.error), r);
check('ads prompt: real offer passed as is', /Offer: \$99 HydraFacial/.test(lastPrompt()), null);
mock(ME, () => ({ concepts: [concept(1), concept(2), concept(3)], suggested_offer: 'should be ignored' }));
r = await call({ task: 'ads', campaign: { ...base, offer_text: '$99 HydraFacial' } });
check('ads: suggested_offer empty when she gave an offer', r.data.suggested_offer === '', r.data.suggested_offer);
r = await call({ task: 'ads', campaign: { business_name: '' } });
check('ads: missing name/product -> 400 plain message', r.status === 400 && /business name/.test(r.data.error), r);
mock(ME, () => 'not json at all');
r = await call({ task: 'ads', campaign: base });
check('ads: unreadable AI answer -> 500 plain message', r.status === 500 && /unreadable/.test(r.data.error), r);
mock(ME, () => { throw new Error('Credits ran out'); });
r = await call({ task: 'ads', campaign: base });
check('ads: AI error passed through', r.status === 500 && r.data.error === 'Credits ran out', r);
mock(ME, () => ({ concepts: [concept(1), concept(2), concept(3)], suggested_offer: '' }));
await call({ task: 'ads', campaign: { business_name: 'Kelly Roofing', product: 'roof replacement', goal: 'purchases' } });
check('ads prompt (purchases): click goes to website, buy', /Their website/.test(lastPrompt()) && /shop or buy/.test(lastPrompt()), null);
await call({ task: 'ads', campaign: { business_name: 'Kelly Roofing', product: 'roof replacement', no_emojis: true, assets_text: 'real crew photos' } });
check('ads prompt: emoji rule + no health rules for roofer', /No emojis anywhere/.test(lastPrompt()) && !/prescription drugs/.test(lastPrompt()), null);

// ---- fill ----
mock(ME, () => ({
  business_name: 'Kelly Roofing', business_type: 'roofing', location: 'Naples, FL', goal: 'whatever',
  services: ['Roof Replacement', 'Semaglutide'], offers: ['Free Roof Replacement', '$300 (regularly $500) facial', 'Free estimate on any roof repair this month'],
  description: 'Roofers — since 1978.', target_customer: 'Homeowners', differentiators: 'Family owned',
  proof: 'Since 1978. Most trusted roofer in Florida. 60,000+ roofs.', credentials: 'Licensed CCC1234', details: ['Hours 8 to 5'], brand_style: 'bold',
}));
r = await call({ task: 'fill', site_text: 'x'.repeat(50) });
check('fill: too little site text -> 400', r.status === 400, r);
r = await call({ task: 'fill', site_text: 'Kelly Roofing site text. '.repeat(20) });
const f = r.data;
check('fill: invalid type/goal blanked', f.fields.business_type === '' && f.fields.goal === '', f.fields);
check('fill: "regularly" offers and one-word menu links dropped', !f.offers.some((o: string) => /regularly/.test(o)) && f.offers.length === 2, f.offers);
check('fill: boasts removed from proof', !/Most trusted/.test(f.fields.proof_text) && /Since 1978/.test(f.fields.proof_text), f.fields.proof_text);
check('fill: prescription service -> warning', f.warnings.length === 1 && /LegitScript/.test(f.warnings[0]), f.warnings);
check('fill: dashes cleaned', !dash.test(JSON.stringify(f)), null);
check('fill prompt: offers rule + credentials rule', /A menu link, button or page title alone is not an offer/.test(lastPrompt()) && /never add DDS/.test(lastPrompt()), null);

// ---- rewrite ----
mock(ME, () => ({ text: 'New line one. New line two. New line three. Leave your number.' }));
r = await call({ task: 'rewrite', campaign: base, field: 'primary_short', text: 'old', style: 'clearer', ad: concept(1) });
check('rewrite: primary text comes back in paragraphs', r.status === 200 && r.data.text.includes('\n\n'), r.data);
check('rewrite prompt: "clearer" never adds fake urgency', /Never add limited/.test(lastPrompt()) && /Keep every \[placeholder/.test(lastPrompt()), null);
r = await call({ task: 'rewrite', campaign: base, field: 'headline_2', text: 'old', how: 'mention the free consult', ad: concept(1) });
check('rewrite: own instruction used, headline limit in prompt', /mention the free consult/.test(lastPrompt()) && /under 40 characters/.test(lastPrompt()), null);
r = await call({ task: 'rewrite', campaign: base, field: 'headline_1', text: '' });
check('rewrite: empty text -> 400', r.status === 400, r);

// ---- form ----
mock(ME, () => ({
  form_headline: 'Your free consult', intro: 'Tell us a bit.',
  questions: [{ question: 'What skin concerns or health conditions do you have?', options: ['a'] }, { question: 'Which treatment interests you?', options: ['Facial', 'Laser'] }, { question: 'Third?', options: [] }],
  contact_fields: ['Name', 'Phone', 'Email'], privacy_note: '[link to their privacy policy]', thank_you_headline: 'Thanks', thank_you_text: 'We will call [when we\'ll call].', cta: 'Submit', follow_up: 'Call fast',
}));
r = await call({ task: 'form', campaign: base, ad: concept(1) });
const form = r.data.instant_form;
check('form: health question removed, max 2 kept', form.questions.length === 2 && !form.questions.some((q: any) => /health/.test(q.question)), form.questions);
check('form prompt: bans health/insurance questions, placeholder for call time', /Never ask about health/.test(lastPrompt()) && /\[when we'll call\]/.test(lastPrompt()), null);

// ---- page ----
mock(ME, () => ({ page_type: 'Lead generation', headline: 'Fresh skin', subheadline: 'Sub', cta: 'Get started', offer: 'Consult', benefits: ['A: b', 'C: d', 'E: f', 'G: h'], proof: [], process: ['1', '2', '3'], faqs: [{ q: 'Cost?', a: '[placeholder for the owner]' }], form_fields: ['Name', 'Insurance provider', 'Phone'] }));
r = await call({ task: 'page', campaign: base, ad: concept(1) });
check('page: 3 benefits, insurance field dropped', r.data.landing_page.benefits.length === 3 && !r.data.landing_page.form_fields.some((x: string) => /Insurance/.test(x)), r.data.landing_page);
check('page: build prompt has the copy and the Pixel Lead event', /Headline: Fresh skin/.test(r.data.build_prompt) && /fire a Lead event/.test(r.data.build_prompt) && /Cost\?: \[placeholder/.test(r.data.build_prompt), r.data.build_prompt?.slice(0, 200));

// ---- more versions / launch (code only, no AI) ----
mock(ME, () => { throw new Error('should not call AI'); });
r = await call({ task: 'more', campaign: base, ad: concept(1) });
check('more: text with rules, no AI call', r.status === 200 && /Create 6 new versions/.test(r.data.text) && /Ad rules:/.test(r.data.text) && g.__mock.calls.length === 0, r);
r = await call({ task: 'launch', campaign: base, ads: [{ name: 'First Visit', primary: 'Hi', headline: 'H', description: 'D', cta: 'Sign Up', format: 'static' }], funnel: {} });
check('launch: Instant Form fallback when no form written', /An Instant Form with name, phone and email/.test(r.data.text), r.data.text?.slice(0, 200));
check('launch: campaign name and ad name', /"Glow Med Spa - appointments - [A-Z][a-z]{2} \d{4}"/.test(r.data.text) && /Ad "Glow Med Spa - First Visit - Image"/.test(r.data.text), null);
r = await call({ task: 'launch', campaign: { ...base, funnel_type: 'landing_page', cta_url: 'https://glow.base44.app' }, ads: [], funnel: { landing_page: { headline: 'Fresh skin' } } });
check('launch: landing page needs pixel Lead event, headline match', /Lead event/.test(r.data.text) && /"Fresh skin"/.test(r.data.text) && /https:\/\/glow\.base44\.app/.test(r.data.text), null);
r = await call({ task: 'launch', campaign: { business_name: 'Peak Home Loans', product: 'mortgages', location: 'Knoxville' }, ads: [] });
check('launch: special category reminder', /special ad category/.test(r.data.text), null);
check('launch: no dashes', !dash.test(r.data.text), null);

// ---- round 2 fixes ----
const P = async (c: Record<string, unknown>) => (await call({ task: 'plan', campaign: c })).data.plan;
for (const n of ['Glendale Family Dental', 'Splendid Smiles Salon', 'Blend Coffee Bar', 'Jet Ski Rentals', 'Accredited Roofing Co', 'Parental Pediatric']) {
  const pl = await P({ business_name: n, product: 'services' });
  check(`no special category for "${n}"`, pl.special === false, pl.notes);
}
for (const n of ['Peak Home Loans', 'Sunrise Realty', 'Smith Mortgage', 'Now Hiring Plumbers']) {
  check(`special category for "${n}"`, (await P({ business_name: n, product: 'x' })).special === true);
}
for (const [n, prod] of [['Bethesda Roofing', 'roofing in Bethesda, MD'], ['Green Plant Nursery', 'plants'], ['Laser Tag Arena', 'laser tag parties'], ['Sculpt Pilates', 'pilates classes']]) {
  check(`not health: ${n}`, (await P({ business_name: n, product: prod })).health === false);
}
check('Kybella only counts as health (rx)', (await P({ business_name: 'Chin Co', product: 'Kybella' })).health === true);
check('online skincare store + help -> purchases', (await P({ business_name: 'Glow Skin Shop', business_type: 'ecommerce', product: 'skincare serums', goal: 'help' })).goal === 'purchases');
let cafe = await P({ business_name: 'Camellia Cafe', product: 'breakfast', goal: 'leads' });
check('cafe with no offer: walk-in note', cafe.walk_in === true && cafe.notes.some((n: string) => /reason to leave a name/.test(n)), cafe);
check('$15 budget parsed', (await P({ ...base, daily_budget: '$15' })).daily_budget === 15);

mock(ME, () => ({ concepts: [
  concept(1, { cta: 'Book Now', headlines: 'Line one\nLine two that is far too long for a Meta headline here', overlay: 'Nine words is just a little bit too many words', primary_short: 'Meet Dr. Lee at Glow. Facials start at $99.50 this month. Visit glowspa.com to see more. We open at 7 a.m. daily \u{1F600}. Leave your number.' }),
  concept(2, { headlines: ['Get [price] off now'] }), concept(3)], suggested_offer: '' }));
r = await call({ task: 'ads', campaign: { ...base, no_emojis: true } });
let c1 = r.data.concepts[0];
check('Book Now on an Instant Form becomes Sign Up', c1.cta === 'Sign Up', c1.cta);
check('headlines given as text are split into a list', c1.headlines.length === 2, c1.headlines);
check('warnings: long headline and long overlay', c1.warnings.some((w: string) => /Headline 2/.test(w)) && c1.warnings.some((w: string) => /text on the image/.test(w)), c1.warnings);
check('warning: [blank] in a headline', r.data.concepts[1].warnings.some((w: string) => /\[blank\]/.test(w)), r.data.concepts[1].warnings);
check('paragraphs keep "Dr. Lee", "$99.50", "glowspa.com", "7 a.m."', /Dr\. Lee/.test(c1.primary_short) && /\$99\.50/.test(c1.primary_short) && /glowspa\.com/.test(c1.primary_short) && /7 a\.m\./.test(c1.primary_short), c1.primary_short);
check('emojis removed when no_emojis', !/\u{1F600}/u.test(c1.primary_short), c1.primary_short);
mock(ME, () => ({ concepts: [concept(1, { why: 'Roofers \u2014 since 1978. Open 9\u20135 and 8 - 4.' }), concept(2), concept(3)], suggested_offer: '' }));
r = await call({ task: 'ads', campaign: base });
check('dashes: em dash to comma, ranges to "to"', r.data.concepts[0].why === 'Roofers, since 1978. Open 9 to 5 and 8 to 4.', r.data.concepts[0].why);
mock(ME, () => ({ concepts: [concept(1, { headlines: [] }), concept(2), concept(3)], suggested_offer: '' }));
r = await call({ task: 'ads', campaign: base });
check('an ad with no headline -> try again', r.status === 500 && /unfinished/.test(r.data.error), r.data);
mock(ME, () => ({ concepts: [concept(1), concept(2), concept(3)], suggested_offer: '' }));
await call({ task: 'ads', campaign: { business_name: 'Camellia Cafe', product: 'breakfast', goal: 'leads' } });
check('cafe ads prompt: claim the offer, never "we\'ll call to find a time"', /form claims the offer/.test(lastPrompt()), null);
await call({ task: 'ads', campaign: { ...base, differentiators: 'Pain-free laser. Nurse-led care.', proof_text: 'Industry-leading results. 12 years in Austin.' } });
check('boasts removed from differentiators and proof before the AI sees them', !/Pain-free|Industry-leading/.test(lastPrompt()) && /Nurse-led care/.test(lastPrompt()) && /12 years in Austin/.test(lastPrompt()), null);

mock(ME, () => ({ business_name: 'Glow', business_type: 'health_beauty', location: '', goal: 'appointments', services: ['Facials'],
  offers: ['Limited Time Offer: $50 off your first facial', 'Instant Roof Estimate', 'Signature Facial $300 $500'],
  description: 'x', target_customer: 'x', differentiators: 'Permanent results. Calm studio.', proof: 'After 6 treatments I see a big difference. Friendly staff and a clean studio.', credentials: 'RN', details: ['Signature Facial $300 $500', 'Open 9 to 5'], brand_style: 'calm' }));
r = await call({ task: 'fill', site_text: 'Glow med spa facials laser. '.repeat(20) });
check('fill: "Limited Time Offer:" prefix stripped, menu link and before-price dropped', JSON.stringify(r.data.offers) === JSON.stringify(['$50 off your first facial']), r.data.offers);
check('fill: before-price detail dropped', JSON.stringify(r.data.details) === JSON.stringify(['Open 9 to 5']), r.data.details);
check('fill: boasts dropped from differentiators', r.data.fields.differentiators === 'Calm studio.', r.data.fields.differentiators);
check('fill (health): results review dropped from proof', !/difference/.test(r.data.fields.proof_text) && /Friendly staff/.test(r.data.fields.proof_text), r.data.fields.proof_text);

mock(ME, () => ({ form_headline: 'x', intro: 'x', questions: [{ question: "What's the age of your roof?", options: ['0-10', '10+'] }, { question: 'Which package interests you?', options: ['A'] }], contact_fields: ['Name'], privacy_note: 'p', thank_you_headline: 't', thank_you_text: 't', cta: 'c', follow_up: 'f' }));
r = await call({ task: 'form', campaign: { business_name: 'Kelly Roofing', product: 'roofs' }, ad: concept(1) });
check('form keeps ordinary roof/package questions', r.data.instant_form.questions.length === 2, r.data.instant_form.questions);
mock(ME, () => ({ form_headline: 'x', intro: 'x', questions: [{ question: 'Weight training or cardio?', options: ['Weights', 'Cardio'] }], contact_fields: ['Name'], privacy_note: 'p', thank_you_headline: 't', thank_you_text: 't', cta: 'c', follow_up: 'f' }));
r = await call({ task: 'form', campaign: { business_name: 'Iron Gym', product: 'memberships' }, ad: concept(1) });
check('gym keeps a "weight training" question', r.data.instant_form.questions.length === 1, r.data.instant_form.questions);
mock(ME, () => ({ form_headline: 'x', intro: 'x', questions: [{ question: 'Where is your pain?', options: ['Back'] }, { question: 'Best time to call?', options: ['Morning'] }], contact_fields: ['Name'], privacy_note: 'p', thank_you_headline: 't', thank_you_text: 't', cta: 'c', follow_up: 'f' }));
r = await call({ task: 'form', campaign: base, ad: concept(1) });
check('health business: pain question removed', r.data.instant_form.questions.length === 1 && /time/.test(r.data.instant_form.questions[0].question), r.data.instant_form.questions);

mock(ME, () => { throw new Error('should not call AI'); });
r = await call({ task: 'launch', mode: 'claude', campaign: base, ads: [{ name: 'A', primary: 'Line one.\n\nLine two.', headline: 'H', description: 'D', cta: 'Sign Up', format: 'static' }], funnel: { instant_form: { form_headline: 'Claim', questions: 'Which treatment?\nBest time?', contact_fields: 'Name\nPhone' } } });
check('launch (claude mode): connector, PAUSED, no crash on text lists', r.status === 200 && /Meta Ads connector/.test(r.data.text) && /PAUSED/.test(r.data.text) && /Which treatment\?; Best time\?/.test(r.data.text), r.data);
check('launch keeps paragraph breaks in primary text', /Line one\.\n\nLine two\./.test(r.data.text), null);
r = await call({ task: 'pagebuild', campaign: base, ad: concept(1), landing_page: { headline: 'Edited headline', benefits: 'One\nTwo', faqs: [{ q: 'Q?', a: 'A.' }] } });
check('pagebuild rebuilds the prompt from edited copy', /Headline: Edited headline/.test(r.data.build_prompt) && /One\nTwo/.test(r.data.build_prompt) && /Q\?: A\./.test(r.data.build_prompt), r.data);
r = await call({ task: 'practice', campaign: {} });
check('practice business returned', r.data.campaign.business_name === 'Glow Aesthetics' && r.data.campaign.website === '', r.data);
r = await call({ task: 'rewrite', campaign: base, field: 'image_prompt', text: 'x', ad: concept(1) });
check('rewrite on image prompt refused (edit by hand)', r.status === 400, r.data);
check('no AI called by code-only tasks', g.__mock.calls.length === 0, g.__mock.calls.length);

// ---- round 3 fixes ----
for (const [n, prod, type] of [['Apex Roofing', 'we restore roofs and gutters', ''], ['Fast Plumbing', 'water heaters delivered and installed', ''], ['Main St Barbershop', 'haircuts', ''], ['Grow Coaching', 'business workshop for owners', 'coaching'], ['Joe Auto Body Shop', 'collision repair', '']]) {
  check(`not walk-in: ${n}`, (await P({ business_name: n, product: prod, business_type: type })).walk_in === false);
}
for (const n of ['Camellia Cafe', 'Tony Pizzeria', 'Sweet Bakery']) check(`walk-in: ${n}`, (await P({ business_name: n, product: 'food' })).walk_in === true);
for (const [n, prod] of [['Peak Roofing', 'roofs with flexible financing'], ['Jumpy Bounce', 'bounce houses for rent'], ['Snap Media', 'real estate photography']]) {
  check(`not special: ${n}`, (await P({ business_name: n, product: prod })).special === false);
}
for (const [n, prod] of [['Paws Vet', 'pet wellness exams'], ['Aesthetic Landscaping', 'garden design']]) check(`not health: ${n}`, (await P({ business_name: n, product: prod })).health === false);
check('"Glow Aesthetics" still health', (await P({ business_name: 'Glow Aesthetics', product: 'facials' })).health === true);

mock(ME, () => ({ concepts: [concept(1, { why: 'Call 512-555-0199 Mon\u2013Fri, 9am\u20135pm. Open 2024-2025.', cta: 'Book Now', primary_short: 'Hello \u23F0 there . Leave your number.' }), concept(2), concept(3)], suggested_offer: 'Free consult' }));
r = await call({ task: 'ads', campaign: { ...base, website: 'https://www.24-7roofing.com', no_emojis: true } });
check('phone number kept, day and time ranges read "to"', r.data.concepts[0].why === 'Call 512-555-0199 Mon to Fri, 9am to 5pm. Open 2024 to 2025.', r.data.concepts[0].why);
check('more emojis removed, no space before punctuation', r.data.concepts[0].primary_short.includes('Hello there.') && !/\u23F0/u.test(r.data.concepts[0].primary_short), r.data.concepts[0].primary_short);
check('suggested_offer empty when she did not ask for one', r.data.suggested_offer === '', r.data.suggested_offer);
mock(ME, () => ({ concepts: [concept(1, { why: 'Tustin, CA 92780-1234. Suite 100.' }), concept(2), concept(3)], suggested_offer: '' }));
r = await call({ task: 'ads', campaign: base });
check('ZIP+4 untouched', r.data.concepts[0].why === 'Tustin, CA 92780-1234. Suite 100.', r.data.concepts[0].why);
mock(ME, () => ({ concepts: [concept(1), concept(2), concept(3)], suggested_offer: '' }));
await call({ task: 'ads', campaign: { ...base, website: 'https://www.24-7roofing.com' } });
check('website kept exactly (no "to" inside a URL)', /Website: https:\/\/www\.24-7roofing\.com/.test(lastPrompt()), null);
mock(ME, () => ({ form_headline: 'x', intro: 'x', questions: [{ question: 'How old is your roof?', options: ['0-10', '10+'] }, { question: 'How old are you?', options: ['18-30'] }], contact_fields: ['Name'], privacy_note: 'p', thank_you_headline: 't', thank_you_text: 't', cta: 'c', follow_up: 'f' }));
r = await call({ task: 'form', campaign: { business_name: 'Kelly Roofing', product: 'roofs', offer_help: true }, ad: concept(1) });
check('form keeps "How old is your roof?", drops "How old are you?"', r.data.instant_form.questions.length === 1 && /roof/.test(r.data.instant_form.questions[0].question), r.data.instant_form.questions);
check('form prompt: where the click goes + no suggested offer', /WHERE THE CLICK GOES/.test(lastPrompt()) && /Offer: none yet/.test(lastPrompt()) && !/Suggest one simple offer/.test(lastPrompt()), null);
await call({ task: 'form', campaign: { business_name: 'Camellia Cafe', product: 'breakfast' }, ad: concept(1) });
check('cafe form prompt: claim the offer wording', /form claims the offer/.test(lastPrompt()), null);
mock(ME, () => ({ business_name: 'G', business_type: '', location: '', goal: '', services: [], offers: ['See our specials', 'New patient special', 'Was $120, now $99 facial', 'LIMITED TIME OFFER - $25 off any facial', '$40 off your first massage', 'Reg. $150, now $99'], description: '', target_customer: '', differentiators: '', proof: '', credentials: '', details: [], brand_style: '' }));
r = await call({ task: 'fill', site_text: 'Glow site text here. '.repeat(20) });
check('offers: menu links and before-prices dropped, prefix stripped', JSON.stringify(r.data.offers) === JSON.stringify(['$25 off any facial', '$40 off your first massage']), r.data.offers);
mock(ME, () => { throw new Error('no AI'); });
r = await call({ task: 'launch', campaign: base, ads: [{ name: 'A', primary: 'P', headline: 'H', description: 'D', cta: 'Book Now', format: 'static' }] });
check('launch: Book Now becomes Sign Up for an Instant Form', /Button: Sign Up/.test(r.data.text), null);
r = await call({ task: 'more', campaign: { ...base, site_details: ['Open 9 to 5'] }, ad: concept(1) });
check('more versions: site facts and facts rule', /Facts from their website: Open 9 to 5/.test(r.data.text) && /must come from the answers above/.test(r.data.text), null);

// ---- round 4 fixes ----
mock(ME, () => ({ concepts: [concept(1, { headlines: ['20% Off Your First Visit', '1st Visit Free', '24/7 Emergency Plumbing', '2 for 1 Tuesdays', '- Bullet item'], descriptions: ['1. Listed', '3 Easy Steps', '50% off'] }), concept(2), concept(3)], suggested_offer: '' }));
r = await call({ task: 'ads', campaign: base });
check('leading numbers kept in headlines, only list markers removed', JSON.stringify(r.data.concepts[0].headlines) === JSON.stringify(['20% Off Your First Visit', '1st Visit Free', '24/7 Emergency Plumbing', '2 for 1 Tuesdays', 'Bullet item']), r.data.concepts[0].headlines);
check('leading numbers kept in descriptions', JSON.stringify(r.data.concepts[0].descriptions) === JSON.stringify(['Listed', '3 Easy Steps', '50% off']), r.data.concepts[0].descriptions);
mock(ME, () => ({ concepts: [concept(1, { why: 'Call (512) 555-0199 or 555-0199. We answer 24-7.' }), concept(2), concept(3)], suggested_offer: '' }));
r = await call({ task: 'ads', campaign: { ...base, business_name: '24-7 Plumbing' } });
check('phone numbers and 24-7 kept', r.data.concepts[0].why === 'Call (512) 555-0199 or 555-0199. We answer 24-7.', r.data.concepts[0].why);
check('business name kept exactly', /Business: 24-7 Plumbing/.test(lastPrompt()), null);
for (const n of ['Blue Door Coffee', "Joe's Grill", 'Hole in One Bagel Shop', 'Second Life Thrift Store', 'Spoke Bike Shop', 'Taqueria El Sol', 'Boba Time']) check(`walk-in: ${n}`, (await P({ business_name: n, product: 'x' })).walk_in === true);
for (const n of ['Lash Bar Studio', 'Grab Bar Installers']) check(`not walk-in: ${n}`, (await P({ business_name: n, product: 'x' })).walk_in === false);
for (const [n, prod] of [['Luxe Clinic', 'aesthetic clinic: neurotoxins and lip enhancement'], ['Revive', 'IV hydration and B12 shots']]) check(`health: ${n}`, (await P({ business_name: n, product: prod })).health === true);
for (const [n, prod] of [['Smith Team', 'real estate team helps buyers and sellers'], ['Jane Doe', 'financial advisor'], ['Main Insurance', 'insurance agency']]) check(`special: ${n}`, (await P({ business_name: n, product: prod })).special === true);
mock(ME, () => ({ business_name: 'G', business_type: '', location: '', goal: '', services: ['24/7 emergency service', '1st time cleaning'], offers: ['Today only: $50 off any repair', 'Free whitening ($300 value) with new patient exam', 'Buy one, get one half price', '15% off first visit'], description: '', target_customer: '', differentiators: '', proof: '', credentials: '', details: [], brand_style: '' }));
r = await call({ task: 'fill', site_text: 'Some site text here. '.repeat(20) });
check('fill: offers keep conditions, value offers and BOGO, numbers intact', JSON.stringify(r.data.offers) === JSON.stringify(['Today only: $50 off any repair', 'Free whitening ($300 value) with new patient exam', 'Buy one, get one half price']), r.data.offers);
check('fill: services keep leading numbers', JSON.stringify(r.data.services) === JSON.stringify(['24/7 emergency service', '1st time cleaning']), r.data.services);
mock(ME, () => ({ text: 'x' }));
await call({ task: 'rewrite', campaign: base, field: 'headline_1', text: 'old', style: 'clearer', ad: concept(1) });
check('rewrite prompt says where the click goes', /WHERE THE CLICK GOES: An Instant Form/.test(lastPrompt()), null);
mock(ME, () => ({}));
r = await call({ task: 'form', campaign: base, ad: concept(1) });
const plain = await adsAI(new Request('https://fn/', { method: 'POST', body: JSON.stringify({ task: 'form', campaign: base }) }));
check('adsAI file does not serve "form" (it lives in adsExtra)', plain.status === 400, plain.status);
const plain2 = await adsExtra(new Request('https://fn/', { method: 'POST', body: JSON.stringify({ task: 'ads', campaign: base }) }));
check('adsExtra file does not serve "ads"', plain2.status === 400, plain2.status);

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const x of fails) console.log('FAIL: ' + x);
Deno.exit(fails.length ? 1 : 0);
