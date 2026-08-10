/**
 * Test: corrected parser for packed PDF text format
 * 
 * PDF text format (all fields concatenated, no spaces between columns):
 *   "1286692.65DSE26101808  KACHADE HARSHAL DHANRAJMOBCGOPEN"
 *    SrNo │    │ AppID    │  Name               │ │cat│seat
 *         │Merit│         2 spaces               G
 *         Score(XX.XX)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch(e) { console.error('npm install first'); process.exit(1); }

const TEST_COLLEGES = [
  { code: '1002', name: 'Government College of Engineering, Amravati' },
  { code: '3012', name: 'VJTI Mumbai' },
  { code: '6271', name: 'Pune Institute of Computer Technology' },
];

// ── SEAT TYPES (longest first so regex is greedy-safe) ─────────────────────────
const SEAT_TYPES_ORDERED = [
  'GOPENH','LOPENH','GOPENO','LOPENO','GOPENS','LOPENS',
  'GOBCH','LOBCH','GOBCO','LOBCO','GOBCS','LOBCS',
  'GSCH','LSCH','GSCO','LSCO','GSCS','LSCS',
  'GSTH','LSTH','GSTO','LSTO','GSTS','LSTS',
  'GVJH','LVJH','GVJO','LVJO','GVJS','LVJS',
  'GNTAH','LNTAH','GNTBH','LNTBH',
  'GNTH','LNTH','GNTO','LNTO','GNTS','LNTS',
  'GSEBCH','LSEBCH','GSEBCO','LSEBCO','GSEBCS','LSEBCS',
  'GSEBC','LSEBC',
  'GOPEN','LOPEN',
  'GOBC','LOBC',
  'GSC','LSC',
  'GST','LST',
  'EWSH','EWSO','EWSS','EWS',
  'TFWSH','TFWSO','TFWSS','TFWS',
  'EXSM','DEF','PWD','MI',
];
const SEAT_RE = new RegExp('(' + SEAT_TYPES_ORDERED.join('|') + ')$');

// Known category start tokens (for gender position validation)
const VALID_CAT_RE = /^(OPEN|OBC|SC|ST|NT-[A-D]|NT|SEBC|SBC\/OBC|SBC|EWS|TFWS|VJ|DT|MI|PWD|DEF|EXSM|\s*$)/;

function parseLine(line) {
  // 1. Anchor: find the 12-char Application ID (DSE26 + 6 digits)
  const appMatch = line.match(/(DSE26\d{6})/);
  if (!appMatch) return null;

  const appId    = appMatch[1];                    // e.g. "DSE26101808"
  const appStart = line.indexOf(appId);
  const appEnd   = appStart + appId.length;

  // ── BEFORE: [SrNo][MeritNo][Score(XX.XX)] all concatenated ────────────────
  const before = line.substring(0, appStart);
  // Score always has exactly 2 decimal places: XX.XX
  const beforeMatch = before.match(/^(\d{1,4})(\d{2,6})(\d{2}\.\d{2})$/);
  if (!beforeMatch) return null;

  const srNo   = beforeMatch[1];
  const meritNo = beforeMatch[2];
  const marks  = parseFloat(beforeMatch[3]);

  // ── AFTER: [2 spaces][NAME(caps+spaces)][M|F][Category][SeatType] ─────────
  const after = line.substring(appEnd).replace(/^\s+/, '');  // strip leading spaces

  // Step 1: strip seat type from the right
  const seatMatch = after.match(SEAT_RE);
  if (!seatMatch) return null;
  const seatType  = seatMatch[1];
  const withoutSeat = after.substring(0, after.length - seatType.length);

  // Step 2: find gender by scanning LEFT to RIGHT for last M or F
  // preceded by an uppercase letter AND followed by a valid category start
  const ws = withoutSeat.trimEnd();
  let genderPos = -1;

  for (let j = 1; j < ws.length; j++) {
    const ch = ws[j];
    if ((ch === 'M' || ch === 'F') && /[A-Z]/.test(ws[j - 1])) {
      // Validate the potential category after this gender position
      const potentialCat = ws.substring(j + 1).trim();
      if (VALID_CAT_RE.test(potentialCat)) {
        genderPos = j;
        // Don't break — we want the LAST valid occurrence
        // This handles names like VIKRAM where M appears in the name too
      }
    }
  }

  if (genderPos === -1) return null;

  const name     = ws.substring(0, genderPos).trim();
  const gender   = ws[genderPos];
  const category = ws.substring(genderPos + 1).trim();

  if (!name || !appId) return null;

  return { srNo, meritNo, marks, appId, name, gender, category, seatType };
}

function parseAllotmentText(text, collegeName, collegeCode) {
  const records = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let currentCourse = '';
  let currentCourseCode = '';
  let currentSection = '';
  let currentGroup = '';

  for (const line of lines) {
    // Course header: "0100219110 - Civil Engineering"
    const courseMatch = line.match(/^(\d{9,})\s*[-–]\s*(.+)$/);
    if (courseMatch) {
      currentCourseCode = courseMatch[1].trim();
      currentCourse = courseMatch[2].trim().replace(/\s*Status:.*$/i, '').trim();
      currentSection = ''; currentGroup = '';
      continue;
    }

    if (/Home University Seats/i.test(line))      { currentSection = 'Home University'; continue; }
    if (/Other Than Home University/i.test(line)) { currentSection = 'Other Than Home University'; continue; }
    if (/State Level/i.test(line))                { currentSection = 'State Level'; continue; }
    if (/Group\s+II\b/i.test(line))              { currentGroup = 'Graduate'; continue; }
    if (/Group\s+I\b/i.test(line))               { currentGroup = 'Diploma'; continue; }

    if (line.includes('DSE26')) {
      const r = parseLine(line);
      if (r) records.push({ ...r, collegeName, collegeCode, course: currentCourse,
        courseCode: currentCourseCode, section: currentSection, group: currentGroup });
    }
  }
  return records;
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/pdf,*/*',
        'Referer': 'https://dse2026.mahacet.org.in/',
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    setTimeout(() => req.destroy(new Error('Timeout')), 30000);
  });
}

