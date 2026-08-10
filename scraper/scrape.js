/**
 * DSE 2026 CAP Round 1 - Allotment PDF Scraper
 * 
 * This script:
 * 1. Reads all college codes from the CSV file
 * 2. Downloads each college's PDF from the MAHACET portal
 * 3. Parses the PDF text to extract student allotment records
 * 4. Saves all records as ../data/allotments.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.error('pdf-parse not found. Please run: npm install');
  process.exit(1);
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Usage: node scrape.js           → scrapes CAP Round 1
//        node scrape.js --round=2 → scrapes CAP Round 2
const ROUND_ARG = process.argv.find(a => a.startsWith('--round='));
const ROUND = ROUND_ARG ? parseInt(ROUND_ARG.split('=')[1]) : 1;

const CSV_PATH = path.join(__dirname, '..', '..', 'Institute wise Allotment List _ Home - DSE (1).csv');
const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_PATH = path.join(OUTPUT_DIR, `allotments_round${ROUND}.json`);
const PDF_BASE_URL = `https://dse2026.mahacet.org.in/downloaddoc/cap${ROUND}/{CODE}_final.pdf`;
const CONCURRENT_REQUESTS = 5;       // How many PDFs to download at once
const REQUEST_DELAY_MS = 200;        // Delay between batches (ms)
const REQUEST_TIMEOUT_MS = 60000;    // 60 second timeout per PDF

// ─── SEAT TYPE DECODER ───────────────────────────────────────────────────────
const SEAT_TYPE_MAP = {
  'GOPENH': 'General - OPEN - Home Univ.',
  'LOPENH': 'Ladies - OPEN - Home Univ.',
  'GOPENO': 'General - OPEN - Other Univ.',
  'LOPENO': 'Ladies - OPEN - Other Univ.',
  'GOPENS': 'General - OPEN - State Level',
  'LOPENS': 'Ladies - OPEN - State Level',
  'GOBCH': 'General - OBC - Home Univ.',
  'LOBCH': 'Ladies - OBC - Home Univ.',
  'GOBCO': 'General - OBC - Other Univ.',
  'LOBCO': 'Ladies - OBC - Other Univ.',
  'GOBCS': 'General - OBC - State Level',
  'LOBCS': 'Ladies - OBC - State Level',
  'GSCH': 'General - SC - Home Univ.',
  'LSCH': 'Ladies - SC - Home Univ.',
  'GSCO': 'General - SC - Other Univ.',
  'LSCO': 'Ladies - SC - Other Univ.',
  'GSCS': 'General - SC - State Level',
  'LSCS': 'Ladies - SC - State Level',
  'GSTH': 'General - ST - Home Univ.',
  'LSTH': 'Ladies - ST - Home Univ.',
  'GSTO': 'General - ST - Other Univ.',
  'LSTO': 'Ladies - ST - Other Univ.',
  'GSTS': 'General - ST - State Level',
  'LSTS': 'Ladies - ST - State Level',
  'GVJH': 'General - DT/VJ - Home Univ.',
  'LVJH': 'Ladies - DT/VJ - Home Univ.',
  'GVJO': 'General - DT/VJ - Other Univ.',
  'LVJO': 'Ladies - DT/VJ - Other Univ.',
  'GVJS': 'General - DT/VJ - State Level',
  'LVJS': 'Ladies - DT/VJ - State Level',
  'GNTAH': 'General - NT-A - Home Univ.',
  'LNTAH': 'Ladies - NT-A - Home Univ.',
  'GNTBH': 'General - NT-B - Home Univ.',
  'LNTBH': 'Ladies - NT-B - Home Univ.',
  'GNTH': 'General - NT - Home Univ.',
  'LNTH': 'Ladies - NT - Home Univ.',
  'GNTO': 'General - NT - Other Univ.',
  'LNTO': 'Ladies - NT - Other Univ.',
  'GNTS': 'General - NT - State Level',
  'LNTS': 'Ladies - NT - State Level',
  'GSEBCH': 'General - SEBC - Home Univ.',
  'LSEBCH': 'Ladies - SEBC - Home Univ.',
  'GSEBCO': 'General - SEBC - Other Univ.',
  'LSEBCO': 'Ladies - SEBC - Other Univ.',
  'GSEBCS': 'General - SEBC - State Level',
  'LSEBCS': 'Ladies - SEBC - State Level',
  'GSEBC': 'General - SEBC',
  'LSEBC': 'Ladies - SEBC',
  'GOPEN': 'General - OPEN',
  'LOPEN': 'Ladies - OPEN',
  'GOBC': 'General - OBC',
  'LOBC': 'Ladies - OBC',
  'GSC': 'General - SC',
  'LSC': 'Ladies - SC',
  'GST': 'General - ST',
  'LST': 'Ladies - ST',
  'EWSH': 'EWS - Home Univ.',
  'EWSO': 'EWS - Other Univ.',
  'EWSS': 'EWS - State Level',
  'EWS': 'Economically Weaker Section',
  'TFWS': 'Tuition Fee Waiver Scheme',
  'MI': 'Minority Seat',
  'PWD': 'Person with Disability',
  'DEF': 'Defence Quota',
  'EXSM': 'Ex-Serviceman',
  'TFWSH': 'TFWS - Home Univ.',
  'TFWSO': 'TFWS - Other Univ.',
  'TFWSS': 'TFWS - State Level',
};

function decodeSeatType(code) {
  if (!code) return code;
  const clean = code.replace(/\$/g, '').replace(/#/g, '').trim();
  return SEAT_TYPE_MAP[clean] || code;
}

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
        courseCode: currentCourseCode, section: currentSection, group: currentGroup, seatTypeDecoded: decodeSeatType(r.seatType) });
    }
  }
  return records;
}

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
function parseCSV(csvText) {
  const lines = csvText.split('\n');
  const colleges = [];
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Handle quoted fields with commas inside
    const fields = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    
    if (fields.length >= 3) {
      const srNo = fields[0];
      const code = fields[1];
      const name = fields[2];
      const type = fields[3] || '';
      
      if (code && code.match(/^\d+$/)) {
        colleges.push({ srNo, code, name, type });
      }
    }
  }
  
  return colleges;
}

// ─── HTTP DOWNLOAD ─────────────────────────────────────────────────────────────
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/pdf,*/*',
        'Referer': 'https://dse2026.mahacet.org.in/',
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        clearTimeout(timeout);
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      
      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
      res.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    
    req.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ─── PROCESS ONE COLLEGE ──────────────────────────────────────────────────────
