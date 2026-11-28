import * as XLSX from "xlsx";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export function bnToEnDigits(val) {
  return String(val == null ? "" : val).replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d)));
}

export function parseFlexibleNumber(val, fallback = 0) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const cleaned = bnToEnDigits(val).replace(/[,৳\s]/g, "").replace(/[^\d.-]/g, "");
  if (!cleaned) return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePhone(val) {
  if (val == null) return "";
  let s = bnToEnDigits(String(val)).trim();
  if (!s || s === "—") return "";
  if (/^1[3-9]\d{8}$/.test(s)) s = "0" + s;
  return s;
}

function normalizeDateCell(val) {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = bnToEnDigits(String(val == null ? "" : val)).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return "";
}

const CLASS_ALIAS_MAP = new Map([
  ["play", "প্লে"], ["প্লে", "প্লে"], ["playgroup", "প্লে"], ["pg", "প্লে"],
  ["nursery", "নার্সারি"], ["নার্সারি", "নার্সারি"], ["n", "নার্সারি"],
  ["kg", "কেজি"], ["কেজি", "কেজি"], ["k.g", "কেজি"],
  ["1", "প্রথম"], ["one", "প্রথম"], ["class 1", "প্রথম"], ["class-1", "প্রথম"], ["১ম", "প্রথম"], ["প্রথম", "প্রথম"],
  ["2", "দ্বিতীয়"], ["two", "দ্বিতীয়"], ["class 2", "দ্বিতীয়"], ["class-2", "দ্বিতীয়"], ["২য়", "দ্বিতীয়"], ["দ্বিতীয়", "দ্বিতীয়"], ["দ্বিতীয়", "দ্বিতীয়"],
  ["3", "তৃতীয়"], ["three", "তৃতীয়"], ["class 3", "তৃতীয়"], ["class-3", "তৃতীয়"], ["৩য়", "তৃতীয়"], ["তৃতীয়", "তৃতীয়"], ["তৃতীয়", "তৃতীয়"],
  ["4", "চতুর্থ"], ["four", "চতুর্থ"], ["class 4", "চতুর্থ"], ["class-4", "চতুর্থ"], ["৪র্থ", "চতুর্থ"], ["চতুর্থ", "চতুর্থ"],
  ["5", "পঞ্চম"], ["five", "পঞ্চম"], ["class 5", "পঞ্চম"], ["class-5", "পঞ্চম"], ["৫ম", "পঞ্চম"], ["পঞ্চম", "পঞ্চম"],
  ["6", "ষষ্ঠ"], ["six", "ষষ্ঠ"], ["class 6", "ষষ্ঠ"], ["class-6", "ষষ্ঠ"], ["৬ষ্ঠ", "ষষ্ঠ"], ["ষষ্ঠ", "ষষ্ঠ"],
  ["7", "সপ্তম"], ["seven", "সপ্তম"], ["class 7", "সপ্তম"], ["class-7", "সপ্তম"], ["৭ম", "সপ্তম"], ["সপ্তম", "সপ্তম"],
  ["8", "অষ্টম"], ["eight", "অষ্টম"], ["class 8", "অষ্টম"], ["class-8", "অষ্টম"], ["৮ম", "অষ্টম"], ["অষ্টম", "অষ্টম"],
  ["9", "নবম"], ["nine", "নবম"], ["class 9", "নবম"], ["class-9", "নবম"], ["৯ম", "নবম"], ["নবম", "নবম"],
  ["10", "দশম"], ["ten", "দশম"], ["class 10", "দশম"], ["class-10", "দশম"], ["১০ম", "দশম"], ["দশম", "দশম"],
  ["11", "একাদশ"], ["eleven", "একাদশ"], ["class 11", "একাদশ"], ["class-11", "একাদশ"], ["১১শ", "একাদশ"], ["একাদশ", "একাদশ"],
  ["12", "দ্বাদশ"], ["twelve", "দ্বাদশ"], ["class 12", "দ্বাদশ"], ["class-12", "দ্বাদশ"], ["১২শ", "দ্বাদশ"], ["দ্বাদশ", "দ্বাদশ"],
]);