async function test() {
  console.log('🧪 PARSER TEST v2 — 3 colleges\n');
  let totalRecords = 0;

  for (const college of TEST_COLLEGES) {
    const url = `https://dse2026.mahacet.org.in/downloaddoc/cap1/${college.code}_final.pdf`;
    console.log(`\n📥 ${college.code} — ${college.name}`);
    try {
      const buf = await downloadBuffer(url);
      const data = await pdfParse(buf, { max: 0 });
      const records = parseAllotmentText(data.text, college.name, college.code);
      console.log(`   Pages: ${data.numpages} | Extracted: ${records.length} student records`);
      if (records.length > 0) {
        console.log('   Sample records (first 5):');
        records.slice(0, 5).forEach(r => {
          console.log(`   [${r.srNo}] ${r.appId} | "${r.name}" | ${r.gender} | ${r.category} | ${r.seatType} | ${r.marks}% | ${r.course}`);
        });
        // Check for obvious parse errors
        const badNames = records.filter(r => r.name.length < 3 || /\d/.test(r.name));
        if (badNames.length) console.log(`   ⚠️  ${badNames.length} suspicious name parses:`, badNames.slice(0,3).map(r=>r.name));
      } else {
        // Debug: print first few lines with DSE26
        console.log('   ⚠️  No records. Lines containing DSE26:');
        data.text.split('\n').filter(l => l.includes('DSE26')).slice(0, 5).forEach(l => {
          console.log('     RAW:', JSON.stringify(l.trim()));
          const r = parseLine(l.trim());
          console.log('     PARSED:', r ? JSON.stringify(r) : 'null');
        });
      }
      totalRecords += records.length;
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }
  }

  console.log(`\n\n✅ TOTAL RECORDS FOUND: ${totalRecords}\n`);
}

test().catch(console.error);
