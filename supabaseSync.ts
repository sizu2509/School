import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import type { Response as ExpressResponse } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export function loadDotEnvFile(envFilePath: string): void {
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
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore .env parse errors gracefully
  }
}

const STORAGE_BUCKET = "school-media";
const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MEDIA_MIME: Record<string, { ext: string; type: "photo" | "video" }> = {
  "image/jpeg": { ext: "jpg", type: "photo" },
  "image/jpg": { ext: "jpg", type: "photo" },
  "image/png": { ext: "png", type: "photo" },
  "image/webp": { ext: "webp", type: "photo" },
  "image/gif": { ext: "gif", type: "photo" },
  "video/mp4": { ext: "mp4", type: "video" },
  "video/webm": { ext: "webm", type: "video" },
  "video/ogg": { ext: "ogv", type: "video" },
  "video/quicktime": { ext: "mov", type: "video" },
};

let cachedClient: SupabaseClient | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let realtimeConnected = false;
const sseClients = new Set<ExpressResponse>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function getSupabaseConfig(): { url: string; key: string; configured: boolean } {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  ).trim();
  return {
    url,
    key,
    configured: Boolean(url && key),
  };
}

export function getSupabaseClient(): SupabaseClient | null {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) return null;
  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 5,
        },
      },
    });
  }
  return cachedClient;
}

export function isSchemaMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; hint?: string };
  const code = String(e.code || "");
  const msg = String(e.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

async function fetchAllRows<T = Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  selectCols = "*",
  orderCol = "id"
): Promise<{ rows: T[]; error: unknown }> {
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    let q = client.from(table).select(selectCols).range(from, from + pageSize - 1);
    if (orderCol) {
      q = q.order(orderCol, { ascending: true });
    }
    const { data, error } = await q;
    if (error) return { rows: all, error };
    const chunk = (data || []) as T[];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return { rows: all, error: null };
}

async function upsertInChunks(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunkSize = 500
): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client.from(table).upsert(chunk, { onConflict: "id" });
    if (error) throw error;
  }
}

async function deleteIdsInChunks(
  client: SupabaseClient,
  table: string,
  ids: string[],
  chunkSize = 200
): Promise<void> {
  const cleanIds = ids.map((x) => String(x || "").trim()).filter(Boolean);
  if (!cleanIds.length) return;
  for (let i = 0; i < cleanIds.length; i += chunkSize) {
    const chunk = cleanIds.slice(i, i + chunkSize);
    const { error } = await client.from(table).delete().in("id", chunk);
    if (error) throw error;
  }
}

function mapSettingsFromDb(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    name: String(row.name || "আমার স্কুল"),
    motto: String(row.motto || "জ্ঞানেই আলো, চরিত্রেই শক্তি"),
    established: String(row.established || ""),
    address: String(row.address || "মেইন রোড, সদর উপজেলা"),
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
    ig: String(row.ig || ""),
  };
}

function mapSettingsToDb(s: Record<string, unknown>) {
  return {
    id: "main",
    name: String(s.name || "আমার স্কুল"),
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
    updated_at: new Date().toISOString(),
  };
}

function assembleClassesFromDb(
  classesRows: Record<string, unknown>[],
  sectionRows: Record<string, unknown>[],
  boardBookRows: Record<string, unknown>[],
  extraActRows: Record<string, unknown>[]
) {
  const secByCls = new Map<string, Record<string, unknown>[]>();
  for (const r of sectionRows) {
    const cid = String(r.class_id || "");
    if (!cid) continue;
    if (!secByCls.has(cid)) secByCls.set(cid, []);
    secByCls.get(cid)!.push(r);
  }
  const bbByCls = new Map<string, Record<string, unknown>[]>();
  for (const r of boardBookRows) {
    const cid = String(r.class_id || "");
    if (!cid) continue;
    if (!bbByCls.has(cid)) bbByCls.set(cid, []);
    bbByCls.get(cid)!.push(r);
  }
  const eaByCls = new Map<string, Record<string, unknown>[]>();
  for (const r of extraActRows) {
    const cid = String(r.class_id || "");
    if (!cid) continue;
    if (!eaByCls.has(cid)) eaByCls.set(cid, []);
    eaByCls.get(cid)!.push(r);
  }

  return classesRows
    .slice()
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
    .map((c) => {
      const cid = String(c.id || "");
      const secs = (secByCls.get(cid) || [])
        .slice()
        .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))
        .map((s) => {
          const item: Record<string, unknown> = {
            name: String(s.section_name || ""),
            room: String(s.room_no || ""),
            capacity: Number(s.seat_capacity || 0),
          };
          if (Array.isArray(s.subjects)) {
            item.subjects = s.subjects;
          }
          return item;
        });

      const bbooks = (bbByCls.get(cid) || [])
        .slice()
        .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
        .map((b) => ({
          group: String(b.book_group || "সাধারণ"),
          title: String(b.title || ""),
        }));

      let extraActivities: string[] = [];
      if (Array.isArray(c.extra_activities) && c.extra_activities.length > 0) {
        extraActivities = c.extra_activities.map((x) => String(x || "")).filter(Boolean);
      } else {
        extraActivities = (eaByCls.get(cid) || [])
          .slice()
          .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
          .map((e) => String(e.title || ""))
          .filter(Boolean);
      }

      return {
        id: cid,
        name: String(c.name || ""),
        sections: secs.length
          ? secs.map((s) => s.name).join(", ")
          : String(c.sections || ""),
        room: secs.length
          ? secs.map((s) => s.room).join(", ")
          : String(c.room || ""),
        capacity: secs.length
          ? secs.reduce((sum, s) => sum + Number(s.capacity || 0), 0)
          : Number(c.capacity || 0),
        sectionDetails: secs.length ? secs : undefined,
        boardBooks: bbooks.length ? bbooks : undefined,
        extraActivities,
      };
    });
}