export function normalizeClassValue(raw, availableClasses = []) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  const matchedExact = availableClasses.find(c => c && c.trim() === s);
  if (matchedExact) return matchedExact;
  const cleaned = bnToEnDigits(s)
    .replace(/শ্রেণি|শ্রেণী|class/gi, "")
    .replace(/[()]/g, "")
    .trim()
    .toLowerCase();
  if (CLASS_ALIAS_MAP.has(cleaned)) {
    const mapped = CLASS_ALIAS_MAP.get(cleaned);
    const inList = availableClasses.find(c => c === mapped);
    return inList || mapped;
  }
  const enLower = bnToEnDigits(s).trim().toLowerCase();
  if (CLASS_ALIAS_MAP.has(enLower)) {
    const mapped = CLASS_ALIAS_MAP.get(enLower);
    const inList = availableClasses.find(c => c === mapped);
    return inList || mapped;
  }
  return s;
}

function normalizeSectionValue(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low === "a" || low === "sec a" || low === "section a") return "ক";
  if (low === "b" || low === "sec b" || low === "section b") return "খ";
  if (low === "c" || low === "sec c" || low === "section c") return "গ";
  if (low === "science") return "সাইন্স";
  if (low === "commerce" || low === "business") return "ইকমার্স";
  if (low === "arts" || low === "humanities") return "মানবিক";
  return s;
}

