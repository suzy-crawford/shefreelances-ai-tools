# SheFreelances AI tools

Backend function code for the SheFreelances AI tools. Members don't need to open this repo:
the build prompt on the SheFreelances AI HQ page tells Base44 which file to copy.

Each release is a tag (for example `client-finder-v1`). Tags are never moved; changes get a new tag.

`tests/` holds the scenario tests: `cd tests && deno run --allow-read --import-map=import_map.json scenarios.ts`