function mapMediaFromDb(r: Record<string, unknown>) {
  return {
    id: String(r.id || ""),
    title: String(r.title || ""),
    mediaType: r.media_type === "video" ? "video" : "photo",
    category: String(r.category || "গ্যালারি"),
    fileUrl: String(r.file_url || ""),
    storagePath: String(r.storage_path || ""),
    description: String(r.description || ""),
    createdAt: String(r.created_at || ""),
  };
}

export async function getSupabaseStatus() {
  const cfg = getSupabaseConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      schemaReady: false,
      storageReady: false,
      realtimeConnected: false,
      studentCount: 0,
      mediaCount: 0,
      message: "SUPABASE_URL বা SUPABASE_PUBLISHABLE_KEY সেট করা নেই।",
    };
  }
  const client = getSupabaseClient()!;
  let schemaReady = false;
  let studentCount = 0;
  let mediaCount = 0;
  let storageReady = false;
  let message = "Supabase সংযুক্ত আছে।";

  try {
    const [settingsRes, studentsRes, mediaRes] = await Promise.all([
      client.from("school_settings").select("id", { count: "exact" }).limit(1),
      client.from("students").select("id", { count: "exact" }).limit(1),
      client.from("school_media").select("id", { count: "exact" }).limit(1),
    ]);

    if (!settingsRes.error && !studentsRes.error && !mediaRes.error) {
      schemaReady = true;
      studentCount = studentsRes.count || 0;
      mediaCount = mediaRes.count || 0;
    } else {
      const firstErr = settingsRes.error || studentsRes.error || mediaRes.error;
      message = isSchemaMissingError(firstErr)
        ? "Supabase-এ সংযোগ আছে, তবে SQL স্কিমা (টেবিলসমূহ) এখনও রান করা হয়নি। supabase.sql চালান।"
        : String(firstErr?.message || "টেবিল যাচাই ব্যর্থ হয়েছে।");
    }
  } catch (err) {
    message = String((err as Error)?.message || "Supabase যাচাই ব্যর্থ হয়েছে।");
  }

  try {
    const { error: stErr } = await client.storage.getBucket(STORAGE_BUCKET);
    storageReady = !stErr;
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
    message,
  };
}

