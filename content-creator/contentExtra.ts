import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Content Creator, part 2: redo one pillar, hook or day, and rewrite one piece, with their exact AI instructions and rules.
// task "redo_pillar", "redo_hook", "redo_day", "rewrite".


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

const WRITER = 'claude-sonnet-5';
const FORMATS = ['talking_head', 'broll', 'carousel'];
const FORMAT_LABEL: Record<string, string> = { talking_head: 'Talking head reel', broll: 'B-roll reel', carousel: 'Carousel' };
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
    '- Never invent what their clients do, say, feel or ask, or how often ("most of our clients are surprised...", "our regulars come in monthly", "clients always ask us..."), what the staff personally do at a visit ("Dr. X checks your skin first", "we\'ll turn you away if..."), or comparisons with other businesses ("not the ten minute version you get elsewhere"). If it isn\'t in the CLIENT block, write it as general know-how ("Most providers check...", "A good med spa will...") or leave it out.',
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

HOW IT SHOULD SOUND (the examples below are from OTHER businesses and only show the style: never reuse their details, steps, staff or claims for this client):
- Write the way the owner talks to a customer at the front desk, not like a brochure.
- Short everyday words their customers use, not industry jargon.
- Every line says something specific: a real detail, a moment, a step, a question customers ask. If it could be on any business's page, cut it.
- B-roll text: each line is a full, specific thought that moves a mini story or list forward, like texting a friend. No taglines.
- Calls to action specific to the post: "Comment PRICES and I'll send you the price list" beats "Save this for later".
- (A dog groomer) Weak: "We care about your pet." Better: "If a dog is shaking on the table, we stop and let them settle. A rushed groom is how nicks happen."
- (A bakery) Weak hook: "Ever wonder how sourdough is made?" Better: "Here's what happens to tomorrow's sourdough, starting at 4pm today."
- (A roofer) Weak CTA: "Save this for later." Better: "Comment ROOF and I'll send you the 5 things to check after a storm."
- Every fact about this client (who does what, how a visit goes, what they check, what they say no to) must come from the CLIENT block. If you don't know it, say it as general know-how or leave it out.
- Before you return, reread every line out loud and rewrite any that sounds like an ad, a slogan or a website.`;

const HOOK_RULES = 'Each hook is the first sentence spoken or shown, under 15 words, in the customer\'s language. Mix curiosity, mistake, myth, how-to, result, relatable and question types. Plain everyday words ("med spa", not "medical spa"). Don\'t start with "Ever wonder", "Did you know" or "Are you tired of". No slogans.';

function pillarText(pl: any[]) {
  return pl.map((x, i) => `${i + 1}. ${s(x?.name, 80)}: ${s(x?.about, 300)} (Leads to the offer: ${s(x?.leads_to_offer, 300)})`).join('\n');
}

function redoPillarPrompt(p: Plan, index: number, note: string, days: any[]) {
  const pillars = Array.isArray(p.strategy?.pillars) ? p.strategy.pillars : [];
  return `You are a content strategist. Replace ONE content pillar in this client's Instagram plan.

${clientBlock(p)}

Positioning: ${s(p.strategy?.positioning, 400)}
Current pillars:
${pillarText(pillars)}

