import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Content Creator, part 1: website fill, the content strategy and the posts, with their exact AI instructions and rules.
// task "fill": facts from their website text. "strategy": positioning, 3 pillars, 21 hooks and the calendar.
// "posts": up to 5 posts at once, one AI call each.


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

const WRITER = 'claude-sonnet-5';
const FORMATS = ['talking_head', 'broll', 'carousel'];
const FORMAT_LABEL: Record<string, string> = { talking_head: 'Talking head reel', broll: 'B-roll reel', carousel: 'Carousel' };
const GOALS = ['reach', 'trust', 'offer'];
const CTA_LABEL: Record<string, string> = { keyword: 'Comment a keyword', dm: 'Send a DM', book: 'Book a call or visit', link: 'Click the link in bio', follow: 'Just follow' };
const HEALTH = /(med ?spa|aesthetic|botox|\btox\b|filler|injectabl|laser|facial|skin ?care|derma|dental|dentist|orthodont|invisalign|\bteeth\b|chiropract|physical therap|massage|wellness|weight loss|semaglutide|\bglp|peptide|iv (drip|therapy|hydration)|hormone|testosterone|hair (loss|restoration)|microneedl|body sculpt|clinic|nurse|physician)/i;

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
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;
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
const NP = 'Not provided';
const or = (v: string) => v || NP;
const s = (v: unknown, max = 600) => fixDashes(raw(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v: unknown, max = 8) => (Array.isArray(v) ? v : raw(v).split(/\n|;|,(?=\s)/)).map((x) => s(x, 200)).filter(Boolean).slice(0, max);
const keepLines = (v: unknown, max: number) => fixDashes(raw(v)).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

// deno-lint-ignore no-explicit-any
function readPlan(p: any) {
  const formats = (Array.isArray(p?.formats) ? p.formats.map(str) : []).filter((f: string) => FORMATS.includes(f));
  const cta_type = Object.keys(CTA_LABEL).includes(str(p?.cta_type)) ? str(p?.cta_type) : 'keyword';
  const plan = {
    business_name: s(p?.business_name, 120), website: s(p?.website, 200), business_description: s(p?.business_description, 600),
    location: s(p?.location, 120), offer_text: s(p?.offer_text, 300), audience: s(p?.audience, 300),
    cta_type, cta_detail: s(p?.cta_detail, 120), voice_samples: keepLines(p?.voice_samples, 3000), audit_notes: keepLines(p?.audit_notes, 3000),
    brand_colors: Array.isArray(p?.brand_colors) ? p.brand_colors.map((x: unknown) => s(x, 20)).join(', ') : s(p?.brand_colors, 120),
    brand_style: s(p?.brand_style, 200), services: list(p?.services, 8),
    length: Number(p?.length) === 14 ? 14 : 7,
    formats: formats.length ? [...new Set(formats)] as string[] : [...FORMATS],
    // deno-lint-ignore no-explicit-any
    strategy: (p?.strategy && typeof p.strategy === 'object' ? p.strategy : {}) as any,
  };
  return { ...plan, health: HEALTH.test([plan.business_name, plan.business_description, plan.offer_text, plan.services.join(' ')].join(' ')) };
}
type Plan = ReturnType<typeof readPlan>;

const ctaLine = (p: Plan) => p.cta_type === 'follow' ? 'Just follow' : `${CTA_LABEL[p.cta_type]}${p.cta_detail ? `: ${p.cta_detail}` : ''}`;

function clientBlock(p: Plan) {
  return [
    'CLIENT',
    `Business: ${or(p.business_name)}${p.location ? `, ${p.location}` : ''}`,
    `What they do: ${or(p.business_description)}`,
    `Services: ${or(p.services.join(', '))}`,
    `The offer to push: ${or(p.offer_text)}`,
    `Who it's for: ${or(p.audience)}`,
    `What followers should do: ${ctaLine(p)}`,
    p.voice_samples ? `How the client writes (match this voice):\n${p.voice_samples}` : '',
    p.audit_notes ? `WHAT THE FREELANCER FOUND AUDITING THIS CLIENT'S SOCIAL MEDIA (real observations; build the plan on these):\n${p.audit_notes}` : '',
  ].filter(Boolean).join('\n');
}

function rules(p: Plan) {
  return [
    'RULES',
    '- Plain words their customers actually use. Specific to this business, never generic.',
    '- Facts about THIS business (prices, staff, hours, how they work, results, reviews, credentials, stories) only come from the answers above. If one would help, write it as a short [placeholder in square brackets] for the freelancer to fill in (at most 2 per post, never for the main point of the post).',
    '- General know-how that is true for this kind of service everywhere is welcome and makes posts useful (for example "most estheticians say to skip retinol a few days before a facial", "a roof inspection usually takes under an hour"). Say it as general advice, never as this business\'s promise, and keep it to well-known, safe basics.',
    "- Don't invent details about the place (a wall, a room, an event, a staff member, a ranking like \"best in town\").",
    '- No hype words, no clickbait the post can\'t pay off. No em dashes or en dashes.',
    p.health ? '- Health and beauty: no claims about what a treatment or product does to the body unless the facts say it, no promised results, no before and after, no shaming anyone\'s looks or body. Talk about how it feels, what it\'s for, what happens at a visit and why people choose it.' : '',
  ].filter(Boolean).join('\n');
}

const VOICE_GUIDE = `SPEAKER: the business owner or provider talking to their own followers. The guide below was written for a marketer talking to an owner; switch the roles and keep every rule.
VOICE GUIDE (follow it closely):
Sound like an experienced expert speaking naturally. Not a copywriter writing an ad, not a friend on FaceTime, not a corporate consultant.
The central rule: don't try to sound impressive. Start with the most useful observation you'd naturally make about the situation. Let the insight carry it; the sentence can be simple. Too written: "Cheap leads are expensive." Better: "A low cost per lead does not mean much if those leads are not turning into appointments." Better still: "If your cost per lead looks great but hardly any of those people are booking, I would not increase the ad budget yet." The third has judgment.
Be calm, direct, specific, observant, practical, naturally opinionated, confident without being absolute. Not chatty, polished for effect, dramatic, corporate or LinkedIn-style.
Use contractions and normal spoken words. No filler: like, honestly, I mean, okay, kinda, basically, literally, you know, super, crazy, totally.
First-person judgment when it helps ("I'd look at...", "Before we..., we'd want to..."), not in every line.
Observations over declarations. Too ad-like: "Your marketing system is broken." Better: "If leads are coming in but appointments are still inconsistent, something is probably happening after the lead comes in."
Ground it in a moment that really happens in this business; never invent a scene. Plain is good when the thinking is good.
Never: clever endings, punchlines, slogans, neat reversals, forced metaphors, dramatic one-liners, rhetorical questions for effect, fake specifics, scenes, numbers or quotes. Not as default devices: "X isn't the problem. Y is." / "It's not X. It's Y." / "You don't need X. You need Y." / "Here's the truth." / "The reality is..." / "What nobody tells you..." / "Stop doing X." / "Imagine..." / "Picture this...". A natural contrast is fine when it's genuinely the idea.
Don't manufacture curiosity, shock or pain. Use the customer's world, in the industry's natural words; prefer concrete words over growth, results, success, transformation.
Before returning, ask of each line: would this person say it out loud? Is the IDEA interesting, or only the wording? Could it be about any business? Am I inventing anything? If so, rewrite it.

HOW IT SHOULD SOUND:
- Write the way the owner talks to a customer at the front desk, not like a brochure.
- Short everyday words: "med spa" not "medical spa", "Botox" not "neuromodulator treatment".
- Every line says something specific: a real detail, a moment, a step, a question customers ask. If it could be on any business's page, cut it.
- B-roll text: each line is a full, specific thought that moves a mini story or list forward, like texting a friend. No taglines.
- Calls to action specific to the post: "Comment GLOW and I'll send you the price list" beats "Save this for later".
- Weak: "Medical supervision makes a difference." Better: "A nurse checks your skin before anything touches it. That's why we'll sometimes say not today."
- Weak hook: "Ever wonder what a medical spa facial really looks like?" Better: "Here's exactly what happens in your first facial with us, start to finish."
- Weak CTA: "Save this for your next self-care day." Better: "Comment FACIAL and I'll send you what to do the week before."
- Before you return, reread every line out loud and rewrite any that sounds like an ad, a slogan or a website.`;

const BANNED = /(makes a difference|personalized care|long-term results|\bfocused on\b|\belevate|\bjourney\b|\btransform|self-care day|treat yourself|you deserve|look and feel your best|passionate about|game[- ]changer|take the guesswork out|ever wonder|did you know|are you tired of|here's the truth|what nobody tells you|\bimagine\b|picture this)/i;
const HOOK_RULES = 'Each hook is the first sentence spoken or shown, under 15 words, in the customer\'s language. Mix curiosity, mistake, myth, how-to, result, relatable and question types. Plain everyday words ("med spa", not "medical spa"). Don\'t start with "Ever wonder", "Did you know" or "Are you tired of". No slogans.';

function fillPrompt(site: string) {
  return `Pull the facts a freelance social media manager needs from this business's website text. Only use what is on the website. Never invent offers, prices, reviews, credentials or services.

WEBSITE TEXT:
${site}

Return JSON: business_name (as they write it), location (city and state, empty if not shown), services (up to 6, each 1 to 4 plain words), offers (up to 3 real promotions written on the site, under 12 words each, empty if none), description (one plain sentence about what they do), target_customer (one short phrase, empty if unclear), brand_style (look and tone in a few words). No em dashes.`;
}
const FILL_SCHEMA = {
  type: 'object',
  properties: { business_name: { type: 'string' }, location: { type: 'string' }, services: { type: 'array', items: { type: 'string' } }, offers: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, target_customer: { type: 'string' }, brand_style: { type: 'string' } },
  required: ['business_name', 'location', 'services', 'offers', 'description', 'target_customer', 'brand_style'],
};

function pillarsPrompt(p: Plan, note: string, lastPillars: string[]) {
  return `You are a content strategist helping a beginner freelance social media manager plan organic Instagram content for a client.

${clientBlock(p)}
${p.audit_notes ? "\nUSE THE AUDIT: keep what's already working, fix the gaps it found, and make the biggest opportunity the heart of the plan. Don't repeat the audit back; turn it into posts.\n" : ''}${note || lastPillars.length ? `\nTHIS IS A REDO. The freelancer didn't like the last plan. What they want changed: ${note || 'make it clearly different and better'}.${lastPillars.length ? ` Last pillars (make these clearly different unless told otherwise): ${lastPillars.join(', ')}.` : ''}\n` : ''}
Return JSON:
- positioning: one sentence. Who they help, the outcome, and what makes them different, using only the facts above. Plain words, no slogan.
- pillars: exactly 3 content pillars, each {name (2 to 4 words), about (one line: what posts in it talk about), leads_to_offer (one line: how this pillar leads followers to the offer)}. Three genuinely different reasons to follow this account, not three versions of one.

${rules(p)}`;
}
const PILLARS_SCHEMA = {
  type: 'object',
  properties: {
    positioning: { type: 'string' },
    pillars: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, about: { type: 'string' }, leads_to_offer: { type: 'string' } }, required: ['name', 'about', 'leads_to_offer'] } },
  },
  required: ['positioning', 'pillars'],
};

// deno-lint-ignore no-explicit-any
function pillarText(pl: any[]) {
  return pl.map((x, i) => `${i + 1}. ${s(x?.name, 80)}: ${s(x?.about, 300)} (Leads to the offer: ${s(x?.leads_to_offer, 300)})`).join('\n');
}

// deno-lint-ignore no-explicit-any
function hooksPrompt(p: Plan, positioning: string, pillars: any[], i: number, note = '') {
  return `You are a content strategist writing hooks for a client's organic Instagram posts.

${clientBlock(p)}

Positioning: ${positioning}
Content pillars:
${pillarText(pillars)}

Write 7 hooks for pillar ${i + 1} only ("${s(pillars[i]?.name, 80)}"). ${HOOK_RULES}${note ? `\nWhat the freelancer wants: ${note}` : ''}

${VOICE_GUIDE}

${rules(p)}

Return JSON: hooks (7 lines).`;
}
const HOOKS_SCHEMA = { type: 'object', properties: { hooks: { type: 'array', items: { type: 'string' } } }, required: ['hooks'] };

// deno-lint-ignore no-explicit-any
function calendarPrompt(p: Plan, positioning: string, pillars: any[]) {
  return `You are a content strategist planning ${p.length} days of organic Instagram posts for a client.

${clientBlock(p)}

Positioning: ${positioning}
Content pillars:
${pillarText(pillars)}

Formats to use (only these): ${p.formats.map((f) => `${f} (${FORMAT_LABEL[f]})`).join(', ')}.

Return JSON: calendar, exactly ${p.length} posts in order, each {day, pillar (the pillar name exactly), format (one of: ${p.formats.join(', ')}), goal (reach, trust or offer), hook, idea (one line: what the post is about), cta}. Rotate pillars and formats so no two posts in a row share both. About 1 in 5 posts has goal offer and uses the client's call to action (${ctaLine(p)}); the rest end with a soft call to action (save, share, follow) or the client's call to action when it fits. Each day is a different, specific idea. ${HOOK_RULES}

${VOICE_GUIDE}

${rules(p)}`;
}
const CALENDAR_SCHEMA = {
  type: 'object',
  properties: { calendar: { type: 'array', items: { type: 'object', properties: { day: { type: 'number' }, pillar: { type: 'string' }, format: { type: 'string' }, goal: { type: 'string' }, hook: { type: 'string' }, idea: { type: 'string' }, cta: { type: 'string' } }, required: ['day', 'pillar', 'format', 'goal', 'hook', 'idea', 'cta'] } } },
  required: ['calendar'],
};

const FORMAT_NEEDS: Record<string, string> = {
  talking_head: 'talking_head: hook (the first line they say), script (the full spoken script after the hook, 30 to 45 seconds, short lines, one thought per line, ends with the call to action), visual (where they stand or sit, framing, and 2 or 3 cutaway shots), caption. on_screen and slides empty.',
  broll: 'broll: hook (the first text on screen), on_screen (4 to 6 short lines in order, one per clip, the last is the call to action), visual (what each clip shows, numbered to match, all filmable on a phone at the business), caption. script and slides empty.',
  carousel: 'carousel: hook (slide 1 text), slides (6 to 8, each {text under 25 words, visual: a photo to use or a simple design}; slide 1 is the hook, the last is the call to action), caption. script and on_screen empty.',
};

// deno-lint-ignore no-explicit-any
function postPrompt(p: Plan, day: any) {
  return `You are a social media copywriter writing ONE organic Instagram post for a client. The client is speaking to their own followers and customers.

${clientBlock(p)}

Positioning: ${s(p.strategy?.positioning, 400)}

THE POST: day ${day.day}, format ${day.format} (${FORMAT_LABEL[day.format]}), pillar "${day.pillar}", goal ${day.goal}, hook "${day.hook}", idea: ${day.idea}, call to action: ${day.cta}.
Use the hook as the starting point. If it breaks a rule below, improve it.

WHAT TO WRITE
${FORMAT_NEEDS[day.format]}
caption: 2 to 5 short paragraphs separated by a blank line, ending with the call to action. At most 2 emojis. 3 to 5 relevant hashtags on the last line.

${VOICE_GUIDE}

${rules(p)}

Return JSON: post {hook, script, visual, on_screen, slides, caption}.`;
}
const POST_SCHEMA = {
  type: 'object',
  properties: {
    post: {
      type: 'object',
      properties: {
        hook: { type: 'string' }, script: { type: 'string' }, visual: { type: 'string' }, on_screen: { type: 'array', items: { type: 'string' } },
        slides: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, visual: { type: 'string' } }, required: ['text', 'visual'] } }, caption: { type: 'string' },
      },
      required: ['hook', 'script', 'visual', 'on_screen', 'slides', 'caption'],
    },
  },
  required: ['post'],
};

function cleanPillars(d: any) {
  // deno-lint-ignore no-explicit-any
  return (Array.isArray(d?.pillars) ? d.pillars : []).slice(0, 3).map((x: any) => ({ name: clean(x?.name, 60), about: clean(x?.about, 300), leads_to_offer: clean(x?.leads_to_offer, 300) })).filter((x: { name: string }) => x.name);
}

// deno-lint-ignore no-explicit-any
function cleanCalendar(raw: any, p: Plan, pillars: { name: string }[]) {
  const names = pillars.map((x) => x.name);
  // deno-lint-ignore no-explicit-any
  const rows = (Array.isArray(raw) ? raw : []).slice(0, p.length).map((x: any, i: number) => {
    const name = names.find((n) => n.toLowerCase() === s(x?.pillar, 80).toLowerCase()) || names[i % names.length] || '';
    const format = p.formats.includes(str(x?.format)) ? str(x?.format) : p.formats[i % p.formats.length];
    const goal = GOALS.includes(str(x?.goal).toLowerCase()) ? str(x?.goal).toLowerCase() : 'reach';
    return { day: i + 1, pillar: name, format, goal, hook: clean(x?.hook, 200), idea: clean(x?.idea, 300), cta: clean(x?.cta, 200) };
  });
  const want = Math.max(1, Math.round(rows.length / 5));
  let have = rows.filter((r) => r.goal === 'offer').length;
  for (let k = 0; k < want && have < want; k++) {
    const i = Math.min(rows.length - 1, Math.round(((k + 1) * rows.length) / want) - 1);
    if (rows[i] && rows[i].goal !== 'offer') { rows[i].goal = 'offer'; rows[i].cta = ctaLine(p); have++; }
  }
  return rows;
}

function cleanCaption(v: unknown) {
  let t = paragraphs(raw(v));
  const tags = [...new Set((t.match(/#[\p{L}\p{N}_]+/gu) || []))].slice(0, 5);
  t = t.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  let n = 0;
  t = t.replace(EMOJI, (m) => (/[\u{FE0F}\u{200D}\u{20E3}]/u.test(m) ? m : ++n <= 2 ? m : '')).replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1');
  return tags.length ? `${t}\n\n${tags.join(' ')}` : t;
}

// deno-lint-ignore no-explicit-any
function cleanPost(x: any, day: any) {
  const f = day.format;
  const post = {
    day: day.day, format: f,
    hook: clean(x?.hook, 200) || day.hook,
    script: f === 'talking_head' ? keepLines(x?.script, 3000) : '',
    visual: keepLines(x?.visual, 1500),
    on_screen: f === 'broll' ? arr(x?.on_screen, 6, 200) : [],
    // deno-lint-ignore no-explicit-any
    slides: f === 'carousel' ? (Array.isArray(x?.slides) ? x.slides : []).slice(0, 8).map((sl: any) => ({ text: clean(sl?.text, 300), visual: clean(sl?.visual, 300) })).filter((sl: { text: string }) => sl.text) : [],
    caption: cleanCaption(x?.caption),
    warnings: [] as string[],
  };
  const all = [post.hook, post.script, post.on_screen.join(' '), post.slides.map((sl: { text: string }) => sl.text).join(' '), post.caption].join(' ');
  const hit = all.match(BANNED);
  if (hit) post.warnings.push(`"${hit[0]}" sounds like an ad. Rewrite that line.`);
  if (f === 'talking_head' && !post.script) post.warnings.push('The script is missing. Write this post again.');
  if (f === 'broll' && post.on_screen.length < 3) post.warnings.push('Fewer than 3 lines of text on screen. Write this post again.');
  if (f === 'carousel' && post.slides.length < 4) post.warnings.push('Fewer than 4 slides. Write this post again.');
  return post;
}

// deno-lint-ignore no-explicit-any
async function ask(base44: any, prompt: string, schema: unknown, ms: number, model = '', fallbackMs?: () => number) {
  const call = (m: string, t: number) => withTimeout(base44.asServiceRole.integrations.Core.InvokeLLM(m ? { prompt, response_json_schema: schema, model: m } : { prompt, response_json_schema: schema }), t, 'The AI took too long. Try again.');
  let raw;
  try {
    raw = await call(model, ms);
  } catch (e) {
    if (!model || !fallbackMs || fallbackMs() < 15_000) throw e;
    raw = await call('', fallbackMs());
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
    const p = readPlan(body?.plan);
    const write = (prompt: string, schema: unknown, ms = 50_000) => ask(base44, prompt, schema, left(ms), WRITER, () => left(30_000));

    if (task === 'fill') {
      const site = str(body?.site_text).slice(0, 20_000);
      if (site.length < 100) return Response.json({ error: "There wasn't enough text on their website to fill anything in." }, { status: 400 });
      const d = await ask(base44, fillPrompt(site), FILL_SCHEMA, left(45_000));
      const services = arr(d.services, 6, 60);
      const offers = arr(d.offers, 3, 120);
      return Response.json({
        fields: { business_name: clean(d.business_name, 120), location: clean(d.location, 120), business_description: clean(d.description, 600), audience: clean(d.target_customer, 200), brand_style: clean(d.brand_style, 200), offer_text: offers[0] || services[0] || '' },
        services, offers,
      });
    }

    if (task === 'strategy') {
      if (!p.business_name || !(p.offer_text || p.services.length)) return Response.json({ error: 'Add the business name and what they sell first.' }, { status: 400 });
      const note = s(body?.note, 300);
      const last = Array.isArray(p.strategy?.pillars) ? p.strategy.pillars.map((x: { name?: unknown }) => s(x?.name, 60)).filter(Boolean) : [];
      const a = await write(pillarsPrompt(p, note, body?.redo ? last : []), PILLARS_SCHEMA, 35_000);
      const positioning = clean(a.positioning, 400);
      const pillars = cleanPillars(a);
      if (!positioning || pillars.length < 3) throw new Error("The AI didn't finish the plan. Try again.");
      const [h1, h2, h3, cal] = await Promise.all([
        ...[0, 1, 2].map((i) => write(hooksPrompt(p, positioning, pillars, i), HOOKS_SCHEMA, 40_000).catch(() => ({ hooks: [] }))),
        write(calendarPrompt(p, positioning, pillars), CALENDAR_SCHEMA, 45_000),
      ]);
      const hooks = [h1, h2, h3].flatMap((h, i) => arr(h?.hooks, 7, 200).map((line) => ({ pillar: pillars[i].name, line })));
      const calendar = cleanCalendar(cal?.calendar, p, pillars);
      if (calendar.length < p.length) throw new Error(`The AI planned ${calendar.length} of ${p.length} days. Try again.`);
      return Response.json({ strategy: { positioning, pillars, hooks, calendar } });
    }

    if (task === 'posts') {
      const cal = Array.isArray(p.strategy?.calendar) ? p.strategy.calendar : [];
      const want = (Array.isArray(body?.days) ? body.days : []).map(Number).filter((n: number) => Number.isInteger(n)).slice(0, 5);
      // deno-lint-ignore no-explicit-any
      const days = want.map((n: number) => cal.find((d: any) => Number(d?.day) === n)).filter(Boolean)
        // deno-lint-ignore no-explicit-any
        .map((d: any) => ({ day: Number(d.day), pillar: s(d.pillar, 80), format: p.formats.includes(str(d.format)) ? str(d.format) : (FORMATS.includes(str(d.format)) ? str(d.format) : p.formats[0]), goal: s(d.goal, 20), hook: s(d.hook, 200), idea: s(d.idea, 300), cta: s(d.cta, 200) || ctaLine(p) }));
      if (!days.length) return Response.json({ error: 'Pick the days to write first.' }, { status: 400 });
      const results = await Promise.all(days.map((d: { day: number }) => write(postPrompt(p, d), POST_SCHEMA).then((r) => ({ d, r })).catch(() => ({ d, r: null }))));
      const posts = results.filter((x) => x.r).map((x) => cleanPost(x.r.post ?? x.r, x.d));
      const failed = results.filter((x) => !x.r).map((x) => x.d.day);
      if (!posts.length) throw new Error('The AI took too long. Try again.');
      return Response.json({ posts, failed });
    }

    return Response.json({ error: 'Unknown task.' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Something went wrong. Try again.' }, { status: 500 });
  }
}
