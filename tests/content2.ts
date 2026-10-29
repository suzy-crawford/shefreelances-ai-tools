// Scenario tests for contentAI / contentExtra (AI Content Creator).
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
function mock(user: unknown, llm: (a: any, n: number) => unknown) { g.__mock = { user, llm, calls: [] }; }
async function call(body: unknown) {
  const task = (body as any)?.task;
  const fn = ['redo_pillar', 'redo_hook', 'redo_day', 'rewrite'].includes(task) ? contentExtra : contentAI;
  const res = await fn(new Request('https://fn/', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
const ME = { id: 'u' };
const dash = /[–—]/;
const base = { business_name: 'Glow Med Spa', location: 'Austin, TX', business_description: 'Med spa for facials and wrinkle relaxers', offer_text: '$50 off a first facial', audience: 'busy women nearby', cta_type: 'keyword', cta_detail: 'GLOW', length: 7, formats: ['talking_head', 'broll', 'carousel'] };
const pillarsAns = { positioning: 'Facials for busy people in Austin — done in under an hour.', pillars: [{ name: 'First visits', about: 'What happens', leads_to_offer: 'x' }, { name: 'Skin basics', about: 'b', leads_to_offer: 'y' }, { name: 'Behind the desk', about: 'c', leads_to_offer: 'z' }, { name: 'Extra', about: 'd', leads_to_offer: 'w' }] };
const cal = (n: number, extra: any = {}) => ({ calendar: Array.from({ length: n }, (_, i) => ({ day: i + 10, pillar: ['First visits', 'skin basics', 'Nope'][i % 3], format: i === 1 ? 'tiktok' : 'carousel', goal: i === 2 ? 'sell' : 'reach', hook: `Hook ${i + 1}`, idea: `Idea ${i + 1}`, cta: 'Save this', ...extra })) });
function strategyLLM(a: any) {
  if (a.response_json_schema?.properties?.positioning) return pillarsAns;
  if (a.response_json_schema?.properties?.hooks) return { hooks: ['1. One', '2. Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'] };
  if (a.response_json_schema?.properties?.calendar) return cal(9);
  return {};
}

// ---- access ----
mock(null, () => ({}));
let r = await call({ task: 'strategy', plan: base });
check('401 when not logged in', r.status === 401, r);
mock(ME, () => ({}));
r = await call({ task: 'nope', plan: base });
check('unknown task -> 400', r.status === 400, r);
r = await call({ task: 'redo_pillar', plan: base });
check('contentAI does not serve redo tasks (contentExtra does)', r.status === 400, r);

// ---- fill ----
mock(ME, () => ({ business_name: 'Glow Med Spa', location: 'Austin, TX', services: ['- Facials', 'Peels'], offers: [], description: 'Facials — and more.', target_customer: '', brand_style: 'calm' }));
r = await call({ task: 'fill', site_text: 'Glow Med Spa offers facials. '.repeat(10) });
check('fill: fields cleaned, offer falls back to first service, cheap model', r.status === 200 && r.data.fields.offer_text === 'Facials' && r.data.services[0] === 'Facials' && !dash.test(JSON.stringify(r.data)) && !g.__mock.calls[0].model, r.data);
r = await call({ task: 'fill', site_text: 'short' });
check('fill: too little text -> 400', r.status === 400, r);

// ---- strategy ----
mock(ME, strategyLLM);
r = await call({ task: 'strategy', plan: base });
const st = r.data.strategy;
check('strategy: 200, 3 pillars kept, positioning cleaned', r.status === 200 && st.pillars.length === 3 && !dash.test(st.positioning), r.data);
check('strategy: 21 hooks, 7 per pillar, list markers removed', st.hooks.length === 21 && st.hooks[0].line === 'One' && st.hooks.filter((h: any) => h.pillar === 'Skin basics').length === 7, st.hooks.slice(0, 2));
check('strategy: calendar cut to 7 and renumbered 1..7', st.calendar.length === 7 && st.calendar.map((d: any) => d.day).join() === '1,2,3,4,5,6,7', st.calendar.map((d: any) => d.day));
check('strategy: unknown pillar mapped, case fixed', st.calendar[1].pillar === 'Skin basics' && ['First visits', 'Skin basics', 'Behind the desk'].includes(st.calendar[2].pillar), st.calendar.slice(0, 3));
check('strategy: bad format replaced with a chosen one, bad goal -> reach', ['talking_head', 'broll', 'carousel'].includes(st.calendar[1].format) && st.calendar[2].goal === 'reach', st.calendar.slice(1, 3));
check('strategy: at least one offer post with the client CTA', st.calendar.some((d: any) => d.goal === 'offer' && d.cta === 'Comment a keyword: GLOW'), st.calendar.map((d: any) => d.goal));
check('strategy: Claude writes it, 5 calls (pillars, 3 hook sets, calendar)', g.__mock.calls.length === 5 && g.__mock.calls.every((x: any) => x.model === 'claude-sonnet-5'), g.__mock.calls.length);
check('strategy: voice guide + rules in the hook and calendar prompts', g.__mock.calls.slice(1).every((x: any) => /VOICE GUIDE/.test(x.prompt) && /RULES/.test(x.prompt)), null);
check('strategy: health business gets the health rule', /Health and beauty: no claims/.test(g.__mock.calls[0].prompt), null);
mock(ME, strategyLLM);
r = await call({ task: 'strategy', plan: { ...base, formats: ['broll'] } });
check('strategy: only chosen formats used', r.data.strategy.calendar.every((d: any) => d.format === 'broll'), r.data);
mock(ME, strategyLLM);
r = await call({ task: 'strategy', plan: { ...base, length: 14 } });
check('strategy: 9 of 14 days -> plain error', r.status === 500 && /9 of 14/.test(r.data.error), r);
mock(ME, (a: any) => (a.response_json_schema?.properties?.calendar ? cal(14) : strategyLLM(a)));
r = await call({ task: 'strategy', plan: { ...base, length: 14 } });
check('strategy: 14 days, about 1 in 5 offer posts', r.data.strategy.calendar.length === 14 && r.data.strategy.calendar.filter((d: any) => d.goal === 'offer').length >= 3, r.data.strategy?.calendar?.map((d: any) => d.goal));
mock(ME, (a: any) => (a.response_json_schema?.properties?.hooks ? (() => { throw new Error('slow'); })() : strategyLLM(a)));
r = await call({ task: 'strategy', plan: base });
check('strategy: hooks that fail fall back, plan still returns', r.status === 200 && r.data.strategy.calendar.length === 7, r.status);
mock(ME, strategyLLM);
await call({ task: 'strategy', plan: { ...base, audit_notes: 'Reels of the room do well', strategy: { pillars: [{ name: 'Old one' }] } }, redo: true, note: 'focus more on peels' });
check('strategy: redo note, old pillars and audit go in', /THIS IS A REDO/.test(g.__mock.calls[0].prompt) && /focus more on peels/.test(g.__mock.calls[0].prompt) && /Old one/.test(g.__mock.calls[0].prompt) && /USE THE AUDIT/.test(g.__mock.calls[0].prompt), null);
mock(ME, strategyLLM);
r = await call({ task: 'strategy', plan: { ...base, business_name: '' } });
check('strategy: needs a business name', r.status === 400, r);
mock(ME, (a: any) => (a.response_json_schema?.properties?.positioning ? { positioning: 'x', pillars: [] } : strategyLLM(a)));
r = await call({ task: 'strategy', plan: base });
check('strategy: fewer than 3 pillars -> plain error', r.status === 500 && /didn't finish/.test(r.data.error), r);

// ---- posts ----
const planned = { ...base, strategy: { positioning: 'P', pillars: pillarsAns.pillars.slice(0, 3), calendar: [
  { day: 1, pillar: 'First visits', format: 'talking_head', goal: 'reach', hook: 'Day one hook', idea: 'i1', cta: 'Save this' },
  { day: 2, pillar: 'Skin basics', format: 'broll', goal: 'trust', hook: 'Day two hook', idea: 'i2', cta: '' },
  { day: 3, pillar: 'Behind the desk', format: 'carousel', goal: 'offer', hook: 'Day three hook', idea: 'i3', cta: 'Comment GLOW' },
] } };
const postAns = { post: { hook: '', script: 'Line one.\nLine two — here.', visual: 'At the desk', on_screen: ['1. First', 'Second', 'Third', 'Fourth'], slides: [{ text: 'S1', visual: 'v' }, { text: 'S2', visual: 'v' }, { text: 'S3', visual: 'v' }, { text: 'S4', visual: 'v' }], caption: 'First sentence here. Second one. Third one. Last one \u{1F600}\u{1F600}\u{1F600}. #glow #facial #austin #a #b #c #d' } };
mock(ME, () => postAns);
r = await call({ task: 'posts', plan: planned, days: [1, 2, 3] });
const [p1, p2, p3] = r.data.posts || [];
check('posts: 3 written, one Claude call each', r.status === 200 && r.data.posts.length === 3 && g.__mock.calls.length === 3 && g.__mock.calls.every((x: any) => x.model === 'claude-sonnet-5'), r.status);
check('posts: empty hook uses the calendar hook', p1.hook === 'Day one hook', p1.hook);
check('posts: talking head keeps script lines, no dashes; no b-roll/slides', /Line one\.\nLine two, here\./.test(p1.script) && p1.on_screen.length === 0 && p1.slides.length === 0, p1);
check('posts: b-roll lines cleaned, no script', p2.on_screen[0] === 'First' && p2.script === '' && p2.slides.length === 0, p2);
check('posts: carousel slides kept', p3.slides.length === 4 && p3.script === '', p3);
check('posts: caption max 5 hashtags on the last line, max 2 emojis', /\n\n#glow #facial #austin #a #b$/.test(p1.caption) && (p1.caption.match(/\u{1F600}/gu) || []).length === 2, p1.caption);
check('posts: each prompt has only its format needs + voice guide', /talking_head: hook/.test(g.__mock.calls[0].prompt) && !/carousel: hook/.test(g.__mock.calls[0].prompt) && /VOICE GUIDE/.test(g.__mock.calls[0].prompt), null);
check('posts: empty CTA uses the client CTA', /call to action: Comment a keyword: GLOW/.test(g.__mock.calls[1].prompt), null);
mock(ME, () => ({ post: { ...postAns.post, hook: 'Ever wonder what a facial is like?' } }));
r = await call({ task: 'posts', plan: planned, days: [1] });
check('posts: banned phrase flagged, not blocked', r.status === 200 && r.data.posts[0].warnings.some((w: string) => /Ever wonder/i.test(w)), r.data.posts?.[0]?.warnings);
mock(ME, () => ({ post: { ...postAns.post, script: '', on_screen: ['one'], slides: [] } }));
r = await call({ task: 'posts', plan: planned, days: [1, 2, 3] });
check('posts: missing parts flagged per format', r.data.posts[0].warnings.some((w: string) => /script is missing/.test(w)) && r.data.posts[1].warnings.some((w: string) => /Fewer than 3/.test(w)) && r.data.posts[2].warnings.some((w: string) => /Fewer than 4 slides/.test(w)), r.data.posts.map((x: any) => x.warnings));
mock(ME, (a: any) => { if (/day 2,/.test(a.prompt)) throw new Error('slow'); return postAns; });
r = await call({ task: 'posts', plan: planned, days: [1, 2, 3] });
check('posts: one that fails twice comes back in failed, others saved', r.status === 200 && r.data.posts.length === 2 && JSON.stringify(r.data.failed) === '[2]', r.data);
mock(ME, () => postAns);
r = await call({ task: 'posts', plan: planned, days: [1, 2, 3, 4, 5, 6, 7, 8] });
check('posts: unknown days ignored, at most 5 asked', r.data.posts.length === 3, r.data.posts?.length);
r = await call({ task: 'posts', plan: planned, days: [] });
check('posts: no days -> 400', r.status === 400, r);
mock(ME, () => { throw new Error('boom'); });
r = await call({ task: 'posts', plan: planned, days: [1] });
check('posts: all fail -> plain error', r.status === 500 && /too long/.test(r.data.error), r);

// ---- redo + rewrite (contentExtra) ----
mock(ME, () => ({ pillar: { name: 'Pricing — plain', about: 'a', leads_to_offer: 'b' }, hooks: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'], days: [{ day: 1, hook: 'nh', idea: 'ni' }, { day: 3, hook: 'not mine', idea: 'x' }] }));
r = await call({ task: 'redo_pillar', plan: planned, index: 0, note: 'make it about pricing' });
check('redo pillar: new pillar, 7 hooks, only its own days', r.status === 200 && r.data.pillar.name === 'Pricing, plain' && r.data.hooks.length === 7 && r.data.days.length === 1 && r.data.days[0].day === 1 && r.data.old_name === 'First visits', r.data);
check('redo pillar: note and its days in the prompt', /make it about pricing/.test(g.__mock.calls[0].prompt) && /day 1 \(talking_head, reach\)/.test(g.__mock.calls[0].prompt), null);
r = await call({ task: 'redo_pillar', plan: planned, index: 7 });
check('redo pillar: bad index -> 400', r.status === 400, r);
mock(ME, () => ({ text: 'New hook — better' }));
r = await call({ task: 'redo_hook', plan: planned, pillar: 'Skin basics', text: 'Old hook' });
check('redo hook: one clean hook, default note', r.data.text === 'New hook, better' && /Make it clearly different/.test(g.__mock.calls[0].prompt), r.data);
mock(ME, () => ({ format: 'tiktok', hook: '', idea: 'New idea', cta: 'Comment GLOW' }));
r = await call({ task: 'redo_day', plan: { ...planned, formats: ['talking_head', 'broll'] }, day: 2 });
check('redo day: bad format keeps old, empty hook keeps old', r.data.format === 'broll' && r.data.hook === 'Day two hook' && r.data.idea === 'New idea', r.data);
r = await call({ task: 'redo_day', plan: planned, day: 99 });
check('redo day: missing day -> 400', r.status === 400, r);
mock(ME, () => ({ text: 'Shorter caption. #a #b' }));
r = await call({ task: 'rewrite', plan: planned, label: 'caption', text: 'Long caption', style: 'shorter', format: 'carousel', hook: 'H' });
check('rewrite: caption cleaned, style text used, Claude', r.data.text === 'Shorter caption.\n\n#a #b' && /Make it shorter/.test(g.__mock.calls[0].prompt) && g.__mock.calls[0].model === 'claude-sonnet-5', r.data);
mock(ME, () => ({ text: 'Who we help.' }));
r = await call({ task: 'rewrite', plan: planned, label: 'positioning', text: 'Old', how: 'mention Austin' });
check('rewrite: positioning prompt, custom how', r.data.text === 'Who we help.' && /positioning statement/.test(g.__mock.calls[0].prompt) && /mention Austin/.test(g.__mock.calls[0].prompt), r.data);
r = await call({ task: 'rewrite', plan: planned, label: 'caption', text: '  ' });
check('rewrite: empty text -> 400', r.status === 400, r);
mock(ME, (a: any) => { if (a.model) throw new Error('nope'); return { text: 'ok' }; });
r = await call({ task: 'rewrite', plan: planned, label: 'hook', text: 'x' });
check('rewrite: falls back to the default model', r.status === 200 && r.data.text === 'ok' && g.__mock.calls.length === 2, r);

// ---- files ----
const a = await Deno.readTextFile(new URL('../content-creator/contentAI.ts', import.meta.url));
const x = await Deno.readTextFile(new URL('../content-creator/contentExtra.ts', import.meta.url));
check('files: no em or en dashes, ASCII only', ![a, x].some((t) => /[^\x00-\x7F]/.test(t)), null);
check('files: each ends with the default function', /export default async function/.test(a) && /export default async function/.test(x), null);

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('FAIL: ' + f);
Deno.exit(fails.length ? 1 : 0);
