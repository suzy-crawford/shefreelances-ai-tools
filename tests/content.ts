// Scenario tests for contentAI and contentExtra (AI Content Creator).
// Run: deno run --allow-read --import-map=import_map.json content.ts
import contentAI from '../content-creator/contentAI.ts';
import contentExtra from '../content-creator/contentExtra.ts';

const g = globalThis as any;
let pass = 0;
const fails: string[] = [];
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) pass++;
  else fails.push(`${name}${detail === undefined ? '' : `  -> ${JSON.stringify(detail)?.slice(0, 500)}`}`);
}
function mock(user: unknown, llm: (a: any, n: number) => unknown) {
  g.__mock = { user, llm, calls: [] };
}
const EXTRA = ['redo_pillar', 'redo_hook', 'redo_day', 'rewrite'];
async function call(body: any, fn?: any) {
  const f = fn || (EXTRA.includes(body?.task) ? contentExtra : contentAI);
  const res = await f(new Request('https://fn/', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
const ME = { id: 'u' };
const prompts = () => g.__mock.calls.map((c: any) => c.prompt as string);
const dash = /[–—]/;

const spa = { business_name: 'Glow Med Spa', location: 'Austin, TX', business_description: 'Med spa for facials and wrinkle relaxers', offer_text: '$50 off your first facial', services: ['Facials', 'Wrinkle relaxers'], audience: 'Busy professionals', cta_type: 'keyword', cta_detail: 'GLOW', length: 7, formats: ['talking_head', 'broll', 'carousel'] };
const roof = { business_name: 'Kelly Roofing', location: 'Tulsa, OK', business_description: 'Roof repair and replacement', offer_text: 'Free roof inspection', services: ['Roof repair'], length: 14, formats: ['carousel', 'broll'] };
const PILLARS = { positioning: 'Glow helps busy people — calm facials.', pillars: [{ name: 'First Visits', about: 'a', leads_to_offer: 'b' }, { name: 'Skin Basics', about: 'a', leads_to_offer: 'b' }, { name: 'Behind The Desk', about: 'a', leads_to_offer: 'b' }, { name: 'Extra', about: 'x', leads_to_offer: 'y' }] };
const cal = (n: number, extra: (i: number) => any = () => ({})) => ({ calendar: Array.from({ length: n }, (_, i) => ({ day: i + 10, pillar: ['first visits', 'Skin Basics', 'Nope'][i % 3], format: 'talking_head', goal: 'reach', hook: `Hook ${i + 1}`, idea: `Idea ${i + 1}`, cta: 'Save this', ...extra(i) })) });
function strategyLLM(n: number, calExtra?: (i: number) => any, opts: { hooksFail?: boolean } = {}) {
  return (a: any) => {
    if (/Return JSON:\n- positioning/.test(a.prompt)) return PILLARS;
    if (/Write 7 hooks for pillar/.test(a.prompt)) { if (opts.hooksFail) throw new Error('x'); return { hooks: ['1. One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'] }; }
    if (/content calendar|calendar, exactly/.test(a.prompt)) return cal(n, calExtra);
    return {};
  };
}

// ---- access and routing ----
mock(null, () => ({}));
let r = await call({ task: 'strategy', plan: spa });
check('401 when not logged in', r.status === 401, r);
mock(ME, () => ({}));
r = await call({ task: 'nope', plan: spa });
check('unknown task -> 400', r.status === 400, r);
r = await call({ task: 'rewrite', plan: spa, text: 'x' }, contentAI);
check('contentAI does not serve rewrite', r.status === 400, r);
r = await call({ task: 'posts', plan: spa, days: [1] }, contentExtra);
check('contentExtra does not serve posts', r.status === 400, r);

// ---- fill ----
r = await call({ task: 'fill', site_text: 'short' });
check('fill: too little text -> 400', r.status === 400, r);
mock(ME, () => ({ business_name: 'Glow Med Spa', location: 'Austin, TX', services: ['- Facials', 'Peels'], offers: [], description: 'Facials — and peels.', target_customer: 'Locals', brand_style: 'Calm' }));
r = await call({ task: 'fill', site_text: 'Glow Med Spa site. '.repeat(20) });
check('fill: fields mapped, offer falls back to first service, dashes cleaned', r.status === 200 && r.data.fields.offer_text === 'Facials' && r.data.services[0] === 'Facials' && !dash.test(JSON.stringify(r.data)), r.data);
check('fill: uses the cheap default model', !g.__mock.calls[0].model, g.__mock.calls[0].model);

// ---- strategy ----
mock(ME, strategyLLM(7));
r = await call({ task: 'strategy', plan: { ...spa, business_name: '' } });
check('strategy: needs a business name -> 400', r.status === 400, r);
r = await call({ task: 'strategy', plan: spa });
let st = r.data.strategy;
check('strategy: 200, 3 pillars kept', r.status === 200 && st.pillars.length === 3, r);
check('strategy: 1 pillar call then 3 hook calls + calendar, all Claude', g.__mock.calls.length === 5 && g.__mock.calls.every((c: any) => c.model === 'claude-sonnet-5'), g.__mock.calls.length);
check('strategy: 21 hooks, 7 per pillar, list markers stripped', st.hooks.length === 21 && st.hooks.filter((h: any) => h.pillar === 'Skin Basics').length === 7 && st.hooks[0].line === 'One', st.hooks.slice(0, 2));
check('strategy: calendar exactly 7, days 1 to 7', st.calendar.length === 7 && st.calendar.map((d: any) => d.day).join() === '1,2,3,4,5,6,7', st.calendar.map((d: any) => d.day));
check('strategy: pillar names matched case-insensitively, unknown pillar gets one', st.calendar[0].pillar === 'First Visits' && st.calendar.every((d: any) => ['First Visits', 'Skin Basics', 'Behind The Desk'].includes(d.pillar)), st.calendar.map((d: any) => d.pillar));
check('strategy: at least 1 offer day with the client CTA', st.calendar.some((d: any) => d.goal === 'offer' && d.cta === 'Comment a keyword: GLOW'), st.calendar.map((d: any) => [d.goal, d.cta]));
check('strategy: em dash cleaned in positioning', !dash.test(st.positioning), st.positioning);
check('strategy: voice guide + rules in hook prompts, health rule for med spa', prompts().filter((x: string) => /Write 7 hooks/.test(x)).every((x: string) => /SPEAKER: the business owner/.test(x) && /Health and beauty: no claims/.test(x)), null);
check('strategy: calendar prompt has length, formats and CTA', /exactly 7 posts/.test(prompts().find((x: string) => /calendar, exactly/.test(x))) && /talking_head, broll, carousel/.test(prompts().join()) && /Comment a keyword: GLOW/.test(prompts().join()), null);

mock(ME, strategyLLM(14, (i) => ({ format: i % 2 ? 'talking_head' : 'carousel', goal: i === 2 ? 'Viral' : 'reach' })));
r = await call({ task: 'strategy', plan: roof });
st = r.data.strategy;
check('strategy: unchosen format replaced with chosen ones', st.calendar.every((d: any) => ['carousel', 'broll'].includes(d.format)), st.calendar.map((d: any) => d.format));
check('strategy: bad goal becomes reach', st.calendar[2].goal === 'reach' || st.calendar[2].goal === 'offer', st.calendar[2]);
check('strategy: 14 days get at least 3 offer days', st.calendar.filter((d: any) => d.goal === 'offer').length >= 3, st.calendar.map((d: any) => d.goal));
check('strategy: no health rule for a roofer', !/Health and beauty: no claims/.test(prompts().join()), null);
check('strategy: Just follow default CTA when type missing uses keyword label', /Comment a keyword/.test(prompts().join()), null);

mock(ME, strategyLLM(10));
r = await call({ task: 'strategy', plan: spa });
check('strategy: too many days cut to the chosen length', r.status === 200 && r.data.strategy.calendar.length === 7, r.data.strategy?.calendar?.length);
mock(ME, strategyLLM(5));
r = await call({ task: 'strategy', plan: spa });
check('strategy: short calendar -> plain error', r.status === 500 && /planned 5 of 7 days/.test(r.data.error), r.data);
mock(ME, strategyLLM(7, undefined, { hooksFail: true }));
r = await call({ task: 'strategy', plan: spa });
check('strategy: hook calls failing still returns the plan', r.status === 200 && r.data.strategy.calendar.length === 7, r.status);
mock(ME, (a: any) => (/Return JSON:\n- positioning/.test(a.prompt) ? { positioning: 'x', pillars: [{ name: 'A' }] } : {}));
r = await call({ task: 'strategy', plan: spa });
check('strategy: fewer than 3 pillars -> plain error', r.status === 500 && /didn't finish the plan/.test(r.data.error), r.data);
mock(ME, strategyLLM(7));
await call({ task: 'strategy', plan: { ...spa, audit_notes: 'Reels of the room do best', strategy: { pillars: [{ name: 'Old One' }] } }, redo: true, note: 'focus on Botox' });
r = await call({ task: 'strategy', plan: { ...spa, audit_notes: 'Reels of the room do best', strategy: { pillars: [{ name: 'Old One' }] } }, redo: true, note: 'focus on Botox' } as any);
check('strategy: redo note + last pillars + audit in the prompt', /THIS IS A REDO.*focus on Botox.*Old One/s.test(prompts()[0]) && /USE THE AUDIT/.test(prompts()[0]) && /Reels of the room do best/.test(prompts()[0]), prompts()[0].slice(0, 200));
mock(ME, (a: any) => { if (a.model) throw new Error('model unavailable'); return strategyLLM(7)(a); });
r = await call({ task: 'strategy', plan: spa });
check('strategy: falls back to default model when Claude fails', r.status === 200 && g.__mock.calls.filter((c: any) => !c.model).length === 5, g.__mock.calls.map((c: any) => c.model));

// ---- examples don't leak; offer days push the offer ----
mock(ME, strategyLLM(7, (i) => (i === 3 ? { goal: 'offer', cta: 'Just follow so you do not miss the next one.' } : {})));
r = await call({ task: 'strategy', plan: spa });
check('offer day: follow/save CTA replaced with the client CTA', r.data.strategy.calendar[3].goal === 'offer' && r.data.strategy.calendar[3].cta === 'Comment a keyword: GLOW', r.data.strategy.calendar[3]);
check('examples: labeled as other businesses, no nurse or facial example left', /from OTHER businesses and only show the style/.test(prompts().join()) && !/A nurse checks your skin/.test(prompts().join()) && !/Comment FACIAL/.test(prompts().join()), null);
mock(ME, strategyLLM(7, (i) => (i === 3 ? { goal: 'offer', cta: 'Comment AFTERCARE and I will send the list' } : {})));
r = await call({ task: 'strategy', plan: spa });
check('rules: no invented client habits, staff actions or comparisons', /Never invent what their clients do, say, feel or ask/.test(prompts().join()) && /comparisons with other businesses/.test(prompts().join()), null);
check('offer day: a real specific CTA is kept', r.data.strategy.calendar[3].cta === 'Comment AFTERCARE and I will send the list', r.data.strategy.calendar[3].cta);
mock(ME, strategyLLM(7, (i) => (i === 3 ? { goal: 'offer', cta: 'Follow for more' } : {})));
r = await call({ task: 'strategy', plan: { ...spa, cta_type: 'follow' } });
check('offer day: Just follow clients keep a follow CTA', r.data.strategy.calendar[3].cta === 'Follow for more', r.data.strategy.calendar[3].cta);

// ---- posts ----
const stratPlan = { ...spa, strategy: { positioning: 'Glow helps.', pillars: PILLARS.pillars.slice(0, 3), calendar: [
  { day: 1, pillar: 'First Visits', format: 'talking_head', goal: 'trust', hook: 'Your first facial, step by step.', idea: 'What happens', cta: 'Comment GLOW' },
  { day: 2, pillar: 'Skin Basics', format: 'broll', goal: 'reach', hook: 'Three things before a peel.', idea: 'Prep', cta: 'Save this' },
  { day: 3, pillar: 'Behind The Desk', format: 'carousel', goal: 'offer', hook: 'What $50 off covers.', idea: 'Offer', cta: 'Comment GLOW' },
  { day: 4, pillar: 'First Visits', format: 'reel', goal: 'reach', hook: 'Hook 4', idea: 'Idea 4', cta: '' },
] } };
const POST = { hook: '', script: 'Line one — calm.\nLine two.', visual: 'Standing at the front desk.', on_screen: ['1. First', 'Second', 'Third', 'Fourth'], slides: [{ text: 'S1', visual: 'v' }, { text: 'S2', visual: 'v' }, { text: 'S3', visual: 'v' }, { text: 'S4', visual: 'v' }], caption: 'First line. Second line. Third line. Last line. \u{1F600}\u{1F600}\u{1F600} #glow #facial #austin #medspa #skin #extra #more' };
mock(ME, () => ({ post: POST }));
r = await call({ task: 'posts', plan: stratPlan, days: [1, 2, 3, 4, 5, 6, 7] });
let posts = r.data.posts;
check('posts: one Claude call per day, max 5 days, unknown days skipped', r.status === 200 && g.__mock.calls.length === 4 && posts.length === 4 && g.__mock.calls.every((c: any) => c.model === 'claude-sonnet-5'), [g.__mock.calls.length, posts?.length]);
check('posts: talking head keeps script, drops slides and on_screen', posts[0].format === 'talking_head' && /Line one, calm\.\nLine two\./.test(posts[0].script) && !posts[0].slides.length && !posts[0].on_screen.length, posts[0]);
check('posts: empty hook falls back to the calendar hook', posts[0].hook === 'Your first facial, step by step.', posts[0].hook);
check('posts: broll keeps on_screen (markers stripped), no script', posts[1].format === 'broll' && posts[1].on_screen[0] === 'First' && posts[1].script === '', posts[1]);
check('posts: carousel keeps slides, no script', posts[2].format === 'carousel' && posts[2].slides.length === 4 && posts[2].script === '', posts[2]);
check('posts: unknown format falls back to a chosen one', FORMATSOK(posts[3].format), posts[3].format);
function FORMATSOK(f: string) { return ['talking_head', 'broll', 'carousel'].includes(f); }
check('posts: caption hashtags last line, max 5', /\n\n(#\S+ ){4}#\S+$/.test(posts[0].caption) && !/#extra/.test(posts[0].caption), posts[0].caption);
check('posts: caption at most 2 emojis, paragraphs', ((posts[0].caption.match(/\u{1F600}/gu) || []).length === 2) && /\n\n/.test(posts[0].caption), posts[0].caption);
check('posts: no em dashes anywhere', !dash.test(JSON.stringify(posts)), null);
check('posts: prompt has the day, format needs, voice guide, CTA', prompts().some((x: string) => /day 3, format carousel/.test(x) && /slides \(6 to 8/.test(x) && /SPEAKER/.test(x) && /Comment GLOW/.test(x)), null);
check('posts: empty cta becomes the client CTA', prompts().some((x: string) => /day 4,.*call to action: Comment a keyword: GLOW/.test(x)), null);
mock(ME, () => ({ post: { ...POST, caption: 'Treat yourself to a glow. #glow #a #b' } }));
r = await call({ task: 'posts', plan: stratPlan, days: [1] });
check('posts: banned phrase flagged as a warning, not blocked', r.status === 200 && /Treat yourself/i.test(r.data.posts[0].warnings[0]), r.data.posts?.[0]?.warnings);
mock(ME, () => ({ post: { hook: 'h', script: '', visual: '', on_screen: ['one'], slides: [], caption: 'c' } }));
r = await call({ task: 'posts', plan: stratPlan, days: [1, 2, 3] });
check('posts: missing parts flagged per format', r.data.posts[0].warnings.some((w: string) => /script is missing/.test(w)) && r.data.posts[1].warnings.some((w: string) => /Fewer than 3 lines/.test(w)) && r.data.posts[2].warnings.some((w: string) => /Fewer than 4 slides/.test(w)), r.data.posts.map((p: any) => p.warnings));
mock(ME, (a: any) => { if (/day 2,/.test(a.prompt)) throw new Error('slow'); return { post: POST }; });
r = await call({ task: 'posts', plan: stratPlan, days: [1, 2, 3] });
check('posts: a failed day comes back in failed, others kept', r.status === 200 && r.data.posts.length === 2 && JSON.stringify(r.data.failed) === '[2]', r.data.failed);
mock(ME, () => { throw new Error('boom'); });
r = await call({ task: 'posts', plan: stratPlan, days: [1, 2] });
check('posts: all fail -> plain error', r.status === 500 && /took too long/.test(r.data.error), r.data);
mock(ME, () => ({}));
r = await call({ task: 'posts', plan: stratPlan, days: [] });
check('posts: no days -> 400', r.status === 400, r);
mock(ME, (a: any) => (a.model ? (() => { throw new Error('x'); })() : { post: POST }));
r = await call({ task: 'posts', plan: stratPlan, days: [1] });
check('posts: falls back to the default model', r.status === 200 && g.__mock.calls.length === 2 && !g.__mock.calls[1].model, g.__mock.calls.map((c: any) => c.model));

// ---- redo and rewrite (contentExtra) ----
mock(ME, () => ({ pillar: { name: 'Prices — Plainly', about: 'a', leads_to_offer: 'b' }, hooks: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'], days: [{ day: 1, hook: 'n1', idea: 'i1' }, { day: 2, hook: 'nope', idea: 'x' }, { day: 4, hook: 'n4', idea: 'i4' }] }));
r = await call({ task: 'redo_pillar', plan: stratPlan, index: 0, note: 'make one about pricing' });
check('redo_pillar: new pillar, 7 hooks, only its own days', r.status === 200 && r.data.pillar.name === 'Prices, Plainly' && r.data.hooks.length === 7 && r.data.days.map((d: any) => d.day).join() === '1,4' && r.data.old_name === 'First Visits', r.data);
check('redo_pillar: note and its days in the prompt', /make one about pricing/.test(prompts()[0]) && /day 1 \(talking_head, trust\); day 4/.test(prompts()[0]), null);
r = await call({ task: 'redo_pillar', plan: stratPlan, index: 7 });
check('redo_pillar: missing pillar -> 400', r.status === 400, r);
mock(ME, () => ({ text: 'Here is what your first visit looks like — start to finish.' }));
r = await call({ task: 'redo_hook', plan: stratPlan, pillar: 'First Visits', text: 'Old hook', note: '' });
check('redo_hook: one clean hook', r.status === 200 && r.data.text === 'Here is what your first visit looks like, start to finish.', r.data);
check('redo_hook: blank note asks for different and better', /clearly different from the current one/.test(prompts()[0]), null);
mock(ME, () => ({ format: 'talking_head', hook: '', idea: 'New idea', cta: '' }));
r = await call({ task: 'redo_day', plan: { ...stratPlan, formats: ['carousel', 'broll'] }, day: 3, note: 'make it a reel' });
check('redo_day: format outside the chosen ones is refused, empty keeps old', r.status === 200 && r.data.format === 'carousel' && r.data.hook === 'What $50 off covers.' && r.data.idea === 'New idea' && r.data.cta === 'Comment GLOW', r.data);
r = await call({ task: 'redo_day', plan: stratPlan, day: 99 });
check('redo_day: missing day -> 400', r.status === 400, r);
mock(ME, () => ({ text: 'Short caption here. Another line. Last line. #a #b #c' }));
r = await call({ task: 'rewrite', plan: stratPlan, label: 'Caption', text: 'Long caption', style: 'shorter', format: 'carousel', hook: 'What $50 off covers.' });
check('rewrite: caption cleaned with hashtags last', r.status === 200 && /\n\n#a #b #c$/.test(r.data.text), r.data);
check('rewrite: style text, voice guide, keep placeholders', /Make it shorter/.test(prompts()[0]) && /SPEAKER/.test(prompts()[0]) && /\[placeholder in square brackets\] exactly/.test(prompts()[0]), null);
mock(ME, () => ({ text: 'Glow helps busy people get calm facials.' }));
r = await call({ task: 'rewrite', plan: stratPlan, label: 'positioning', text: 'Old', how: 'mention Austin' });
check('rewrite: positioning uses its own prompt and the how', r.status === 200 && /one-line positioning statement/.test(prompts()[0]) && /mention Austin/.test(prompts()[0]), prompts()[0].slice(0, 120));
r = await call({ task: 'rewrite', plan: stratPlan, label: 'caption', text: '  ' });
check('rewrite: nothing to rewrite -> 400', r.status === 400, r);
mock(ME, () => ({ text: 'Line one.\nLine two.' }));
r = await call({ task: 'rewrite', plan: stratPlan, label: 'script', text: 'x' });
check('rewrite: script keeps its line breaks', r.data.text === 'Line one.\nLine two.', r.data);

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const x of fails) console.log('FAIL: ' + x);
Deno.exit(fails.length ? 1 : 0);
