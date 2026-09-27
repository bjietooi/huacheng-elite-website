# Tests

Headless tests for the booking mock: the shared store (`hc-store.js`), the coach & admin
console (`admin/`) and the parent portal. No browser needed — pages are loaded with jsdom.

```bash
cd tests && npm install     # once: installs jsdom
./run.sh                    # every *.test.js
node store.test.js          # one suite
```

- `dom-harness.js` — loads a real page (console or portal) in jsdom with its own
  localStorage, and gives you `$`, `$$`, `click`, `input`, `go`, `text`, `errors`, …
- `store.test.js` — the data layer on its own (no DOM).
- `<module>.test.js` — one suite per console module / the portal.

Tests must never write to the repo, and never touch the network.
