// appServer.ts
import express from "express";
import crypto2 from "crypto";
import fs2 from "fs";
import path from "path";

// supabaseSync.ts
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import fs from "fs";
function loadDotEnvFile(envFilePath) {
  try {
    if (!fs.existsSync(envFilePath)) return;
    const raw = fs.readFileSync(envFilePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
  }
}
var STORAGE_BUCKET = "school-media";
var MAX_MEDIA_BYTES = 50 * 1024 * 1024;
var ALLOWED_MEDIA_MIME = {
  "image/jpeg": { ext: "jpg", type: "photo" },
  "image/jpg": { ext: "jpg", type: "photo" },
  "image/png": { ext: "png", type: "photo" },
  "image/webp": { ext: "webp", type: "photo" },
  "image/gif": { ext: "gif", type: "photo" },
  "video/mp4": { ext: "mp4", type: "video" },
  "video/webm": { ext: "webm", type: "video" },
  "video/ogg": { ext: "ogv", type: "video" },
  "video/quicktime": { ext: "mov", type: "video" }
};
var cachedClient = null;
var realtimeConnected = false;
var sseClients = /* @__PURE__ */ new Set();
var heartbeatTimer = null;
function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  return {
    url,
    key,
    configured: Boolean(url && key)
  };
}
function getSupabaseClient() {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) return null;
  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      realtime: {
        params: {
          eventsPerSecond: 5
        }
      }
    });
  }
  return cachedClient;
}
function isSchemaMissingError(err) {
  if (!err || typeof err !== "object") return false;
  const e = err;
  const code = String(e.code || "");
  const msg = String(e.message || "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204" || msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("schema cache");
}
async function fetchAllRows(client, table, selectCols = "*", orderCol = "id") {
  const pageSize = 1e3;
  const all = [];
  let from = 0;
  while (true) {
    let q = client.from(table).select(selectCols).range(from, from + pageSize - 1);
    if (orderCol) {
      q = q.order(orderCol, { ascending: true });
    }
    const { data, error } = await q;
    if (error) return { rows: all, error };
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return { rows: all, error: null };
}
async function upsertInChunks(client, table, rows, chunkSize = 500) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client.from(table).upsert(chunk, { onConflict: "id" });
    if (error) throw error;
  }
}
async function deleteIdsInChunks(client, table, ids, chunkSize = 200) {
  const cleanIds = ids.map((x) => String(x || "").trim()).filter(Boolean);
  if (!cleanIds.length) return;
  for (let i = 0; i < cleanIds.length; i += chunkSize) {
    const chunk = cleanIds.slice(i, i + chunkSize);
    const { error } = await client.from(table).delete().in("id", chunk);
    if (error) throw error;
  }
}
function mapSettingsFromDb(row) {
  if (!row) return null;
  return {
    name: String(row.name || "\u0986\u09AE\u09BE\u09B0 \u09B8\u09CD\u0995\u09C1\u09B2"),
    motto: String(row.motto || "\u099C\u09CD\u099E\u09BE\u09A8\u09C7\u0987 \u0986\u09B2\u09CB, \u099A\u09B0\u09BF\u09A4\u09CD\u09B0\u09C7\u0987 \u09B6\u0995\u09CD\u09A4\u09BF"),
    established: String(row.established || ""),
    address: String(row.address || "\u09AE\u09C7\u0987\u09A8 \u09B0\u09CB\u09A1, \u09B8\u09A6\u09B0 \u0989\u09AA\u099C\u09C7\u09B2\u09BE"),
    phone: String(row.phone || ""),
    email: String(row.email || ""),
    showYearlyCostAtAdmission: row.show_yearly_cost_at_admission !== false,
    principalName: String(row.principal_name || ""),
    principalPhone: String(row.principal_phone || ""),
    idLogo: String(row.id_logo || ""),
    principalSignature: String(row.principal_signature || ""),
    principalMsg: String(row.principal_msg || ""),
    fb: String(row.fb || ""),
    yt: String(row.yt || ""),
    ig: String(row.ig || "")
  };
}
function mapSettingsToDb(s) {
  return {
    id: "main",
    name: String(s.name || "\u0986\u09AE\u09BE\u09B0 \u09B8\u09CD\u0995\u09C1\u09B2"),
    motto: String(s.motto || ""),
    established: String(s.established || ""),
    address: String(s.address || ""),
    phone: String(s.phone || ""),
    email: String(s.email || ""),
    show_yearly_cost_at_admission: s.showYearlyCostAtAdmission !== false,
    principal_name: String(s.principalName || ""),
    principal_phone: String(s.principalPhone || ""),
    id_logo: String(s.idLogo || ""),
    principal_signature: String(s.principalSignature || ""),
    principal_msg: String(s.principalMsg || ""),
    fb: String(s.fb || ""),
    yt: String(s.yt || ""),
    ig: String(s.ig || ""),
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function assembleClassesFromDb(classesRows, sectionRows, boardBookRows, extraActRows) {
  const secByCls = /* @__PURE__ */ new Map();
  for (const r of sectionRows) {
    const cid = String(r.class_id || "");
    if (!cid) continue;
    if (!secByCls.has(cid)) secByCls.set(cid, []);
    secByCls.get(cid).push(r);
  }
  const bbByCls = /* @__PURE__ */ new Map();
  for (const r of boardBookRows) {
    const cid = String(r.class_id || "");
    if (!cid) continue;
    if (!bbByCls.has(cid)) bbByCls.set(cid, []);
    bbByCls.get(cid).push(r);
  }
  const eaByCls = /* @__PURE__ */ new Map();
  for (const r of extraActRows) {
    const cid = String(r.class_id || "");
    if (!cid) continue;
    if (!eaByCls.has(cid)) eaByCls.set(cid, []);
    eaByCls.get(cid).push(r);
  }
  return classesRows.slice().sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0)).map((c) => {
    const cid = String(c.id || "");
    const secs = (secByCls.get(cid) || []).slice().sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""))).map((s) => {
      const item = {
        name: String(s.section_name || ""),
        room: String(s.room_no || ""),
        capacity: Number(s.seat_capacity || 0)
      };
      if (Array.isArray(s.subjects)) {
        item.subjects = s.subjects;
      }
      return item;
    });
    const bbooks = (bbByCls.get(cid) || []).slice().sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0)).map((b) => ({
      group: String(b.book_group || "\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3"),
      title: String(b.title || "")
    }));
    let extraActivities = [];
    if (Array.isArray(c.extra_activities) && c.extra_activities.length > 0) {
      extraActivities = c.extra_activities.map((x) => String(x || "")).filter(Boolean);
    } else {
      extraActivities = (eaByCls.get(cid) || []).slice().sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0)).map((e) => String(e.title || "")).filter(Boolean);
    }
    return {
      id: cid,
      name: String(c.name || ""),
      sections: secs.length ? secs.map((s) => s.name).join(", ") : String(c.sections || ""),
      room: secs.length ? secs.map((s) => s.room).join(", ") : String(c.room || ""),
      capacity: secs.length ? secs.reduce((sum, s) => sum + Number(s.capacity || 0), 0) : Number(c.capacity || 0),
      sectionDetails: secs.length ? secs : void 0,
      boardBooks: bbooks.length ? bbooks : void 0,
      extraActivities
    };
  });
}
function mapMediaFromDb(r) {
  return {
    id: String(r.id || ""),
    title: String(r.title || ""),
    mediaType: r.media_type === "video" ? "video" : "photo",
    category: String(r.category || "\u0997\u09CD\u09AF\u09BE\u09B2\u09BE\u09B0\u09BF"),
    fileUrl: String(r.file_url || ""),
    storagePath: String(r.storage_path || ""),
    description: String(r.description || ""),
    createdAt: String(r.created_at || "")
  };
}
async function getSupabaseStatus() {
  const cfg = getSupabaseConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      schemaReady: false,
      storageReady: false,
      realtimeConnected: false,
      studentCount: 0,
      mediaCount: 0,
      message: "SUPABASE_URL \u09AC\u09BE SUPABASE_PUBLISHABLE_KEY \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09A8\u09C7\u0987\u0964"
    };
  }
  const client = getSupabaseClient();
  let schemaReady = false;
  let studentCount = 0;
  let mediaCount = 0;
  let storageReady = false;
  let message = "Supabase \u09B8\u0982\u09AF\u09C1\u0995\u09CD\u09A4 \u0986\u099B\u09C7\u0964";
  try {
    const [settingsRes, studentsRes, mediaRes] = await Promise.all([
      client.from("school_settings").select("id", { count: "exact" }).limit(1),
      client.from("students").select("id", { count: "exact" }).limit(1),
      client.from("school_media").select("id", { count: "exact" }).limit(1)
    ]);
    if (!settingsRes.error && !studentsRes.error && !mediaRes.error) {
      schemaReady = true;
      studentCount = studentsRes.count || 0;
      mediaCount = mediaRes.count || 0;
    } else {
      const firstErr = settingsRes.error || studentsRes.error || mediaRes.error;
      message = isSchemaMissingError(firstErr) ? "Supabase-\u098F \u09B8\u0982\u09AF\u09CB\u0997 \u0986\u099B\u09C7, \u09A4\u09AC\u09C7 SQL \u09B8\u09CD\u0995\u09BF\u09AE\u09BE (\u099F\u09C7\u09AC\u09BF\u09B2\u09B8\u09AE\u09C2\u09B9) \u098F\u0996\u09A8\u0993 \u09B0\u09BE\u09A8 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964 supabase.sql \u099A\u09BE\u09B2\u09BE\u09A8\u0964" : String(firstErr?.message || "\u099F\u09C7\u09AC\u09BF\u09B2 \u09AF\u09BE\u099A\u09BE\u0987 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964");
    }
  } catch (err) {
    message = String(err?.message || "Supabase \u09AF\u09BE\u099A\u09BE\u0987 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964");
  }
  try {
    const { error: stErr } = await client.storage.getBucket(STORAGE_BUCKET);
    if (!stErr) {
      storageReady = true;
    } else if (schemaReady) {
      const { error: listErr } = await client.storage.from(STORAGE_BUCKET).list("", { limit: 1 });
      storageReady = !listErr;
    }
  } catch {
    storageReady = false;
  }
  return {
    configured: true,
    schemaReady,
    storageReady,
    realtimeConnected,
    studentCount,
    mediaCount,
    message
  };
}
async function loadPublicSnapshot() {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, configured: false, schemaReady: false, data: null };
  }
  try {
    const [
      settingsRes,
      classesRes,
      sectionsRes,
      boardBooksRes,
      extraActsRes,
      subjectsRes,
      teachersRes,
      noticesRes,
      booksRes,
      routesRes,
      costTypesRes,
      mediaRes,
      loansCountRes,
      stuClsRes
    ] = await Promise.all([
      client.from("school_settings").select("*").eq("id", "main").maybeSingle(),
      fetchAllRows(client, "classes", "*", "display_order"),
      fetchAllRows(client, "class_sections", "*", "id"),
      fetchAllRows(client, "board_books", "*", "display_order"),
      fetchAllRows(client, "class_extra_activities", "*", "display_order"),
      fetchAllRows(client, "subjects", "*", "id"),
      fetchAllRows(client, "teachers", "*", "id"),
      fetchAllRows(client, "notices", "*", "id"),
      fetchAllRows(client, "books", "*", "id"),
      fetchAllRows(client, "transport_routes", "*", "id"),
      fetchAllRows(client, "cost_types", "*", "id"),
      client.from("school_media").select("*").order("created_at", { ascending: false }),
      client.from("book_loans").select("id", { count: "exact" }).eq("returned", false).limit(1),
      fetchAllRows(client, "students", "id, cls", "id")
    ]);
    const possibleErr = settingsRes.error || classesRes.error || sectionsRes.error || subjectsRes.error || teachersRes.error || noticesRes.error || mediaRes.error || stuClsRes.error;
    if (possibleErr) {
      return {
        ok: false,
        configured: true,
        schemaReady: !isSchemaMissingError(possibleErr),
        error: String(possibleErr.message || "Database read error"),
        data: null
      };
    }
    const classStudentCounts = {};
    for (const s of stuClsRes.rows) {
      const c = String(s.cls || "");
      if (c) classStudentCounts[c] = (classStudentCounts[c] || 0) + 1;
    }
    const classes = assembleClassesFromDb(
      classesRes.rows,
      sectionsRes.rows,
      boardBooksRes.rows,
      extraActsRes.rows
    );
    const [teacherMetaMap, savedRoutine] = await Promise.all([
      loadTeacherMetaMapFromSupabase(client),
      loadRoutineFromSupabase(client)
    ]);
    return {
      ok: true,
      configured: true,
      schemaReady: true,
      data: {
        settings: mapSettingsFromDb(settingsRes.data),
        classes,
        subjects: subjectsRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          code: String(r.code || ""),
          classes: String(r.classes || "\u09B8\u09AC \u09B6\u09CD\u09B0\u09C7\u09A3\u09BF"),
          group: String(r.book_group || "\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3"),
          section: String(r.section || "\u09B8\u09AC \u09B6\u09BE\u0996\u09BE")
        })),
        teachers: teachersRes.rows.map(
          (r) => mergeTeacherRow(r, teacherMetaMap[String(r.id || "")], false)
        ),
        notices: noticesRes.rows.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          body: String(r.body || ""),
          date: String(r.date || "")
        })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
        books: booksRes.rows.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          author: String(r.author || ""),
          copies: Number(r.copies || 1)
        })),
        routes: routesRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          vehicle: String(r.vehicle || ""),
          driver: String(r.driver || ""),
          stops: String(r.stops || "")
        })),
        costTypes: costTypesRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          amount: Number(r.amount || 0),
          isCustom: Boolean(r.is_custom)
        })),
        media: (mediaRes.data || []).map(mapMediaFromDb),
        routine: savedRoutine,
        studentCount: stuClsRes.rows.length,
        classStudentCounts,
        issuedLoansCount: loansCountRes.count || 0
      }
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      schemaReady: !isSchemaMissingError(err),
      error: String(err?.message || "Unknown read error"),
      data: null
    };
  }
}
async function loadFullSnapshot(includeOfficeSensitive) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, configured: false, schemaReady: false, data: null };
  }
  try {
    const [
      pub,
      studentsRes,
      studentCostsRes,
      payHistoryRes,
      attRes,
      resultsRes,
      loansRes,
      admissionsRes,
      deptsRes,
      empsRes,
      officeAttRes,
      leavesRes,
      payrollRes,
      tasksRes,
      expensesRes,
      docsRes
    ] = await Promise.all([
      loadPublicSnapshot(),
      fetchAllRows(client, "students", "*", "id"),
      fetchAllRows(client, "student_costs", "*", "id"),
      fetchAllRows(client, "student_payment_history", "*", "id"),
      fetchAllRows(client, "attendance", "*", "id"),
      fetchAllRows(client, "results", "*", "id"),
      fetchAllRows(client, "book_loans", "*", "id"),
      includeOfficeSensitive ? fetchAllRows(client, "admissions", "*", "id") : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive ? fetchAllRows(client, "departments", "*", "id") : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive ? fetchAllRows(client, "employees", "*", "id") : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive ? fetchAllRows(client, "office_attendance", "*", "id") : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive ? fetchAllRows(client, "leaves", "*", "id") : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive ? fetchAllRows(client, "payroll", "*", "id") : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive ? fetchAllRows(client, "tasks", "*", "id") : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive ? fetchAllRows(client, "expenses", "*", "id") : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive ? fetchAllRows(client, "office_docs", "*", "id") : Promise.resolve({ rows: [], error: null })
    ]);
    if (!pub.ok || !pub.data) return pub;
    const firstErr = studentsRes.error || studentCostsRes.error || payHistoryRes.error || attRes.error || resultsRes.error || loansRes.error || admissionsRes.error || empsRes.error;
    if (firstErr) {
      return {
        ok: false,
        configured: true,
        schemaReady: !isSchemaMissingError(firstErr),
        error: String(firstErr.message || "Snapshot error"),
        data: null
      };
    }
    const attendance = {};
    const attendanceTimes = {};
    for (const r of attRes.rows) {
      const dt = String(r.att_date || "");
      const cls = String(r.cls || "");
      const sid = String(r.student_id || "");
      const st = String(r.status || "P");
      if (!dt || !sid) continue;
      const key = `${dt}|${cls}`;
      if (!attendance[key]) attendance[key] = {};
      attendance[key][sid] = st;
      if (r.scan_time) {
        attendanceTimes[`${dt}|${sid}`] = String(r.scan_time);
      }
    }
    const results = {};
    for (const r of resultsRes.rows) {
      const sid = String(r.student_id || "");
      if (sid && r.marks && typeof r.marks === "object") {
        results[sid] = r.marks;
      }
    }
    const officeAttendance = {};
    for (const r of officeAttRes.rows) {
      const dt = String(r.att_date || "");
      const eid = String(r.emp_id || "");
      if (dt && eid) {
        if (!officeAttendance[dt]) officeAttendance[dt] = {};
        officeAttendance[dt][eid] = String(r.status || "P");
      }
    }
    const rawTeacherRows = await fetchAllRows(client, "teachers", "*", "id").catch(() => ({ rows: [], error: null }));
    const metaDocRow = docsRes.rows.find((r) => String(r.id || "") === "__teacher_profiles_v1__");
    let fullMetaMap = {};
    if (metaDocRow && metaDocRow.note) {
      try {
        const parsed = JSON.parse(String(metaDocRow.note || "{}"));
        if (parsed && typeof parsed === "object") fullMetaMap = parsed;
      } catch {
        fullMetaMap = {};
      }
    } else if (includeOfficeSensitive) {
      fullMetaMap = await loadTeacherMetaMapFromSupabase(client);
    }
    const teachersWithDetails = includeOfficeSensitive && rawTeacherRows.rows.length ? rawTeacherRows.rows.map((r) => mergeTeacherRow(r, fullMetaMap[String(r.id || "")], true)) : pub.data.teachers;
    return {
      ok: true,
      configured: true,
      schemaReady: true,
      data: {
        ...pub.data,
        teachers: teachersWithDetails,
        students: studentsRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          cls: String(r.cls || ""),
          roll: Number(r.roll || 0),
          section: String(r.section || "\u0995"),
          guardian: String(r.guardian || ""),
          phone: String(r.phone || ""),
          payable: Number(r.payable || 0),
          paid: Number(r.paid || 0),
          photo: String(r.photo || ""),
          admissionDate: String(r.admission_date || "")
        })).sort((a, b) => a.roll - b.roll),
        studentCosts: studentCostsRes.rows.map((r) => ({
          id: String(r.id || ""),
          studentId: String(r.student_id || ""),
          costTypeId: String(r.cost_type_id || ""),
          name: String(r.name || ""),
          amount: Number(r.amount || 0),
          paid: Number(r.paid || 0)
        })),
        paymentHistory: payHistoryRes.rows.map((r) => ({
          id: String(r.id || ""),
          studentId: String(r.student_id || ""),
          date: String(r.pay_date || ""),
          time: String(r.pay_time || ""),
          head: String(r.head || ""),
          amount: Number(r.amount || 0),
          note: String(r.note || "")
        })).reverse(),
        attendance,
        attendanceTimes,
        results,
        loans: loansRes.rows.map((r) => ({
          id: String(r.id || ""),
          bookId: String(r.book_id || ""),
          studentId: String(r.student_id || ""),
          date: String(r.loan_date || ""),
          returned: Boolean(r.returned)
        })),
        admissions: admissionsRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          cls: String(r.cls || ""),
          section: String(r.section || "\u0995"),
          guardian: String(r.guardian || ""),
          phone: String(r.phone || ""),
          address: String(r.address || ""),
          status: String(r.status || "pending"),
          date: String(r.apply_date || "")
        })),
        departments: deptsRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          head: String(r.head || ""),
          note: String(r.note || "")
        })),
        employees: empsRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          dept: String(r.dept || ""),
          designation: String(r.designation || ""),
          phone: String(r.phone || ""),
          email: String(r.email || ""),
          salary: Number(r.salary || 0),
          joinDate: String(r.join_date || ""),
          status: String(r.status || "\u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC")
        })),
        officeAttendance,
        leaves: leavesRes.rows.map((r) => ({
          id: String(r.id || ""),
          empId: String(r.emp_id || ""),
          type: String(r.type || ""),
          from: String(r.from_date || ""),
          to: String(r.to_date || ""),
          reason: String(r.reason || ""),
          status: String(r.status || "pending")
        })),
        payroll: payrollRes.rows.map((r) => ({
          id: String(r.id || ""),
          empId: String(r.emp_id || ""),
          month: String(r.month || ""),
          basic: Number(r.basic || 0),
          allowance: Number(r.allowance || 0),
          deduction: Number(r.deduction || 0)
        })),
        tasks: tasksRes.rows.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          empId: String(r.emp_id || ""),
          due: String(r.due || ""),
          priority: String(r.priority || "\u09AE\u09BE\u099D\u09BE\u09B0\u09BF"),
          status: String(r.status || "\u099A\u09B2\u09AE\u09BE\u09A8")
        })),
        expenses: expensesRes.rows.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          category: String(r.category || ""),
          amount: Number(r.amount || 0),
          date: String(r.exp_date || ""),
          note: String(r.note || "")
        })),
        officeDocs: docsRes.rows.filter(
          (r) => {
            const id = String(r.id || "");
            const cat = String(r.category || "");
            return id !== "__master_auth_v1__" && cat !== "__system_auth__" && id !== "__teacher_profiles_v1__" && cat !== "__system_teacher_meta__" && id !== "__class_routine_v1__" && cat !== "__system_routine__";
          }
        ).map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          category: String(r.category || ""),
          date: String(r.doc_date || ""),
          note: String(r.note || "")
        }))
      }
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      schemaReady: !isSchemaMissingError(err),
      error: String(err?.message || "Full snapshot load failed"),
      data: null
    };
  }
}
async function syncSlicesToSupabase(changes, removals, options) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, schemaReady: false, error: "Supabase \u0995\u09A8\u09AB\u09BF\u0997\u09BE\u09B0 \u0995\u09B0\u09BE \u09A8\u09C7\u0987\u0964" };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const touchedTables = [];
  try {
    if (options.isMaster && changes.settings && typeof changes.settings === "object") {
      await upsertInChunks(client, "school_settings", [
        mapSettingsToDb(changes.settings)
      ]);
      touchedTables.push("school_settings");
    }
    if (Array.isArray(removals.classes) && removals.classes.length) {
      await deleteIdsInChunks(client, "classes", removals.classes);
      touchedTables.push("classes");
    }
    if (Array.isArray(changes.classes)) {
      const clsList = changes.classes;
      const clsRows = clsList.map((c, idx) => ({
        id: String(c.id || `cls-${idx + 1}`),
        name: String(c.name || ""),
        display_order: idx + 1,
        sections: String(c.sections || ""),
        room: String(c.room || ""),
        capacity: Number(c.capacity || 0),
        extra_activities: Array.isArray(c.extraActivities) ? c.extraActivities : [],
        updated_at: now
      }));
      await upsertInChunks(client, "classes", clsRows);
      const touchedClassIds = clsRows.map((c) => c.id);
      if (touchedClassIds.length) {
        await client.from("class_sections").delete().in("class_id", touchedClassIds);
        await client.from("board_books").delete().in("class_id", touchedClassIds);
        await client.from("class_extra_activities").delete().in("class_id", touchedClassIds);
        const secRows = [];
        const bbRows = [];
        const eaRows = [];
        clsList.forEach((c, idx) => {
          const cid = String(c.id || `cls-${idx + 1}`);
          const cname = String(c.name || "");
          const secDetails = Array.isArray(c.sectionDetails) ? c.sectionDetails : [];
          secDetails.forEach((sec, sIdx) => {
            secRows.push({
              id: `${cid}-sec-${sIdx + 1}`,
              class_id: cid,
              section_name: String(sec.name || ""),
              room_no: String(sec.room || ""),
              seat_capacity: Number(sec.capacity || 0),
              subjects: Array.isArray(sec.subjects) ? sec.subjects : null,
              updated_at: now
            });
          });
          const bbooks = Array.isArray(c.boardBooks) ? c.boardBooks : [];
          const seenBookKey = /* @__PURE__ */ new Set();
          bbooks.forEach((b, bIdx) => {
            const grp = String(b.group || "\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3");
            const title = String(b.title || "").trim();
            if (!title) return;
            const k = `${grp}::${title}`;
            if (seenBookKey.has(k)) return;
            seenBookKey.add(k);
            bbRows.push({
              id: `${cid}-bb-${bIdx + 1}`,
              class_id: cid,
              class_name: cname,
              book_group: grp,
              title,
              display_order: bIdx + 1,
              updated_at: now
            });
          });
          const acts = Array.isArray(c.extraActivities) ? c.extraActivities : [];
          const seenAct = /* @__PURE__ */ new Set();
          acts.forEach((a, aIdx) => {
            const title = String(a || "").trim();
            if (!title || seenAct.has(title)) return;
            seenAct.add(title);
            eaRows.push({
              id: `${cid}-ea-${aIdx + 1}`,
              class_id: cid,
              class_name: cname,
              title,
              display_order: aIdx + 1,
              updated_at: now
            });
          });
        });
        await upsertInChunks(client, "class_sections", secRows);
        await upsertInChunks(client, "board_books", bbRows);
        await upsertInChunks(client, "class_extra_activities", eaRows);
      }
      touchedTables.push("classes", "class_sections", "board_books", "class_extra_activities");
    }
    if (Array.isArray(removals.subjects) && removals.subjects.length) {
      await deleteIdsInChunks(client, "subjects", removals.subjects);
      touchedTables.push("subjects");
    }
    if (Array.isArray(changes.subjects)) {
      await upsertInChunks(
        client,
        "subjects",
        changes.subjects.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          code: String(r.code || ""),
          classes: String(r.classes || "\u09B8\u09AC \u09B6\u09CD\u09B0\u09C7\u09A3\u09BF"),
          book_group: String(r.group || "\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3"),
          section: String(r.section || "\u09B8\u09AC \u09B6\u09BE\u0996\u09BE"),
          updated_at: now
        }))
      );
      touchedTables.push("subjects");
    }
    if (options.isMaster) {
      if (Array.isArray(removals.costTypes) && removals.costTypes.length) {
        await deleteIdsInChunks(client, "cost_types", removals.costTypes);
        touchedTables.push("cost_types");
      }
      if (Array.isArray(changes.costTypes)) {
        await upsertInChunks(
          client,
          "cost_types",
          changes.costTypes.map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            amount: Number(r.amount || 0),
            is_custom: Boolean(r.isCustom),
            updated_at: now
          }))
        );
        touchedTables.push("cost_types");
      }
    }
    if (Array.isArray(removals.students) && removals.students.length) {
      await deleteIdsInChunks(client, "students", removals.students);
      touchedTables.push("students");
    }
    if (Array.isArray(changes.students)) {
      await upsertInChunks(
        client,
        "students",
        changes.students.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          cls: String(r.cls || ""),
          roll: Number(r.roll || 0),
          section: String(r.section || "\u0995"),
          guardian: String(r.guardian || ""),
          phone: String(r.phone || ""),
          payable: Number(r.payable || 0),
          paid: Number(r.paid || 0),
          photo: String(r.photo || ""),
          admission_date: String(r.admissionDate || ""),
          updated_at: now
        }))
      );
      touchedTables.push("students");
    }
    if (Array.isArray(removals.studentCosts) && removals.studentCosts.length) {
      await deleteIdsInChunks(client, "student_costs", removals.studentCosts);
      touchedTables.push("student_costs");
    }
    if (Array.isArray(changes.studentCosts)) {
      await upsertInChunks(
        client,
        "student_costs",
        changes.studentCosts.map((r) => ({
          id: String(r.id || ""),
          student_id: String(r.studentId || ""),
          cost_type_id: String(r.costTypeId || ""),
          name: String(r.name || ""),
          amount: Number(r.amount || 0),
          paid: Number(r.paid || 0),
          updated_at: now
        }))
      );
      touchedTables.push("student_costs");
    }
    if (Array.isArray(removals.paymentHistory) && removals.paymentHistory.length) {
      await deleteIdsInChunks(client, "student_payment_history", removals.paymentHistory);
      touchedTables.push("student_payment_history");
    }
    if (Array.isArray(changes.paymentHistory)) {
      await upsertInChunks(
        client,
        "student_payment_history",
        changes.paymentHistory.map((r) => ({
          id: String(r.id || ""),
          student_id: String(r.studentId || ""),
          pay_date: String(r.date || ""),
          pay_time: String(r.time || ""),
          head: String(r.head || ""),
          amount: Number(r.amount || 0),
          note: String(r.note || ""),
          updated_at: now
        }))
      );
      touchedTables.push("student_payment_history");
    }
    if (Array.isArray(removals.teachers) && removals.teachers.length) {
      await deleteIdsInChunks(client, "teachers", removals.teachers);
      await saveTeacherMetaToSupabase(client, [], removals.teachers);
      touchedTables.push("teachers");
    }
    if (Array.isArray(changes.teachers)) {
      const teacherRecs = changes.teachers;
      const fullRows = teacherRecs.map((r) => ({
        id: String(r.id || ""),
        name: String(r.name || ""),
        teacher_code: String(r.teacherCode || ""),
        subject: String(r.subject || ""),
        designation: String(r.designation || ""),
        phone: String(r.phone || ""),
        email: String(r.email || ""),
        qualification: String(r.qualification || ""),
        join_date: String(r.joinDate || ""),
        monthly_salary: Number(r.monthlySalary || 0),
        monthly_allowance: Number(r.monthlyAllowance || 0),
        class_teacher_class: String(r.classTeacherClass || ""),
        class_teacher_section: String(r.classTeacherSection || ""),
        teaching_classes: Array.isArray(r.teachingClasses) ? r.teachingClasses : [],
        teaching_assignments: Array.isArray(r.teachingAssignments) ? r.teachingAssignments : [],
        salary_history: Array.isArray(r.salaryHistory) ? r.salaryHistory : [],
        blood_group: String(r.bloodGroup || ""),
        address: String(r.address || ""),
        status: String(r.status || "\u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC"),
        photo: String(r.photo || ""),
        updated_at: now
      }));
      try {
        await upsertInChunks(client, "teachers", fullRows);
      } catch (tErr) {
        if (!isSchemaMissingError(tErr)) throw tErr;
        await upsertInChunks(
          client,
          "teachers",
          teacherRecs.map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            subject: String(r.subject || ""),
            phone: String(r.phone || ""),
            qualification: String(r.qualification || ""),
            photo: String(r.photo || ""),
            updated_at: now
          }))
        );
      }
      await saveTeacherMetaToSupabase(client, teacherRecs, []);
      touchedTables.push("teachers");
    }
    if (Array.isArray(removals.notices) && removals.notices.length) {
      await deleteIdsInChunks(client, "notices", removals.notices);
      touchedTables.push("notices");
    }
    if (Array.isArray(changes.notices)) {
      await upsertInChunks(
        client,
        "notices",
        changes.notices.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          body: String(r.body || ""),
          date: String(r.date || ""),
          updated_at: now
        }))
      );
      touchedTables.push("notices");
    }
    if (Array.isArray(removals.books) && removals.books.length) {
      await deleteIdsInChunks(client, "books", removals.books);
      touchedTables.push("books");
    }
    if (Array.isArray(changes.books)) {
      await upsertInChunks(
        client,
        "books",
        changes.books.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          author: String(r.author || ""),
          copies: Number(r.copies || 1),
          updated_at: now
        }))
      );
      touchedTables.push("books");
    }
    if (Array.isArray(removals.loans) && removals.loans.length) {
      await deleteIdsInChunks(client, "book_loans", removals.loans);
      touchedTables.push("book_loans");
    }
    if (Array.isArray(changes.loans)) {
      await upsertInChunks(
        client,
        "book_loans",
        changes.loans.map((r) => ({
          id: String(r.id || ""),
          book_id: String(r.bookId || ""),
          student_id: String(r.studentId || ""),
          loan_date: String(r.date || ""),
          returned: Boolean(r.returned),
          updated_at: now
        }))
      );
      touchedTables.push("book_loans");
    }
    if (Array.isArray(removals.routes) && removals.routes.length) {
      await deleteIdsInChunks(client, "transport_routes", removals.routes);
      touchedTables.push("transport_routes");
    }
    if (Array.isArray(changes.routes)) {
      await upsertInChunks(
        client,
        "transport_routes",
        changes.routes.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          vehicle: String(r.vehicle || ""),
          driver: String(r.driver || ""),
          stops: String(r.stops || ""),
          updated_at: now
        }))
      );
      touchedTables.push("transport_routes");
    }
    if (Array.isArray(removals.media) && removals.media.length) {
      await deleteIdsInChunks(client, "school_media", removals.media);
      touchedTables.push("school_media");
    }
    if (Array.isArray(changes.media)) {
      await upsertInChunks(
        client,
        "school_media",
        changes.media.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          media_type: r.mediaType === "video" ? "video" : "photo",
          category: String(r.category || "\u0997\u09CD\u09AF\u09BE\u09B2\u09BE\u09B0\u09BF"),
          file_url: String(r.fileUrl || ""),
          storage_path: String(r.storagePath || ""),
          description: String(r.description || ""),
          updated_at: now
        }))
      );
      touchedTables.push("school_media");
    }
    if (changes.routine && typeof changes.routine === "object") {
      await saveRoutineToSupabase(client, changes.routine);
      touchedTables.push("office_docs");
    }
    if (changes.attendance && typeof changes.attendance === "object") {
      const attObj = changes.attendance;
      const timesObj = changes.attendanceTimes && typeof changes.attendanceTimes === "object" ? changes.attendanceTimes : {};
      const attRows = [];
      for (const [attKey, stuMap] of Object.entries(attObj)) {
        const sep = attKey.indexOf("|");
        if (sep <= 0 || !stuMap || typeof stuMap !== "object") continue;
        const attDate = attKey.slice(0, sep);
        const cls = attKey.slice(sep + 1);
        for (const [sid, status] of Object.entries(stuMap)) {
          attRows.push({
            id: `${attDate}|${sid}`,
            att_date: attDate,
            cls,
            student_id: sid,
            status: String(status || "P"),
            scan_time: String(timesObj[`${attDate}|${sid}`] || ""),
            updated_at: now
          });
        }
      }
      await upsertInChunks(client, "attendance", attRows);
      touchedTables.push("attendance");
    }
    if (changes.results && typeof changes.results === "object") {
      const resObj = changes.results;
      const resRows = Object.entries(resObj).map(([sid, marks]) => ({
        id: `res-${sid}`,
        student_id: sid,
        marks: marks || {},
        updated_at: now
      }));
      await upsertInChunks(client, "results", resRows);
      touchedTables.push("results");
    }
    if (options.isMaster) {
      if (Array.isArray(removals.admissions) && removals.admissions.length) {
        await deleteIdsInChunks(client, "admissions", removals.admissions);
        touchedTables.push("admissions");
      }
      if (Array.isArray(changes.admissions)) {
        await upsertInChunks(
          client,
          "admissions",
          changes.admissions.map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            cls: String(r.cls || ""),
            section: String(r.section || "\u0995"),
            guardian: String(r.guardian || ""),
            phone: String(r.phone || ""),
            address: String(r.address || ""),
            status: String(r.status || "pending"),
            apply_date: String(r.date || ""),
            updated_at: now
          }))
        );
        touchedTables.push("admissions");
      }
      if (Array.isArray(removals.departments) && removals.departments.length) {
        await deleteIdsInChunks(client, "departments", removals.departments);
        touchedTables.push("departments");
      }
      if (Array.isArray(changes.departments)) {
        await upsertInChunks(
          client,
          "departments",
          changes.departments.map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            head: String(r.head || ""),
            note: String(r.note || ""),
            updated_at: now
          }))
        );
        touchedTables.push("departments");
      }
      if (Array.isArray(removals.employees) && removals.employees.length) {
        await deleteIdsInChunks(client, "employees", removals.employees);
        touchedTables.push("employees");
      }
      if (Array.isArray(changes.employees)) {
        await upsertInChunks(
          client,
          "employees",
          changes.employees.map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            dept: String(r.dept || ""),
            designation: String(r.designation || ""),
            phone: String(r.phone || ""),
            email: String(r.email || ""),
            salary: Number(r.salary || 0),
            join_date: String(r.joinDate || ""),
            status: String(r.status || "\u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC"),
            updated_at: now
          }))
        );
        touchedTables.push("employees");
      }
      if (changes.officeAttendance && typeof changes.officeAttendance === "object") {
        const oa = changes.officeAttendance;
        const rows = [];
        for (const [dt, empMap] of Object.entries(oa)) {
          if (!empMap || typeof empMap !== "object") continue;
          for (const [eid, st] of Object.entries(empMap)) {
            rows.push({
              id: `${dt}|${eid}`,
              att_date: dt,
              emp_id: eid,
              status: String(st || "P"),
              updated_at: now
            });
          }
        }
        await upsertInChunks(client, "office_attendance", rows);
        touchedTables.push("office_attendance");
      }
      if (Array.isArray(removals.leaves) && removals.leaves.length) {
        await deleteIdsInChunks(client, "leaves", removals.leaves);
        touchedTables.push("leaves");
      }
      if (Array.isArray(changes.leaves)) {
        await upsertInChunks(
          client,
          "leaves",
          changes.leaves.map((r) => ({
            id: String(r.id || ""),
            emp_id: String(r.empId || ""),
            type: String(r.type || ""),
            from_date: String(r.from || ""),
            to_date: String(r.to || ""),
            reason: String(r.reason || ""),
            status: String(r.status || "pending"),
            updated_at: now
          }))
        );
        touchedTables.push("leaves");
      }
      if (Array.isArray(removals.payroll) && removals.payroll.length) {
        await deleteIdsInChunks(client, "payroll", removals.payroll);
        touchedTables.push("payroll");
      }
      if (Array.isArray(changes.payroll)) {
        await upsertInChunks(
          client,
          "payroll",
          changes.payroll.map((r) => ({
            id: String(r.id || ""),
            emp_id: String(r.empId || ""),
            month: String(r.month || ""),
            basic: Number(r.basic || 0),
            allowance: Number(r.allowance || 0),
            deduction: Number(r.deduction || 0),
            updated_at: now
          }))
        );
        touchedTables.push("payroll");
      }
      if (Array.isArray(removals.tasks) && removals.tasks.length) {
        await deleteIdsInChunks(client, "tasks", removals.tasks);
        touchedTables.push("tasks");
      }
      if (Array.isArray(changes.tasks)) {
        await upsertInChunks(
          client,
          "tasks",
          changes.tasks.map((r) => ({
            id: String(r.id || ""),
            title: String(r.title || ""),
            emp_id: String(r.empId || ""),
            due: String(r.due || ""),
            priority: String(r.priority || "\u09AE\u09BE\u099D\u09BE\u09B0\u09BF"),
            status: String(r.status || "\u099A\u09B2\u09AE\u09BE\u09A8"),
            updated_at: now
          }))
        );
        touchedTables.push("tasks");
      }
      if (Array.isArray(removals.expenses) && removals.expenses.length) {
        await deleteIdsInChunks(client, "expenses", removals.expenses);
        touchedTables.push("expenses");
      }
      if (Array.isArray(changes.expenses)) {
        await upsertInChunks(
          client,
          "expenses",
          changes.expenses.map((r) => ({
            id: String(r.id || ""),
            title: String(r.title || ""),
            category: String(r.category || ""),
            amount: Number(r.amount || 0),
            exp_date: String(r.date || ""),
            note: String(r.note || ""),
            updated_at: now
          }))
        );
        touchedTables.push("expenses");
      }
      if (Array.isArray(removals.officeDocs) && removals.officeDocs.length) {
        const safeIds = removals.officeDocs.filter((id) => {
          const s = String(id || "");
          return s !== "__master_auth_v1__" && s !== "__teacher_profiles_v1__" && s !== "__class_routine_v1__";
        });
        if (safeIds.length) {
          await deleteIdsInChunks(client, "office_docs", safeIds);
          touchedTables.push("office_docs");
        }
      }
      if (Array.isArray(changes.officeDocs)) {
        const safeDocs = changes.officeDocs.filter(
          (r) => {
            const id = String(r.id || "");
            const cat = String(r.category || "");
            return id !== "__master_auth_v1__" && cat !== "__system_auth__" && id !== "__teacher_profiles_v1__" && cat !== "__system_teacher_meta__" && id !== "__class_routine_v1__" && cat !== "__system_routine__";
          }
        );
        await upsertInChunks(
          client,
          "office_docs",
          safeDocs.map((r) => ({
            id: String(r.id || ""),
            title: String(r.title || ""),
            category: String(r.category || ""),
            doc_date: String(r.date || ""),
            note: String(r.note || ""),
            updated_at: now
          }))
        );
        touchedTables.push("office_docs");
      }
    }
    if (touchedTables.length > 0) {
      broadcastSchoolUpdate("sync", Array.from(new Set(touchedTables)));
    }
    return { ok: true, schemaReady: true, touchedTables };
  } catch (err) {
    const schemaMissing = isSchemaMissingError(err);
    return {
      ok: false,
      schemaReady: !schemaMissing,
      error: schemaMissing ? "Supabase-\u098F \u099F\u09C7\u09AC\u09BF\u09B2 \u09AC\u09BE \u0995\u09B2\u09BE\u09AE \u09A4\u09C8\u09B0\u09BF \u09B9\u09AF\u09BC\u09A8\u09BF\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 supabase.sql \u099A\u09BE\u09B2\u09BE\u09A8\u0964" : String(err?.message || "Sync failed")
    };
  }
}
async function createPublicAdmissionInSupabase(record) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, schemaReady: false, error: "Supabase \u0995\u09A8\u09AB\u09BF\u0997\u09BE\u09B0 \u0995\u09B0\u09BE \u09A8\u09C7\u0987\u0964" };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const id = String(record.id || `adm-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`);
  const row = {
    id,
    name: String(record.name || "").trim().slice(0, 120),
    cls: String(record.cls || "").trim().slice(0, 40),
    section: String(record.section || "\u0995").trim().slice(0, 40),
    guardian: String(record.guardian || "").trim().slice(0, 120),
    phone: String(record.phone || "").trim().slice(0, 30),
    address: String(record.address || "").trim().slice(0, 260),
    status: "pending",
    apply_date: String(record.date || now.slice(0, 10)),
    updated_at: now
  };
  try {
    const { error } = await client.from("admissions").insert(row);
    if (error) {
      return {
        ok: false,
        schemaReady: !isSchemaMissingError(error),
        error: String(error.message || "\u09AD\u09B0\u09CD\u09A4\u09BF \u0986\u09AC\u09C7\u09A6\u09A8 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964")
      };
    }
    broadcastSchoolUpdate("admission", ["admissions"]);
    return {
      ok: true,
      admission: {
        id: row.id,
        name: row.name,
        cls: row.cls,
        section: row.section,
        guardian: row.guardian,
        phone: row.phone,
        address: row.address,
        status: row.status,
        date: row.apply_date
      }
    };
  } catch (err) {
    return {
      ok: false,
      schemaReady: !isSchemaMissingError(err),
      error: String(err?.message || "\u09AD\u09B0\u09CD\u09A4\u09BF \u0986\u09AC\u09C7\u09A6\u09A8 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964")
    };
  }
}
async function uploadMediaToSupabase(params) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, status: 503, error: "Supabase \u0995\u09A8\u09AB\u09BF\u0997\u09BE\u09B0 \u0995\u09B0\u09BE \u09A8\u09C7\u0987\u0964" };
  }
  let mime = String(params.mimeType || "").trim().toLowerCase();
  let rawBase64 = String(params.base64Data || "").trim();
  if (rawBase64.startsWith("data:")) {
    const commaIdx = rawBase64.indexOf(",");
    if (commaIdx <= 0) {
      return { ok: false, status: 400, error: "\u0985\u09AC\u09C8\u09A7 \u09AB\u09BE\u0987\u09B2 \u09A1\u09C7\u099F\u09BE\u0964" };
    }
    const header = rawBase64.slice(5, commaIdx);
    const semiIdx = header.indexOf(";");
    const detectedMime = (semiIdx > 0 ? header.slice(0, semiIdx) : header).toLowerCase();
    if (!mime) mime = detectedMime;
    rawBase64 = rawBase64.slice(commaIdx + 1);
  }
  const info = ALLOWED_MEDIA_MIME[mime];
  if (!info) {
    return {
      ok: false,
      status: 400,
      error: "\u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09AB\u09BE\u0987\u09B2 \u09AB\u09B0\u09AE\u09CD\u09AF\u09BE\u099F: JPG, PNG, WebP, GIF, MP4, WebM, OGG, MOV\u0964"
    };
  }
  const buffer = Buffer.from(rawBase64, "base64");
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) {
    return {
      ok: false,
      status: 400,
      error: "\u09AB\u09BE\u0987\u09B2\u09C7\u09B0 \u0986\u0995\u09BE\u09B0 \u09B6\u09C2\u09A8\u09CD\u09AF \u09AC\u09BE \u09EB\u09E6MB \u09B8\u09C0\u09AE\u09BE\u09B0 \u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09C7\u09B6\u09BF\u0964"
    };
  }
  const folder = info.type === "video" ? "videos" : "photos";
  const storagePath = `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${info.ext}`;
  const { error: uploadErr } = await client.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
    contentType: mime,
    upsert: false
  });
  if (uploadErr) {
    return {
      ok: false,
      status: 500,
      error: String(uploadErr.message || "Supabase Storage-\u098F \u0986\u09AA\u09B2\u09CB\u09A1 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 'school-media' \u09AC\u09BE\u0995\u09C7\u099F \u09A4\u09C8\u09B0\u09BF \u0986\u099B\u09C7 \u0995\u09BF\u09A8\u09BE \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C1\u09A8\u0964")
    };
  }
  const { data: urlData } = client.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  const publicUrl = urlData?.publicUrl || "";
  let mediaItem = null;
  if (params.saveToGallery !== false) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const id = `med-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const row = {
      id,
      title: String(params.title || (info.type === "video" ? "\u0995\u09CD\u09AF\u09BE\u09AE\u09CD\u09AA\u09BE\u09B8 \u09AD\u09BF\u09A1\u09BF\u0993" : "\u0995\u09CD\u09AF\u09BE\u09AE\u09CD\u09AA\u09BE\u09B8\u09C7\u09B0 \u099B\u09AC\u09BF")).trim().slice(0, 140),
      media_type: info.type,
      category: String(params.category || (info.type === "video" ? "\u0995\u09CD\u09AF\u09BE\u09AE\u09CD\u09AA\u09BE\u09B8 \u09AD\u09BF\u09A1\u09BF\u0993" : "\u0997\u09CD\u09AF\u09BE\u09B2\u09BE\u09B0\u09BF")).trim().slice(0, 60),
      file_url: publicUrl,
      storage_path: storagePath,
      description: String(params.description || "").trim().slice(0, 400),
      created_at: now,
      updated_at: now
    };
    const { error: dbErr } = await client.from("school_media").insert(row);
    if (dbErr) {
      return {
        ok: false,
        status: 500,
        error: isSchemaMissingError(dbErr) ? "Storage-\u098F \u09AB\u09BE\u0987\u09B2 \u0989\u09A0\u09C7\u099B\u09C7, \u09A4\u09AC\u09C7 school_media \u099F\u09C7\u09AC\u09BF\u09B2 \u098F\u0996\u09A8\u0993 \u09A4\u09C8\u09B0\u09BF \u09B9\u09AF\u09BC\u09A8\u09BF\u0964" : String(dbErr.message || "\u09AE\u09BF\u09A1\u09BF\u09AF\u09BC\u09BE \u09B0\u09C7\u0995\u09B0\u09CD\u09A1 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964")
      };
    }
    mediaItem = mapMediaFromDb(row);
    broadcastSchoolUpdate("media", ["school_media"]);
  }
  return {
    ok: true,
    status: 200,
    url: publicUrl,
    storagePath,
    mediaType: info.type,
    mediaItem
  };
}
async function deleteMediaFromSupabase(id) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: "Supabase \u0995\u09A8\u09AB\u09BF\u0997\u09BE\u09B0 \u0995\u09B0\u09BE \u09A8\u09C7\u0987\u0964" };
  }
  const cleanId = String(id || "").trim();
  if (!cleanId) return { ok: false, error: "\u0985\u09AC\u09C8\u09A7 \u09AE\u09BF\u09A1\u09BF\u09AF\u09BC\u09BE \u0986\u0987\u09A1\u09BF\u0964" };
  const { data: existing } = await client.from("school_media").select("id, storage_path").eq("id", cleanId).maybeSingle();
  if (existing && existing.storage_path) {
    const sp = String(existing.storage_path);
    await client.storage.from(STORAGE_BUCKET).remove([sp]).catch(() => {
    });
  }
  const { error } = await client.from("school_media").delete().eq("id", cleanId);
  if (error) {
    return { ok: false, error: String(error.message || "\u09AE\u09BF\u09A1\u09BF\u09AF\u09BC\u09BE \u09A1\u09BF\u09B2\u09BF\u099F \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964") };
  }
  broadcastSchoolUpdate("media", ["school_media"]);
  return { ok: true };
}
function broadcastSchoolUpdate(reason, tables = []) {
  const payload = JSON.stringify({
    type: "db-updated",
    reason,
    tables,
    ts: Date.now()
  });
  for (const res of sseClients) {
    try {
      res.write(`event: db-updated
