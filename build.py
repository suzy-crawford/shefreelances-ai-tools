# Builds the single-file backend functions from src/ (Base44 functions can't import each other).
# Run: python3 build.py
import pathlib
here = pathlib.Path(__file__).parent
helpers = (here / "src" / "helpers.ts").read_text()
HEAD = {
    "findBusinesses": """import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Client Finder: finds real local businesses with the built-in AI web search.
// Runs 3 searches at once, removes duplicates, flags chains, checks that every website
// actually loads (so made-up businesses are easy to spot), and looks for an email on the
// business's own website. An email is never guessed.
""",
    "findEmail": """import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Client Finder: finds a business's contact info (email, Instagram, Facebook Page).
// First on its own website (homepage, Contact, About, Privacy pages), then with a web search
// that is double-checked against the source page. Never guesses an email.
// Also finds the right website when the one on file doesn't work.
""",
    "readWebsite": """import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Meta Ads Builder: reads a business's own website for "Fill it in for me". No AI here.
// Returns the page text (plus up to 2 services, menu or pricing pages on the same site), the title,
// button wording, social links and brand colors. Won't read social, links or booking pages, parked or
// placeholder domains, or a domain that forwards to a different business.
""",
    "adsAI": """import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Meta Ads Builder, part 1: the plan, the ads and the launch message, with their exact AI instructions and rules.
// task "plan": the campaign plan, decided in code. "fill": facts from their website text. "ads": 3 ad concepts.
// "practice": a made-up practice business. "launch": the message to paste into Claude or ChatGPT.
""",
    "adsExtra": """import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// Meta Ads Builder, part 2: editing and what happens after the click, with their exact AI instructions and rules.
// task "rewrite": one piece of an ad. "more": the "make more versions" prompt. "form": the Instant Form.
// "page": landing page copy plus the Base44 prompt to build it. "pagebuild": that prompt again after edits.
""",
    "contentAI": """import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Content Creator, part 1: website fill, the content strategy and the posts, with their exact AI instructions and rules.
// task "fill": facts from their website text. "strategy": positioning, 3 pillars, 21 hooks and the calendar.
// "posts": up to 5 posts at once, one AI call each.
""",
    "contentExtra": """import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Content Creator, part 2: redo one pillar, hook or day, and rewrite one piece, with their exact AI instructions and rules.
// task "redo_pillar", "redo_hook", "redo_day", "rewrite".
""",
    "analyzeLead": """import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Client Finder: gathers facts for the AI Lead Analyzer without screenshots. Reads the business's
// own website for things it can confirm (Meta Pixel, Google tag, online booking, a clear Book button,
// phone-ready, contact form, prices, reviews, footer year, https, social links), and runs one web
// search for their Google rating and whether they run Meta ads, which the app labels "double-check".
""",
}
import re
def prune(src):
    # Drop top-level helpers this file never uses, so there's less to copy exactly.
    while True:
        lines = src.split("\n")
        starts = [i for i, l in enumerate(lines) if re.match(r"(async )?function \w+|const [A-Z_a-z]\w* ?[:=]", l)]
        removed = False
        for k, s in enumerate(starts):
            m = re.match(r"(?:async )?function (\w+)|const (\w+)", lines[s])
            name = m.group(1) or m.group(2)
            e = starts[k + 1] if k + 1 < len(starts) else len(lines)
            # include the comment lines just above it
            c = s
            while c > 0 and lines[c - 1].startswith("//") and not lines[c - 1].startswith("// ----"):
                c -= 1
            body = "\n".join(lines[s:e])
            rest = "\n".join(lines[:c] + lines[e:])
            if name != "default" and not re.search(r"\b" + re.escape(name) + r"\b", rest) and "export default" not in body:
                # keep blank-line separation
                end = e
                while end > s and lines[end - 1].strip() == "" and end - 1 > s: end -= 1
                src = "\n".join(lines[:c] + lines[end:])
                removed = True
                break
        if not removed:
            return re.sub(r"\n{3,}", "\n\n", src)

TASKS = {"adsAI": {"plan", "fill", "ads", "practice", "launch"}, "adsExtra": {"rewrite", "more", "form", "page", "pagebuild"},
         "contentAI": {"fill", "strategy", "posts"}, "contentExtra": {"redo_pillar", "redo_hook", "redo_day", "rewrite"}}
SOURCE = {"adsExtra": "adsAI", "contentExtra": "contentAI"}
def keep_tasks(body, keep):
    # Drop the task handlers this file doesn't serve (a handler is one line, or a block up to its closing "    }").
    lines = body.split("\n"); out = []; i = 0
    while i < len(lines):
        m = re.match(r"    if \(task === '(\w+)'\)", lines[i])
        if m and m.group(1) not in keep:
            if lines[i].rstrip().endswith("{"):
                while lines[i] != "    }": i += 1
            i += 1
            while i < len(lines) and lines[i].strip() == "": i += 1
            continue
        out.append(lines[i]); i += 1
    return "\n".join(out)

for name, head in HEAD.items():
    src = SOURCE.get(name, name)
    body = (here / "src" / f"{src}.body.ts").read_text()
    if name in TASKS:
        body = keep_tasks(body, TASKS[name]).replace("// ---- adsAI ----", f"// ---- {name} ----").replace("// ---- contentAI ----", f"// ---- {name} ----")
    out = "// deno-lint-ignore-file no-unused-vars\n" + head + "\n" + helpers + "\n" + body
    if name in ("readWebsite", "adsAI", "adsExtra", "adsFunnel", "contentAI", "contentExtra"):
        out = prune(out).replace("// deno-lint-ignore-file no-unused-vars\n", "")
        if name in ("adsAI", "adsExtra", "contentAI", "contentExtra"):
            # Smaller to copy: drop comment-only lines after the header (the commented source stays in src/).
            head_end = out.index("\n\n", out.index("\n\n") + 2) + 2
            kept = [l for l in out[head_end:].split("\n") if not l.strip().startswith("//") or "deno-lint-ignore" in l]
            out = out[:head_end] + re.sub(r"\n{3,}", "\n\n", "\n".join(kept))
    assert "—" not in out and "–" not in out
    folder = "meta-ads" if name in ("readWebsite", "adsAI", "adsExtra", "adsFunnel") else "content-creator" if name.startswith("content") else "client-finder"
    (here / folder).mkdir(exist_ok=True)
    (here / folder / f"{name}.ts").write_text(out)
    print(folder, name, len(out.splitlines()), "lines")
import shutil
(here / "meta-ads").mkdir(exist_ok=True)
shutil.copyfile(here / "client-finder" / "generateWithAI.ts", here / "meta-ads" / "generateWithAI.ts")
# The Content Creator reads websites with the same function as the Meta Ads Builder.
shutil.copyfile(here / "meta-ads" / "readWebsite.ts", here / "content-creator" / "readWebsite.ts")