export async function loadPublicSnapshot() {
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
      stuClsRes,
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
      fetchAllRows<{ id: string; cls: string }>(client, "students", "id, cls", "id"),
    ]);

    const possibleErr =
      settingsRes.error ||
      classesRes.error ||
      sectionsRes.error ||
      subjectsRes.error ||
      teachersRes.error ||
      noticesRes.error ||
      mediaRes.error ||
      stuClsRes.error;

    if (possibleErr) {
      return {
        ok: false,
        configured: true,
        schemaReady: !isSchemaMissingError(possibleErr),
        error: String((possibleErr as { message?: string }).message || "Database read error"),
        data: null,
      };
    }

    const classStudentCounts: Record<string, number> = {};
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

    return {
      ok: true,
      configured: true,
      schemaReady: true,
      data: {
        settings: mapSettingsFromDb(settingsRes.data as Record<string, unknown> | null),
        classes,
        subjects: subjectsRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          code: String(r.code || ""),
          classes: String(r.classes || "সব শ্রেণি"),
          group: String(r.book_group || "সাধারণ"),
          section: String(r.section || "সব শাখা"),
        })),
        teachers: teachersRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          subject: String(r.subject || ""),
          phone: String(r.phone || ""),
          qualification: String(r.qualification || ""),
          photo: String(r.photo || ""),
        })),
        notices: noticesRes.rows
          .map((r) => ({
            id: String(r.id || ""),
            title: String(r.title || ""),
            body: String(r.body || ""),
            date: String(r.date || ""),
          }))
          .sort((a, b) => String(b.date).localeCompare(String(a.date))),
        books: booksRes.rows.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          author: String(r.author || ""),
          copies: Number(r.copies || 1),
        })),
        routes: routesRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          vehicle: String(r.vehicle || ""),
          driver: String(r.driver || ""),
          stops: String(r.stops || ""),
        })),
        costTypes: costTypesRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          amount: Number(r.amount || 0),
          isCustom: Boolean(r.is_custom),
        })),
        media: ((mediaRes.data || []) as Record<string, unknown>[]).map(mapMediaFromDb),
        studentCount: stuClsRes.rows.length,
        classStudentCounts,
        issuedLoansCount: loansCountRes.count || 0,
      },
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      schemaReady: !isSchemaMissingError(err),
      error: String((err as Error)?.message || "Unknown read error"),
      data: null,
    };
  }
}

export async function loadFullSnapshot(includeOfficeSensitive: boolean) {
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
      docsRes,
    ] = await Promise.all([
      loadPublicSnapshot(),
      fetchAllRows(client, "students", "*", "id"),
      fetchAllRows(client, "student_costs", "*", "id"),
      fetchAllRows(client, "student_payment_history", "*", "id"),
      fetchAllRows(client, "attendance", "*", "id"),
      fetchAllRows(client, "results", "*", "id"),
      fetchAllRows(client, "book_loans", "*", "id"),
      includeOfficeSensitive
        ? fetchAllRows(client, "admissions", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive
        ? fetchAllRows(client, "departments", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive
        ? fetchAllRows(client, "employees", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive
        ? fetchAllRows(client, "office_attendance", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive
        ? fetchAllRows(client, "leaves", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive
        ? fetchAllRows(client, "payroll", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive
        ? fetchAllRows(client, "tasks", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive
        ? fetchAllRows(client, "expenses", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
      includeOfficeSensitive
        ? fetchAllRows(client, "office_docs", "*", "id")
        : Promise.resolve({ rows: [], error: null }),
    ]);

    if (!pub.ok || !pub.data) return pub;

    const firstErr =
      studentsRes.error ||
      studentCostsRes.error ||
      payHistoryRes.error ||
      attRes.error ||
      resultsRes.error ||
      loansRes.error ||
      admissionsRes.error ||
      empsRes.error;

    if (firstErr) {
      return {
        ok: false,
        configured: true,
        schemaReady: !isSchemaMissingError(firstErr),
        error: String((firstErr as { message?: string }).message || "Snapshot error"),
        data: null,
      };
    }

    const attendance: Record<string, Record<string, string>> = {};
    const attendanceTimes: Record<string, string> = {};
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

    const results: Record<string, Record<string, unknown>> = {};
    for (const r of resultsRes.rows) {
      const sid = String(r.student_id || "");
      if (sid && r.marks && typeof r.marks === "object") {
        results[sid] = r.marks as Record<string, unknown>;
      }
    }

    const officeAttendance: Record<string, Record<string, string>> = {};
    for (const r of officeAttRes.rows) {
      const dt = String(r.att_date || "");
      const eid = String(r.emp_id || "");
      if (dt && eid) {
        if (!officeAttendance[dt]) officeAttendance[dt] = {};
        officeAttendance[dt][eid] = String(r.status || "P");
      }
    }

    return {
      ok: true,
      configured: true,
      schemaReady: true,
      data: {
        ...pub.data,
        students: studentsRes.rows
          .map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            cls: String(r.cls || ""),
            roll: Number(r.roll || 0),
            section: String(r.section || "ক"),
            guardian: String(r.guardian || ""),
            phone: String(r.phone || ""),
            payable: Number(r.payable || 0),
            paid: Number(r.paid || 0),
            photo: String(r.photo || ""),
            admissionDate: String(r.admission_date || ""),
          }))
          .sort((a, b) => a.roll - b.roll),
        studentCosts: studentCostsRes.rows.map((r) => ({
          id: String(r.id || ""),
          studentId: String(r.student_id || ""),
          costTypeId: String(r.cost_type_id || ""),
          name: String(r.name || ""),
          amount: Number(r.amount || 0),
          paid: Number(r.paid || 0),
        })),
        paymentHistory: payHistoryRes.rows
          .map((r) => ({
            id: String(r.id || ""),
            studentId: String(r.student_id || ""),
            date: String(r.pay_date || ""),
            time: String(r.pay_time || ""),
            head: String(r.head || ""),
            amount: Number(r.amount || 0),
            note: String(r.note || ""),
          }))
          .reverse(),
        attendance,
        attendanceTimes,
        results,
        loans: loansRes.rows.map((r) => ({
          id: String(r.id || ""),
          bookId: String(r.book_id || ""),
          studentId: String(r.student_id || ""),
          date: String(r.loan_date || ""),
          returned: Boolean(r.returned),
        })),
        admissions: admissionsRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          cls: String(r.cls || ""),
          section: String(r.section || "ক"),
          guardian: String(r.guardian || ""),
          phone: String(r.phone || ""),
          address: String(r.address || ""),
          status: String(r.status || "pending"),
          date: String(r.apply_date || ""),
        })),
        departments: deptsRes.rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          head: String(r.head || ""),
          note: String(r.note || ""),
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
          status: String(r.status || "সক্রিয়"),
        })),
        officeAttendance,
        leaves: leavesRes.rows.map((r) => ({
          id: String(r.id || ""),
          empId: String(r.emp_id || ""),
          type: String(r.type || ""),
          from: String(r.from_date || ""),
          to: String(r.to_date || ""),
          reason: String(r.reason || ""),
          status: String(r.status || "pending"),
        })),
        payroll: payrollRes.rows.map((r) => ({
          id: String(r.id || ""),
          empId: String(r.emp_id || ""),
          month: String(r.month || ""),
          basic: Number(r.basic || 0),
          allowance: Number(r.allowance || 0),
          deduction: Number(r.deduction || 0),
        })),
        tasks: tasksRes.rows.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          empId: String(r.emp_id || ""),
          due: String(r.due || ""),
          priority: String(r.priority || "মাঝারি"),
          status: String(r.status || "চলমান"),
        })),
        expenses: expensesRes.rows.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          category: String(r.category || ""),
          amount: Number(r.amount || 0),
          date: String(r.exp_date || ""),
          note: String(r.note || ""),
        })),
        officeDocs: docsRes.rows.map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          category: String(r.category || ""),
          date: String(r.doc_date || ""),
          note: String(r.note || ""),
        })),
      },
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      schemaReady: !isSchemaMissingError(err),
      error: String((err as Error)?.message || "Full snapshot load failed"),
      data: null,
    };
  }
}

