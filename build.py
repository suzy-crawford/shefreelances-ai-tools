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
}
for name, head in HEAD.items():
    body = (here / "src" / f"{name}.body.ts").read_text()
    out = "// deno-lint-ignore-file no-unused-vars\n" + head + "\n" + helpers + "\n" + body
    assert "—" not in out and "–" not in out
    (here / "client-finder" / f"{name}.ts").write_text(out)
    print(name, len(out.splitlines()), "lines")