data: ${payload}

`);
    } catch {
      sseClients.delete(res);
    }
  }
}
function registerSseClient(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  res.write(`event: connected
data: ${JSON.stringify({ realtimeConnected, ts: Date.now() })}

`);
  sseClients.add(res);
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      if (sseClients.size === 0) return;
      for (const clientRes of sseClients) {
        try {
          clientRes.write(`: ping

`);
        } catch {
          sseClients.delete(clientRes);
        }
      }
    }, 25e3);
  }
  res.on("close", () => {
    sseClients.delete(res);
  });
}
async function loadMasterAuthFromSupabase(expectedEmail) {
  const client = getSupabaseClient();
  if (!client) return null;
  const targetEmail = expectedEmail.trim().toLowerCase();
  try {
    const { data, error } = await client.from("app_auth_store").select("id, email, salt, hash").eq("id", "master").maybeSingle();
    if (!error && data) {
      const email = String(data.email || "").trim().toLowerCase();
      const salt = String(data.salt || "");
      const hash = String(data.hash || "");
      if (email === targetEmail && salt && hash) {
        return { email, salt, hash };
      }
    }
    if (error && !isSchemaMissingError(error)) {
      return null;
    }
  } catch {
  }
  try {
    const { data, error } = await client.from("office_docs").select("id, title, category, note").eq("id", "__master_auth_v1__").maybeSingle();
    if (error || !data) return null;
    if (String(data.category || "") !== "__system_auth__") return null;
    const parsed = JSON.parse(String(data.note || "{}"));
    const email = String(parsed.email || data.title || "").trim().toLowerCase();
    const salt = String(parsed.salt || "");
    const hash = String(parsed.hash || "");
    if (email === targetEmail && salt && hash) {
      return { email, salt, hash };
    }
    return null;
  } catch {
    return null;
  }
}
async function saveMasterAuthToSupabase(cred) {
  const client = getSupabaseClient();
  if (!client) return false;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const cleanEmail = cred.email.trim().toLowerCase();
  try {
    const { error } = await client.from("app_auth_store").upsert(
      {
        id: "master",
        email: cleanEmail,
        salt: cred.salt,
        hash: cred.hash,
        updated_at: now
      },
      { onConflict: "id" }
    );
    if (!error) return true;
    if (!isSchemaMissingError(error)) return false;
  } catch {
  }
  try {
    const { error } = await client.from("office_docs").upsert(
      {
        id: "__master_auth_v1__",
        title: cleanEmail,
        category: "__system_auth__",
        doc_date: now.slice(0, 10),
        note: JSON.stringify({
          email: cleanEmail,
          salt: cred.salt,
          hash: cred.hash
        }),
        updated_at: now
      },
      { onConflict: "id" }
    );
    return !error;
  } catch {
    return false;
  }
}
async function loadTeacherMetaMapFromSupabase(client) {
  try {
    const { data, error } = await client.from("office_docs").select("id, category, note").eq("id", "__teacher_profiles_v1__").maybeSingle();
    if (error || !data) return {};
    if (String(data.category || "") !== "__system_teacher_meta__") return {};
    const parsed = JSON.parse(String(data.note || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
async function loadRoutineFromSupabase(client) {
  try {
    const { data, error } = await client.from("office_docs").select("id, category, note").eq("id", "__class_routine_v1__").maybeSingle();
    if (error || !data) return null;
    if (String(data.category || "") !== "__system_routine__") return null;
    const parsed = JSON.parse(String(data.note || "null"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
async function saveRoutineToSupabase(client, routineObj) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await client.from("office_docs").upsert(
    {
      id: "__class_routine_v1__",
      title: "Class Routine Master Data",
      category: "__system_routine__",
      doc_date: now.slice(0, 10),
      note: JSON.stringify(routineObj),
      updated_at: now
    },
    { onConflict: "id" }
  );
}
async function saveTeacherMetaToSupabase(client, recs, removedIds) {
  try {
    const cur = await loadTeacherMetaMapFromSupabase(client);
    for (const rid of removedIds) {
      const k = String(rid || "").trim();
      if (k) delete cur[k];
    }
    for (const r of recs) {
      const id = String(r.id || "").trim();
      if (!id) continue;
      cur[id] = {
        teacherCode: String(r.teacherCode || ""),
        designation: String(r.designation || ""),
        joinDate: String(r.joinDate || ""),
        monthlySalary: Number(r.monthlySalary || 0),
        monthlyAllowance: Number(r.monthlyAllowance || 0),
        classTeacherClass: String(r.classTeacherClass || ""),
        classTeacherSection: String(r.classTeacherSection || ""),
        teachingClasses: Array.isArray(r.teachingClasses) ? r.teachingClasses : [],
        teachingAssignments: Array.isArray(r.teachingAssignments) ? r.teachingAssignments : [],
        salaryHistory: Array.isArray(r.salaryHistory) ? r.salaryHistory : [],
        additionalSubjects: Array.isArray(r.additionalSubjects) ? r.additionalSubjects : [],
        subjects: Array.isArray(r.subjects) ? r.subjects : [],
        email: String(r.email || ""),
        bloodGroup: String(r.bloodGroup || ""),
        address: String(r.address || ""),
        status: String(r.status || "\u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC")
      };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await client.from("office_docs").upsert(
      {
        id: "__teacher_profiles_v1__",
        title: "Teacher Extended Profiles",
        category: "__system_teacher_meta__",
        doc_date: now.slice(0, 10),
        note: JSON.stringify(cur),
        updated_at: now
      },
      { onConflict: "id" }
    );
  } catch {
  }
}
function mergeTeacherRow(r, meta, includeSalary) {
  const m = meta || {};
  const teachingClasses = Array.isArray(r.teaching_classes) && r.teaching_classes.length ? r.teaching_classes : Array.isArray(m.teachingClasses) ? m.teachingClasses : [];
  const teachingAssignments = Array.isArray(r.teaching_assignments) && r.teaching_assignments.length ? r.teaching_assignments : Array.isArray(m.teachingAssignments) ? m.teachingAssignments : [];
  const base = {
    id: String(r.id || ""),
    name: String(r.name || ""),
    teacherCode: String(r.teacher_code || m.teacherCode || ""),
    subject: String(r.subject || ""),
    additionalSubjects: Array.isArray(m.additionalSubjects) ? m.additionalSubjects : Array.isArray(r.additional_subjects) ? r.additional_subjects : [],
    subjects: Array.isArray(m.subjects) ? m.subjects : [],
    designation: String(r.designation || m.designation || ""),
    phone: String(r.phone || ""),
    qualification: String(r.qualification || ""),
    joinDate: String(r.join_date || m.joinDate || ""),
    classTeacherClass: String(r.class_teacher_class || m.classTeacherClass || ""),
    classTeacherSection: String(r.class_teacher_section || m.classTeacherSection || ""),
    teachingClasses,
    teachingAssignments,
    bloodGroup: String(r.blood_group || m.bloodGroup || ""),
    status: String(r.status || m.status || "\u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC"),
    photo: String(r.photo || "")
  };
  if (includeSalary) {
    base.email = String(r.email || m.email || "");
    base.address = String(r.address || m.address || "");
    base.monthlySalary = Number(r.monthly_salary || m.monthlySalary || 0);
    base.monthlyAllowance = Number(r.monthly_allowance || m.monthlyAllowance || 0);
    base.salaryHistory = Array.isArray(r.salary_history) && r.salary_history.length ? r.salary_history : Array.isArray(m.salaryHistory) ? m.salaryHistory : [];
  }
  return base;
}

// appServer.ts
loadDotEnvFile(path.resolve(process.cwd(), ".env"));
var ALL_MODULES = [
  "dashboard",
  "students",
  "teachers",
  "classes",
  "attendance",
  "results",
  "fees",
  "notices",
  "routine",
  "library",
  "transport",
  "admissions",
  "media",
  "employees",
  "departments",
  "office-attendance",
  "leaves",
  "payroll",
  "tasks",
  "expenses",
  "student-costs",
  "office-docs",
  "settings"
];
var STAFF_MODULES = [
  "dashboard",
  "students",
  "teachers",
  "classes",
  "attendance",
  "results",
  "notices",
  "routine",
  "library",
  "transport",
  "media"
];
var STUDENT_MODULES = [
  "dashboard",
  "notices",
  "routine",
  "results",
  "library",
  "transport"
];
var MASTER_ADMIN_EMAIL = (process.env.MASTER_ADMIN_EMAIL || "sizu111@gmail.com").trim().toLowerCase();
var AUTH_DATA_DIR = path.resolve(process.cwd(), ".data");
var AUTH_STORE_FILE = path.join(AUTH_DATA_DIR, "master-auth.json");
function readAuthStore() {
  try {
    if (!fs2.existsSync(AUTH_STORE_FILE)) return {};
    const raw = fs2.readFileSync(AUTH_STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeAuthStore(store) {
  fs2.mkdirSync(AUTH_DATA_DIR, { recursive: true });
  fs2.writeFileSync(AUTH_STORE_FILE, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    mode: 384
  });
}
var initialStore = readAuthStore();
var SESSION_SECRET = process.env.SESSION_SECRET || (typeof initialStore.sessionSecret === "string" && initialStore.sessionSecret.length >= 32 ? initialStore.sessionSecret : crypto2.randomBytes(32).toString("hex"));
var TOKEN_TTL_MS = 12 * 60 * 60 * 1e3;
var claimedMaster = typeof initialStore.email === "string" && initialStore.email.trim().toLowerCase() === MASTER_ADMIN_EMAIL && typeof initialStore.salt === "string" && typeof initialStore.hash === "string" && initialStore.salt && initialStore.hash ? {
  email: MASTER_ADMIN_EMAIL,
  salt: initialStore.salt,
  hash: initialStore.hash
} : null;
var revokedTokens = /* @__PURE__ */ new Set();
function getEnvMasterPassword() {
  return (process.env.MASTER_ADMIN_PASSWORD || "").trim();
}
async function resolveClaimedMaster() {
  if (claimedMaster) return claimedMaster;
  const store = readAuthStore();
  if (typeof store.email === "string" && store.email.trim().toLowerCase() === MASTER_ADMIN_EMAIL && typeof store.salt === "string" && typeof store.hash === "string" && store.salt && store.hash) {
    claimedMaster = {
      email: MASTER_ADMIN_EMAIL,
      salt: store.salt,
      hash: store.hash
    };
    return claimedMaster;
  }
  const fromDb = await loadMasterAuthFromSupabase(MASTER_ADMIN_EMAIL);
  if (fromDb) {
    claimedMaster = fromDb;
    try {
      writeAuthStore({
        email: fromDb.email,
        salt: fromDb.salt,
        hash: fromDb.hash,
        sessionSecret: SESSION_SECRET,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch {
    }
    return claimedMaster;
  }
  return null;
}
function hashPassword(password) {
  const salt = crypto2.randomBytes(16).toString("hex");
  const hash = crypto2.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyScryptPassword(password, salt, expectedHashHex) {
  const derived = crypto2.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHashHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto2.timingSafeEqual(derived, expected);
}
function verifyConstantTimeString(candidate, expected) {
  const a = crypto2.createHash("sha256").update(candidate, "utf8").digest();
  const b = crypto2.createHash("sha256").update(expected, "utf8").digest();
  return crypto2.timingSafeEqual(a, b);
}
function signToken(user) {
  const payload = {
    ...user,
    jti: crypto2.randomUUID(),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const sig = crypto2.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto2.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto2.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    );
    if (!parsed || typeof parsed.exp !== "number" || Date.now() > parsed.exp) {
      return null;
    }
    if (!parsed.jti || revokedTokens.has(parsed.jti)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}
function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "\u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u09AA\u09C1\u09A8\u09B0\u09BE\u09AF\u09BC \u09B2\u0997\u0987\u09A8 \u0995\u09B0\u09C1\u09A8\u0964"
    });
  }
  req.authUser = payload;
  next();
}
function createApiApp() {
  const app2 = express();
  const smallJsonParser = express.json({ limit: "256kb" });
  app2.use((req, res, next) => {
    const reqWithFlag = req;
    if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
      reqWithFlag._body = true;
    }
    if (req.path === "/api/school/sync" || req.path === "/api/media/upload") {
      return next();
    }
    return smallJsonParser(req, res, next);
  });
  app2.get("/api/auth/status", async (req, res) => {
    const envPw = getEnvMasterPassword();
    const resolvedMaster = envPw ? null : await resolveClaimedMaster();
    const masterConfigured = Boolean(envPw || resolvedMaster);
    const needsMasterSetup = !masterConfigured;
    const token = extractBearerToken(req);
    const user = token ? verifyToken(token) : null;
    res.json({
      masterAdminEmail: MASTER_ADMIN_EMAIL,
      masterConfigured,
      needsMasterSetup,
      authenticated: Boolean(user),
      user: user ? {
        id: user.id,
        role: user.role,
        year: user.year,
        isSuper: user.isSuper,
        isMasterAdmin: user.isMasterAdmin,
        allowedModules: user.allowedModules,
        via: user.via
      } : null
    });
  });
  app2.post("/api/auth/setup-master", async (req, res) => {
    const envPw = getEnvMasterPassword();
    const existingMaster = envPw ? null : await resolveClaimedMaster();
    if (envPw || existingMaster) {
      return res.status(409).json({
        error: "ALREADY_CONFIGURED",
        message: "\u09AE\u09BE\u09B8\u09CD\u099F\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u0987\u09A4\u09BF\u09AE\u09A7\u09CD\u09AF\u09C7\u0987 \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u0986\u099B\u09C7\u0964"
      });
    }
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (email !== MASTER_ADMIN_EMAIL) {
      return res.status(400).json({
        error: "INVALID_MASTER_ID",
        message: `\u09AE\u09BE\u09B8\u09CD\u099F\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u0986\u0987\u09A1\u09BF \u0985\u09AC\u09B6\u09CD\u09AF\u0987 ${MASTER_ADMIN_EMAIL} \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964`
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        error: "WEAK_PASSWORD",
        message: "\u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u09EC \u0985\u0995\u09CD\u09B7\u09B0\u09C7\u09B0 \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964"
      });
    }
    const { salt, hash } = hashPassword(password);
    const nextMaster = { email: MASTER_ADMIN_EMAIL, salt, hash };
    claimedMaster = nextMaster;
    let savedLocal = false;
    try {
      writeAuthStore({
        email: MASTER_ADMIN_EMAIL,
        salt,
        hash,
        sessionSecret: SESSION_SECRET,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      savedLocal = true;
    } catch {
    }
    const savedDb = await saveMasterAuthToSupabase(nextMaster);
    if (!savedLocal && !savedDb) {
      claimedMaster = null;
      return res.status(500).json({
        error: "PERSISTENCE_ERROR",
        message: "\u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964 Supabase \u0993 Environment Variables \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C1\u09A8\u0964"
      });
    }
    const user = {
      id: MASTER_ADMIN_EMAIL,
      role: "master",
      isSuper: true,
      isMasterAdmin: true,
      allowedModules: ALL_MODULES,
      via: "master"
    };
    const token = signToken(user);
    return res.json({ token, user });
  });
  app2.post("/api/auth/login", async (req, res) => {
    const rawRole = typeof req.body?.role === "string" ? req.body.role.trim() : "";
    const rawId = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const year = typeof req.body?.year === "string" ? req.body.year.trim() : "\u09E8\u09E6\u09E8\u09EC";
    if (!rawId || !password) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "\u0987\u0989\u099C\u09BE\u09B0 \u0986\u0987\u09A1\u09BF \u0993 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u0989\u09AD\u09AF\u09BC\u0987 \u09A6\u09BF\u09A8\u0964"
      });
    }
    const normalizedId = rawId.toLowerCase();
    const isMasterAttempt = rawRole === "master" || normalizedId === MASTER_ADMIN_EMAIL;
    if (isMasterAttempt) {
      if (normalizedId !== MASTER_ADMIN_EMAIL) {
        return res.status(401).json({
          error: "INVALID_CREDENTIALS",
          message: "\u09AE\u09BE\u09B8\u09CD\u099F\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u0986\u0987\u09A1\u09BF \u09AC\u09BE \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964"
        });
      }
      const envPw = getEnvMasterPassword();
      const resolvedMaster = envPw ? null : await resolveClaimedMaster();
      if (!envPw && !resolvedMaster) {
        return res.status(409).json({
          error: "MASTER_SETUP_REQUIRED",
          needsMasterSetup: true,
          message: "\u09AA\u09CD\u09B0\u09A5\u09AE\u09C7 \u09AE\u09BE\u09B8\u09CD\u099F\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09C7\u099F\u0986\u09AA \u0995\u09B0\u09C1\u09A8\u0964"
        });
      }
      const isValid = envPw ? verifyConstantTimeString(password, envPw) : verifyScryptPassword(
        password,
        resolvedMaster.salt,
        resolvedMaster.hash
      );
      if (!isValid) {
        return res.status(401).json({
          error: "INVALID_CREDENTIALS",
          message: "\u09AE\u09BE\u09B8\u09CD\u099F\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u0986\u0987\u09A1\u09BF \u09AC\u09BE \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964"
        });
      }
      const user = {
        id: MASTER_ADMIN_EMAIL,
        role: "master",
        isSuper: true,
        isMasterAdmin: true,
        allowedModules: ALL_MODULES,
        via: "master"
      };
      const token = signToken(user);
      return res.json({ token, user });
    }
    if (rawRole === "admin") {
      const user = {
        id: rawId,
        role: "admin",
        isSuper: false,
        isMasterAdmin: false,
        allowedModules: STAFF_MODULES,
        via: "demo"
      };
      const token = signToken(user);
      return res.json({ token, user });
    }
    if (rawRole === "student") {
      const user = {
        id: rawId,
        role: "student",
        year,
        isSuper: false,
        isMasterAdmin: false,
        allowedModules: STUDENT_MODULES,
        via: "demo"
      };
      const token = signToken(user);
      return res.json({ token, user });
    }
    return res.status(400).json({
      error: "INVALID_ROLE",
      message: "\u0985\u09AC\u09C8\u09A7 \u09AD\u09C2\u09AE\u09BF\u0995\u09BE \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964"
    });
  });
  app2.get("/api/auth/me", requireAuth, (req, res) => {
    const u = req.authUser;
    res.json({
      user: {
        id: u.id,
        role: u.role,
        year: u.year,
        isSuper: u.isSuper,
        isMasterAdmin: u.isMasterAdmin,
        allowedModules: u.allowedModules,
        via: u.via
      }
    });
  });
  app2.post("/api/auth/logout", (req, res) => {
    const token = extractBearerToken(req);
    const payload = token ? verifyToken(token) : null;
    if (payload?.jti) {
      revokedTokens.add(payload.jti);
    }
    res.json({ ok: true });
  });
  app2.get("/api/console/access", requireAuth, (req, res) => {
    const u = req.authUser;
    res.json({
      isMasterAdmin: u.isMasterAdmin,
      allowedModules: u.allowedModules
    });
  });
  app2.get("/api/school/status", async (_req, res) => {
    const status = await getSupabaseStatus();
    res.json(status);
  });
  app2.get("/api/school/public", async (_req, res) => {
    const snap = await loadPublicSnapshot();
    res.json(snap);
  });
  app2.post("/api/school/admissions", async (req, res) => {
    const b = req.body || {};
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const cls = typeof b.cls === "string" ? b.cls.trim() : "";
    const guardian = typeof b.guardian === "string" ? b.guardian.trim() : "";
    const phone = typeof b.phone === "string" ? b.phone.trim() : "";
    if (!name || !cls || !guardian || !phone) {
      return res.status(400).json({
        ok: false,
        message: "\u09B6\u09BF\u0995\u09CD\u09B7\u09BE\u09B0\u09CD\u09A5\u09C0\u09B0 \u09A8\u09BE\u09AE, \u09B6\u09CD\u09B0\u09C7\u09A3\u09BF, \u0985\u09AD\u09BF\u09AD\u09BE\u09AC\u0995\u09C7\u09B0 \u09A8\u09BE\u09AE \u0993 \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u0986\u09AC\u09B6\u09CD\u09AF\u0995\u0964"
      });
    }
    const result = await createPublicAdmissionInSupabase({
      id: typeof b.id === "string" ? b.id : void 0,
      name,
      cls,
      section: typeof b.section === "string" ? b.section : "\u0995",
      guardian,
      phone,
      address: typeof b.address === "string" ? b.address : "",
      date: typeof b.date === "string" ? b.date : void 0
    });
    if (!result.ok) {
      return res.status(result.schemaReady ? 500 : 503).json(result);
    }
    return res.json(result);
  });
  app2.get(
    "/api/school/bootstrap",
    requireAuth,
    async (req, res) => {
      const u = req.authUser;
      const includeOfficeSensitive = Boolean(
        u.isMasterAdmin || u.role === "master" || u.role === "admin"
      );
      const snap = await loadFullSnapshot(includeOfficeSensitive);
      res.json(snap);
    }
  );
  app2.post(
    "/api/school/sync",
    requireAuth,
    express.json({ limit: "15mb" }),
    async (req, res) => {
      const u = req.authUser;
      if (u.role === "student") {
        return res.status(403).json({
          ok: false,
          message: "\u09B6\u09BF\u0995\u09CD\u09B7\u09BE\u09B0\u09CD\u09A5\u09C0 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u09A5\u09C7\u0995\u09C7 \u09A1\u09C7\u099F\u09BE \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC\u0964"
        });
      }
      const changes = req.body?.changes && typeof req.body.changes === "object" ? req.body.changes : {};
      const removals = req.body?.removals && typeof req.body.removals === "object" ? req.body.removals : {};
      const result = await syncSlicesToSupabase(changes, removals, {
        isMaster: Boolean(u.isMasterAdmin || u.role === "master")
      });
      if (!result.ok) {
        return res.status(result.schemaReady ? 500 : 503).json(result);
      }
      return res.json(result);
    }
  );
  app2.post(
    "/api/media/upload",
    requireAuth,
    express.json({ limit: "60mb" }),
    async (req, res) => {
      const u = req.authUser;
      if (u.role === "student") {
        return res.status(403).json({
          ok: false,
          message: "\u09AB\u099F\u09CB \u09AC\u09BE \u09AD\u09BF\u09A1\u09BF\u0993 \u0986\u09AA\u09B2\u09CB\u09A1\u09C7\u09B0 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A8\u09C7\u0987\u0964"
        });
      }
      const b = req.body || {};
      if (typeof b.base64Data !== "string" || !b.base64Data) {
        return res.status(400).json({ ok: false, error: "\u09AB\u09BE\u0987\u09B2 \u09A1\u09C7\u099F\u09BE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
      }
      const result = await uploadMediaToSupabase({
        base64Data: b.base64Data,
        mimeType: typeof b.mimeType === "string" ? b.mimeType : "",
        title: typeof b.title === "string" ? b.title : void 0,
        category: typeof b.category === "string" ? b.category : void 0,
        description: typeof b.description === "string" ? b.description : void 0,
        saveToGallery: b.saveToGallery !== false
      });
      if (!result.ok) {
        return res.status(result.status || 500).json(result);
      }
      return res.json(result);
    }
  );
  app2.delete(
    "/api/media/:id",
    requireAuth,
    async (req, res) => {
      const u = req.authUser;
      if (u.role === "student") {
        return res.status(403).json({
          ok: false,
          message: "\u09AE\u09BF\u09A1\u09BF\u09AF\u09BC\u09BE \u09AE\u09CB\u099B\u09BE\u09B0 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A8\u09C7\u0987\u0964"
        });
      }
      const result = await deleteMediaFromSupabase(String(req.params.id || ""));
      if (!result.ok) {
        return res.status(500).json(result);
      }
      return res.json(result);
    }
  );
  app2.get("/api/school/events", (_req, res) => {
    if (process.env.VERCEL) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.write(
        `retry: 30000
event: connected
data: ${JSON.stringify({
          realtimeConnected: true,
          serverless: true,
          ts: Date.now()
        })}

`
      );
      res.end();
      return;
    }
    registerSseClient(res);
  });
  return app2;
}

// api/_handler.ts
var app = createApiApp();
var handler_default = app;
export {
  handler_default as default
};