function normalizeHeaderKey(h) {
  return String(h == null ? "" : h)
    .replace(/^\uFEFF/, "")
    .replace(/[*:#()৳]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const STUDENT_HEADER_ALIASES = {
  name: ["নাম", "শিক্ষার্থীর নাম", "শিক্ষার্থী", "ছাত্র/ছাত্রীর নাম", "ছাত্র/ছাত্রী", "ছাত্রের নাম", "ছাত্রীর নাম", "ছাত্র", "ছাত্রী", "student name", "name of student", "student's name", "student", "name", "full name", "candidate"],
  cls: ["শ্রেণি", "শ্রেণী", "ক্লাস", "class", "class name", "cls", "grade", "standard"],
  roll: ["রোল", "রোল নং", "রোল নম্বর", "roll", "roll no", "roll no.", "roll number", "id", "student id", "ক্রমিক", "ক্রমিক নং", "sl", "sl no"],
  section: ["শাখা", "বিভাগ", "বিভাগ / শাখা", "section", "sec", "sec.", "group", "stream"],
  guardian: ["অভিভাবক", "অভিভাবকের নাম", "পিতার নাম", "পিতা/অভিভাবক", "মাতার নাম", "guardian", "guardian name", "guardian's name", "father", "father name", "father's name", "mother name", "parent"],
  phone: ["মোবাইল", "ফোন", "মোবাইল নং", "অভিভাবকের মোবাইল", "ফোন নম্বর", "যোগাযোগ", "phone", "phone no", "mobile", "mobile no.", "contact", "phone number", "mobile no", "cell"],
  payable: ["মোট ফি", "নির্ধারিত ফি", "মোট খরচ", "বার্ষিক ফি", "payable", "total fee", "fee", "fees"],
  paid: ["জমা", "ভর্তিকালীন জমা", "পরিশোধিত", "paid", "deposit", "paid amount"],
};

const TEACHER_HEADER_ALIASES = {
  name: ["নাম", "শিক্ষকের নাম", "শিক্ষক", "শিক্ষিকা", "teacher name", "name of teacher", "teacher's name", "teacher", "instructor", "lecturer", "name", "full name"],
  teacherCode: ["কোড", "শিক্ষক কোড", "টিচার কোড", "আইডি", "teacher code", "code", "teacher id", "emp id", "id", "sl", "sl no"],
  shortCode: ["সংক্ষিপ্ত কোড", "শর্ট কোড", "short code", "shortcode", "initials"],
  designation: ["পদবি", "পদবী", "designation", "post", "position", "role", "title"],
  subject: ["বিষয়", "বিষয়", "মূল বিষয়", "মূল বিষয়", "পাঠদানের বিষয়", "subject", "subject name", "main subject", "primary subject"],
  additionalSubjects: ["অতিরিক্ত বিষয়", "অতিরিক্ত বিষয়", "অন্যান্য বিষয়", "অন্যান্য বিষয়", "বরাদ্দকৃত বিষয়", "additional subjects", "extra subjects", "other subjects", "subjects"],
  qualification: ["যোগ্যতা", "শিক্ষাগত যোগ্যতা", "ডিগ্রি", "qualification", "education", "degree"],
  phone: ["মোবাইল", "ফোন", "মোবাইল নং", "ফোন নম্বর", "যোগাযোগ", "phone", "phone no", "phone no.", "mobile", "mobile no", "mobile no.", "contact", "phone number", "cell"],
  email: ["ইমেইল", "ই-মেইল", "email", "e mail", "mail"],
  bloodGroup: ["রক্তের গ্রুপ", "ব্লাড গ্রুপ", "blood group", "blood"],
  address: ["ঠিকানা", "address", "location"],
  joinDate: ["যোগদানের তারিখ", "যোগদান", "joining date", "join date", "joined", "joining"],
  classTeacherClass: ["শ্রেণি শিক্ষক", "শ্রেণী শিক্ষক", "দায়িত্বপ্রাপ্ত শ্রেণি", "class teacher", "class teacher class"],
  classTeacherSection: ["শ্রেণি শিক্ষকের শাখা", "দায়িত্বপ্রাপ্ত শাখা", "class teacher section", "শাখা", "section"],
  teachingClasses: ["ক্লাস নেন", "পাঠদানের শ্রেণি", "বরাদ্দকৃত শ্রেণি", "শ্রেণিসমূহ", "শ্রেণি", "শ্রেণী", "teaching classes", "classes", "class"],
  monthlySalary: ["বেতন", "মূল বেতন", "মাসিক বেতন", "salary", "basic", "basic salary", "monthly salary"],
  monthlyAllowance: ["ভাতা", "মাসিক ভাতা", "allowance", "monthly allowance"],
  status: ["অবস্থা", "স্ট্যাটাস", "status"],
};

function resolveFieldKey(headerCell, aliasMap) {
  const norm = normalizeHeaderKey(headerCell);
  if (!norm) return null;
  for (const [field, aliases] of Object.entries(aliasMap)) {
    if (aliases.some(a => normalizeHeaderKey(a) === norm)) return field;
  }
  for (const [field, aliases] of Object.entries(aliasMap)) {
    if (aliases.some(a => {
      const na = normalizeHeaderKey(a);
      return na.length >= 3 && (norm.includes(na) || na.includes(norm));
    })) {
      return field;
    }
  }
  return null;
}

export async function parseSpreadsheetFile(file) {
  if (!file) throw new Error("কোনো ফাইল নির্বাচন করা হয়নি।");
  const lower = (file.name || "").toLowerCase();
  const isCsv = lower.endsWith(".csv") || lower.endsWith(".tsv") || file.type === "text/csv";
  let wb;
  if (isCsv) {
    const rawText = await file.text();
    const cleanText = rawText.replace(/^\uFEFF/, "");
    wb = XLSX.read(cleanText, { type: "string", raw: false });
  } else {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: "array", cellDates: true });
  }
  if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error("ফাইলটিতে কোনো শীট পাওয়া যায়নি।");
  }
  let bestRows = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
    if (Array.isArray(rows) && rows.length > bestRows.length) {
      bestRows = rows;
    }
  }
  if (bestRows.length === 0) {
    throw new Error("ফাইলটি খালি অথবা এতে কোনো তথ্য পাওয়া যায়নি।");
  }
  return {
    fileName: file.name,
    rows: bestRows,
  };
}