async function processCollege(college) {
  const url = PDF_BASE_URL.replace('{CODE}', college.code);
  
  try {
    const buffer = await downloadBuffer(url);
    const data = await pdfParse(buffer, { max: 0 });
    const records = parseAllotmentText(data.text, college.name, college.code);
    return { success: true, college, records, pages: data.numpages };
  } catch (err) {
    return { success: false, college, error: err.message, records: [] };
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🎓 DSE 2026 CAP Round 1 - Allotment PDF Scraper');
  console.log('================================================\n');
  
  // Read CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV not found at: ${CSV_PATH}`);
    process.exit(1);
  }
  
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const colleges = parseCSV(csvText);
  console.log(`📋 Found ${colleges.length} colleges in CSV\n`);
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Process colleges in batches
  const allRecords = [];
  const failed = [];
  let processed = 0;
  let totalRecords = 0;
  
  const startTime = Date.now();
  
  for (let i = 0; i < colleges.length; i += CONCURRENT_REQUESTS) {
    const batch = colleges.slice(i, i + CONCURRENT_REQUESTS);
    const results = await Promise.all(batch.map(processCollege));
    
    for (const result of results) {
      processed++;
      const pct = ((processed / colleges.length) * 100).toFixed(1);
      
      if (result.success) {
        allRecords.push(...result.records);
        totalRecords += result.records.length;
        const icon = result.records.length > 0 ? '✅' : '⚠️ ';
        console.log(`${icon} [${pct}%] ${result.college.code} - ${result.college.name.substring(0, 50)} → ${result.records.length} records (${result.pages} pages)`);
      } else {
        failed.push(result.college);
        console.log(`❌ [${pct}%] ${result.college.code} - ${result.college.name.substring(0, 50)} → ${result.error}`);
      }
    }
    
    // Save intermediate progress every 30 colleges
    if (processed % 30 === 0 || processed === colleges.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processed / (elapsed / 60)).toFixed(1);
      console.log(`\n💾 Saving intermediate results... (${allRecords.length} records, ${elapsed}s elapsed, ${rate} colleges/min)\n`);
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allRecords, null, 0));
    }
    
    // Delay between batches to be respectful to the server
    if (i + CONCURRENT_REQUESTS < colleges.length) {
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }
  }
  
  // Final save
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allRecords, null, 0));
  
  console.log('\n================================================');
  console.log('✨ SCRAPING COMPLETE!');
  console.log(`📊 Total records extracted: ${totalRecords.toLocaleString()}`);
  console.log(`🏫 Colleges processed: ${processed - failed.length}/${colleges.length}`);
  console.log(`⏱️  Total time: ${elapsed} seconds`);
  console.log(`📁 Output saved to: ${OUTPUT_PATH}`);
  
  const fileSizeMB = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`📦 File size: ${fileSizeMB} MB`);
  
  if (failed.length > 0) {
    console.log(`\n⚠️  ${failed.length} colleges had no PDF (normal - they may not be participating):`);
    failed.forEach(c => console.log(`   - ${c.code}: ${c.name}`));
  }
  
  console.log('\n🚀 Next step: Open index.html in your browser to search!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
