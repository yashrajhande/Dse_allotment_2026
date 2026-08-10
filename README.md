# DSE 2026 Allotment Search

Unofficial search tool for DSE 2026 CAP Round allotment results. Search by student name or Application ID across all colleges in Maharashtra.

**Live site:** https://YOUR-USERNAME.github.io/dse-allotment-search/

## Features
- Instant live search (results appear as you type)
- CAP Round I + Round II data
- College name prominently shown first
- Works on mobile

## Project Structure
```
index.html              — Search web app
data/
  allotments_round1.json  — CAP Round I data (38,213 records)
  allotments_round2.json  — CAP Round II data (generated after 14 Aug)
scraper/
  scrape.js               — PDF scraper (Node.js)
  package.json
```


Data is sourced from official MAHACET PDFs. This tool is unofficial.