function detectHeaderRowIndex(rows, aliasMap) {
  let bestIdx = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 6);
  for (let i = 0; i < limit; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    let score = 0;
    const seen = new Set();
    for (const cell of row) {
      const k = resolveFieldKey(cell, aliasMap);
      if (k && !seen.has(k)) {
        seen.add(k);
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return { headerIdx: bestIdx, matchedColumns: bestScore };
}

export function parseStudentsFromRows(rows, availableClasses = [], optionsOrPayable = 12000) {
  const opts = typeof optionsOrPayable === "number"
    ? { defaultPayable: optionsOrPayable }
    : (optionsOrPayable || {});
  const defaultPayable = typeof opts.defaultPayable === "number" ? opts.defaultPayable : 12000;
  const fixedClass = opts.targetClass && opts.targetClass !== "__AUTO__" ? opts.targetClass : "";
  const fixedSection = fixedClass && opts.targetSection && opts.targetSection !== "__AUTO__" ? opts.targetSection : "";

  const { headerIdx, matchedColumns } = detectHeaderRowIndex(rows, STUDENT_HEADER_ALIASES);
  let startRowIdx = headerIdx + 1;
  let colMap = [];

  if (matchedColumns <= 0) {
    const firstNonEmpty = rows.findIndex(r => Array.isArray(r) && r.some(v => String(v == null ? "" : v).trim() !== ""));
    if (firstNonEmpty < 0) {
      throw new Error("ফাইলে কোনো শিক্ষার্থীর তথ্য পাওয়া যায়নি।");
    }
    const sampleRow = rows[firstNonEmpty] || [];
    const col0Text = String(sampleRow[0] == null ? "" : sampleRow[0]).trim();
    const col1Text = String(sampleRow[1] == null ? "" : sampleRow[1]).trim();
    const col0IsNum = /^\d+$/.test(bnToEnDigits(col0Text));
    if (col0IsNum && col1Text) {
      colMap = ["roll", "name", "guardian", "phone"];
      startRowIdx = firstNonEmpty;
    } else if (col0Text) {
      colMap = ["name", "roll", "guardian", "phone"];
      startRowIdx = firstNonEmpty;
    } else {
      throw new Error("কলামের শিরোনাম চেনা যায়নি। দয়া করে 'নাম' / 'Name', 'রোল' / 'Roll', 'অভিভাবক' / 'Guardian', 'মোবাইল' / 'Phone' কলাম রাখুন অথবা নমুনা ফাইল ডাউনলোড করুন।");
    }
  } else {
    const headerRow = rows[headerIdx] || [];
    colMap = headerRow.map(h => resolveFieldKey(h, STUDENT_HEADER_ALIASES));
    if (!colMap.includes("name")) {
      const firstEmptyOrUnknown = colMap.findIndex(k => !k);
      if (firstEmptyOrUnknown >= 0) colMap[firstEmptyOrUnknown] = "name";
    }
  }

  const defaultCls = fixedClass || availableClasses[0] || "ষষ্ঠ";
  const records = [];
  let skipped = 0;

  for (let i = startRowIdx; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const hasAny = row.some(v => String(v == null ? "" : v).trim() !== "");
    if (!hasAny) continue;

    const rawObj = {};
    colMap.forEach((field, idx) => {
      if (field && rawObj[field] === undefined) rawObj[field] = row[idx];
    });

    const name = String(rawObj.name == null ? "" : rawObj.name).trim();
    if (!name) {
      skipped += 1;
      continue;
    }

    const cls = fixedClass || normalizeClassValue(rawObj.cls, availableClasses) || defaultCls;
    const roll = Math.max(0, Math.round(parseFlexibleNumber(rawObj.roll, records.length + 1)));
    const section = fixedSection || normalizeSectionValue(rawObj.section) || "ক";
    const guardian = String(rawObj.guardian == null ? "" : rawObj.guardian).trim();
    const phone = normalizePhone(rawObj.phone);
    const payable = Math.max(0, Math.round(parseFlexibleNumber(rawObj.payable, defaultPayable)));
    const paid = Math.max(0, Math.round(parseFlexibleNumber(rawObj.paid, 0)));

    records.push({
      name,
      cls,
      roll,
      section,
      guardian,
      phone,
      photo: "",
      payable,
      paid,
    });
  }

  return {
    records,
    skipped,
    detectedColumns: colMap.filter(Boolean),
  };
}

export function parseTeachersFromRows(rows, availableClasses = [], options = {}) {
  const opts = options || {};
  const fixedClass = opts.targetClass && opts.targetClass !== "__AUTO__" ? opts.targetClass : "";
  const fixedSubject = opts.targetSubject && opts.targetSubject !== "__AUTO__" ? opts.targetSubject : "";

  const { headerIdx, matchedColumns } = detectHeaderRowIndex(rows, TEACHER_HEADER_ALIASES);
  let startRowIdx = headerIdx + 1;
  let colMap = [];

  if (matchedColumns <= 0) {
    const firstNonEmpty = rows.findIndex(r => Array.isArray(r) && r.some(v => String(v == null ? "" : v).trim() !== ""));
    if (firstNonEmpty < 0) {
      throw new Error("ফাইলে কোনো শিক্ষকের তথ্য পাওয়া যায়নি।");
    }
    const sampleRow = rows[firstNonEmpty] || [];
    const col0Text = String(sampleRow[0] == null ? "" : sampleRow[0]).trim();
    const col1Text = String(sampleRow[1] == null ? "" : sampleRow[1]).trim();
    const col0IsSerialOrCode = /^\d+$/.test(bnToEnDigits(col0Text)) || /^TCH[-_]?\d+$/i.test(col0Text);
    if (col0IsSerialOrCode && col1Text) {
      colMap = ["teacherCode", "name", "subject", "phone"];
      startRowIdx = firstNonEmpty;
    } else if (col0Text) {
      colMap = ["name", "subject", "designation", "phone"];
      startRowIdx = firstNonEmpty;
    } else {
      throw new Error("কলামের শিরোনাম চেনা যায়নি। দয়া করে 'নাম' / 'Name', 'বিষয়' / 'Subject', 'পদবি' / 'Designation', 'মোবাইল' / 'Phone' কলাম রাখুন অথবা নমুনা ফাইল ডাউনলোড করুন।");
    }
  } else {
    const headerRow = rows[headerIdx] || [];
    colMap = headerRow.map(h => resolveFieldKey(h, TEACHER_HEADER_ALIASES));
    if (!colMap.includes("name")) {
      const firstEmptyOrUnknown = colMap.findIndex(k => !k);
      if (firstEmptyOrUnknown >= 0) colMap[firstEmptyOrUnknown] = "name";
    }
  }

  const records = [];
  let skipped = 0;

  for (let i = startRowIdx; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const hasAny = row.some(v => String(v == null ? "" : v).trim() !== "");
    if (!hasAny) continue;

    const rawObj = {};
    colMap.forEach((field, idx) => {
      if (field && rawObj[field] === undefined) rawObj[field] = row[idx];
    });

    const name = String(rawObj.name == null ? "" : rawObj.name).trim();
    if (!name) {
      skipped += 1;
      continue;
    }

    const fileSubject = String(rawObj.subject == null ? "" : rawObj.subject).trim();
    const subject = fixedSubject || fileSubject || "সাধারণ";
    const additionalSubjects = String(rawObj.additionalSubjects == null ? "" : rawObj.additionalSubjects)
      .split(/[,;|/]+/)
      .map(s => s.trim())
      .filter(s => s && s !== subject);
    if (fixedSubject && fileSubject && fileSubject !== fixedSubject && !additionalSubjects.includes(fileSubject)) {
      additionalSubjects.unshift(fileSubject);
    }

    let ctRaw = String(rawObj.classTeacherClass == null ? "" : rawObj.classTeacherClass).trim();
    let ctSec = normalizeSectionValue(rawObj.classTeacherSection);
    const ctParen = ctRaw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (ctParen) {
      ctRaw = ctParen[1].trim();
      if (!ctSec) ctSec = normalizeSectionValue(ctParen[2]);
    }
    const classTeacherClass = normalizeClassValue(ctRaw, availableClasses);
    const classTeacherSection = classTeacherClass ? (ctSec || "ক") : "";

    let teachingClasses = String(rawObj.teachingClasses == null ? "" : rawObj.teachingClasses)
      .split(/[,;|]+/)
      .map(c => normalizeClassValue(c, availableClasses))
      .filter(Boolean);
    if (classTeacherClass && !teachingClasses.includes(classTeacherClass)) {
      teachingClasses = [classTeacherClass, ...teachingClasses];
    }
    if (fixedClass && !teachingClasses.includes(fixedClass)) {
      teachingClasses = [fixedClass, ...teachingClasses];
    }

    const joinDate = normalizeDateCell(rawObj.joinDate) || "2022-01-05";
    const monthlySalary = Math.max(0, Math.round(parseFlexibleNumber(rawObj.monthlySalary, 26000)));
    const monthlyAllowance = Math.max(0, Math.round(parseFlexibleNumber(rawObj.monthlyAllowance, 4500)));

    records.push({
      teacherCode: String(rawObj.teacherCode == null ? "" : rawObj.teacherCode).trim(),
      shortCode: String(rawObj.shortCode == null ? "" : rawObj.shortCode).trim(),
      name,
      designation: String(rawObj.designation == null ? "" : rawObj.designation).trim() || "সহকারী শিক্ষক",
      subject,
      additionalSubjects,
      qualification: String(rawObj.qualification == null ? "" : rawObj.qualification).trim() || "স্নাতকোত্তর",
      phone: normalizePhone(rawObj.phone) || "—",
      email: String(rawObj.email == null ? "" : rawObj.email).trim(),
      bloodGroup: String(rawObj.bloodGroup == null ? "" : rawObj.bloodGroup).trim(),
      address: String(rawObj.address == null ? "" : rawObj.address).trim(),
      photo: "",
      joinDate,
      classTeacherClass,
      classTeacherSection,
      teachingClasses,
      monthlySalary,
      monthlyAllowance,
      status: String(rawObj.status == null ? "" : rawObj.status).trim() || "সক্রিয়",
    });
  }

  return {
    records,
    skipped,
    detectedColumns: colMap.filter(Boolean),
  };
}

export function downloadBulkTemplate(type, format = "xlsx", targetClass = "", targetSection = "", targetSubject = "") {
  const isStudents = type === "students";
  const sampleCls = targetClass && targetClass !== "__AUTO__" ? targetClass : "ষষ্ঠ";
  const sampleSec = targetClass && targetClass !== "__AUTO__" && targetSection && targetSection !== "__AUTO__" ? targetSection : "ক";
  const sampleSub = targetSubject && targetSubject !== "__AUTO__" ? targetSubject : "";
  const aoa = isStudents
    ? [
        ["নাম", "শ্রেণি", "রোল", "শাখা", "অভিভাবক", "মোবাইল", "জমা"],
        ["তাসনিম তাবাসসুম", sampleCls, "১০১", sampleSec, "মোঃ কামরুল হাসান", "01711000001", "5000"],
        ["রাফিউল ইসলাম", targetClass && targetClass !== "__AUTO__" ? sampleCls : "সপ্তম", targetClass && targetClass !== "__AUTO__" ? "১০২" : "২০২", targetClass && targetClass !== "__AUTO__" ? sampleSec : "খ", "মোঃ সাইফুল ইসলাম", "01812000002", "4000"],
        ["নুসরাত জাহান মিম", targetClass && targetClass !== "__AUTO__" ? sampleCls : "অষ্টম", targetClass && targetClass !== "__AUTO__" ? "১০৩" : "৩০১", sampleSec, "জাহিদুল ইসলাম", "01913000003", "6000"],
      ]
    : [
        ["শিক্ষকের নাম", "কোড", "পদবি", "বিষয়", "অতিরিক্ত বিষয়", "যোগ্যতা", "মোবাইল", "শ্রেণি শিক্ষক", "ক্লাস নেন", "মাসিক বেতন", "মাসিক ভাতা", "যোগদানের তারিখ"],
        ["ড. মাহবুবুল আলম", "TCH-201", "সিনিয়র শিক্ষক", sampleSub || "বাংলা", "বাংলা সাহিত্য", "পিএইচডি / এমএ (বাংলা)", "01711223344", `${sampleCls} (${sampleSec})`, targetClass && targetClass !== "__AUTO__" ? sampleCls : "ষষ্ঠ, সপ্তম, অষ্টম", "32000", "5500", "2019-02-01"],
        ["ফারহানা ইয়াসমিন", "TCH-202", "সহকারী শিক্ষক", sampleSub || "ইংরেজি", "English Grammar", "এমএ (ইংরেজি)", "01811223355", "", targetClass && targetClass !== "__AUTO__" ? sampleCls : "সপ্তম, অষ্টম, নবম", "28000", "4500", "2021-01-10"],
        ["মোঃ তানভীর আহমেদ", "TCH-203", "সহকারী শিক্ষক", sampleSub || "গণিত", "উচ্চতর গণিত", "এমএসসি (গণিত)", "01911223366", "", targetClass && targetClass !== "__AUTO__" ? sampleCls : "অষ্টম, নবম, দশম", "29000", "5000", "2020-06-15"],
      ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = aoa[0].map(() => ({ wch: 20 }));

  const baseName = isStudents ? "students-template" : "teachers-template";
  if (format === "csv") {
    const csv = "\uFEFF" + XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isStudents ? "Students" : "Teachers");
  XLSX.writeFile(wb, `${baseName}.xlsx`);
}
