import React, { useMemo, useState, useEffect } from "react";
import {
  ROUTINE_ALL_DAYS,
  toBnStr,
  ordinalPeriodBn,
  secSlotKey,
  cellSlotKey,
  formatMinutes12hBn,
  parseTimeMinutes,
  defaultRoutineConfig,
  normalizeRoutineConfig,
  normalizeRoutineState,
  buildRoutineTimeline,
  maxSpanFromPeriod,
  mergedPeriodTimeRangeBn,
  getCoveredPeriodsForRow,
  findTeacherClashes,
  getConsecutiveStreakMap,
  checkTeacherStreakIfAssigned,
  computeTeacherWeeklyStats,
  deriveTeacherDayRow,
  generateSmartMasterRoutine,
  autoCoordinateRoutineViolations,
  buildTeacherShortCodeMap
} from "./routineUtils.js";

function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slotFreeStatusForTeacher(entries, day, period, span, teacherId, ignoreSecKey, ignoreCommonId, timeline) {
  if (!teacherId) return { free: true, busyAt: [] };
  const busyAt = [];
  const pEnd = period + Math.max(1, span) - 1;
  Object.entries(entries || {}).forEach(([k, entry]) => {
    if (!entry) return;
    const parts = k.split("|");
    if (parts.length !== 3) return;
    const [eDay, eSecKey, ePStr] = parts;
    if (eDay !== day) return;
    if (eSecKey === ignoreSecKey && Number(ePStr) === Number(period)) return;
    if (ignoreCommonId && entry.commonId && entry.commonId === ignoreCommonId) return;
    const eStart = Number(ePStr) || 1;
    const eSpan = Math.min(Math.max(1, entry.span || 1), maxSpanFromPeriod(timeline, eStart));
    const eEnd = eStart + eSpan - 1;
    if (period <= eEnd && eStart <= pEnd) {
      if ((entry.items || []).some(it => it.teacherId === teacherId)) {
        busyAt.push(eSecKey.replace("::", " (") + ")");
      }
    }
  });
  return { free: busyAt.length === 0, busyAt: Array.from(new Set(busyAt)) };
}

