export const ROUTINE_ALL_DAYS = [
  "রবিবার",
  "সোমবার",
  "মঙ্গলবার",
  "বুধবার",
  "বৃহস্পতিবার",
  "শনিবার"
];

export const ROUTINE_DEFAULT_DAYS = [
  "রবিবার",
  "সোমবার",
  "মঙ্গলবার",
  "বুধবার",
  "বৃহস্পতিবার"
];

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
export function toBnStr(v) {
  return String(v == null ? "" : v).replace(/\d/g, d => BN_DIGITS[+d]);
}

const ORDINAL_BN = [
  "",
  "১ম",
  "২য়",
  "৩য়",
  "৪র্থ",
  "৫ম",
  "৬ষ্ঠ",
  "৭ম",
  "৮ম",
  "৯ম",
  "১০ম",
  "১১শ",
  "১২শ"
];

export function ordinalPeriodBn(n) {
  const num = Math.max(1, Math.round(Number(n) || 1));
  return ORDINAL_BN[num] || toBnStr(num) + "তম";
}

export function secSlotKey(clsName, secName) {
  return `${String(clsName || "").trim()}::${String(secName || "ক").trim()}`;
}

export function cellSlotKey(day, secKey, period) {
  return `${day}|${secKey}|${Number(period) || 1}`;
}

export function parseTimeMinutes(hhmm) {
  const m = String(hhmm || "09:00").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 9 * 60;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return h * 60 + min;
}