Replace pillar ${index + 1} ("${s(pillars[index]?.name, 80)}"). The new one must not overlap the other two. What the freelancer wants: ${note || 'Make it clearly different from the current one, and better.'}
Its days (keep each day's format and goal): ${days.map((d) => `day ${d.day} (${d.format}, ${d.goal})`).join('; ') || 'none'}.

Return JSON: pillar {name (2 to 4 words), about, leads_to_offer}, hooks (7 lines; ${HOOK_RULES}), days [{day, hook, idea}] for each of its days listed above.

${VOICE_GUIDE}

${rules(p)}`;
}
const REDO_PILLAR_SCHEMA = {
  type: 'object',
  properties: {
    pillar: { type: 'object', properties: { name: { type: 'string' }, about: { type: 'string' }, leads_to_offer: { type: 'string' } }, required: ['name', 'about', 'leads_to_offer'] },
    hooks: { type: 'array', items: { type: 'string' } },
    days: { type: 'array', items: { type: 'object', properties: { day: { type: 'number' }, hook: { type: 'string' }, idea: { type: 'string' } }, required: ['day', 'hook', 'idea'] } },
  },
  required: ['pillar', 'hooks', 'days'],
};

function redoHookPrompt(p: Plan, pillar: string, text: string, note: string) {
  return `Write ONE new hook for this client's Instagram content pillar "${pillar}".

${clientBlock(p)}

The current hook: "${text}"
What the freelancer wants: ${note || 'Make it clearly different from the current one, and better.'}
${HOOK_RULES}

${VOICE_GUIDE}

${rules(p)}

Return JSON: text.`;
}

// deno-lint-ignore no-explicit-any
function redoDayPrompt(p: Plan, day: any, note: string) {
  return `Rework ONE day of this client's Instagram content calendar.

${clientBlock(p)}

Positioning: ${s(p.strategy?.positioning, 400)}
The day now: day ${day.day}, pillar "${day.pillar}", goal ${day.goal}, format ${day.format}, hook "${day.hook}", idea: ${day.idea}, call to action: ${day.cta}.
What the freelancer wants: ${note || 'Make it clearly different from the current one, and better.'}
Keep the pillar and goal. Keep the format unless asked; if you change it, use only: ${p.formats.join(', ')}. ${HOOK_RULES}

${VOICE_GUIDE}

${rules(p)}

Return JSON: format, hook, idea, cta.`;
}
const REDO_DAY_SCHEMA = { type: 'object', properties: { format: { type: 'string' }, hook: { type: 'string' }, idea: { type: 'string' }, cta: { type: 'string' } }, required: ['format', 'hook', 'idea', 'cta'] };

const STYLES: Record<string, string> = {
  shorter: 'Make it shorter. Keep the strongest idea.',
  punchier: 'Make it punchier: stronger hook, fewer words, more energy.',
  warmer: 'Make it warmer and more personal, like a friendly owner talking to one person.',
  urgent: 'Give it more urgency using only what is true about the offer. Never invent deadlines or limited spots.',
};

function rewritePrompt(p: Plan, label: string, text: string, ask: string, format: string, hook: string) {
  if (label === 'positioning') {
    return `Rewrite this client's one-line positioning statement.

${clientBlock(p)}

THE STATEMENT:
${text}

HOW: ${ask}
One sentence: who they help, the outcome, and what makes them different, using only the facts above. Plain words, no slogans.

${rules(p)}

Return JSON: text.`;
  }
  return `You are a social media copywriter. Rewrite one piece of this client's Instagram post.

${clientBlock(p)}

The post: ${FORMAT_LABEL[format] || 'post'}, hook "${hook}".

REWRITE THIS ${label.toUpperCase()}:
${text}

HOW: ${ask}
Keep the same idea, facts and call to action. Keep it the right length for a ${label}. Keep any [placeholder in square brackets] exactly as written.

${VOICE_GUIDE}

${rules(p)}

Return JSON: text.`;
}
const TEXT_SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };

function cleanCaption(v: unknown) {
  let t = paragraphs(raw(v));
  const tags = [...new Set((t.match(/#[\p{L}\p{N}_]+/gu) || []))].slice(0, 5);
  t = t.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  let n = 0;
  t = t.replace(EMOJI, (m) => (/[\u{FE0F}\u{200D}\u{20E3}]/u.test(m) ? m : ++n <= 2 ? m : '')).replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1');
  return tags.length ? `${t}\n\n${tags.join(' ')}` : t;
}

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

    if (task === 'redo_pillar') {
      const pillars = Array.isArray(p.strategy?.pillars) ? p.strategy.pillars : [];
      const index = Number(body?.index);
      if (!pillars[index]) return Response.json({ error: 'That pillar is missing.' }, { status: 400 });
      const old = s(pillars[index]?.name, 80);
      // deno-lint-ignore no-explicit-any
      const days = (Array.isArray(p.strategy?.calendar) ? p.strategy.calendar : []).filter((d: any) => s(d?.pillar, 80) === old);
      const d = await write(redoPillarPrompt(p, index, s(body?.note, 300), days), REDO_PILLAR_SCHEMA, 55_000);
      const pillar = { name: clean(d?.pillar?.name, 60), about: clean(d?.pillar?.about, 300), leads_to_offer: clean(d?.pillar?.leads_to_offer, 300) };
      if (!pillar.name) throw new Error("The AI didn't finish. Try again.");
      // deno-lint-ignore no-explicit-any
      const dayHooks = (Array.isArray(d?.days) ? d.days : []).map((x: any) => ({ day: Number(x?.day), hook: clean(x?.hook, 200), idea: clean(x?.idea, 300) })).filter((x: { day: number }) => days.some((y: { day: unknown }) => Number(y.day) === x.day));
      return Response.json({ pillar, hooks: arr(d?.hooks, 7, 200), days: dayHooks, old_name: old });
    }

    if (task === 'redo_hook') {
      const d = await write(redoHookPrompt(p, s(body?.pillar, 80), s(body?.text, 300), s(body?.note, 300)), TEXT_SCHEMA, 55_000);
      const text = clean(d?.text, 200);
      if (!text) throw new Error("The AI didn't finish. Try again.");
      return Response.json({ text });
    }

    if (task === 'redo_day') {
      // deno-lint-ignore no-explicit-any
      const day = (Array.isArray(p.strategy?.calendar) ? p.strategy.calendar : []).find((x: any) => Number(x?.day) === Number(body?.day));
      if (!day) return Response.json({ error: 'That day is missing.' }, { status: 400 });
      const d = await write(redoDayPrompt(p, day, s(body?.note, 300)), REDO_DAY_SCHEMA, 55_000);
      const format = p.formats.includes(str(d?.format)) ? str(d?.format) : str(day.format);
      return Response.json({ format, hook: clean(d?.hook, 200) || s(day.hook, 200), idea: clean(d?.idea, 300) || s(day.idea, 300), cta: clean(d?.cta, 200) || s(day.cta, 200) });
    }

    if (task === 'rewrite') {
      const text = raw(body?.text).slice(0, 4000);
      if (!text.trim()) return Response.json({ error: 'Nothing to rewrite.' }, { status: 400 });
      const label = s(body?.label, 40).toLowerCase() || 'caption';
      const how = s(body?.how, 300) || STYLES[str(body?.style)] || STYLES.punchier;
      const d = await write(rewritePrompt(p, label, text, how, str(body?.format), s(body?.hook, 200)), TEXT_SCHEMA, 55_000);
      const out = label === 'caption' ? cleanCaption(d?.text) : /script|visual|slides|text on screen/.test(label) ? keepLines(d?.text, 4000) : clean(d?.text, 1500);
      if (!out) throw new Error("The AI didn't finish. Try again.");
      return Response.json({ text: out });
    }

    return Response.json({ error: 'Unknown task.' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Something went wrong. Try again.' }, { status: 500 });
  }
}