export async function syncSlicesToSupabase(
  changes: Record<string, unknown>,
  removals: Record<string, string[]>,
  options: { isMaster: boolean }
) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, schemaReady: false, error: "Supabase কনফিগার করা নেই।" };
  }

  const now = new Date().toISOString();
  const touchedTables: string[] = [];

  try {
    // ১. স্কুল সেটিংস (শুধু মাস্টার অ্যাডমিন)
    if (options.isMaster && changes.settings && typeof changes.settings === "object") {
      await upsertInChunks(client, "school_settings", [
        mapSettingsToDb(changes.settings as Record<string, unknown>),
      ]);
      touchedTables.push("school_settings");
    }

    // ২. শ্রেণি ও শাখা ও বোর্ড বই ও এক্সট্রা অ্যাকটিভিটিস
    if (Array.isArray(removals.classes) && removals.classes.length) {
      await deleteIdsInChunks(client, "classes", removals.classes);
      touchedTables.push("classes");
    }
    if (Array.isArray(changes.classes)) {
      const clsList = changes.classes as Record<string, unknown>[];
      const clsRows = clsList.map((c, idx) => ({
        id: String(c.id || `cls-${idx + 1}`),
        name: String(c.name || ""),
        display_order: idx + 1,
        sections: String(c.sections || ""),
        room: String(c.room || ""),
        capacity: Number(c.capacity || 0),
        extra_activities: Array.isArray(c.extraActivities) ? c.extraActivities : [],
        updated_at: now,
      }));
      await upsertInChunks(client, "classes", clsRows);

      const touchedClassIds = clsRows.map((c) => c.id);
      if (touchedClassIds.length) {
        // Delete child rows for touched classes to avoid unique constraint conflicts on renames
        await client.from("class_sections").delete().in("class_id", touchedClassIds);
        await client.from("board_books").delete().in("class_id", touchedClassIds);
        await client.from("class_extra_activities").delete().in("class_id", touchedClassIds);

        const secRows: Record<string, unknown>[] = [];
        const bbRows: Record<string, unknown>[] = [];
        const eaRows: Record<string, unknown>[] = [];

        clsList.forEach((c, idx) => {
          const cid = String(c.id || `cls-${idx + 1}`);
          const cname = String(c.name || "");
          const secDetails = Array.isArray(c.sectionDetails)
            ? (c.sectionDetails as Record<string, unknown>[])
            : [];
          secDetails.forEach((sec, sIdx) => {
            secRows.push({
              id: `${cid}-sec-${sIdx + 1}`,
              class_id: cid,
              section_name: String(sec.name || ""),
              room_no: String(sec.room || ""),
              seat_capacity: Number(sec.capacity || 0),
              subjects: Array.isArray(sec.subjects) ? sec.subjects : null,
              updated_at: now,
            });
          });

          const bbooks = Array.isArray(c.boardBooks)
            ? (c.boardBooks as Record<string, unknown>[])
            : [];
          const seenBookKey = new Set<string>();
          bbooks.forEach((b, bIdx) => {
            const grp = String(b.group || "সাধারণ");
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
              updated_at: now,
            });
          });

          const acts = Array.isArray(c.extraActivities) ? (c.extraActivities as unknown[]) : [];
          const seenAct = new Set<string>();
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
              updated_at: now,
            });
          });
        });

        await upsertInChunks(client, "class_sections", secRows);
        await upsertInChunks(client, "board_books", bbRows);
        await upsertInChunks(client, "class_extra_activities", eaRows);
      }
      touchedTables.push("classes", "class_sections", "board_books", "class_extra_activities");
    }

    // ৩. বিষয়
    if (Array.isArray(removals.subjects) && removals.subjects.length) {
      await deleteIdsInChunks(client, "subjects", removals.subjects);
      touchedTables.push("subjects");
    }
    if (Array.isArray(changes.subjects)) {
      await upsertInChunks(
        client,
        "subjects",
        (changes.subjects as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          code: String(r.code || ""),
          classes: String(r.classes || "সব শ্রেণি"),
          book_group: String(r.group || "সাধারণ"),
          section: String(r.section || "সব শাখা"),
          updated_at: now,
        }))
      );
      touchedTables.push("subjects");
    }

    // ৪. খরচের ধরন (Master)
    if (options.isMaster) {
      if (Array.isArray(removals.costTypes) && removals.costTypes.length) {
        await deleteIdsInChunks(client, "cost_types", removals.costTypes);
        touchedTables.push("cost_types");
      }
      if (Array.isArray(changes.costTypes)) {
        await upsertInChunks(
          client,
          "cost_types",
          (changes.costTypes as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            amount: Number(r.amount || 0),
            is_custom: Boolean(r.isCustom),
            updated_at: now,
          }))
        );
        touchedTables.push("cost_types");
      }
    }

    // ৫. শিক্ষার্থী (Deletion order: costs/history first or cascade handles it)
    if (Array.isArray(removals.students) && removals.students.length) {
      await deleteIdsInChunks(client, "students", removals.students);
      touchedTables.push("students");
    }
    if (Array.isArray(changes.students)) {
      await upsertInChunks(
        client,
        "students",
        (changes.students as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          cls: String(r.cls || ""),
          roll: Number(r.roll || 0),
          section: String(r.section || "ক"),
          guardian: String(r.guardian || ""),
          phone: String(r.phone || ""),
          payable: Number(r.payable || 0),
          paid: Number(r.paid || 0),
          photo: String(r.photo || ""),
          admission_date: String(r.admissionDate || ""),
          updated_at: now,
        }))
      );
      touchedTables.push("students");
    }

    // ৬. শিক্ষার্থীর বার্ষিক খরচ
    if (Array.isArray(removals.studentCosts) && removals.studentCosts.length) {
      await deleteIdsInChunks(client, "student_costs", removals.studentCosts);
      touchedTables.push("student_costs");
    }
    if (Array.isArray(changes.studentCosts)) {
      await upsertInChunks(
        client,
        "student_costs",
        (changes.studentCosts as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          student_id: String(r.studentId || ""),
          cost_type_id: String(r.costTypeId || ""),
          name: String(r.name || ""),
          amount: Number(r.amount || 0),
          paid: Number(r.paid || 0),
          updated_at: now,
        }))
      );
      touchedTables.push("student_costs");
    }

    // ৭. শিক্ষার্থীর পেমেন্ট হিস্টোরি
    if (Array.isArray(removals.paymentHistory) && removals.paymentHistory.length) {
      await deleteIdsInChunks(client, "student_payment_history", removals.paymentHistory);
      touchedTables.push("student_payment_history");
    }
    if (Array.isArray(changes.paymentHistory)) {
      await upsertInChunks(
        client,
        "student_payment_history",
        (changes.paymentHistory as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          student_id: String(r.studentId || ""),
          pay_date: String(r.date || ""),
          pay_time: String(r.time || ""),
          head: String(r.head || ""),
          amount: Number(r.amount || 0),
          note: String(r.note || ""),
          updated_at: now,
        }))
      );
      touchedTables.push("student_payment_history");
    }

    // ৮. শিক্ষক, নোটিশ, লাইব্রেরি, পরিবহন
    if (Array.isArray(removals.teachers) && removals.teachers.length) {
      await deleteIdsInChunks(client, "teachers", removals.teachers);
      touchedTables.push("teachers");
    }
    if (Array.isArray(changes.teachers)) {
      await upsertInChunks(
        client,
        "teachers",
        (changes.teachers as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          subject: String(r.subject || ""),
          phone: String(r.phone || ""),
          qualification: String(r.qualification || ""),
          photo: String(r.photo || ""),
          updated_at: now,
        }))
      );
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
        (changes.notices as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          body: String(r.body || ""),
          date: String(r.date || ""),
          updated_at: now,
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
        (changes.books as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          author: String(r.author || ""),
          copies: Number(r.copies || 1),
          updated_at: now,
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
        (changes.loans as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          book_id: String(r.bookId || ""),
          student_id: String(r.studentId || ""),
          loan_date: String(r.date || ""),
          returned: Boolean(r.returned),
          updated_at: now,
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
        (changes.routes as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          vehicle: String(r.vehicle || ""),
          driver: String(r.driver || ""),
          stops: String(r.stops || ""),
          updated_at: now,
        }))
      );
      touchedTables.push("transport_routes");
    }

    // ৯. মিডিয়া মেটাডাটা
    if (Array.isArray(removals.media) && removals.media.length) {
      await deleteIdsInChunks(client, "school_media", removals.media);
      touchedTables.push("school_media");
    }
    if (Array.isArray(changes.media)) {
      await upsertInChunks(
        client,
        "school_media",
        (changes.media as Record<string, unknown>[]).map((r) => ({
          id: String(r.id || ""),
          title: String(r.title || ""),
          media_type: r.mediaType === "video" ? "video" : "photo",
          category: String(r.category || "গ্যালারি"),
          file_url: String(r.fileUrl || ""),
          storage_path: String(r.storagePath || ""),
          description: String(r.description || ""),
          updated_at: now,
        }))
      );
      touchedTables.push("school_media");
    }

    // ১০. হাজিরা ও ফলাফল
    if (changes.attendance && typeof changes.attendance === "object") {
      const attObj = changes.attendance as Record<string, Record<string, string>>;
      const timesObj = (changes.attendanceTimes && typeof changes.attendanceTimes === "object"
        ? changes.attendanceTimes
        : {}) as Record<string, string>;
      const attRows: Record<string, unknown>[] = [];
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
            updated_at: now,
          });
        }
      }
      await upsertInChunks(client, "attendance", attRows);
      touchedTables.push("attendance");
    }

    if (changes.results && typeof changes.results === "object") {
      const resObj = changes.results as Record<string, Record<string, unknown>>;
      const resRows = Object.entries(resObj).map(([sid, marks]) => ({
        id: `res-${sid}`,
        student_id: sid,
        marks: marks || {},
        updated_at: now,
      }));
      await upsertInChunks(client, "results", resRows);
      touchedTables.push("results");
    }

    // ১১. ভর্তি ও অফিস মডিউল (মাস্টার অ্যাডমিন)
    if (options.isMaster) {
      if (Array.isArray(removals.admissions) && removals.admissions.length) {
        await deleteIdsInChunks(client, "admissions", removals.admissions);
        touchedTables.push("admissions");
      }
      if (Array.isArray(changes.admissions)) {
        await upsertInChunks(
          client,
          "admissions",
          (changes.admissions as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            cls: String(r.cls || ""),
            section: String(r.section || "ক"),
            guardian: String(r.guardian || ""),
            phone: String(r.phone || ""),
            address: String(r.address || ""),
            status: String(r.status || "pending"),
            apply_date: String(r.date || ""),
            updated_at: now,
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
          (changes.departments as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            head: String(r.head || ""),
            note: String(r.note || ""),
            updated_at: now,
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
          (changes.employees as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            name: String(r.name || ""),
            dept: String(r.dept || ""),
            designation: String(r.designation || ""),
            phone: String(r.phone || ""),
            email: String(r.email || ""),
            salary: Number(r.salary || 0),
            join_date: String(r.joinDate || ""),
            status: String(r.status || "সক্রিয়"),
            updated_at: now,
          }))
        );
        touchedTables.push("employees");
      }

      if (changes.officeAttendance && typeof changes.officeAttendance === "object") {
        const oa = changes.officeAttendance as Record<string, Record<string, string>>;
        const rows: Record<string, unknown>[] = [];
        for (const [dt, empMap] of Object.entries(oa)) {
          if (!empMap || typeof empMap !== "object") continue;
          for (const [eid, st] of Object.entries(empMap)) {
            rows.push({
              id: `${dt}|${eid}`,
              att_date: dt,
              emp_id: eid,
              status: String(st || "P"),
              updated_at: now,
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
          (changes.leaves as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            emp_id: String(r.empId || ""),
            type: String(r.type || ""),
            from_date: String(r.from || ""),
            to_date: String(r.to || ""),
            reason: String(r.reason || ""),
            status: String(r.status || "pending"),
            updated_at: now,
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
          (changes.payroll as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            emp_id: String(r.empId || ""),
            month: String(r.month || ""),
            basic: Number(r.basic || 0),
            allowance: Number(r.allowance || 0),
            deduction: Number(r.deduction || 0),
            updated_at: now,
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
          (changes.tasks as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            title: String(r.title || ""),
            emp_id: String(r.empId || ""),
            due: String(r.due || ""),
            priority: String(r.priority || "মাঝারি"),
            status: String(r.status || "চলমান"),
            updated_at: now,
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
          (changes.expenses as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            title: String(r.title || ""),
            category: String(r.category || ""),
            amount: Number(r.amount || 0),
            exp_date: String(r.date || ""),
            note: String(r.note || ""),
            updated_at: now,
          }))
        );
        touchedTables.push("expenses");
      }

      if (Array.isArray(removals.officeDocs) && removals.officeDocs.length) {
        await deleteIdsInChunks(client, "office_docs", removals.officeDocs);
        touchedTables.push("office_docs");
      }
      if (Array.isArray(changes.officeDocs)) {
        await upsertInChunks(
          client,
          "office_docs",
          (changes.officeDocs as Record<string, unknown>[]).map((r) => ({
            id: String(r.id || ""),
            title: String(r.title || ""),
            category: String(r.category || ""),
            doc_date: String(r.date || ""),
            note: String(r.note || ""),
            updated_at: now,
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
      error: schemaMissing
        ? "Supabase-এ টেবিল বা কলাম তৈরি হয়নি। অনুগ্রহ করে supabase.sql চালান।"
        : String((err as { message?: string })?.message || "Sync failed"),
    };
  }
}

export async function createPublicAdmissionInSupabase(record: Record<string, unknown>) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, schemaReady: false, error: "Supabase কনফিগার করা নেই।" };
  }
  const now = new Date().toISOString();
  const id = String(record.id || `adm-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`);
  const row = {
    id,
    name: String(record.name || "").trim().slice(0, 120),
    cls: String(record.cls || "").trim().slice(0, 40),
    section: String(record.section || "ক").trim().slice(0, 40),
    guardian: String(record.guardian || "").trim().slice(0, 120),
    phone: String(record.phone || "").trim().slice(0, 30),
    address: String(record.address || "").trim().slice(0, 260),
    status: "pending",
    apply_date: String(record.date || now.slice(0, 10)),
    updated_at: now,
  };

  try {
    const { error } = await client.from("admissions").insert(row);
    if (error) {
      return {
        ok: false,
        schemaReady: !isSchemaMissingError(error),
        error: String(error.message || "ভর্তি আবেদন সংরক্ষণ ব্যর্থ হয়েছে।"),
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
        date: row.apply_date,
      },
    };
  } catch (err) {
    return {
      ok: false,
      schemaReady: !isSchemaMissingError(err),
      error: String((err as Error)?.message || "ভর্তি আবেদন সংরক্ষণ ব্যর্থ হয়েছে।"),
    };
  }
}

export async function uploadMediaToSupabase(params: {
  base64Data: string;
  mimeType: string;
  title?: string;
  category?: string;
  description?: string;
  saveToGallery?: boolean;
}) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, status: 503, error: "Supabase কনফিগার করা নেই।" };
  }

  let mime = String(params.mimeType || "").trim().toLowerCase();
  let rawBase64 = String(params.base64Data || "").trim();

  if (rawBase64.startsWith("data:")) {
    const commaIdx = rawBase64.indexOf(",");
    if (commaIdx <= 0) {
      return { ok: false, status: 400, error: "অবৈধ ফাইল ডেটা।" };
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
      error: "অনুমোদিত ফাইল ফরম্যাট: JPG, PNG, WebP, GIF, MP4, WebM, OGG, MOV।",
    };
  }

  const buffer = Buffer.from(rawBase64, "base64");
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) {
    return {
      ok: false,
      status: 400,
      error: "ফাইলের আকার শূন্য বা ৫০MB সীমার চেয়ে বেশি।",
    };
  }

  const folder = info.type === "video" ? "videos" : "photos";
  const storagePath = `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${info.ext}`;

  const { error: uploadErr } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mime,
      upsert: false,
    });

  if (uploadErr) {
    return {
      ok: false,
      status: 500,
      error: String(uploadErr.message || "Supabase Storage-এ আপলোড ব্যর্থ হয়েছে। 'school-media' বাকেট তৈরি আছে কিনা যাচাই করুন।"),
    };
  }

  const { data: urlData } = client.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  const publicUrl = urlData?.publicUrl || "";

  let mediaItem = null;
  if (params.saveToGallery !== false) {
    const now = new Date().toISOString();
    const id = `med-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const row = {
      id,
      title: String(params.title || (info.type === "video" ? "ক্যাম্পাস ভিডিও" : "ক্যাম্পাসের ছবি")).trim().slice(0, 140),
      media_type: info.type,
      category: String(params.category || (info.type === "video" ? "ক্যাম্পাস ভিডিও" : "গ্যালারি")).trim().slice(0, 60),
      file_url: publicUrl,
      storage_path: storagePath,
      description: String(params.description || "").trim().slice(0, 400),
      created_at: now,
      updated_at: now,
    };

    const { error: dbErr } = await client.from("school_media").insert(row);
    if (dbErr) {
      return {
        ok: false,
        status: 500,
        error: isSchemaMissingError(dbErr)
          ? "Storage-এ ফাইল উঠেছে, তবে school_media টেবিল এখনও তৈরি হয়নি।"
          : String(dbErr.message || "মিডিয়া রেকর্ড সংরক্ষণ ব্যর্থ হয়েছে।"),
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
    mediaItem,
  };
}

export async function deleteMediaFromSupabase(id: string) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: "Supabase কনফিগার করা নেই।" };
  }
  const cleanId = String(id || "").trim();
  if (!cleanId) return { ok: false, error: "অবৈধ মিডিয়া আইডি।" };

  const { data: existing } = await client
    .from("school_media")
    .select("id, storage_path")
    .eq("id", cleanId)
    .maybeSingle();

  if (existing && (existing as { storage_path?: string }).storage_path) {
    const sp = String((existing as { storage_path?: string }).storage_path);
    await client.storage.from(STORAGE_BUCKET).remove([sp]).catch(() => {});
  }

  const { error } = await client.from("school_media").delete().eq("id", cleanId);
  if (error) {
    return { ok: false, error: String(error.message || "মিডিয়া ডিলিট ব্যর্থ হয়েছে।") };
  }

  broadcastSchoolUpdate("media", ["school_media"]);
  return { ok: true };
}

export function broadcastSchoolUpdate(reason: string, tables: string[] = []): void {
  const payload = JSON.stringify({
    type: "db-updated",
    reason,
    tables,
    ts: Date.now(),
  });
  for (const res of sseClients) {
    try {
      res.write(`event: db-updated\ndata: ${payload}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

export function registerSseClient(res: ExpressResponse): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === "function") {
    (res as unknown as { flushHeaders: () => void }).flushHeaders();
  }
  res.write(`event: connected\ndata: ${JSON.stringify({ realtimeConnected, ts: Date.now() })}\n\n`);
  sseClients.add(res);

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      if (sseClients.size === 0) return;
      for (const clientRes of sseClients) {
        try {
          clientRes.write(`: ping\n\n`);
        } catch {
          sseClients.delete(clientRes);
        }
      }
    }, 25000);
  }

  res.on("close", () => {
    sseClients.delete(res);
  });
}

export function startSupabaseRealtimeBridge(): void {
  const client = getSupabaseClient();
  if (!client || realtimeChannel) return;

  try {
    realtimeChannel = client
      .channel("school-live-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        (payload) => {
          broadcastSchoolUpdate("realtime", payload?.table ? [payload.table] : []);
        }
      )
      .subscribe((status) => {
        realtimeConnected = status === "SUBSCRIBED";
      });
  } catch {
    realtimeConnected = false;
  }
}