export function formatMinutes12hBn(totalMins) {
  const wrapped = ((Math.round(totalMins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${toBnStr(h12)}:${toBnStr(String(m).padStart(2, "0"))}`;
}

export function defaultRoutineConfig() {
  return {
    startTime: "09:00",
    periodsPerDay: 6,
    periodDuration: 45,
    periodDurations: {},
    breaks: [
      { id: "brk-1", afterPeriod: 2, duration: 10, label: "সংক্ষিপ্ত বিরতি" },
      { id: "brk-2", afterPeriod: 4, duration: 30, label: "টিফিন বিরতি" }
    ],
    days: [...ROUTINE_DEFAULT_DAYS]
  };
}

export function normalizeRoutineConfig(raw) {
  const def = defaultRoutineConfig();
  const src = raw && typeof raw === "object" ? raw : {};
  const periodsPerDay = Math.min(12, Math.max(1, Math.round(Number(src.periodsPerDay) || def.periodsPerDay)));
  const periodDuration = Math.min(180, Math.max(15, Math.round(Number(src.periodDuration) || def.periodDuration)));
  const startTime = /^\d{1,2}:\d{2}$/.test(String(src.startTime || "")) ? String(src.startTime) : def.startTime;

  const rawDurations = src.periodDurations && typeof src.periodDurations === "object" ? src.periodDurations : {};
  const periodDurations = {};
  for (let p = 1; p <= periodsPerDay; p++) {
    const val = Number(rawDurations[p] || rawDurations[String(p)]);
    if (val >= 15 && val <= 180) periodDurations[p] = Math.round(val);
  }

  const rawBreaks = Array.isArray(src.breaks) ? src.breaks : def.breaks;
  const breaks = rawBreaks
    .filter(b => b && typeof b === "object")
    .map((b, idx) => ({
      id: String(b.id || `brk-${idx + 1}`),
      afterPeriod: Math.min(Math.max(1, periodsPerDay - 1), Math.max(1, Math.round(Number(b.afterPeriod) || 2))),
      duration: Math.min(120, Math.max(5, Math.round(Number(b.duration) || 15))),
      label: String(b.label || (idx === 0 ? "বিরতি" : "টিফিন বিরতি")).trim() || "বিরতি"
    }))
    .slice(0, 4)
    .sort((a, b) => a.afterPeriod - b.afterPeriod);

  const daysRaw = Array.isArray(src.days) && src.days.length ? src.days : def.days;
  const days = ROUTINE_ALL_DAYS.filter(d => daysRaw.includes(d));

  return {
    startTime,
    periodsPerDay,
    periodDuration,
    periodDurations,
    breaks,
    days: days.length ? days : [...ROUTINE_DEFAULT_DAYS]
  };
}

export function buildRoutineTimeline(rawConfig) {
  const cfg = normalizeRoutineConfig(rawConfig);
  const timeline = [];
  let cursor = parseTimeMinutes(cfg.startTime);
  let sessionIndex = 0;

  for (let p = 1; p <= cfg.periodsPerDay; p++) {
    const dur = Number(cfg.periodDurations[p]) || cfg.periodDuration;
    const start = cursor;
    const end = cursor + dur;
    cursor = end;

    timeline.push({
      type: "period",
      period: p,
      label: `${ordinalPeriodBn(p)} পিরিয়ড`,
      shortLabel: `${ordinalPeriodBn(p)}`,
      duration: dur,
      startMin: start,
      endMin: end,
      timeBn: `${formatMinutes12hBn(start)}–${formatMinutes12hBn(end)}`,
      sessionIndex
    });

    const matchingBreaks = cfg.breaks.filter(b => b.afterPeriod === p && p < cfg.periodsPerDay);
    if (matchingBreaks.length > 0) {
      matchingBreaks.forEach((b, bIdx) => {
        const bStart = cursor;
        const bEnd = cursor + b.duration;
        cursor = bEnd;
        timeline.push({
          type: "break",
          breakIndex: bIdx + 1,
          id: b.id,
          afterPeriod: p,
          label: b.label || "বিরতি",
          duration: b.duration,
          startMin: bStart,
          endMin: bEnd,
          timeBn: `${formatMinutes12hBn(bStart)}–${formatMinutes12hBn(bEnd)}`
        });
      });
      sessionIndex++;
    }
  }
  return timeline;
}

export function maxSpanFromPeriod(timeline, startPeriod) {
  const periods = timeline.filter(t => t.type === "period");
  const startSlot = periods.find(t => t.period === startPeriod);
  if (!startSlot) return 1;
  let span = 1;
  for (let i = startPeriod + 1; i <= periods.length; i++) {
    const nxt = periods.find(t => t.period === i);
    if (!nxt || nxt.sessionIndex !== startSlot.sessionIndex) break;
    span++;
  }
  return span;
}

export function mergedPeriodTimeRangeBn(timeline, startPeriod, span) {
  const periods = timeline.filter(t => t.type === "period");
  const first = periods.find(t => t.period === startPeriod);
  const last = periods.find(t => t.period === startPeriod + Math.max(1, span) - 1) || first;
  if (!first || !last) return "";
  return `${formatMinutes12hBn(first.startMin)}–${formatMinutes12hBn(last.endMin)}`;
}

export function normalizeRoutineEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const span = Math.max(1, Math.round(Number(entry.span) || 1));
  const rawItems = Array.isArray(entry.items)
    ? entry.items
    : (entry.subject || entry.teacherId ? [{ subject: entry.subject, teacherId: entry.teacherId, studentCount: entry.studentCount }] : []);
  const items = rawItems
    .filter(it => it && typeof it === "object")
    .map(it => ({
      subject: String(it.subject || "").trim(),
      teacherId: String(it.teacherId || "").trim(),
      studentCount: it.studentCount ? Math.max(0, Math.round(Number(it.studentCount) || 0)) : 0
    }))
    .filter(it => it.subject || it.teacherId);

  if (items.length === 0) return null;
  return {
    span,
    items,
    commonId: String(entry.commonId || "").trim(),
    commonTargets: Array.isArray(entry.commonTargets) ? entry.commonTargets.map(x => String(x || "").trim()).filter(Boolean) : [],
    room: String(entry.room || "").trim(),
    note: String(entry.note || "").trim()
  };
}

export function normalizeRoutineState(raw) {
  const config = normalizeRoutineConfig(raw && raw.config);
  const rawEntries = raw && raw.entries && typeof raw.entries === "object" ? raw.entries : {};
  const entries = {};
  for (const [k, v] of Object.entries(rawEntries)) {
    const clean = normalizeRoutineEntry(v);
    if (clean) entries[k] = clean;
  }
  return { config, entries };
}

export function getCoveredPeriodsForRow(entries, day, secKey, timeline) {
  const periods = timeline.filter(s => s.type === "period");
  const coveredBy = {}; // p -> startPeriod
  const effectiveSpan = {}; // startPeriod -> clamped span within session
  for (const slot of periods) {
    const p = slot.period;
    if (coveredBy[p]) continue;
    const entry = entries[cellSlotKey(day, secKey, p)];
    if (!entry) continue;
    const maxHere = maxSpanFromPeriod(timeline, p);
    const clampedSpan = Math.min(Math.max(1, entry.span || 1), maxHere);
    effectiveSpan[p] = clampedSpan;
    for (let k = 1; k < clampedSpan; k++) {
      coveredBy[p + k] = p;
    }
  }
  return { coveredBy, effectiveSpan };
}

export function findTeacherClashes(routine, timeline, allSectionKeys) {
  const cfg = normalizeRoutineConfig(routine && routine.config);
  const entries = (routine && routine.entries) || {};
  const clashMap = {}; // `${day}|${teacherId}|${period}` -> secKey[]

  for (const day of cfg.days) {
    const occupancy = {}; // `${teacherId}|${p}` -> Map<string, { secKeys: Set, groupKey: string }>
    for (const secKey of allSectionKeys) {
      const { coveredBy, effectiveSpan } = getCoveredPeriodsForRow(entries, day, secKey, timeline);
      for (const slot of timeline) {
        if (slot.type !== "period") continue;
        const p = slot.period;
        const ownerP = coveredBy[p] || p;
        const entry = entries[cellSlotKey(day, secKey, ownerP)];
        if (!entry) continue;
        if (coveredBy[p] && p >= ownerP + (effectiveSpan[ownerP] || 1)) continue;

        for (const item of entry.items) {
          if (!item.teacherId) continue;
          const tKey = `${item.teacherId}|${p}`;
          if (!occupancy[tKey]) occupancy[tKey] = [];
          occupancy[tKey].push({
            secKey,
            commonId: entry.commonId || ""
          });
        }
      }
    }

    for (const [tKey, usages] of Object.entries(occupancy)) {
      if (usages.length <= 1) continue;
      // Multiple usages: check if ALL share the exact same non-empty commonId
      const uniqueDistinct = new Set(
        usages.map((u, idx) => (u.commonId ? `common:${u.commonId}` : `solo:${u.secKey}:${idx}`))
      );
      if (uniqueDistinct.size > 1) {
        const [tid, pStr] = tKey.split("|");
        clashMap[`${day}|${tid}|${pStr}`] = Array.from(new Set(usages.map(u => u.secKey)));
      }
    }
  }
  return clashMap;
}

export function computeTeacherWeeklyStats(routine, timeline, teachers, allSectionsMeta) {
  const cfg = normalizeRoutineConfig(routine && routine.config);
  const entries = (routine && routine.entries) || {};
  const stats = {};

  (teachers || []).forEach(t => {
    stats[t.id] = {
      weeklyPeriods: 0,
      commonPeriods: 0,
      splitPeriods: 0,
      subjectsUsed: new Set(),
      classesUsed: new Set()
    };
  });

  const secKeys = allSectionsMeta.map(s => s.secKey);
  const secMetaByKey = new Map(allSectionsMeta.map(s => [s.secKey, s]));

  for (const day of cfg.days) {
    const countedCommonPeriod = new Set(); // `${teacherId}|${p}|${commonId}`
    for (const secKey of secKeys) {
      const meta = secMetaByKey.get(secKey);
      const { coveredBy, effectiveSpan } = getCoveredPeriodsForRow(entries, day, secKey, timeline);
      for (const slot of timeline) {
        if (slot.type !== "period") continue;
        const p = slot.period;
        const ownerP = coveredBy[p] || p;
        const entry = entries[cellSlotKey(day, secKey, ownerP)];
        if (!entry) continue;
        if (coveredBy[p] && p >= ownerP + (effectiveSpan[ownerP] || 1)) continue;

        const isSplit = entry.items.length > 1;
        for (const item of entry.items) {
          if (!item.teacherId || !stats[item.teacherId]) continue;
          if (item.subject) stats[item.teacherId].subjectsUsed.add(item.subject);
          if (meta) stats[item.teacherId].classesUsed.add(meta.clsName);

          if (entry.commonId) {
            const cTag = `${item.teacherId}|${p}|${entry.commonId}`;
            if (countedCommonPeriod.has(cTag)) continue;
            countedCommonPeriod.add(cTag);
            if (p === ownerP) stats[item.teacherId].commonPeriods += 1;
          }
          stats[item.teacherId].weeklyPeriods += 1;
          if (isSplit && p === ownerP) stats[item.teacherId].splitPeriods += 1;
        }
      }
    }
  }

  return stats;
}

export function deriveTeacherDayRow(routine, timeline, teacherId, day, allSectionsMeta) {
  const entries = (routine && routine.entries) || {};
  const secMetaByKey = new Map(allSectionsMeta.map(s => [s.secKey, s]));

  // Map period -> list of raw assignments for this teacher on that day
  const byPeriod = {}; // p -> array of { secKey, meta, entry, item, ownerP, span }
  for (const secMeta of allSectionsMeta) {
    const { coveredBy, effectiveSpan } = getCoveredPeriodsForRow(entries, day, secMeta.secKey, timeline);
    for (const slot of timeline) {
      if (slot.type !== "period") continue;
      const p = slot.period;
      if (coveredBy[p]) continue; // Only process owner cells and project across their span
      const entry = entries[cellSlotKey(day, secMeta.secKey, p)];
      if (!entry) continue;
      const span = effectiveSpan[p] || 1;
      for (const item of entry.items) {
        if (item.teacherId !== teacherId) continue;
        if (!byPeriod[p]) byPeriod[p] = [];
        byPeriod[p].push({
          secKey: secMeta.secKey,
          meta: secMeta,
          entry,
          item,
          ownerP: p,
          span,
          isSplit: entry.items.length > 1
        });
      }
    }
  }

  // Group commonId blocks at each startPeriod cleanly
  const startBlocks = {}; // p -> { span, blocks: [...], isClash }
  const occupiedLater = new Set();

  const periods = timeline.filter(s => s.type === "period");
  for (const slot of periods) {
    const p = slot.period;
    const rawList = byPeriod[p] || [];
    if (!rawList.length) continue;

    const groupsMap = new Map();
    for (const r of rawList) {
      const gKey = r.entry.commonId ? `common:${r.entry.commonId}` : `sec:${r.secKey}:${r.item.subject}`;
      if (!groupsMap.has(gKey)) {
        groupsMap.set(gKey, {
          commonId: r.entry.commonId || "",
          span: r.span,
          subject: r.item.subject,
          studentCount: r.item.studentCount,
          isSplit: r.isSplit,
          sections: [],
          room: r.entry.room || r.meta.room || "—"
        });
      }
      const g = groupsMap.get(gKey);
      g.span = Math.max(g.span, r.span);
      g.sections.push({ clsName: r.meta.clsName, secName: r.meta.secName, secKey: r.secKey });
      if (r.entry.room && (!g.room || g.room === "—")) g.room = r.entry.room;
    }

    const blocks = Array.from(groupsMap.values());
    const maxBlockSpan = blocks.reduce((mx, b) => Math.max(mx, b.span), 1);
    const clampedSpan = Math.min(maxBlockSpan, maxSpanFromPeriod(timeline, p));

    // Check if any block clashes with something starting inside (p+1..p+clampedSpan-1) or >1 separate blocks at p
    const isMultiBlockHere = blocks.length > 1;
    let overlapsLater = false;
    for (let k = 1; k < clampedSpan; k++) {
      if (byPeriod[p + k] && byPeriod[p + k].length > 0) overlapsLater = true;
    }
    const displaySpan = overlapsLater ? 1 : clampedSpan;
    for (let k = 1; k < displaySpan; k++) {
      occupiedLater.add(p + k);
    }

    startBlocks[p] = {
      span: displaySpan,
      blocks,
      hasClash: isMultiBlockHere || overlapsLater || occupiedLater.has(p)
    };
  }

  return { startBlocks, coveredPeriods: occupiedLater };
}

export function generateSmartMasterRoutine({
  classes,
  teachers,
  subjects,
  config,
  normalizeClassSections,
  normalizeSectionSubjects,
  normalizeTeacherRecord,
  teacherCoversSubject
}) {
  const cfg = normalizeRoutineConfig(config);
  const timeline = buildRoutineTimeline(cfg);
  const normTeachers = (teachers || []).map(t => normalizeTeacherRecord(t, true));
  const allSecMeta = [];

  (classes || []).forEach(c => {
    normalizeClassSections(c).forEach(sec => {
      allSecMeta.push({
        clsObj: c,
        secObj: sec,
        clsName: c.name,
        secName: sec.name,
        secKey: secSlotKey(c.name, sec.name),
        room: sec.room || "—",
        capacity: Number(sec.capacity) || 30,
        secSubs: normalizeSectionSubjects(c, sec, subjects).filter(s => s.group !== "এক্সট্রা অ্যাকটিভিটিস"),
        extraSubs: normalizeSectionSubjects(c, sec, subjects).filter(s => s.group === "এক্সট্রা অ্যাকটিভিটিস")
      });
    });
  });

  const entries = {};
  const busy = new Set(); // `${day}|${p}|${teacherId}`

  const markTeacherBusy = (day, startP, span, teacherId) => {
    if (!teacherId) return;
    for (let k = 0; k < span; k++) busy.add(`${day}|${startP + k}|${teacherId}`);
  };

  const isTeacherFree = (day, startP, span, teacherId) => {
    if (!teacherId) return false;
    for (let k = 0; k < span; k++) {
      if (busy.has(`${day}|${startP + k}|${teacherId}`)) return false;
    }
    return true;
  };

  const isCellOccupied = (day, secKey, startP, span) => {
    for (let k = 0; k < span; k++) {
      const p = startP + k;
      if (entries[cellSlotKey(day, secKey, p)]) return true;
      for (let prev = 1; prev < p; prev++) {
        const prevE = entries[cellSlotKey(day, secKey, prev)];
        if (prevE && prev + prevE.span - 1 >= p) return true;
      }
    }
    return false;
  };

  const findTeacherFor = (clsName, subName, day, startP, span, avoidIds = []) => {
    // 1. Prefer teachers covering subject + teachingClasses + free
    const tier1 = normTeachers.find(
      t =>
        !avoidIds.includes(t.id) &&
        teacherCoversSubject(t, subName) &&
        (t.teachingClasses || []).includes(clsName) &&
        isTeacherFree(day, startP, span, t.id)
    );
    if (tier1) return tier1;

    // 2. Any teacher covering subject + free
    const tier2 = normTeachers.find(
      t => !avoidIds.includes(t.id) && teacherCoversSubject(t, subName) && isTeacherFree(day, startP, span, t.id)
    );
    if (tier2) return tier2;

    return null;
  };

  // ১) কমন ক্লাস উদাহরণ: নবম (ও দশম) শ্রেণির সাইন্স, ইকমার্স, মানবিক শাখায় একসাথে বাংলা ক্লাস
  const commonClasses = ["নবম", "দশম"];
  commonClasses.forEach((clsName, cIdx) => {
    const groupMetas = allSecMeta.filter(m => m.clsName === clsName);
    if (groupMetas.length >= 2) {
      const day = cfg.days[cIdx % cfg.days.length];
      const period = cIdx === 0 ? 1 : Math.min(2, cfg.periodsPerDay);
      const subName = "বাংলা সাহিত্য ও সহপাঠ";
      const teacher =
        findTeacherFor(clsName, "বাংলা", day, period, 1) ||
        normTeachers.find(t => isTeacherFree(day, period, 1, t.id));
      if (teacher) {
        const commonId = `cmn-${clsName}-${day}-${period}`;
        const targets = groupMetas.map(m => m.secKey);
        markTeacherBusy(day, period, 1, teacher.id);
        groupMetas.forEach(m => {
          entries[cellSlotKey(day, m.secKey, period)] = {
            span: 1,
            items: [{ subject: subName, teacherId: teacher.id, studentCount: 0 }],
            commonId,
            commonTargets: targets,
            room: groupMetas[0].room || "কমন হল",
            note: "সমন্বিত কমন ক্লাস"
          };
        });
      }
    }
  });

  // ২) একই পিরিয়ডে একাধিক বিষয় ও শিক্ষক মার্জ (স্প্লিট ক্লাস): অষ্টম শ্রেণি ক শাখায় গান (১০) + আবৃত্তি (১০) + স্পোর্টস (১০)
  const eightA = allSecMeta.find(m => m.clsName === "অষ্টম") || allSecMeta[0];
  if (eightA && cfg.days.length >= 2) {
    const splitDay = cfg.days.includes("মঙ্গলবার") ? "মঙ্গলবার" : cfg.days[Math.min(1, cfg.days.length - 1)];
    const splitPeriod = 1;
    if (!isCellOccupied(splitDay, eightA.secKey, splitPeriod, 1)) {
      const total = eightA.capacity || 30;
      const g1 = Math.floor(total / 3);
      const g2 = Math.floor(total / 3);
      const g3 = total - g1 - g2;

      const t1 = findTeacherFor(eightA.clsName, "গান", splitDay, splitPeriod, 1) || normTeachers.find(t => isTeacherFree(splitDay, splitPeriod, 1, t.id));
      const t2 = findTeacherFor(eightA.clsName, "আবৃত্তি", splitDay, splitPeriod, 1, t1 ? [t1.id] : []) || normTeachers.find(t => (!t1 || t.id !== t1.id) && isTeacherFree(splitDay, splitPeriod, 1, t.id));
      const t3 = findTeacherFor(eightA.clsName, "স্পোর্টস", splitDay, splitPeriod, 1, [t1?.id, t2?.id].filter(Boolean)) || normTeachers.find(t => t.id !== t1?.id && t.id !== t2?.id && isTeacherFree(splitDay, splitPeriod, 1, t.id));

      const splitItems = [
        { subject: "গান", teacherId: t1 ? t1.id : "", studentCount: g1 },
        { subject: "আবৃত্তি", teacherId: t2 ? t2.id : "", studentCount: g2 },
        { subject: "স্পোর্টস", teacherId: t3 ? t3.id : "", studentCount: g3 }
      ].filter(x => x.teacherId || x.subject);

      if (splitItems.length >= 2) {
        splitItems.forEach(it => markTeacherBusy(splitDay, splitPeriod, 1, it.teacherId));
        entries[cellSlotKey(splitDay, eightA.secKey, splitPeriod)] = {
          span: 1,
          items: splitItems,
          commonId: "",
          commonTargets: [],
          room: eightA.room,
          note: "একই পিরিয়ডে বিভক্ত ক্লাস"
        };
      }
    }
  }

  // ৩) একাধিক পিরিয়ড একসাথে মার্জ: টিফিনের পর বা শেষের দুই পিরিয়ড মিলে সুইমিং / স্পোর্টস
  const lastPeriod = cfg.periodsPerDay;
  if (lastPeriod >= 2) {
    const mergeTargets = allSecMeta.filter(m => m.clsName === "অষ্টম" || m.clsName === "সপ্তম").slice(0, 2);
    mergeTargets.forEach((meta, idx) => {
      const mDay = cfg.days[cfg.days.length - 1 - (idx % cfg.days.length)];
      let startP = Math.max(1, lastPeriod - 1);
      // Ensure startP can legally span 2 periods without crossing break
      if (maxSpanFromPeriod(timeline, startP) < 2) {
        for (let cand = cfg.periodsPerDay - 1; cand >= 1; cand--) {
          if (maxSpanFromPeriod(timeline, cand) >= 2) {
            startP = cand;
            break;
          }
        }
      }
      if (maxSpanFromPeriod(timeline, startP) >= 2 && !isCellOccupied(mDay, meta.secKey, startP, 2)) {
        const subName = idx === 0 ? "সুইমিং" : "স্পোর্টস";
        const t = findTeacherFor(meta.clsName, subName, mDay, startP, 2);
        if (t) {
          markTeacherBusy(mDay, startP, 2, t.id);
          entries[cellSlotKey(mDay, meta.secKey, startP)] = {
            span: 2,
            items: [{ subject: subName, teacherId: t.id, studentCount: 0 }],
            commonId: "",
            commonTargets: [],
            room: subName === "সুইমিং" ? "সুইমিং পুল" : "খেলার মাঠ",
            note: "২ পিরিয়ড একত্রে মার্জ"
          };
        }
      }
    });
  }

  // ৪) বাকি সকল শ্রেণি-শাখার প্রতিটি খালি পিরিয়ডে সংঘর্ষমুক্ত বিষয় ও শিক্ষক বসানো
  const periods = timeline.filter(s => s.type === "period");
  cfg.days.forEach((day, dIdx) => {
    periods.forEach((slot, pIdx) => {
      const p = slot.period;
      allSecMeta.forEach((meta, sIdx) => {
        if (isCellOccupied(day, meta.secKey, p, 1)) return;
        const pool = meta.secSubs.length ? meta.secSubs : meta.extraSubs;
        if (!pool.length) return;

        let chosenSub = null;
        let chosenTeacher = null;

        for (let tries = 0; tries < pool.length; tries++) {
          const candSub = pool[(dIdx * 3 + pIdx + sIdx + tries) % pool.length];
          const candTeacher = findTeacherFor(meta.clsName, candSub.name, day, p, 1);
          if (candTeacher) {
            chosenSub = candSub;
            chosenTeacher = candTeacher;
            break;
          }
        }

        if (!chosenTeacher) {
          // Try class teacher or any free teacher covering class
          const fallbackSub = pool[(dIdx + pIdx + sIdx) % pool.length];
          const freeTeacher = normTeachers.find(
            t =>
              ((t.teachingClasses || []).includes(meta.clsName) || t.classTeacherClass === meta.clsName) &&
              isTeacherFree(day, p, 1, t.id)
          ) || normTeachers.find(t => isTeacherFree(day, p, 1, t.id));
          if (freeTeacher) {
            chosenSub = fallbackSub;
            chosenTeacher = freeTeacher;
          }
        }

        if (chosenSub && chosenTeacher) {
          markTeacherBusy(day, p, 1, chosenTeacher.id);
          entries[cellSlotKey(day, meta.secKey, p)] = {
            span: 1,
            items: [{ subject: chosenSub.name, teacherId: chosenTeacher.id, studentCount: 0 }],
            commonId: "",
            commonTargets: [],
            room: meta.room,
            note: ""
          };
        }
      });
    });
  });

  return { config: cfg, entries };
}

export function createDefaultRoutineData(classes, teachers, subjects) {
  return generateSmartMasterRoutine({
    classes,
    teachers,
    subjects,
    config: defaultRoutineConfig(),
    normalizeClassSections: c => {
      if (c && Array.isArray(c.sectionDetails)) return c.sectionDetails;
      return [{ name: "ক", room: "১০১", capacity: 40 }];
    },
    normalizeSectionSubjects: (c, sec) => {
      if (sec && Array.isArray(sec.subjects)) return sec.subjects;
      const books = (c && Array.isArray(c.boardBooks) ? c.boardBooks : []).map((b, i) => ({
        id: "sb-" + i,
        name: b.title || String(b || ""),
        group: b.group || "সাধারণ"
      }));
      return books;
    },
    normalizeTeacherRecord: t => t,
    teacherCoversSubject: (t, s) => {
      if (!t || !s) return false;
      const sub = String(s).toLowerCase();
      const hay = [t.subject, ...(t.additionalSubjects || [])].join(" | ").toLowerCase();
      if (hay.includes(sub)) return true;
      const words = sub.replace(/[()]/g, " ").split(/[\s,/—-]+/).filter(w => w.length >= 3);
      return words.some(w => hay.includes(w));
    }
  });
}