function RoutineSlotModal({
  initial,
  routine,
  timeline,
  allSectionsMeta,
  allSectionKeys,
  teachers,
  allSubjectNames,
  normalizeSectionSubjects,
  teacherCoversSubject,
  canApproveConsecutive,
  onSave,
  onDelete,
  onClose
}) {
  const secByKey = useMemo(() => new Map(allSectionsMeta.map(s => [s.secKey, s])), [allSectionsMeta]);
  const ALL_DAYS_VAL = "__ALL_DAYS__";
  const allDaysList = routine.config.days && routine.config.days.length ? routine.config.days : ["রবিবার"];
  const allDaysRangeLabel = allDaysList.length > 1
    ? `${allDaysList[0]}-${allDaysList[allDaysList.length - 1]}`
    : allDaysList[0];

  const [day, setDay] = useState(initial.day || allDaysList[0] || "রবিবার");
  const isAllDays = day === ALL_DAYS_VAL;
  const targetDaysList = useMemo(
    () => (isAllDays ? allDaysList : [day]),
    [isAllDays, allDaysList, day]
  );

  const [secKey, setSecKey] = useState(initial.secKey || (allSectionsMeta[0] && allSectionsMeta[0].secKey) || "");
  const [period, setPeriod] = useState(Number(initial.period) || 1);

  const curMeta = secByKey.get(secKey) || allSectionsMeta[0];
  const existingEntry = useMemo(() => {
    for (const d of targetDaysList) {
      const e = (routine.entries || {})[cellSlotKey(d, secKey, period)];
      if (e) return e;
    }
    return null;
  }, [routine.entries, targetDaysList, secKey, period]);

  const [span, setSpan] = useState(() => (existingEntry ? existingEntry.span : 1));
  const [items, setItems] = useState(() =>
    existingEntry && existingEntry.items && existingEntry.items.length
      ? existingEntry.items.map(it => ({ ...it }))
      : [{
          subject: "",
          teacherId: initial.presetTeacherId || "",
          studentCount: 0
        }]
  );
  const [isCommon, setIsCommon] = useState(() => Boolean(existingEntry && existingEntry.commonId));
  const [commonTargets, setCommonTargets] = useState(() => {
    if (existingEntry && existingEntry.commonTargets && existingEntry.commonTargets.length) {
      return Array.from(new Set([secKey, ...existingEntry.commonTargets]));
    }
    return [secKey];
  });
  const [showOtherClassesInCommon, setShowOtherClassesInCommon] = useState(() => {
    if (!existingEntry || !existingEntry.commonTargets) return false;
    const baseCls = curMeta ? curMeta.clsName : "";
    return existingEntry.commonTargets.some(tk => {
      const m = secByKey.get(tk);
      return m && m.clsName !== baseCls;
    });
  });
  const [room, setRoom] = useState(() => (existingEntry && existingEntry.room) || (curMeta && curMeta.room) || "");
  const [note, setNote] = useState(() => (existingEntry && existingEntry.note) || "");
  const [adminApproveStreak, setAdminApproveStreak] = useState(() => Boolean(existingEntry && existingEntry.adminApprovedStreak));
  const [formErr, setFormErr] = useState("");

  // Sync form state when picking a different cell inside the "+ রুটিনে ক্লাস দিন" modal flow
  const reloadCellIfChanged = (nDay, nSecKey, nPeriod, preserveFilled = false) => {
    const checkDays = nDay === ALL_DAYS_VAL ? allDaysList : [nDay];
    let nxt = null;
    for (const d of checkDays) {
      const e = (routine.entries || {})[cellSlotKey(d, nSecKey, nPeriod)];
      if (e) { nxt = e; break; }
    }
    const meta = secByKey.get(nSecKey);
    const hasTypedContent = preserveFilled && items.some(it => String(it.subject || "").trim() || String(it.teacherId || "").trim());
    if (hasTypedContent) {
      setFormErr("");
      return;
    }
    if (nxt) {
      setSpan(nxt.span || 1);
      setItems((nxt.items || []).map(it => ({ ...it })));
      setIsCommon(Boolean(nxt.commonId));
      setCommonTargets(Array.from(new Set([nSecKey, ...(nxt.commonTargets || [])])));
      setRoom(nxt.room || (meta && meta.room) || "");
      setNote(nxt.note || "");
      setAdminApproveStreak(Boolean(nxt.adminApprovedStreak));
    } else {
      setSpan(1);
      setItems([{
        subject: "",
        teacherId: initial.presetTeacherId || "",
        studentCount: 0
      }]);
      setIsCommon(false);
      setCommonTargets([nSecKey]);
      setRoom((meta && meta.room) || "");
      setNote("");
      setAdminApproveStreak(false);
    }
    setFormErr("");
  };

  const maxSpanHere = useMemo(() => maxSpanFromPeriod(timeline, period), [timeline, period]);
  const effectiveSpan = Math.min(Math.max(1, span), maxSpanHere);

  const sectionSubjectNames = useMemo(() => {
    if (!curMeta) return allSubjectNames;
    const secSubs = normalizeSectionSubjects(curMeta.clsObj, curMeta.secObj, []).map(s => s.name);
    return Array.from(new Set([...secSubs, ...allSubjectNames]));
  }, [curMeta, allSubjectNames, normalizeSectionSubjects]);

  const commonCandidateSections = useMemo(() => {
    if (showOtherClassesInCommon || !curMeta) return allSectionsMeta;
    const sameCls = allSectionsMeta.filter(m => m.clsName === curMeta.clsName);
    return sameCls.length ? sameCls : allSectionsMeta;
  }, [allSectionsMeta, curMeta, showOtherClassesInCommon]);

  const totalSplitStudents = items.reduce((sum, it) => sum + (Number(it.studentCount) || 0), 0);
  const sectionCap = curMeta ? curMeta.capacity || 30 : 30;

  const divideEvenly = () => {
    const count = Math.max(1, items.length);
    const total = sectionCap || 30;
    const base = Math.floor(total / count);
    const rem = total - base * count;
    setItems(prev => prev.map((it, idx) => ({ ...it, studentCount: base + (idx < rem ? 1 : 0) })));
  };

  const toggleCommonTarget = targetSecKey => {
    if (targetSecKey === secKey) return;
    setCommonTargets(prev =>
      prev.includes(targetSecKey)
        ? prev.filter(x => x !== targetSecKey)
        : [...prev, targetSecKey]
    );
  };

  const selectAllSameClass = () => {
    const keys = (allSectionsMeta.filter(m => curMeta && m.clsName === curMeta.clsName).map(m => m.secKey));
    setCommonTargets(Array.from(new Set([secKey, ...keys])));
  };

  const activeCommonTargets = useMemo(
    () => (isCommon ? Array.from(new Set([secKey, ...commonTargets])) : [secKey]),
    [isCommon, secKey, commonTargets]
  );

  const checkTeacherMultiDayFree = teacherId => {
    if (!teacherId) return { free: true, busyAt: [] };
    const busyAll = [];
    for (const d of targetDaysList) {
      const dayExisting = (routine.entries || {})[cellSlotKey(d, secKey, period)];
      const st = slotFreeStatusForTeacher(
        routine.entries,
        d,
        period,
        effectiveSpan,
        teacherId,
        secKey,
        dayExisting ? dayExisting.commonId : "",
        timeline
      );
      if (!st.free) {
        st.busyAt.forEach(b => busyAll.push(isAllDays ? `${d}: ${b}` : b));
      }
    }
    return { free: busyAll.length === 0, busyAt: Array.from(new Set(busyAll)) };
  };

  const checkTeacherMultiDayStreak = teacherId => {
    if (!teacherId) return { violates: false, streakPeriods: [], violateDays: [] };
    let worstPeriods = [];
    const violateDays = [];
    for (const d of targetDaysList) {
      const res = checkTeacherStreakIfAssigned({
        entries: routine.entries || {},
        timeline,
        allSectionKeys,
        day: d,
        secKey,
        period,
        span: effectiveSpan,
        teacherId,
        commonTargets: activeCommonTargets
      });
      if (res.violates) {
        violateDays.push(d);
        if (res.streakPeriods.length > worstPeriods.length) worstPeriods = res.streakPeriods;
      }
    }
    return {
      violates: violateDays.length > 0,
      streakPeriods: worstPeriods,
      violateDays
    };
  };

  const itemStreakChecks = useMemo(
    () => items.map(it => checkTeacherMultiDayStreak(it.teacherId)),
    [items, routine.entries, timeline, allSectionKeys, targetDaysList, secKey, period, effectiveSpan, activeCommonTargets]
  );

  const violatingEntries = useMemo(() => {
    const out = [];
    items.forEach((it, idx) => {
      const res = itemStreakChecks[idx];
      if (it.teacherId && res && res.violates) {
        const t = teachers.find(x => x.id === it.teacherId);
        out.push({
          idx,
          teacherId: it.teacherId,
          teacherName: t ? t.name : it.teacherId,
          subject: it.subject,
          streakPeriods: res.streakPeriods,
          violateDays: res.violateDays || []
        });
      }
    });
    return out;
  }, [items, itemStreakChecks, teachers]);

  const maxViolatingLen = violatingEntries.reduce(
    (mx, v) => Math.max(mx, v.streakPeriods.length),
    0
  );

  const pickSafeAlternateTeacher = rowIdx => {
    const row = items[rowIdx];
    if (!row) return;
    const isSafe = t => {
      if (t.id === row.teacherId) return false;
      const st = checkTeacherMultiDayFree(t.id);
      if (!st.free) return false;
      const sk = checkTeacherMultiDayStreak(t.id);
      return !sk.violates;
    };

    const match =
      (row.subject &&
        teachers.find(
          t =>
            isSafe(t) &&
            teacherCoversSubject &&
            teacherCoversSubject(t, row.subject) &&
            curMeta &&
            (t.teachingClasses || []).includes(curMeta.clsName)
        )) ||
      (row.subject &&
        teachers.find(t => isSafe(t) && teacherCoversSubject && teacherCoversSubject(t, row.subject))) ||
      teachers.find(t => isSafe(t) && curMeta && (t.teachingClasses || []).includes(curMeta.clsName)) ||
      teachers.find(isSafe);

    if (!match) {
      setFormErr("এই পিরিয়ডে বিরতি/সংঘর্ষ ছাড়া কোনো বিকল্প শিক্ষক ফাঁকা পাওয়া যায়নি। চাইলে অন্য পিরিয়ড বেছে নিন বা অ্যাডমিন অনুমোদন ব্যবহার করুন।");
      return;
    }

    setItems(prev => prev.map((x, i) => (i === rowIdx ? { ...x, teacherId: match.id } : x)));
    setFormErr("");
  };

  const handleSubmit = e => {
    e.preventDefault();
    const cleaned = items
      .map(it => ({
        subject: String(it.subject || "").trim(),
        teacherId: String(it.teacherId || "").trim(),
        studentCount: Math.max(0, Math.round(Number(it.studentCount) || 0))
      }))
      .filter(it => it.subject || it.teacherId);

    if (cleaned.length === 0) {
      setFormErr("কমপক্ষে একটি বিষয় বা শিক্ষক নির্বাচন করুন।");
      return;
    }

    if (violatingEntries.length > 0) {
      if (!canApproveConsecutive) {
        setFormErr(
          "একজন শিক্ষকের বিরতি/টিফিন ছাড়া পর পর ৩টি ক্লাস থাকতে পারবে না। অন্য নিরাপদ শিক্ষক নির্বাচন করুন অথবা অ্যাডমিনের অনুমোদন নিন।"
        );
        return;
      }
      if (!adminApproveStreak) {
        setFormErr(
          "টানা ৩+ ক্লাসের শর্ত ভঙ্গ হয়েছে — অন্য নিরাপদ শিক্ষক বসান অথবা নিচের 'অ্যাডমিন অনুমোদন' চেকবক্সে টিক দিন।"
        );
        return;
      }
    }

    const finalCommonId = isCommon && activeCommonTargets.length > 1
      ? (existingEntry && existingEntry.commonId ? existingEntry.commonId : `cmn-${Date.now().toString(36)}`)
      : "";

    onSave({
      day: targetDaysList[0],
      days: targetDaysList,
      isAllDays,
      allDaysRangeLabel,
      secKey,
      period,
      span: effectiveSpan,
      items: cleaned,
      commonId: finalCommonId,
      commonTargets: finalCommonId ? activeCommonTargets : [],
      oldCommonId: existingEntry ? existingEntry.commonId : "",
      room: room.trim() || (curMeta && curMeta.room) || "",
      note: note.trim(),
      adminApprovedStreak: violatingEntries.length > 0 && canApproveConsecutive && adminApproveStreak,
      approvedStreakLimit:
        violatingEntries.length > 0 && canApproveConsecutive && adminApproveStreak
          ? Math.max(3, maxViolatingLen)
          : 0
    });
  };

  const periodOptions = timeline.filter(s => s.type === "period");
  const mergedRange = mergedPeriodTimeRangeBn(timeline, period, effectiveSpan);

  return (
    <div className="modal-bg" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal xl" onSubmit={handleSubmit}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>
              {existingEntry && !isAllDays ? "ক্লাস পিরিয়ড সম্পাদনা" : "নতুন ক্লাস পিরিয়ড নির্ধারণ"}
            </h2>
            <p className="sub" style={{ marginBottom: 10 }}>
              {curMeta ? `${curMeta.clsName} (${curMeta.secName})` : ""} · {isAllDays ? `${allDaysRangeLabel} (সকল দিন)` : day} · {ordinalPeriodBn(period)} পিরিয়ড
              {effectiveSpan > 1 ? ` থেকে ${ordinalPeriodBn(period + effectiveSpan - 1)} পিরিয়ড` : ""}
              {mergedRange ? ` (${mergedRange})` : ""}
            </p>
          </div>
          {existingEntry && (
            <button
              type="button"
              className="mini-btn red"
              onClick={() => onDelete({ day: targetDaysList[0], days: targetDaysList, secKey, period, oldCommonId: existingEntry.commonId || "" })}
            >
              {isAllDays ? "সব দিনের এই ক্লাস মুছুন" : "এই ক্লাস মুছুন"}
            </button>
          )}
        </div>

        {/* অবস্থান ও পিরিয়ড মার্জ (Multi-period span) */}
        <div className="routine-modal-box">
          <div className="routine-modal-grid4">
            <div>
              <label>বার / দিন</label>
              <select
                value={day}
                onChange={e => {
                  const v = e.target.value;
                  setDay(v);
                  reloadCellIfChanged(v, secKey, period, v === ALL_DAYS_VAL);
                }}
              >
                {allDaysList.map(d => <option key={d} value={d}>{d}</option>)}
                {allDaysList.length > 1 && (
                  <option value={ALL_DAYS_VAL}>{allDaysRangeLabel} (সব দিন)</option>
                )}
              </select>
            </div>
            <div>
              <label>শ্রেণি ও শাখা</label>
              <select
                value={secKey}
                onChange={e => {
                  const v = e.target.value;
                  setSecKey(v);
                  reloadCellIfChanged(day, v, period, false);
                }}
              >
                {allSectionsMeta.map(m => (
                  <option key={m.secKey} value={m.secKey}>
                    {m.clsName} — {m.secName} (রুম {m.room})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>শুরুর পিরিয়ড</label>
              <select
                value={period}
                onChange={e => {
                  const v = Number(e.target.value) || 1;
                  setPeriod(v);
                  reloadCellIfChanged(day, secKey, v);
                }}
              >
                {periodOptions.map(p => (
                  <option key={p.period} value={p.period}>
                    {ordinalPeriodBn(p.period)} ({p.timeBn})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>পিরিয়ড মার্জ (একাধিক ঘণ্টা)</label>
              <select
                value={effectiveSpan}
                onChange={e => setSpan(Number(e.target.value) || 1)}
              >
                {Array.from({ length: maxSpanHere }, (_, idx) => idx + 1).map(sp => (
                  <option key={sp} value={sp}>
                    {sp === 1
                      ? "১ পিরিয়ড (স্বাভাবিক)"
                      : `${toBnStr(sp)} পিরিয়ড একত্রে মার্জ (${mergedPeriodTimeRangeBn(timeline, period, sp)})`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {maxSpanHere === 1 && (
            <p style={{ fontSize: "12px", color: "var(--muted)", margin: "6px 0 0" }}>
              এই পিরিয়ডের ঠিক পরেই বিরতি থাকায় বা দিনের শেষ পিরিয়ড হওয়ায় পরের পিরিয়ডের সাথে মার্জ করা যাবে না।
            </p>
          )}
        </div>

        {/* একই পিরিয়ডে বিষয় ও শিক্ষক (এবং বিভক্ত / স্প্লিট গ্রুপ) */}
        <div className="routine-modal-box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div>
              <b style={{ fontSize: "14px", color: "var(--ink)" }}>
                বিষয়, শিক্ষক ও শিক্ষার্থী গ্রুপ ({items.length > 1 ? "একই পিরিয়ডে বিভক্ত / মার্জড ক্লাস" : "একক ক্লাস"})
              </b>
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                যেমন: ৮ম শ্রেণির ৩০ জনের ১০ জন গান, ১০ জন আবৃত্তি ও ১০ জন গেমস ক্লাসে আলাদা শিক্ষকের কাছে গেলে "+ গ্রুপ/বিষয় যোগ করুন" চাপুন।
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {items.length > 1 && (
                <button type="button" className="mini-btn" onClick={divideEvenly}>
                  সমান ভাগে ভাগ করুন ({toBnStr(sectionCap)} জন)
                </button>
              )}
              <button
                type="button"
                className="mini-btn"
                style={{ background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }}
                onClick={() => setItems(prev => [...prev, { subject: "", teacherId: "", studentCount: 0 }])}
              >
                + আরও বিষয়/গ্রুপ যোগ করুন
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {items.map((it, idx) => {
              const teacherStatus = checkTeacherMultiDayFree(it.teacherId);
              const curStreak = itemStreakChecks[idx] || { violates: false, streakPeriods: [], violateDays: [] };
              return (
                <div key={idx} className="routine-split-row">
                  <div>
                    <label>{items.length > 1 ? `বিষয় / অ্যাকটিভিটিস #${toBnStr(idx + 1)}` : "বিষয় *"}</label>
                    <input
                      list="routine-subject-dl"
                      value={it.subject}
                      onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, subject: e.target.value } : x))}
                      placeholder="বিষয়ের নাম লিখুন বা বাছাই করুন…"
                    />
                  </div>
                  <div>
                    <label>শিক্ষক (ফাঁকা ও টানা ক্লাসের শর্ত সহ)</label>
                    <select
                      value={it.teacherId}
                      onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, teacherId: e.target.value } : x))}
                    >
                      <option value="">— শিক্ষক নির্বাচন করুন —</option>
                      {teachers.map(t => {
                        const st = checkTeacherMultiDayFree(t.id);
                        const sk = checkTeacherMultiDayStreak(t.id);
                        const tagLabel = !st.free
                          ? `⚠ ব্যস্ত: ${st.busyAt[0]}`
                          : sk.violates
                            ? `⚠ টানা ${toBnStr(sk.streakPeriods.length)} ক্লাস হবে`
                            : "✓ নিরাপদ ও ফাঁকা";
                        return (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.subject}) — {tagLabel}
                          </option>
                        );
                      })}
                    </select>
                    {it.teacherId && !teacherStatus.free && (
                      <div style={{ fontSize: "11.5px", color: "var(--danger)", fontWeight: 700, marginTop: 3 }}>
                        সংঘর্ষ: এই শিক্ষক এই সময়ে {teacherStatus.busyAt.join(", ")} ক্লাসে নির্ধারিত আছেন।
                      </div>
                    )}
                    {it.teacherId && curStreak.violates && (
                      <div style={{ fontSize: "11.5px", color: "#b45309", fontWeight: 700, marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span>
                          সতর্কতা{curStreak.violateDays && curStreak.violateDays.length && isAllDays ? ` (${curStreak.violateDays.join(", ")})` : ""}: বিরতি/টিফিন ছাড়া টানা {toBnStr(curStreak.streakPeriods.length)} ক্লাস (
                          {curStreak.streakPeriods.map(pNum => ordinalPeriodBn(pNum)).join(", ")} পিরিয়ড)।
                        </span>
                        <button
                          type="button"
                          className="mini-btn"
                          style={{ minHeight: 24, padding: "2px 8px", fontSize: "11.5px", background: "var(--brand-soft)", color: "var(--brand-dark)", borderColor: "var(--brand)" }}
                          onClick={() => pickSafeAlternateTeacher(idx)}
                        >
                          অন্য নিরাপদ শিক্ষক বসান
                        </button>
                      </div>
                    )}
                  </div>
                  {items.length > 1 && (
                    <div>
                      <label>শিক্ষার্থী সংখ্যা</label>
                      <input
                        type="number"
                        min="0"
                        max="300"
                        value={it.studentCount || ""}
                        onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, studentCount: Number(e.target.value) || 0 } : x))}
                        placeholder="১০"
                      />
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    {items.length > 1 && (
                      <button
                        type="button"
                        className="mini-btn red"
                        onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                      >
                        বাদ দিন
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <datalist id="routine-subject-dl">
            {sectionSubjectNames.map(nm => <option key={nm} value={nm} />)}
          </datalist>

          {items.length > 1 && (
            <div style={{ marginTop: 8, fontSize: "12.5px", color: "var(--ink2)", display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span>শাখার আসন/শিক্ষার্থী: <b className="tabular-nums">{toBnStr(sectionCap)} জন</b></span>
              <span>বিভক্ত গ্রুপে মোট: <b className="tabular-nums" style={{ color: totalSplitStudents === sectionCap ? "var(--brand)" : "var(--ink)" }}>{toBnStr(totalSplitStudents)} জন</b></span>
            </div>
          )}
        </div>

        {/* কমন / সম্মিলিত ক্লাস (Common Class across sections/groups) */}
        <div className="routine-modal-box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: 0, cursor: "pointer", fontWeight: 700, color: "var(--ink)" }}>
              <input
                type="checkbox"
                checked={isCommon}
                onChange={e => {
                  const checked = e.target.checked;
                  setIsCommon(checked);
                  if (checked && commonTargets.length <= 1) {
                    const sameClsKeys = allSectionsMeta.filter(m => curMeta && m.clsName === curMeta.clsName).map(m => m.secKey);
                    setCommonTargets(Array.from(new Set([secKey, ...sameClsKeys])));
                  }
                }}
              />
              কমন ক্লাস (একই সময়ে ও একই শিক্ষকে একাধিক শাখা / গ্রুপ একত্রে ক্লাস করবে)
            </label>
            {isCommon && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="mini-btn" onClick={selectAllSameClass}>
                  {curMeta ? `${curMeta.clsName}-এর সব শাখা` : "সব শাখা"}
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => setShowOtherClassesInCommon(v => !v)}
                >
                  {showOtherClassesInCommon ? "শুধু এই শ্রেণির শাখা দেখুন" : "অন্য শ্রেণির শাখাও দেখান"}
                </button>
              </div>
            )}
          </div>
          {isCommon && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 8px" }}>
                উদাহরণ: নবম শ্রেণির সাইন্স, ইকমার্স ও মানবিক — তিনটি গ্রুপের বাংলা ক্লাস ১ম ঘণ্টায় একই শিক্ষক একসাথে নিবেন। যুক্ত শাখাগুলো সিলেক্ট করুন:
              </p>
              <div className="class-chip-grid">
                {commonCandidateSections.map(m => {
                  const active = m.secKey === secKey || commonTargets.includes(m.secKey);
                  return (
                    <button
                      key={m.secKey}
                      type="button"
                      className={`class-chip-btn ${active ? "on" : ""}`}
                      onClick={() => toggleCommonTarget(m.secKey)}
                    >
                      {m.clsName} ({m.secName}){m.secKey === secKey ? " · মূল" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="form-grid" style={{ marginTop: 8 }}>
          <div>
            <label>রুম / স্থান</label>
            <input value={room} onChange={e => setRoom(e.target.value)} placeholder="যেমন: ১০১, কমন হল বা খেলার মাঠ" />
          </div>
          <div>
            <label>মন্তব্য / নির্দেশনা (ঐচ্ছিক)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="যেমন: যৌথ ক্লাস / ল্যাব / স্পোর্টস" />
          </div>
        </div>

        {violatingEntries.length > 0 && (
          <div className="routine-streak-banner" style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <b>টানা ২ ক্লাস সীমা সতর্কতা:</b>{" "}
                {violatingEntries.map((v, i) => (
                  <span key={i}>
                    {i > 0 ? " · " : ""}
                    <b>{v.teacherName}</b> — বিরতি ছাড়া টানা {toBnStr(v.streakPeriods.length)}টি ক্লাস (
                    {v.streakPeriods.map(pNum => ordinalPeriodBn(pNum)).join(", ")})
                  </span>
                ))}
                <div style={{ fontSize: "12px", marginTop: 4 }}>
                  নিয়ম অনুযায়ী দুই ক্লাসের পর কমপক্ষে ১টি ফাঁকা পিরিয়ড বা বিরতি/টিফিন থাকতে হবে। নতুবা কেবল অ্যাডমিনের অনুমতিক্রমেই টানা ৩+ ক্লাস দেওয়া যাবে।
                </div>
              </div>
              {violatingEntries.length === 1 && (
                <button
                  type="button"
                  className="mini-btn"
                  style={{ background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }}
                  onClick={() => pickSafeAlternateTeacher(violatingEntries[0].idx)}
                >
                  অন্য নিরাপদ শিক্ষকের সাথে সমন্বয়
                </button>
              )}
            </div>

            {canApproveConsecutive ? (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 0, cursor: "pointer", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={adminApproveStreak}
                  onChange={e => setAdminApproveStreak(e.target.checked)}
                />
                অ্যাডমিন অনুমোদন: বিশেষ প্রয়োজনে বিরতি ছাড়া টানা {toBnStr(maxViolatingLen)} ক্লাস অনুমোদন করছি
              </label>
            ) : (
              <div style={{ marginTop: 6, fontSize: "12px", fontWeight: 700, color: "var(--danger)" }}>
                বিশেষ দ্রষ্টব্য: টানা ৩+ ক্লাস সেট করতে মাস্টার অ্যাডমিনের অনুমোদন প্রয়োজন। অনুগ্রহ করে নিরাপদ শিক্ষক বেছে নিন।
              </div>
            )}
          </div>
        )}

        {formErr && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: "13px", fontWeight: 700 }}>
            {formErr}
          </div>
        )}

        <div style={{ display: "flex", gap: 9, marginTop: 16, flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-brand" style={{ flex: 1 }}>
            রুটিন স্লট সংরক্ষণ করুন
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            বাতিল
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RoutineModule({
  data,
  setData,
  isStudent,
  canApproveConsecutive = false,
  settings,
  allSchoolSubjectNames,
  normalizeClassSections,
  normalizeSectionSubjects,
  normalizeTeacherRecord,
  teacherCoversSubject,
  onAssignClassTeacher,
  onNewTeacher,
  onEditTeacher,
  onOpenTeacherProfile,
  onDeleteTeacher,
  toast
}) {
  const routine = useMemo(() => normalizeRoutineState(data && data.routine), [data]);
  const cfg = routine.config;
  const timeline = useMemo(() => buildRoutineTimeline(cfg), [cfg]);
  const teachers = useMemo(
    () => (data.teachers || []).map(t => normalizeTeacherRecord(t, !isStudent)),
    [data.teachers, isStudent, normalizeTeacherRecord]
  );
  const teacherById = useMemo(() => new Map(teachers.map(t => [t.id, t])), [teachers]);

  const allSectionsMeta = useMemo(() => {
    const out = [];
    (data.classes || []).forEach(c => {
      normalizeClassSections(c).forEach(sec => {
        out.push({
          clsObj: c,
          secObj: sec,
          clsName: c.name,
          secName: sec.name,
          secKey: secSlotKey(c.name, sec.name),
          room: sec.room || "—",
          capacity: Number(sec.capacity) || 35
        });
      });
    });
    return out;
  }, [data.classes, normalizeClassSections]);

  const allSectionKeys = useMemo(() => allSectionsMeta.map(s => s.secKey), [allSectionsMeta]);
  const secMetaByKey = useMemo(() => new Map(allSectionsMeta.map(s => [s.secKey, s])), [allSectionsMeta]);
  const teacherShortCodeMap = useMemo(() => buildTeacherShortCodeMap(teachers), [teachers]);
  const classSectionCounts = useMemo(() => {
    const m = {};
    allSectionsMeta.forEach(s => {
      m[s.clsName] = (m[s.clsName] || 0) + 1;
    });
    return m;
  }, [allSectionsMeta]);

  const clashMap = useMemo(
    () => findTeacherClashes(routine, timeline, allSectionKeys),
    [routine, timeline, allSectionKeys]
  );
  const clashKeys = useMemo(() => Object.keys(clashMap), [clashMap]);

  const streakInfo = useMemo(
    () => getConsecutiveStreakMap(routine, timeline, allSectionKeys),
    [routine, timeline, allSectionKeys]
  );
  const allStreakRuns = useMemo(() => Object.values(streakInfo.violations).flat(), [streakInfo]);
  const unapprovedStreakRuns = useMemo(() => allStreakRuns.filter(r => !r.approved), [allStreakRuns]);
  const approvedStreakRuns = useMemo(() => allStreakRuns.filter(r => r.approved), [allStreakRuns]);
  const cellStreakStatus = streakInfo.cellStreakStatus;

  const teacherStats = useMemo(
    () => computeTeacherWeeklyStats(routine, timeline, teachers, allSectionsMeta),
    [routine, timeline, teachers, allSectionsMeta]
  );

  // View controls
  const [activeTab, setActiveTab] = useState("master"); // master | teacher | class
  const [masterLayout, setMasterLayout] = useState("summary"); // summary (PDF format) | detailed
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showPeriodDurations, setShowPeriodDurations] = useState(false);
  const [showTeacherPanel, setShowTeacherPanel] = useState(true);
  const [confirmAutoGen, setConfirmAutoGen] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Filters per view
  const [masterDayFilter, setMasterDayFilter] = useState("সব");
  const [masterClsFilter, setMasterClsFilter] = useState("সব");
  const [selectedTeacherId, setSelectedTeacherId] = useState("সব");
  const [teacherRoutineQ, setTeacherRoutineQ] = useState("");
  const [selectedClassSecKey, setSelectedClassSecKey] = useState("সব");

  // Teacher workload panel inline controls
  const [workloadQ, setWorkloadQ] = useState("");
  const [subAddForTeacherId, setSubAddForTeacherId] = useState(null);
  const [subAddInput, setSubAddInput] = useState("");
  const [editCodeForTeacherId, setEditCodeForTeacherId] = useState(null);
  const [editCodeInput, setEditCodeInput] = useState("");
  const [confirmActionKey, setConfirmActionKey] = useState(null); // `clear:${tid}` | `del:${tid}`

  // Slot Editor modal state
  const [slotModal, setSlotModal] = useState(null);

  useEffect(() => {
    const cleanPrint = () => document.body.classList.remove("printing-routine");
    window.addEventListener("afterprint", cleanPrint);
    return () => window.removeEventListener("afterprint", cleanPrint);
  }, []);

  const updateRoutine = updater => {
    setData(prev => {
      const cur = normalizeRoutineState(prev.routine);
      const next = typeof updater === "function" ? updater(cur) : updater;
      return { ...prev, routine: normalizeRoutineState(next) };
    });
  };

  const updateConfig = patchCfg => {
    updateRoutine(prev => ({
      ...prev,
      config: normalizeRoutineConfig({ ...prev.config, ...patchCfg })
    }));
  };

  const handleSetBreakCount = count => {
    const n = Math.min(4, Math.max(0, Number(count) || 0));
    const cur = [...cfg.breaks];
    const next = [];
    for (let i = 0; i < n; i++) {
      if (cur[i]) {
        next.push(cur[i]);
      } else {
        const defaultAfter = Math.min(Math.max(1, cfg.periodsPerDay - 1), (i + 1) * 2);
        next.push({
          id: `brk-${Date.now().toString(36)}-${i + 1}`,
          afterPeriod: defaultAfter,
          duration: i === 1 ? 30 : 10,
          label: i === 1 ? "টিফিন বিরতি" : `বিরতি ${toBnStr(i + 1)}`
        });
      }
    }
    updateConfig({ breaks: next });
  };

  const handleBreakChange = (idx, field, val) => {
    const next = cfg.breaks.map((b, i) => (i === idx ? { ...b, [field]: val } : b));
    updateConfig({ breaks: next });
  };

  const handleToggleDay = d => {
    const exists = cfg.days.includes(d);
    if (exists && cfg.days.length <= 1) {
      toast("কমপক্ষে ১টি কার্যদিবস নির্বাচন থাকতে হবে", true);
      return;
    }
    const nextDays = exists ? cfg.days.filter(x => x !== d) : ROUTINE_ALL_DAYS.filter(x => x === d || cfg.days.includes(x));
    updateConfig({ days: nextDays });
  };

  const runSmartGenerate = () => {
    const generated = generateSmartMasterRoutine({
      classes: data.classes || [],
      teachers: data.teachers || [],
      subjects: data.subjects || [],
      config: cfg,
      normalizeClassSections,
      normalizeSectionSubjects,
      normalizeTeacherRecord,
      teacherCoversSubject
    });
    const postCheck = getConsecutiveStreakMap(generated, timeline, allSectionKeys);
    const unapprovedLeft = Object.values(postCheck.violations).flat().filter(r => !r.approved).length;
    updateRoutine(generated);
    setConfirmAutoGen(false);
    if (unapprovedLeft > 0) {
      toast(`রুটিন তৈরি হয়েছে — তবে শিক্ষক সংকটের কারণে ${toBnStr(unapprovedLeft)}টি ক্ষেত্রে টানা ৩+ ক্লাস সতর্কতা রয়েছে (অ্যাডমিন অনুমোদন প্রয়োজন)।`, true);
    } else {
      toast("টানা ২ ক্লাসের সীমা ও বিরতি শর্ত মেনে মাস্টার, শিক্ষক ও শ্রেণি ভিত্তিক রুটিন তৈরি হয়েছে!");
    }
  };

  const runAutoCoordinateStreaks = () => {
    const { routine: nextRoutine, fixedCount } = autoCoordinateRoutineViolations({
      routine,
      timeline,
      allSectionsMeta,
      teachers: data.teachers || [],
      normalizeTeacherRecord,
      teacherCoversSubject
    });
    updateRoutine(nextRoutine);
    if (fixedCount > 0) {
      toast(`অন্য শিক্ষকদের সাথে অটো-সমন্বয় করে ${toBnStr(fixedCount)}টি টানা ৩+ ক্লাস সমস্যার সমাধান হয়েছে!`);
    } else {
      toast("অটো-সমন্বয়ের মতো কোনো নিরাপদ বিকল্প শিক্ষক ফাঁকা পাওয়া যায়নি — চাইলে অ্যাডমিন অনুমোদন দিতে পারেন।", true);
    }
  };

  const approveStreakRun = run => {
    if (!canApproveConsecutive) {
      toast("টানা ৩+ ক্লাস অনুমোদনের অনুমতি কেবল অ্যাডমিনের আছে", true);
      return;
    }
    const targetOwnerKey = run.ownerKeys[run.ownerKeys.length - 1];
    if (!targetOwnerKey) return;
    updateRoutine(prev => {
      const e = prev.entries[targetOwnerKey];
      if (!e) return prev;
      return {
        ...prev,
        entries: {
          ...prev.entries,
          [targetOwnerKey]: {
            ...e,
            adminApprovedStreak: true,
            approvedStreakLimit: Math.max(3, run.periods.length)
          }
        }
      };
    });
    const t = teacherById.get(run.teacherId);
    toast(`${t ? t.name : "শিক্ষক"}-এর ${run.day}-এর টানা ${toBnStr(run.periods.length)} ক্লাস অ্যাডমিন কর্তৃক অনুমোদিত হয়েছে`);
  };

  const revokeStreakApproval = run => {
    if (!canApproveConsecutive) return;
    updateRoutine(prev => {
      const nextEntries = { ...prev.entries };
      run.ownerKeys.forEach(ok => {
        if (nextEntries[ok] && nextEntries[ok].adminApprovedStreak) {
          nextEntries[ok] = { ...nextEntries[ok], adminApprovedStreak: false, approvedStreakLimit: 0 };
        }
      });
      return { ...prev, entries: nextEntries };
    });
    toast("টানা ৩+ ক্লাসের অ্যাডমিন অনুমোদন প্রত্যাহার করা হয়েছে");
  };

  const runClearAllEntries = () => {
    updateRoutine(prev => ({ ...prev, entries: {} }));
    setConfirmClearAll(false);
    toast("রুটিনের সকল পিরিয়ড খালি করা হয়েছে");
  };

  const saveRoutineSlot = payload => {
    const daysToSave = Array.isArray(payload.days) && payload.days.length ? payload.days : [payload.day];
    updateRoutine(prev => {
      const nextEntries = { ...prev.entries };

      daysToSave.forEach((targetDay, dIdx) => {
        // ১. পুরনো কমন-ক্লাসের যেসব শাখা আন-চেক করা হয়েছে সেগুলো পরিষ্কার করি
        if (payload.oldCommonId) {
          const targetSet = new Set(payload.commonTargets || []);
          Object.keys(nextEntries).forEach(k => {
            const e = nextEntries[k];
            if (!e || e.commonId !== payload.oldCommonId) return;
            const [kDay, kSec, kP] = k.split("|");
            if (kDay === targetDay && (Number(kP) !== payload.period || !targetSet.has(kSec))) {
              delete nextEntries[k];
            }
          });
        }

        const targets = payload.commonTargets && payload.commonTargets.length
          ? payload.commonTargets
          : [payload.secKey];
        const dayCommonId = payload.commonId
          ? (daysToSave.length > 1 ? `${payload.commonId}-d${dIdx}` : payload.commonId)
          : "";

        targets.forEach(tSecKey => {
          for (let prevP = 1; prevP < payload.period; prevP++) {
            const pk = cellSlotKey(targetDay, tSecKey, prevP);
            const pe = nextEntries[pk];
            if (pe && prevP + (pe.span || 1) - 1 >= payload.period) {
              nextEntries[pk] = { ...pe, span: payload.period - prevP };
            }
          }
          for (let offset = 1; offset < payload.span; offset++) {
            delete nextEntries[cellSlotKey(targetDay, tSecKey, payload.period + offset)];
          }
          const meta = secMetaByKey.get(tSecKey);
          nextEntries[cellSlotKey(targetDay, tSecKey, payload.period)] = {
            span: payload.span,
            items: payload.items,
            commonId: dayCommonId,
            commonTargets: dayCommonId ? targets : [],
            room: payload.room || (meta && meta.room) || "",
            note: payload.note || "",
            adminApprovedStreak: Boolean(payload.adminApprovedStreak),
            approvedStreakLimit: payload.adminApprovedStreak ? Number(payload.approvedStreakLimit) || 3 : 0
          };
        });
      });

      return { ...prev, entries: nextEntries };
    });

    setSlotModal(null);
    if (daysToSave.length > 1) {
      toast(`${payload.allDaysRangeLabel || "সব দিন"} (${toBnStr(daysToSave.length)} দিন)-এর রুটিন স্লট সংরক্ষিত হয়েছে!`);
    } else {
      toast(
        payload.commonId
          ? `${toBnStr(payload.commonTargets.length)}টি শাখায় কমন ক্লাস সংরক্ষিত হয়েছে`
          : payload.span > 1
            ? `${toBnStr(payload.span)} পিরিয়ড মার্জ করে সংরক্ষিত হয়েছে`
            : "রুটিন পিরিয়ড সংরক্ষিত হয়েছে"
      );
    }
  };

  const deleteRoutineSlot = ({ day, days, secKey, period, oldCommonId }) => {
    const daysToDelete = Array.isArray(days) && days.length ? days : [day];
    updateRoutine(prev => {
      const nextEntries = { ...prev.entries };
      daysToDelete.forEach(targetDay => {
        if (oldCommonId && daysToDelete.length === 1) {
          Object.keys(nextEntries).forEach(k => {
            const e = nextEntries[k];
            if (e && e.commonId === oldCommonId) delete nextEntries[k];
          });
        }
        const entryAt = nextEntries[cellSlotKey(targetDay, secKey, period)];
        if (entryAt && entryAt.commonId) {
          const cid = entryAt.commonId;
          Object.keys(nextEntries).forEach(k => {
            const e = nextEntries[k];
            if (e && e.commonId === cid) delete nextEntries[k];
          });
        }
        delete nextEntries[cellSlotKey(targetDay, secKey, period)];
      });
      return { ...prev, entries: nextEntries };
    });
    setSlotModal(null);
    toast(daysToDelete.length > 1 ? "সকল দিনের এই রুটিন স্লট মুছে ফেলা হয়েছে" : "রুটিন স্লট মুছে ফেলা হয়েছে");
  };

  const clearTeacherFromRoutine = teacherId => {
    updateRoutine(prev => {
      const nextEntries = {};
      Object.entries(prev.entries || {}).forEach(([k, e]) => {
        if (!e) return;
        const remain = (e.items || []).filter(it => it.teacherId !== teacherId);
        if (remain.length > 0) nextEntries[k] = { ...e, items: remain };
      });
      return { ...prev, entries: nextEntries };
    });
    setConfirmActionKey(null);
    toast("উক্ত শিক্ষকের সকল বরাদ্দকৃত ক্লাস রুটিন থেকে খালি করা হয়েছে");
  };

  const addSubjectToTeacherInline = (teacherId, rawSub) => {
    const sub = String(rawSub || "").trim();
    if (!sub) return;
    setData(prev => ({
      ...prev,
      teachers: (prev.teachers || []).map(rawT => {
        if (rawT.id !== teacherId) return rawT;
        const t = normalizeTeacherRecord(rawT, true);
        if (t.subject === sub || (t.additionalSubjects || []).includes(sub)) return t;
        return { ...t, additionalSubjects: [...(t.additionalSubjects || []), sub] };
      })
    }));
    setSubAddInput("");
    setSubAddForTeacherId(null);
    toast(`শিক্ষকের বিষয়ে "${sub}" যুক্ত হয়েছে`);
  };

  const removeExtraSubjectFromTeacher = (teacherId, subName) => {
    setData(prev => ({
      ...prev,
      teachers: (prev.teachers || []).map(rawT => {
        if (rawT.id !== teacherId) return rawT;
        const t = normalizeTeacherRecord(rawT, true);
        return {
          ...t,
          additionalSubjects: (t.additionalSubjects || []).filter(s => s !== subName)
        };
      })
    }));
    toast(`"${subName}" বিষয় তালিকা থেকে সরানো হয়েছে`);
  };

  const saveTeacherShortCodeInline = (teacherId, rawCode) => {
    const clean = String(rawCode || "").trim().slice(0, 12);
    setData(prev => ({
      ...prev,
      teachers: (prev.teachers || []).map(rawT => {
        if (rawT.id !== teacherId) return rawT;
        const t = normalizeTeacherRecord(rawT, true);
        return { ...t, shortCode: clean };
      })
    }));
    setEditCodeForTeacherId(null);
    setEditCodeInput("");
    toast(clean ? `শিক্ষকের শর্ট কোড "${clean}" সংরক্ষিত হয়েছে` : "শিক্ষকের স্বয়ংক্রিয় শর্ট কোড চালু হয়েছে");
  };

  const triggerPrintRoutine = () => {
    document.body.classList.add("printing-routine");
    setTimeout(() => window.print(), 60);
  };

  const downloadRoutineHtml = () => {
    const area = document.querySelector(".routine-print-area");
    if (!area) return;
    const titleLabel =
      activeTab === "master"
        ? "মাস্টার ক্লাস রুটিন (Summary Timetable)"
        : activeTab === "teacher"
          ? "শিক্ষক ভিত্তিক ক্লাস রুটিন"
          : "শ্রেণি ভিত্তিক ক্লাস রুটিন";
    const isSummaryMaster = activeTab === "master" && masterLayout === "summary";
    const html = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8" />
<title>${escapeHtml((settings && settings.name) || "স্কুল")} — ${escapeHtml(titleLabel)}</title>
<style>
  @page{size:${isSummaryMaster ? "A4 landscape" : "auto"};margin:7mm}
  *{box-sizing:border-box}
  body{font-family:'Noto Sans Bengali','Hind Siliguri','Segoe UI',sans-serif;color:#111;margin:14px;background:#fff}
  h1,h2,h3{margin:0 0 4px;color:#111}
  .meta{color:#4b5563;font-size:12px;margin-bottom:10px}
  .card-block{border:1px solid #cbd5e1;border-radius:8px;padding:10px;margin-bottom:14px;page-break-inside:avoid}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
  th,td{border:1px solid #64748b;padding:4px 5px;vertical-align:top;text-align:left}
  th{background:#f1f5f9;font-weight:700;text-align:center}
  .routine-sum-sheet-head{text-align:center;margin-bottom:8px}
  .routine-sum-sheet-head .inst{font-size:12px;font-weight:600;color:#334155}
  .routine-sum-sheet-head h2{font-size:20px;margin:2px 0 0;font-weight:700}
  .routine-summary-table{border:2px solid #0f172a;table-layout:auto}
  .routine-summary-table th,.routine-summary-table td{border:1px solid #94a3b8;padding:2px 3px}
  .routine-summary-table .day-end{border-right:2px solid #0f172a!important}
  .routine-sum-day-th{font-size:13px;background:#f8fafc;border-bottom:1px solid #0f172a!important}
  .routine-sum-p-th div{font-size:11px;font-weight:700}
  .routine-sum-p-th small,.routine-sum-brk-th small{display:block;font-size:8.5px;line-height:1.15;color:#334155}
  .routine-sum-brk-th{background:#fef3c7!important;width:24px}
  .routine-sum-brk-td{background:#fffbeb;vertical-align:middle!important;text-align:center!important;width:24px;padding:2px!important}
  .routine-sum-brk-rot{writing-mode:vertical-rl;transform:rotate(180deg);font-weight:700;font-size:11px;color:#0f172a;white-space:nowrap;margin:0 auto}
  .routine-sum-cls-td{font-weight:700;font-size:12px;vertical-align:middle!important;background:#f8fafc;min-width:74px;white-space:nowrap}
  .routine-sum-cell{height:46px;min-width:46px;vertical-align:middle!important}
  .routine-sum-cell-box{display:flex;flex-direction:column;justify-content:space-between;min-height:42px;text-align:center}
  .routine-sum-sub{font-size:10px;line-height:1.15;font-weight:600;margin:auto 0;word-break:break-word}
  .routine-sum-tcode{font-size:9.5px;font-weight:700;text-align:right;color:#0f172a;line-height:1.1;margin-top:2px}
  .routine-sum-legend{margin-top:8px;font-size:10.5px;color:#334155;line-height:1.5}
  .routine-sum-footer{display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#475569}
  .no-print,button,select,input{display:none!important}
  @media print{body{margin:0}}
</style>
</head>
<body>
  ${isSummaryMaster ? "" : `<h1>${escapeHtml((settings && settings.name) || "বিদ্যালয়")}</h1><div class="meta">${escapeHtml((settings && settings.address) || "")} · ${escapeHtml(titleLabel)}</div>`}
  ${area.innerHTML}
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `class-routine-${activeTab}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${titleLabel} ডাউনলোড হয়েছে`);
  };

  // Filtered collections for views
  const visibleDays = useMemo(
    () => (masterDayFilter === "সব" ? cfg.days : cfg.days.filter(d => d === masterDayFilter)),
    [cfg.days, masterDayFilter]
  );

  const visibleMasterSections = useMemo(
    () => (masterClsFilter === "সব" ? allSectionsMeta : allSectionsMeta.filter(m => m.clsName === masterClsFilter)),
    [allSectionsMeta, masterClsFilter]
  );

  const visibleTeachersForRoutine = useMemo(() => {
    const q = teacherRoutineQ.trim().toLowerCase();
    return teachers.filter(t => {
      if (selectedTeacherId !== "সব" && t.id !== selectedTeacherId) return false;
      if (!q) return true;
      return (
        (t.name || "").toLowerCase().includes(q) ||
        (t.subject || "").toLowerCase().includes(q) ||
        (t.phone || "").includes(q) ||
        (t.classTeacherClass || "").toLowerCase().includes(q)
      );
    });
  }, [teachers, selectedTeacherId, teacherRoutineQ]);

  const visibleClassSectionsForView = useMemo(
    () => (selectedClassSecKey === "সব" ? allSectionsMeta : allSectionsMeta.filter(m => m.secKey === selectedClassSecKey)),
    [allSectionsMeta, selectedClassSecKey]
  );

  const filteredWorkloadTeachers = useMemo(() => {
    const q = workloadQ.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter(t =>
      (t.name || "").toLowerCase().includes(q) ||
      (t.subject || "").toLowerCase().includes(q) ||
      (t.additionalSubjects || []).some(s => s.toLowerCase().includes(q)) ||
      (t.phone || "").includes(q) ||
      (t.classTeacherClass || "").toLowerCase().includes(q)
    );
  }, [teachers, workloadQ]);

  const totalScheduledSlots = Object.keys(routine.entries || {}).length;
  const startTimeFormatted = formatMinutes12hBn(parseTimeMinutes(cfg.startTime));
  const lastSlot = timeline[timeline.length - 1];
  const endTimeFormatted = lastSlot ? formatMinutes12hBn(lastSlot.endMin) : "";

  return (
    <div className="routine-root">
      <div className="routine-header">
        <div>
          <h1 style={{ marginBottom: 4 }}>মাস্টার ক্লাস রুটিন ও সাপ্তাহিক সময়সূচী</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            মাস্টার রুটিন তৈরি করলে অটো তৈরি হয় শিক্ষক ভিত্তিক রুটিন ও শ্রেণি ভিত্তিক রুটিন · সময়, বিরতি, স্প্লিট গ্রুপ ও কমন ক্লাস কাস্টোমাইজযোগ্য
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={downloadRoutineHtml}>
            HTML ডাউনলোড
          </button>
          <button type="button" className="btn btn-brand btn-sm" onClick={triggerPrintRoutine}>
            প্রিন্ট / PDF
          </button>
        </div>
      </div>

      {/* KPI Strip — Tabular Numerals */}
      <div className="routine-kpis">
        <div className="routine-kpi">
          <b className="tabular-nums">{toBnStr(allSectionsMeta.length)}</b>
          <span>মোট শ্রেণি-শাখা</span>
        </div>
        <div className="routine-kpi">
          <b className="tabular-nums">{toBnStr(cfg.periodsPerDay)} × {toBnStr(cfg.breaks.length)}</b>
          <span>দৈনিক পিরিয়ড ও বিরতি ({startTimeFormatted}–{endTimeFormatted})</span>
        </div>
        <div className="routine-kpi">
          <b className="tabular-nums">{toBnStr(totalScheduledSlots)}</b>
          <span>নির্ধারিত সাপ্তাহিক পিরিয়ড</span>
        </div>
        <div className={`routine-kpi ${clashKeys.length > 0 ? "danger" : "ok"}`}>
          <b className="tabular-nums">{toBnStr(clashKeys.length)}টি</b>
          <span>{clashKeys.length === 0 ? "শিক্ষক সংঘর্ষ মুক্ত" : "শিক্ষক সময় সংঘর্ষ — ঠিক করুন"}</span>
        </div>
        <div className={`routine-kpi ${unapprovedStreakRuns.length > 0 ? "danger" : "ok"}`}>
          <b className="tabular-nums">
            {unapprovedStreakRuns.length > 0
              ? `${toBnStr(unapprovedStreakRuns.length)}টি`
              : approvedStreakRuns.length > 0
                ? `${toBnStr(approvedStreakRuns.length)}টি অনুমোদিত`
                : "০টি"}
          </b>
          <span>
            {unapprovedStreakRuns.length > 0
              ? "টানা ৩+ ক্লাস — সমন্বয় / অনুমোদন দিন"
              : "সর্বোচ্চ ২ টানা ক্লাস শর্ত সুরক্ষিত"}
          </span>
        </div>
      </div>

      {/* Segmented Navigation Tabs (৩ ধরনের রুটিন) + Builder Controls */}
      <div className="routine-nav-bar">
        <div className="routine-tabs" role="tablist" aria-label="রুটিনের ধরন">
          {[
            { id: "master", label: "১. মাস্টার ক্লাস রুটিন" },
            { id: "teacher", label: "২. শিক্ষক ভিত্তিক রুটিন" },
            { id: "class", label: "৩. শ্রেণি ভিত্তিক রুটিন" }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`routine-tab-btn ${activeTab === tab.id ? "on" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!isStudent && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className={`mini-btn ${showCustomizer ? "active-chip" : ""}`}
              onClick={() => setShowCustomizer(v => !v)}
            >
              {showCustomizer ? "▾ সময় ও বিরতি কাস্টোমাইজ" : "▸ সময় ও বিরতি কাস্টোমাইজ"}
            </button>
            <button
              type="button"
              className={`mini-btn ${showTeacherPanel ? "active-chip" : ""}`}
              onClick={() => setShowTeacherPanel(v => !v)}
            >
              {showTeacherPanel ? "▾ শিক্ষক ও সাপ্তাহিক ক্লাস" : "▸ শিক্ষক ও সাপ্তাহিক ক্লাস"}
            </button>
            <button
              type="button"
              className="btn btn-brand btn-sm"
              onClick={() =>
                setSlotModal({
                  day: cfg.days[0] || "রবিবার",
                  secKey: allSectionsMeta[0] ? allSectionsMeta[0].secKey : "",
                  period: 1
                })
              }
            >
              + নতুন ক্লাস যোগ
            </button>
          </div>
        )}
      </div>

      {/* ১. সময়সূচী ও বিরতি কাস্টোমাইজার প্যানেল */}
      {!isStudent && showCustomizer && (
        <section className="card routine-panel" aria-label="ক্লাস সময় ও বিরতি কাস্টোমাইজ">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>রুটিনের সময়, পিরিয়ড ও বিরতি কাস্টোমাইজ</h3>
              <p style={{ margin: "2px 0 0", fontSize: "12.5px", color: "var(--muted)" }}>
                দিনে কয়টি ক্লাস, প্রতিটি ক্লাস কত মিনিট, দিনে কয়টা বিরতি ও প্রতিটি বিরতির সময় নির্ধারণ করলে সকল রুটিন সাথে সাথে আপডেট হবে।
              </p>
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
              {confirmAutoGen ? (
                <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <button type="button" className="mini-btn" style={{ background: "var(--brand)", color: "#fff" }} onClick={runSmartGenerate}>
                    নিশ্চিত অটো-তৈরি করুন
                  </button>
                  <button type="button" className="mini-btn" onClick={() => setConfirmAutoGen(false)}>বাতিল</button>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={() => totalScheduledSlots > 0 ? setConfirmAutoGen(true) : runSmartGenerate()}
                >
                  এই সময়সূচীতে অটো রুটিন তৈরি করুন
                </button>
              )}

              {confirmClearAll ? (
                <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <button type="button" className="mini-btn red" onClick={runClearAllEntries}>সব মুছুন নিশ্চিত</button>
                  <button type="button" className="mini-btn" onClick={() => setConfirmClearAll(false)}>না</button>
                </span>
              ) : (
                <button type="button" className="mini-btn red" onClick={() => setConfirmClearAll(true)}>
                  সব ক্লাস খালি করুন
                </button>
              )}
            </div>
          </div>

          <div className="routine-customizer-grid">
            <div>
              <label>ক্লাস শুরুর সময় ({startTimeFormatted})</label>
              <input
                type="time"
                value={cfg.startTime}
                onChange={e => updateConfig({ startTime: e.target.value || "09:00" })}
              />
            </div>
            <div>
              <label>দিনে মোট ক্লাস (পিরিয়ড)</label>
              <select
                value={cfg.periodsPerDay}
                onChange={e => updateConfig({ periodsPerDay: Number(e.target.value) })}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{toBnStr(n)}টি পিরিয়ড</option>
                ))}
              </select>
            </div>
            <div>
              <label>প্রতি ক্লাসের সময় (মিনিট)</label>
              <input
                type="number"
                min="15"
                max="180"
                step="5"
                value={cfg.periodDuration}
                onChange={e => updateConfig({ periodDuration: Number(e.target.value) || 45 })}
              />
            </div>
            <div>
              <label>দিনে বিরতির সংখ্যা</label>
              <select
                value={cfg.breaks.length}
                onChange={e => handleSetBreakCount(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4].map(n => (
                  <option key={n} value={n}>{n === 0 ? "কোনো বিরতি নেই" : `${toBnStr(n)}টি বিরতি`}</option>
                ))}
              </select>
            </div>
          </div>

          {/* কার্যদিবস নির্বাচন */}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>সাপ্তাহিক কার্যদিবস:</span>
            {ROUTINE_ALL_DAYS.map(d => {
              const active = cfg.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`class-chip-btn ${active ? "on" : ""}`}
                  onClick={() => handleToggleDay(d)}
                >
                  {d}
                </button>
              );
            })}
            <button
              type="button"
              className="mini-btn"
              style={{ marginLeft: "auto" }}
              onClick={() => setShowPeriodDurations(v => !v)}
            >
              {showPeriodDurations ? "▾ প্রতিটি পিরিয়ডের আলাদা মিনিট" : "▸ প্রতিটি পিরিয়ডের আলাদা মিনিট (ঐচ্ছিক)"}
            </button>
          </div>

          {showPeriodDurations && (
            <div className="routine-per-period-grid">
              {Array.from({ length: cfg.periodsPerDay }, (_, i) => i + 1).map(p => (
                <div key={p}>
                  <label>{ordinalPeriodBn(p)} (মি.)</label>
                  <input
                    type="number"
                    min="15"
                    max="180"
                    placeholder={String(cfg.periodDuration)}
                    value={cfg.periodDurations[p] || ""}
                    onChange={e => {
                      const val = Number(e.target.value);
                      const nextDurs = { ...cfg.periodDurations };
                      if (val >= 15 && val <= 180) nextDurs[p] = Math.round(val);
                      else delete nextDurs[p];
                      updateConfig({ periodDurations: nextDurs });
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* প্রতিটি বিরতির কনফিগারেশন */}
          {cfg.breaks.length > 0 && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>বিরতির বিস্তারিত সময়সূচী:</div>
              {cfg.breaks.map((brk, idx) => (
                <div key={brk.id || idx} className="routine-break-row">
                  <div>
                    <label>বিরতি #{toBnStr(idx + 1)}-এর নাম</label>
                    <input
                      value={brk.label}
                      onChange={e => handleBreakChange(idx, "label", e.target.value)}
                      placeholder="যেমন: টিফিন বিরতি"
                    />
                  </div>
                  <div>
                    <label>কোন পিরিয়ডের পর হবে?</label>
                    <select
                      value={brk.afterPeriod}
                      onChange={e => handleBreakChange(idx, "afterPeriod", Number(e.target.value))}
                    >
                      {Array.from({ length: Math.max(1, cfg.periodsPerDay - 1) }, (_, i) => i + 1).map(p => (
                        <option key={p} value={p}>{ordinalPeriodBn(p)} পিরিয়ডের পর</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>বিরতির দৈর্ঘ্য (মিনিট)</label>
                    <input
                      type="number"
                      min="5"
                      max="120"
                      step="5"
                      value={brk.duration}
                      onChange={e => handleBreakChange(idx, "duration", Number(e.target.value) || 15)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* লাইভ সময়সূচী প্রিভিউ */}
          <div className="routine-timeline-strip" aria-label="দৈনিক সময়সূচী প্রিভিউ">
            {timeline.map((slot, i) => (
              <div key={i} className={`routine-tl-slot ${slot.type === "break" ? "is-break" : ""}`}>
                <b>{slot.type === "break" ? slot.label : slot.shortLabel + " পিরিয়ড"}</b>
                <span className="tabular-nums">{slot.timeBn}</span>
                <small className="tabular-nums">{toBnStr(slot.duration)} মি.</small>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* সংঘর্ষ সতর্কতা তালিকা (যদি থাকে) */}
      {clashKeys.length > 0 && (
        <div className="routine-clash-banner">
          <b>সময় সংঘর্ষ সনাক্ত হয়েছে ({toBnStr(clashKeys.length)}টি):</b>{" "}
          {clashKeys.slice(0, 6).map((ck, i) => {
            const [d, tid, pStr] = ck.split("|");
            const t = teacherById.get(tid);
            return (
              <span key={ck}>
                {i > 0 ? " · " : ""}
                <b>{t ? t.name : tid}</b> ({d}, {ordinalPeriodBn(Number(pStr))} পিরিয়ড → {clashMap[ck].map(s => s.replace("::", " ")).join(" ও ")})
              </span>
            );
          })}
          {clashKeys.length > 6 ? ` এবং আরও ${toBnStr(clashKeys.length - 6)}টি` : ""}
        </div>
      )}

      {/* টানা ৩+ ক্লাস সতর্কতা ও অটো-সমন্বয় / অ্যাডমিন অনুমোদন ব্যানার */}
      {unapprovedStreakRuns.length > 0 && (
        <div className="routine-streak-banner">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div>
              <b>টানা ৩+ ক্লাস সীমা সতর্কতা ({toBnStr(unapprovedStreakRuns.length)}টি):</b>{" "}
              একজন শিক্ষকের বিরতি/টিফিন ছাড়া পর পর ৩টি ক্লাস থাকতে পারবে না — দুই ক্লাসের পর কমপক্ষে ১টি পিরিয়ড বা টিফিন থাকতে হবে।
            </div>
            {!isStudent && (
              <button
                type="button"
                className="btn btn-brand btn-sm"
                onClick={runAutoCoordinateStreaks}
              >
                অন্য শিক্ষকের সাথে অটো-সমন্বয় করুন
              </button>
            )}
          </div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {unapprovedStreakRuns.map((run, idx) => {
              const t = teacherById.get(run.teacherId);
              return (
                <div key={`${run.day}|${run.teacherId}|${idx}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,.55)", border: "1px solid rgba(217,119,6,.3)" }}>
                  <span style={{ fontSize: "12.5px" }}>
                    <b>{t ? t.name : run.teacherId}</b> · {run.day} · বিরতিহীন{" "}
                    <b className="tabular-nums">{toBnStr(run.periods.length)} ক্লাস</b> (
                    {run.periods.map(pNum => ordinalPeriodBn(pNum)).join(", ")})
                  </span>
                  {!isStudent && canApproveConsecutive && (
                    <button
                      type="button"
                      className="mini-btn"
                      style={{ minHeight: 30, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}
                      onClick={() => approveStreakRun(run)}
                    >
                      অ্যাডমিন অনুমোদন দিন
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {approvedStreakRuns.length > 0 && unapprovedStreakRuns.length === 0 && (
        <div className="routine-streak-banner approved">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              <b>অ্যাডমিন অনুমোদিত ব্যতিক্রম ({toBnStr(approvedStreakRuns.length)}টি):</b>{" "}
              {approvedStreakRuns.map((r, idx) => {
                const t = teacherById.get(r.teacherId);
                return `${idx > 0 ? ", " : ""}${t ? t.name : r.teacherId} (${r.day}: ${r.periods.map(pN => ordinalPeriodBn(pN)).join("+")})`;
              }).join("")}
            </span>
            {!isStudent && canApproveConsecutive && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {approvedStreakRuns.map((r, idx) => {
                  const t = teacherById.get(r.teacherId);
                  return (
                    <button
                      key={`rev-${idx}`}
                      type="button"
                      className="mini-btn"
                      style={{ minHeight: 28, fontSize: "12px" }}
                      onClick={() => revokeStreakApproval(r)}
                    >
                      অনুমোদন প্রত্যাহার ({t ? t.name : ""})
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ২. শিক্ষক তালিকা, বরাদ্দকৃত বিষয় ও পুরো সপ্তাহে মোট ক্লাস সংখ্যা প্যানেল */}
      {!isStudent && showTeacherPanel && (
        <section className="card routine-panel" aria-label="শিক্ষক, বরাদ্দকৃত বিষয় ও সাপ্তাহিক ক্লাস সংখ্যা">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>শিক্ষক তালিকা, বরাদ্দকৃত বিষয় ও পুরো সপ্তাহে মোট ক্লাসের সংখ্যা</h3>
              <p style={{ margin: "2px 0 0", fontSize: "12.5px", color: "var(--muted)" }}>
                রুটিন তৈরির সময় থেকেই প্রতিটি শিক্ষকের বিষয়, শ্রেণি শিক্ষক দায়িত্ব ও সাপ্তাহিক ক্লাস সংখ্যা দেখা, এডিট, যোগ ও ডিলিট করা যাবে।
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="search"
                style={{ width: 230, minHeight: 36 }}
                placeholder="শিক্ষক, বিষয় বা মোবাইল খুঁজুন…"
                value={workloadQ}
                onChange={e => setWorkloadQ(e.target.value)}
              />
              {onNewTeacher && (
                <button type="button" className="btn btn-brand btn-sm" onClick={onNewTeacher}>
                  + নতুন শিক্ষক যোগ
                </button>
              )}
            </div>
          </div>

          <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>শিক্ষক ও মোবাইল</th>
                  <th>শ্রেণি শিক্ষক</th>
                  <th>বরাদ্দকৃত বিষয়সমূহ</th>
                  <th style={{ textAlign: "center" }}>সাপ্তাহিক মোট ক্লাস</th>
                  <th style={{ textAlign: "right" }}>কার্যক্রম</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkloadTeachers.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>
                      কোনো শিক্ষক পাওয়া যায়নি।
                    </td>
                  </tr>
                )}
                {filteredWorkloadTeachers.map(t => {
                  const st = teacherStats[t.id] || { weeklyPeriods: 0, commonPeriods: 0, splitPeriods: 0, classesUsed: new Set() };
                  const extraSubs = (t.additionalSubjects || []).filter(s => s && s !== t.subject);
                  const isAddingSub = subAddForTeacherId === t.id;
                  const delConfirm = confirmActionKey === `del:${t.id}`;
                  const clrConfirm = confirmActionKey === `clear:${t.id}`;

                  return (
                    <tr key={t.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {t.photo
                            ? <img src={t.photo} alt={t.name} className="stu-ava-sm" style={{ borderRadius: "50%" }} />
                            : <span className="stu-ava-sm" style={{ borderRadius: "50%" }}>{(t.name || "শ").trim().charAt(0)}</span>}
                          <div>
                            <button
                              type="button"
                              onClick={() => onOpenTeacherProfile && onOpenTeacherProfile(t.id)}
                              style={{ background: "none", border: "none", padding: 0, fontWeight: 700, color: "var(--brand-dark)", textAlign: "left", fontSize: "13.5px" }}
                              title="শিক্ষকের পূর্ণ প্রোফাইল দেখুন"
                            >
                              {t.name}
                            </button>
                            <div className="tabular-nums" style={{ fontSize: "12px", color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                              <span>{t.teacherCode} · {t.phone || "মোবাইল নেই"}</span>
                              <span>·</span>
                              {editCodeForTeacherId === t.id ? (
                                <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                                  <input
                                    style={{ width: 76, minHeight: 24, padding: "1px 5px", fontSize: "11.5px" }}
                                    value={editCodeInput}
                                    maxLength={12}
                                    onChange={e => setEditCodeInput(e.target.value)}
                                    placeholder="LR / নু.আ"
                                    autoFocus
                                  />
                                  <button type="button" className="mini-btn" style={{ minHeight: 24, padding: "1px 6px", fontSize: "11px" }} onClick={() => saveTeacherShortCodeInline(t.id, editCodeInput)}>
                                    সেভ
                                  </button>
                                  <button type="button" className="mini-btn" style={{ minHeight: 24, padding: "1px 6px", fontSize: "11px" }} onClick={() => setEditCodeForTeacherId(null)}>
                                    ×
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => { setEditCodeForTeacherId(t.id); setEditCodeInput(t.shortCode || teacherShortCodeMap.get(t.id) || ""); }}
                                  style={{ background: "none", border: "none", padding: 0, fontSize: "11.5px", fontWeight: 700, color: "var(--brand-dark)", textDecoration: "underline dotted" }}
                                  title="মাস্টার রুটিনে দেখানো শিক্ষকের শর্ট কোড পরিবর্তন করুন"
                                >
                                  কোড: {teacherShortCodeMap.get(t.id) || "—"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <select
                          className="sec-ct-select"
                          aria-label={`${t.name}-এর শ্রেণি শিক্ষক দায়িত্ব`}
                          value={t.classTeacherClass ? secSlotKey(t.classTeacherClass, t.classTeacherSection || "ক") : ""}
                          onChange={e => {
                            const v = e.target.value;
                            if (!v) {
                              if (t.classTeacherClass && onAssignClassTeacher) {
                                onAssignClassTeacher("", t.classTeacherClass, t.classTeacherSection || "ক");
                              }
                              return;
                            }
                            const [clsN, secN] = v.split("::");
                            if (onAssignClassTeacher) onAssignClassTeacher(t.id, clsN, secN || "ক");
                          }}
                        >
                          <option value="">— শ্রেণি শিক্ষক নন —</option>
                          {allSectionsMeta.map(m => (
                            <option key={m.secKey} value={m.secKey}>
                              {m.clsName} ({m.secName})
                            </option>
                          ))}
                        </select>
                      </td>

                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                          <span className="sub-badge">{t.subject}</span>
                          {extraSubs.map(es => (
                            <span key={es} className="sub-badge warn" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {es}
                              <button
                                type="button"
                                aria-label={`${es} বিষয় সরান`}
                                onClick={() => removeExtraSubjectFromTeacher(t.id, es)}
                                style={{ background: "none", border: "none", padding: 0, fontWeight: 700, color: "inherit", lineHeight: 1 }}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {isAddingSub ? (
                            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                              <input
                                list="routine-all-sub-dl"
                                style={{ width: 145, minHeight: 28, padding: "2px 6px", fontSize: "12px" }}
                                value={subAddInput}
                                onChange={e => setSubAddInput(e.target.value)}
                                placeholder="বিষয়ের নাম…"
                                autoFocus
                              />
                              <button type="button" className="mini-btn" style={{ background: "var(--brand)", color: "#fff" }} onClick={() => addSubjectToTeacherInline(t.id, subAddInput)}>
                                যুক্ত
                              </button>
                              <button type="button" className="mini-btn" onClick={() => { setSubAddForTeacherId(null); setSubAddInput(""); }}>
                                বাতিল
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="mini-btn"
                              onClick={() => { setSubAddForTeacherId(t.id); setSubAddInput(""); }}
                            >
                              + বিষয়
                            </button>
                          )}
                        </div>
                      </td>

                      <td style={{ textAlign: "center" }}>
                        <div className="tabular-nums" style={{ fontSize: "16px", fontWeight: 800, color: st.weeklyPeriods > 0 ? "var(--brand-dark)" : "var(--muted)" }}>
                          {toBnStr(st.weeklyPeriods)}টি ক্লাস
                        </div>
                        {(st.commonPeriods > 0 || st.splitPeriods > 0 || st.classesUsed.size > 0) && (
                          <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>
                            {st.classesUsed.size > 0 ? Array.from(st.classesUsed).slice(0, 3).join(", ") : ""}
                            {st.commonPeriods > 0 ? ` · কমন ${toBnStr(st.commonPeriods)}` : ""}
                            {st.splitPeriods > 0 ? ` · বিভক্ত ${toBnStr(st.splitPeriods)}` : ""}
                          </div>
                        )}
                      </td>

                      <td>
                        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="mini-btn"
                            style={{ background: "var(--brand-soft)", color: "var(--brand-dark)", borderColor: "var(--brand)" }}
                            onClick={() =>
                              setSlotModal({
                                day: cfg.days[0] || "রবিবার",
                                secKey: allSectionsMeta[0] ? allSectionsMeta[0].secKey : "",
                                period: 1,
                                presetTeacherId: t.id
                              })
                            }
                          >
                            + ক্লাস দিন
                          </button>
                          <button
                            type="button"
                            className="mini-btn"
                            onClick={() => {
                              setSelectedTeacherId(t.id);
                              setActiveTab("teacher");
                            }}
                          >
                            রুটিন দেখুন
                          </button>
                          {onEditTeacher && (
                            <button type="button" className="mini-btn" onClick={() => onEditTeacher(t)}>
                              সম্পাদনা
                            </button>
                          )}
                          {st.weeklyPeriods > 0 && (
                            clrConfirm ? (
                              <button type="button" className="mini-btn red" onClick={() => clearTeacherFromRoutine(t.id)}>
                                খালি নিশ্চিত?
                              </button>
                            ) : (
                              <button type="button" className="mini-btn" onClick={() => setConfirmActionKey(`clear:${t.id}`)}>
                                ক্লাস খালি
                              </button>
                            )
                          )}
                          {onDeleteTeacher && (
                            delConfirm ? (
                              <button
                                type="button"
                                className="mini-btn red"
                                onClick={() => {
                                  clearTeacherFromRoutine(t.id);
                                  onDeleteTeacher(t.id);
                                  setConfirmActionKey(null);
                                }}
                              >
                                মুছুন নিশ্চিত?
                              </button>
                            ) : (
                              <button type="button" className="mini-btn red" onClick={() => setConfirmActionKey(`del:${t.id}`)}>
                                মুছুন
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <datalist id="routine-all-sub-dl">
            {allSchoolSubjectNames.map(nm => <option key={nm} value={nm} />)}
          </datalist>
        </section>
      )}

      {/* ==================== ভিউ ১: মাস্টার ক্লাস রুটিন ==================== */}
      {activeTab === "master" && (
        <div>
          <div className="toolbar no-print">
            <div className="routine-tabs" role="group" aria-label="মাস্টার রুটিন ফরমেট">
              <button
                type="button"
                className={`routine-tab-btn ${masterLayout === "summary" ? "on" : ""}`}
                onClick={() => setMasterLayout("summary")}
              >
                মাস্টার শীট (PDF ফরমেট)
              </button>
              <button
                type="button"
                className={`routine-tab-btn ${masterLayout === "detailed" ? "on" : ""}`}
                onClick={() => setMasterLayout("detailed")}
              >
                দিনভিত্তিক বিস্তারিত
              </button>
            </div>
            <select style={{ maxWidth: 180 }} value={masterDayFilter} onChange={e => setMasterDayFilter(e.target.value)}>
              <option value="সব">সকল দিন ({toBnStr(cfg.days.length)} দিন)</option>
              {cfg.days.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select style={{ maxWidth: 180 }} value={masterClsFilter} onChange={e => setMasterClsFilter(e.target.value)}>
              <option value="সব">সকল শ্রেণি ও শাখা</option>
              {(data.classes || []).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <span className="sp"></span>
            <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>
              {isStudent ? "শ্রেণি, বার ও পিরিয়ড অনুযায়ী মাস্টার ক্লাস রুটিন" : "যেকোনো ঘরে ক্লিক করে বিষয়, শিক্ষক, স্প্লিট গ্রুপ বা কমন ক্লাস সম্পাদনা করুন"}
            </span>
          </div>

          <div className="routine-print-area">
            {masterLayout === "summary" ? (
              <div className="card card-block routine-summary-card">
                <div className="routine-sum-sheet-head">
                  <div className="inst">
                    {(settings && settings.name) || "বিদ্যালয়"}
                    {settings && settings.address ? `, ${settings.address}` : ""}
                  </div>
                  <h2>মাস্টার ক্লাস রুটিন (Summary Timetable of Classes)</h2>
                </div>

                <div className="routine-summary-wrap">
                  <table className="routine-summary-table">
                    <thead>
                      <tr>
                        <th rowSpan={2} className="routine-sum-corner-th">
                          শ্রেণি ও শাখা
                        </th>
                        {visibleDays.map(day => (
                          <th
                            key={`sum-d-${day}`}
                            colSpan={timeline.length}
                            className="routine-sum-day-th day-end"
                          >
                            {day}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {visibleDays.map(day =>
                          timeline.map((slot, sIdx) => {
                            const isDayEnd = sIdx === timeline.length - 1;
                            if (slot.type === "break") {
                              return (
                                <th
                                  key={`sum-bh-${day}-${sIdx}`}
                                  className={`routine-sum-brk-th ${isDayEnd ? "day-end" : ""}`}
                                >
                                  <div>বিরতি</div>
                                  <small className="tabular-nums">{formatMinutes12hBn(slot.startMin)}</small>
                                  <small className="tabular-nums">{formatMinutes12hBn(slot.endMin)}</small>
                                </th>
                              );
                            }
                            return (
                              <th
                                key={`sum-ph-${day}-${slot.period}`}
                                className={`routine-sum-p-th ${isDayEnd ? "day-end" : ""}`}
                              >
                                <div className="tabular-nums">{toBnStr(slot.period)}</div>
                                <small className="tabular-nums">{formatMinutes12hBn(slot.startMin)}</small>
                                <small className="tabular-nums">{formatMinutes12hBn(slot.endMin)}</small>
                              </th>
                            );
                          })
                        )}
                      </tr>
                    </thead>

                    <tbody>
                      {visibleMasterSections.map((secMeta, rowIdx) => {
                        const ctTeacher = teachers.find(
                          t => t.classTeacherClass === secMeta.clsName && (t.classTeacherSection || "ক") === secMeta.secName
                        );
                        const hasMultiSec = (classSectionCounts[secMeta.clsName] || 1) > 1;
                        const rowLabel = hasMultiSec ? `${secMeta.clsName} (${secMeta.secName})` : secMeta.clsName;

                        return (
                          <tr key={`sum-r-${secMeta.secKey}`}>
                            <td
                              className="routine-sum-cls-td"
                              title={`রুম: ${secMeta.room} · শ্রেণি শিক্ষক: ${ctTeacher ? `${ctTeacher.name} (${ctTeacher.phone || "—"})` : "নির্ধারিত নয়"}`}
                            >
                              <div>{rowLabel}</div>
                              {!hasMultiSec && secMeta.secName && secMeta.secName !== "ক" && (
                                <small style={{ fontSize: "10.5px", color: "var(--muted)", fontWeight: 500 }}>
                                  {secMeta.secName}
                                </small>
                              )}
                            </td>

                            {visibleDays.map(day => {
                              const { coveredBy, effectiveSpan } = getCoveredPeriodsForRow(routine.entries, day, secMeta.secKey, timeline);

                              return timeline.map((slot, sIdx) => {
                                const isLastSlotInDay = sIdx === timeline.length - 1;
                                if (slot.type === "break") {
                                  if (rowIdx === 0) {
                                    return (
                                      <td
                                        key={`sum-b-${day}-${sIdx}`}
                                        rowSpan={visibleMasterSections.length}
                                        className={`routine-sum-brk-td ${isLastSlotInDay ? "day-end" : ""}`}
                                      >
                                        <div className="routine-sum-brk-rot">
                                          {slot.label} ({toBnStr(slot.duration)} মিনিট)
                                        </div>
                                      </td>
                                    );
                                  }
                                  return null;
                                }

                                const p = slot.period;
                                if (coveredBy[p]) return null;

                                const entry = (routine.entries || {})[cellSlotKey(day, secMeta.secKey, p)];
                                const cellSpan = entry ? effectiveSpan[p] || 1 : 1;
                                const spanEndIdx = sIdx + cellSpan - 1;
                                const isSpanDayEnd = spanEndIdx >= timeline.length - 1;
                                const ownerKey = cellSlotKey(day, secMeta.secKey, p);
                                const streakSt = entry ? cellStreakStatus[ownerKey] : null;

                                let cellHasClash = false;
                                if (entry) {
                                  for (let k = 0; k < cellSpan; k++) {
                                    for (const it of entry.items) {
                                      if (it.teacherId && clashMap[`${day}|${it.teacherId}|${p + k}`]) {
                                        cellHasClash = true;
                                      }
                                    }
                                  }
                                }

                                const isSplit = entry && entry.items.length > 1;
                                const isCommon = entry && Boolean(entry.commonId);
                                const isMerged = cellSpan > 1;

                                const subjectText = entry
                                  ? entry.items.map(it => it.subject || "—").join(" / ")
                                  : "";
                                const teacherCodesText = entry
                                  ? entry.items
                                      .map(it => {
                                        if (!it.teacherId) return "—";
                                        return teacherShortCodeMap.get(it.teacherId) || "—";
                                      })
                                      .join(" / ")
                                  : "";

                                const tooltipText = entry
                                  ? [
                                      `${secMeta.clsName} (${secMeta.secName}) · ${day} · ${ordinalPeriodBn(p)}${isMerged ? `–${ordinalPeriodBn(p + cellSpan - 1)}` : ""}`,
                                      ...entry.items.map(it => {
                                        const tr = teacherById.get(it.teacherId);
                                        const code = tr ? (teacherShortCodeMap.get(tr.id) || "") : "";
                                        return `${it.subject || "—"} — ${tr ? `${tr.name} [${code}] (${tr.phone || "—"})` : "শিক্ষক নির্ধারিত নয়"}${isSplit && it.studentCount ? ` (${toBnStr(it.studentCount)} জন)` : ""}`;
                                      }),
                                      isCommon ? "কমন / সম্মিলিত ক্লাস" : "",
                                      cellHasClash ? "⚠ শিক্ষকের সময় সংঘর্ষ!" : "",
                                      streakSt === "unapproved" ? "⚠ বিরতি ছাড়া টানা ৩+ ক্লাস!" : "",
                                      streakSt === "approved" ? "অ্যাডমিন অনুমোদিত টানা ৩+ ক্লাস" : ""
                                    ]
                                      .filter(Boolean)
                                      .join("\n")
                                  : `${secMeta.clsName} (${secMeta.secName}) · ${day} · ${ordinalPeriodBn(p)} পিরিয়ড${isStudent ? "" : " (ক্লিক করে ক্লাস যোগ করুন)"}`;

                                return (
                                  <td
                                    key={`sum-c-${day}-${p}`}
                                    colSpan={cellSpan}
                                    title={tooltipText}
                                    className={[
                                      "routine-sum-cell",
                                      !isStudent ? "editable" : "",
                                      !entry ? "empty-cell" : "",
                                      isCommon ? "common" : "",
                                      isMerged ? "merged" : "",
                                      isSplit ? "split" : "",
                                      cellHasClash ? "clash" : "",
                                      streakSt === "unapproved" ? "streak-warn" : "",
                                      streakSt === "approved" ? "streak-approved" : "",
                                      isSpanDayEnd ? "day-end" : ""
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                    onClick={() => {
                                      if (!isStudent) setSlotModal({ day, secKey: secMeta.secKey, period: p });
                                    }}
                                  >
                                    {!entry ? (
                                      <span className="routine-sum-empty">{isStudent ? "" : "+"}</span>
                                    ) : (
                                      <div className="routine-sum-cell-box">
                                        {(isCommon || isMerged || cellHasClash || streakSt) && (
                                          <div className="routine-sum-badges">
                                            {isCommon && <span className="sum-mark common">কমন</span>}
                                            {isMerged && <span className="sum-mark merged">{toBnStr(cellSpan)}পি.</span>}
                                            {cellHasClash && <span className="sum-mark clash">!</span>}
                                            {streakSt === "unapproved" && <span className="sum-mark warn">৩+</span>}
                                          </div>
                                        )}
                                        <div className="routine-sum-sub">{subjectText}</div>
                                        <div className="routine-sum-tcode">{teacherCodesText}</div>
                                      </div>
                                    )}
                                  </td>
                                );
                              });
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* শিক্ষক শর্ট কোড পরিচিতি (Legend) */}
                {teachers.length > 0 && (
                  <div className="routine-sum-legend">
                    <b>শিক্ষক শর্ট কোড পরিচিতি:</b>{" "}
                    {teachers.map((t, idx) => (
                      <span key={t.id}>
                        {idx > 0 ? " · " : ""}
                        <b>{teacherShortCodeMap.get(t.id)}</b> = {t.name} ({t.subject}{t.phone && t.phone !== "—" ? `, ${t.phone}` : ""})
                      </span>
                    ))}
                  </div>
                )}

                <div className="routine-sum-footer tabular-nums">
                  <span>রুটিন তৈরি: {new Date().toLocaleDateString("bn-BD")}</span>
                  <span>{(settings && settings.name) || "স্কুল ম্যানেজমেন্ট"} · ক্লাস রুটিন</span>
                </div>
              </div>
            ) : (
              visibleDays.map(day => (
                <div className="card card-block" key={day} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0 }}>{day} — মাস্টার ক্লাস রুটিন</h3>
                    <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                      শুরু: {startTimeFormatted} · মোট {toBnStr(cfg.periodsPerDay)} পিরিয়ড
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table className="routine-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 155, textAlign: "left" }}>শ্রেণি ও শাখা</th>
                          {timeline.map((slot, idx) =>
                            slot.type === "break" ? (
                              <th key={`b-${idx}`} className="routine-break-th">
                                <div>{slot.label}</div>
                                <small className="tabular-nums">{slot.timeBn}</small>
                              </th>
                            ) : (
                              <th key={`p-${slot.period}`}>
                                <div>{slot.shortLabel} পিরিয়ড</div>
                                <small className="tabular-nums">{slot.timeBn}</small>
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMasterSections.map((secMeta, rowIdx) => {
                          const ctTeacher = teachers.find(
                            t => t.classTeacherClass === secMeta.clsName && (t.classTeacherSection || "ক") === secMeta.secName
                          );
                          const { coveredBy, effectiveSpan } = getCoveredPeriodsForRow(routine.entries, day, secMeta.secKey, timeline);

                          return (
                            <tr key={secMeta.secKey}>
                              <td className="routine-sec-td">
                                <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                                  {secMeta.clsName} ({secMeta.secName})
                                </div>
                                <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>
                                  রুম: {secMeta.room} · আসন {toBnStr(secMeta.capacity)}
                                </div>
                                {ctTeacher && (
                                  <div style={{ fontSize: "11px", color: "var(--brand-dark)", fontWeight: 600, marginTop: 2 }}>
                                    শ্রেণি শিক্ষক: {ctTeacher.name}
                                  </div>
                                )}
                              </td>

                              {timeline.map((slot, sIdx) => {
                                if (slot.type === "break") {
                                  if (rowIdx === 0) {
                                    return (
                                      <td
                                        key={`brk-${sIdx}`}
                                        rowSpan={visibleMasterSections.length}
                                        className="routine-break-td"
                                      >
                                        <div className="routine-break-vertical">
                                          <b>{slot.label}</b>
                                          <span className="tabular-nums">{toBnStr(slot.duration)} মি.</span>
                                        </div>
                                      </td>
                                    );
                                  }
                                  return null;
                                }

                                const p = slot.period;
                                if (coveredBy[p]) return null;

                                const entry = (routine.entries || {})[cellSlotKey(day, secMeta.secKey, p)];
                                const cellSpan = entry ? effectiveSpan[p] || 1 : 1;
                                const ownerKey = cellSlotKey(day, secMeta.secKey, p);
                                const streakSt = entry ? cellStreakStatus[ownerKey] : null;

                                // Check if any item in this cell has a teacher clash within p..p+cellSpan-1
                                let cellHasClash = false;
                                if (entry) {
                                  for (let k = 0; k < cellSpan; k++) {
                                    for (const it of entry.items) {
                                      if (it.teacherId && clashMap[`${day}|${it.teacherId}|${p + k}`]) {
                                        cellHasClash = true;
                                      }
                                    }
                                  }
                                }

                                const isSplit = entry && entry.items.length > 1;
                                const isCommon = entry && Boolean(entry.commonId);
                                const isMerged = cellSpan > 1;
                                const commonLabels = isCommon
                                  ? (entry.commonTargets || []).map(tk => {
                                      const m = secMetaByKey.get(tk);
                                      return m ? m.secName : tk;
                                    })
                                  : [];

                                return (
                                  <td
                                    key={`p-${p}`}
                                    colSpan={cellSpan}
                                    className={[
                                      "routine-cell",
                                      !isStudent ? "editable" : "",
                                      !entry ? "empty-cell" : "",
                                      isSplit ? "split" : "",
                                      isCommon ? "common" : "",
                                      isMerged ? "merged" : "",
                                      cellHasClash ? "clash" : "",
                                      streakSt === "unapproved" ? "streak-warn" : "",
                                      streakSt === "approved" ? "streak-approved" : ""
                                    ].filter(Boolean).join(" ")}
                                    onClick={() => {
                                      if (!isStudent) setSlotModal({ day, secKey: secMeta.secKey, period: p });
                                    }}
                                  >
                                    {!entry ? (
                                      <span className="routine-empty-hint">{isStudent ? "—" : "+ যুক্ত করুন"}</span>
                                    ) : (
                                      <div className="routine-cell-inner">
                                        <div className="routine-cell-tags">
                                          {isCommon && (
                                            <span className="routine-tag common">
                                              কমন: {commonLabels.join(" + ")}
                                            </span>
                                          )}
                                          {isMerged && (
                                            <span className="routine-tag merged">
                                              {toBnStr(cellSpan)} পিরিয়ড মার্জ ({mergedPeriodTimeRangeBn(timeline, p, cellSpan)})
                                            </span>
                                          )}
                                          {isSplit && (
                                            <span className="routine-tag split">বিভক্ত ({toBnStr(entry.items.length)} গ্রুপ)</span>
                                          )}
                                          {cellHasClash && <span className="routine-tag clash">সংঘর্ষ!</span>}
                                          {streakSt === "unapproved" && <span className="routine-tag streak-warn">টানা ৩+ ক্লাস!</span>}
                                          {streakSt === "approved" && <span className="routine-tag streak-approved">অ্যাডমিন অনুমোদিত (৩+)</span>}
                                        </div>

                                        <div className="routine-items-list">
                                          {entry.items.map((it, iIdx) => {
                                            const t = teacherById.get(it.teacherId);
                                            return (
                                              <div key={iIdx} className="routine-item-line">
                                                <b>
                                                  {it.subject || "—"}
                                                  {isSplit && it.studentCount > 0 ? ` (${toBnStr(it.studentCount)} জন)` : ""}
                                                </b>
                                                <span>{t ? `${t.name} (${teacherShortCodeMap.get(t.id) || ""})` : "শিক্ষক নির্ধারিত নয়"}</span>
                                              </div>
                                            );
                                          })}
                                        </div>

                                        {entry.room && entry.room !== secMeta.room && (
                                          <div style={{ fontSize: "10.5px", color: "var(--muted)", marginTop: 2 }}>
                                            স্থান: {entry.room}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ==================== ভিউ ২: শিক্ষক ভিত্তিক রুটিন (অটো তৈরি) ==================== */}
      {activeTab === "teacher" && (
        <div>
          <div className="toolbar no-print">
            <select style={{ maxWidth: 260 }} value={selectedTeacherId} onChange={e => setSelectedTeacherId(e.target.value)}>
              <option value="সব">সকল শিক্ষক ({toBnStr(teachers.length)} জন)</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.subject}) — {t.phone}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="শিক্ষকের নাম, বিষয় বা মোবাইল খুঁজুন…"
              value={teacherRoutineQ}
              onChange={e => setTeacherRoutineQ(e.target.value)}
            />
          </div>

          <div className="routine-print-area">
            {visibleTeachersForRoutine.length === 0 && (
              <div className="card empty"><b>কোনো শিক্ষক পাওয়া যায়নি</b>অনুসন্ধান পরিবর্তন করুন।</div>
            )}
            {visibleTeachersForRoutine.map(t => {
              const st = teacherStats[t.id] || { weeklyPeriods: 0, commonPeriods: 0, splitPeriods: 0, subjectsUsed: new Set() };
              const ctDuty = t.classTeacherClass
                ? `${t.classTeacherClass} (${t.classTeacherSection || "ক"})`
                : "শ্রেণি শিক্ষক নির্ধারিত নয়";

              return (
                <div className="card card-block" key={t.id} style={{ marginBottom: 16 }}>
                  <div className="routine-profile-bar">
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {t.photo
                        ? <img src={t.photo} alt={t.name} className="stu-ava-sm" style={{ width: 46, height: 46, borderRadius: "50%" }} />
                        : <div className="stu-ava-sm" style={{ width: 46, height: 46, borderRadius: "50%", fontSize: 18 }}>{(t.name || "শ").trim().charAt(0)}</div>}
                      <div>
                        <h3 style={{ margin: 0, fontSize: 17 }}>
                          {t.name}{" "}
                          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--muted)" }}>
                            ({t.designation} · {t.teacherCode})
                          </span>
                        </h3>
                        <div className="tabular-nums" style={{ fontSize: "13px", color: "var(--ink2)", marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <span><b>মোবাইল:</b> {t.phone || "—"}</span>
                          <span>
                            <b>শ্রেণি শিক্ষক:</b>{" "}
                            <b style={{ color: t.classTeacherClass ? "var(--brand-dark)" : "var(--muted)" }}>{ctDuty}</b>
                          </span>
                          <span><b>বিষয়:</b> {[t.subject, ...(t.additionalSubjects || [])].filter(Boolean).join(", ")}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="sub-badge tabular-nums">
                        সাপ্তাহিক মোট ক্লাস: {toBnStr(st.weeklyPeriods)}টি
                      </span>
                      {!isStudent && (
                        <button
                          type="button"
                          className="mini-btn no-print"
                          onClick={() =>
                            setSlotModal({
                              day: cfg.days[0] || "রবিবার",
                              secKey: allSectionsMeta[0] ? allSectionsMeta[0].secKey : "",
                              period: 1,
                              presetTeacherId: t.id
                            })
                          }
                        >
                          + ক্লাস যুক্ত করুন
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table className="routine-table">
                      <thead>
                        <tr>
                          <th style={{ width: 115, textAlign: "left" }}>বার</th>
                          {timeline.map((slot, idx) =>
                            slot.type === "break" ? (
                              <th key={`tb-${idx}`} className="routine-break-th">
                                <div>{slot.label}</div>
                                <small className="tabular-nums">{slot.timeBn}</small>
                              </th>
                            ) : (
                              <th key={`tp-${slot.period}`}>
                                <div>{slot.shortLabel} পিরিয়ড</div>
                                <small className="tabular-nums">{slot.timeBn}</small>
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {cfg.days.map((day, dIdx) => {
                          const { startBlocks, coveredPeriods } = deriveTeacherDayRow(routine, timeline, t.id, day, allSectionsMeta);
                          return (
                            <tr key={day}>
                              <td><b>{day}</b></td>
                              {timeline.map((slot, sIdx) => {
                                if (slot.type === "break") {
                                  if (dIdx === 0) {
                                    return (
                                      <td key={`tbrk-${sIdx}`} rowSpan={cfg.days.length} className="routine-break-td">
                                        <div className="routine-break-vertical">
                                          <b>{slot.label}</b>
                                          <span className="tabular-nums">{toBnStr(slot.duration)} মি.</span>
                                        </div>
                                      </td>
                                    );
                                  }
                                  return null;
                                }

                                const p = slot.period;
                                if (coveredPeriods.has(p)) return null;
                                const cell = startBlocks[p];
                                if (!cell) {
                                  return (
                                    <td key={`tp-${p}`} className="routine-cell empty-cell">
                                      <span className="routine-empty-hint">ফাঁকা</span>
                                    </td>
                                  );
                                }

                                const dayTeacherRuns = streakInfo.violations[`${day}|${t.id}`] || [];
                                const matchingRun = dayTeacherRuns.find(r =>
                                  r.periods.some(rp => rp >= p && rp < p + cell.span)
                                );
                                const tStreakSt = matchingRun ? (matchingRun.approved ? "approved" : "unapproved") : null;

                                return (
                                  <td
                                    key={`tp-${p}`}
                                    colSpan={cell.span}
                                    className={[
                                      "routine-cell",
                                      cell.span > 1 ? "merged" : "",
                                      cell.hasClash ? "clash" : "",
                                      cell.blocks.some(b => b.commonId) ? "common" : "",
                                      tStreakSt === "unapproved" ? "streak-warn" : "",
                                      tStreakSt === "approved" ? "streak-approved" : ""
                                    ].filter(Boolean).join(" ")}
                                  >
                                    <div className="routine-cell-inner">
                                      {(cell.span > 1 || tStreakSt) && (
                                        <div className="routine-cell-tags">
                                          {cell.span > 1 && <span className="routine-tag merged">{toBnStr(cell.span)} পিরিয়ড মার্জ</span>}
                                          {tStreakSt === "unapproved" && <span className="routine-tag streak-warn">টানা ৩+ ক্লাস!</span>}
                                          {tStreakSt === "approved" && <span className="routine-tag streak-approved">অ্যাডমিন অনুমোদিত</span>}
                                        </div>
                                      )}
                                      {cell.blocks.map((blk, bIdx) => {
                                        const firstSec = blk.sections[0];
                                        const secListText = blk.sections.length > 1
                                          ? `${firstSec.clsName} (${blk.sections.map(s => s.secName).join(" + ")})`
                                          : `${firstSec.clsName} (${firstSec.secName})`;
                                        return (
                                          <div
                                            key={bIdx}
                                            className={`routine-item-line ${!isStudent ? "clickable-line" : ""}`}
                                            onClick={() => {
                                              if (!isStudent && firstSec) {
                                                setSlotModal({ day, secKey: firstSec.secKey, period: p });
                                              }
                                            }}
                                          >
                                            <b>
                                              {secListText}
                                              {blk.commonId ? " · কমন" : ""}
                                            </b>
                                            <span>
                                              {blk.subject}
                                              {blk.isSplit && blk.studentCount > 0 ? ` (${toBnStr(blk.studentCount)} জন)` : ""}
                                            </span>
                                            <small style={{ color: "var(--muted)", fontSize: "11px" }}>রুম: {blk.room}</small>
                                          </div>
                                        );
                                      })}
                                      {cell.hasClash && <span className="routine-tag clash">সংঘর্ষ!</span>}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== ভিউ ৩: শ্রেণি ভিত্তিক রুটিন (অটো তৈরি) ==================== */}
      {activeTab === "class" && (
        <div>
          <div className="toolbar no-print">
            <select style={{ maxWidth: 260 }} value={selectedClassSecKey} onChange={e => setSelectedClassSecKey(e.target.value)}>
              <option value="সব">সকল শ্রেণি ও শাখা ({toBnStr(allSectionsMeta.length)}টি)</option>
              {allSectionsMeta.map(m => (
                <option key={m.secKey} value={m.secKey}>
                  {m.clsName} — {m.secName} (রুম {m.room})
                </option>
              ))}
            </select>
          </div>

          <div className="routine-print-area">
            {visibleClassSectionsForView.map(secMeta => {
              const ctTeacher = teachers.find(
                t => t.classTeacherClass === secMeta.clsName && (t.classTeacherSection || "ক") === secMeta.secName
              );

              return (
                <div className="card card-block" key={secMeta.secKey} style={{ marginBottom: 16 }}>
                  <div className="routine-profile-bar">
                    <div>
                      <h3 style={{ margin: 0, fontSize: 17 }}>
                        শ্রেণি: {secMeta.clsName} — শাখা/বিভাগ: {secMeta.secName}
                      </h3>
                      <div className="tabular-nums" style={{ fontSize: "13px", color: "var(--ink2)", marginTop: 3, display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span><b>রুম নং:</b> {secMeta.room}</span>
                        <span><b>আসন সংখ্যা:</b> {toBnStr(secMeta.capacity)} জন</span>
                        <span>
                          <b>শ্রেণি শিক্ষক:</b>{" "}
                          {ctTeacher
                            ? <b style={{ color: "var(--brand-dark)" }}>{ctTeacher.name} (মোবাইল: {ctTeacher.phone || "—"})</b>
                            : <span style={{ color: "var(--muted)" }}>নির্ধারিত নয়</span>}
                        </span>
                      </div>
                    </div>
                    {!isStudent && (
                      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <select
                          className="sec-ct-select"
                          aria-label={`${secMeta.clsName} ${secMeta.secName}-এর শ্রেণি শিক্ষক পরিবর্তন`}
                          value={ctTeacher ? ctTeacher.id : ""}
                          onChange={e => onAssignClassTeacher && onAssignClassTeacher(e.target.value, secMeta.clsName, secMeta.secName)}
                        >
                          <option value="">— শ্রেণি শিক্ষক পরিবর্তন —</option>
                          {teachers.map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.phone})</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="table-wrap">
                    <table className="routine-table">
                      <thead>
                        <tr>
                          <th style={{ width: 115, textAlign: "left" }}>বার</th>
                          {timeline.map((slot, idx) =>
                            slot.type === "break" ? (
                              <th key={`cb-${idx}`} className="routine-break-th">
                                <div>{slot.label}</div>
                                <small className="tabular-nums">{slot.timeBn}</small>
                              </th>
                            ) : (
                              <th key={`cp-${slot.period}`}>
                                <div>{slot.shortLabel} পিরিয়ড</div>
                                <small className="tabular-nums">{slot.timeBn}</small>
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {cfg.days.map((day, dIdx) => {
                          const { coveredBy, effectiveSpan } = getCoveredPeriodsForRow(routine.entries, day, secMeta.secKey, timeline);
                          return (
                            <tr key={day}>
                              <td><b>{day}</b></td>
                              {timeline.map((slot, sIdx) => {
                                if (slot.type === "break") {
                                  if (dIdx === 0) {
                                    return (
                                      <td key={`cbrk-${sIdx}`} rowSpan={cfg.days.length} className="routine-break-td">
                                        <div className="routine-break-vertical">
                                          <b>{slot.label}</b>
                                          <span className="tabular-nums">{toBnStr(slot.duration)} মি.</span>
                                        </div>
                                      </td>
                                    );
                                  }
                                  return null;
                                }

                                const p = slot.period;
                                if (coveredBy[p]) return null;
                                const entry = (routine.entries || {})[cellSlotKey(day, secMeta.secKey, p)];
                                const cellSpan = entry ? effectiveSpan[p] || 1 : 1;
                                const ownerKey = cellSlotKey(day, secMeta.secKey, p);
                                const cStreakSt = entry ? cellStreakStatus[ownerKey] : null;
                                const isSplit = entry && entry.items.length > 1;
                                const isCommon = entry && Boolean(entry.commonId);
                                const commonLabels = isCommon
                                  ? (entry.commonTargets || []).map(tk => {
                                      const m = secMetaByKey.get(tk);
                                      return m ? m.secName : tk;
                                    })
                                  : [];

                                return (
                                  <td
                                    key={`cp-${p}`}
                                    colSpan={cellSpan}
                                    className={[
                                      "routine-cell",
                                      !isStudent ? "editable" : "",
                                      !entry ? "empty-cell" : "",
                                      isSplit ? "split" : "",
                                      isCommon ? "common" : "",
                                      cellSpan > 1 ? "merged" : "",
                                      cStreakSt === "unapproved" ? "streak-warn" : "",
                                      cStreakSt === "approved" ? "streak-approved" : ""
                                    ].filter(Boolean).join(" ")}
                                    onClick={() => {
                                      if (!isStudent) setSlotModal({ day, secKey: secMeta.secKey, period: p });
                                    }}
                                  >
                                    {!entry ? (
                                      <span className="routine-empty-hint">{isStudent ? "—" : "+ যুক্ত"}</span>
                                    ) : (
                                      <div className="routine-cell-inner">
                                        {(isCommon || cellSpan > 1 || isSplit || cStreakSt) && (
                                          <div className="routine-cell-tags">
                                            {isCommon && <span className="routine-tag common">কমন: {commonLabels.join(" + ")}</span>}
                                            {cellSpan > 1 && <span className="routine-tag merged">{toBnStr(cellSpan)} পিরিয়ড একত্রে</span>}
                                            {isSplit && <span className="routine-tag split">বিভক্ত ক্লাস</span>}
                                            {cStreakSt === "unapproved" && <span className="routine-tag streak-warn">টানা ৩+ ক্লাস!</span>}
                                            {cStreakSt === "approved" && <span className="routine-tag streak-approved">অ্যাডমিন অনুমোদিত</span>}
                                          </div>
                                        )}
                                        <div className="routine-items-list">
                                          {entry.items.map((it, iIdx) => {
                                            const t = teacherById.get(it.teacherId);
                                            return (
                                              <div key={iIdx} className="routine-item-line">
                                                <b>
                                                  {it.subject || "—"}
                                                  {isSplit && it.studentCount > 0 ? ` (${toBnStr(it.studentCount)} জন)` : ""}
                                                </b>
                                                <span>{t ? t.name : "—"}</span>
                                                {t && t.phone && <small className="tabular-nums" style={{ color: "var(--muted)", fontSize: "11px" }}>{t.phone}</small>}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {slotModal && (
        <RoutineSlotModal
          initial={slotModal}
          routine={routine}
          timeline={timeline}
          allSectionsMeta={allSectionsMeta}
          allSectionKeys={allSectionKeys}
          teachers={teachers}
          allSubjectNames={allSchoolSubjectNames}
          normalizeSectionSubjects={normalizeSectionSubjects}
          teacherCoversSubject={teacherCoversSubject}
          canApproveConsecutive={canApproveConsecutive}
          onSave={saveRoutineSlot}
          onDelete={deleteRoutineSlot}
          onClose={() => setSlotModal(null)}
        />
      )}
    </div>
  );
}
