"use client";

import { useEffect, useMemo, useState } from "react";
import { ACTIVITY_LABELS, type ActivityRow } from "@/lib/types";
import { inRange, rangeOf, type Period } from "@/lib/analytics";
import { useAdmin } from "./Store";
import { Badge, Btn, DateRange, Empty, Page, PageHead, Pills, SearchBox, cx, downloadExcel, fmtDateTime } from "./kit";

/* Who changed what — every change made in the admin console, by the admin or by staff.
   Staff changes that needed the admin's approval show as "requested", then the admin's
   approval or rejection appears as its own line. */

const th = "px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap";
const td = "px-4 py-3 text-[13px]";
const label = (a: string) => ACTIVITY_LABELS[a] ?? a.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());

export default function ActivityPage() {
  const { s } = useAdmin();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [err, setErr] = useState("");
  const [who, setWho] = useState<"all" | "admin" | "staff">("all");
  const [period, setPeriod] = useState<Period>("week");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const PAGE = 30;

  // reload whenever anything in the shop changes
  useEffect(() => {
    let live = true;
    fetch("/api/admin/activity", { cache: "no-store" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!live) return;
        if (ok) {
          setRows(d.rows);
          setErr("");
        } else setErr(d.error ?? "Couldn't load the log.");
      })
      .catch(() => live && setErr("Couldn't load the log."));
    return () => {
      live = false;
    };
  }, [s.version]);

  const range = useMemo(() => rangeOf(period, from, to), [period, from, to]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (who === "all" || r.actor === who) && inRange(r.createdAt, range) && (!n || `${label(r.action)} ${r.target} ${r.action}`.toLowerCase().includes(n)));
  }, [rows, who, range, q]);
  // a new filter starts the list again from page 1
  const pageKey = JSON.stringify([who, period, from, to, q]);
  const [seenKey, setSeenKey] = useState(pageKey);
  if (seenKey !== pageKey) {
    setSeenKey(pageKey);
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const safe = Math.min(page, pages);
  const slice = list.slice((safe - 1) * PAGE, safe * PAGE);
  const byAdmin = list.filter((r) => r.actor === "admin").length;

  const exportExcel = () =>
    downloadExcel(`activity-log-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: "Activity", rows: [["When", "Who", "What was done", "On", "Result", "Action code"], ...list.map((r) => [fmtDateTime(r.createdAt), r.actor === "admin" ? "Admin" : "Staff", label(r.action), r.target, r.outcome === "requested" ? "Sent for approval" : "Done", r.action])] },
    ]);

  return (
    <Page>
      <PageHead
        title="Activity log"
        sub="Who changed what — by the admin or by staff — across the whole console."
        right={
          <Btn icon="download" onClick={exportExcel} disabled={!list.length}>
            Download Excel
          </Btn>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Pills
          value={who}
          onChange={setWho}
          options={[
            { v: "all", t: "Everyone" },
            { v: "admin", t: "Admin" },
            { v: "staff", t: "Staff" },
          ]}
        />
        <Pills
          value={period}
          onChange={setPeriod}
          options={[
            { v: "today", t: "Today" },
            { v: "week", t: "Week" },
            { v: "month", t: "Month" },
            { v: "all", t: "All" },
            { v: "custom", t: "Custom" },
          ]}
        />
        {period === "custom" && <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />}
        <SearchBox value={q} onChange={setQ} placeholder="Search action or name…" className="w-full sm:ml-auto sm:w-64" />
      </div>
      <p className="mb-3 px-1 text-[12.5px] font-semibold text-slate-600">
        {list.length} change{list.length === 1 ? "" : "s"} · {byAdmin} by admin · {list.length - byAdmin} by staff
      </p>
      {err ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">{err}</p>
      ) : !rows ? (
        <p className="py-10 text-center text-[13px] text-slate-400">Loading…</p>
      ) : !list.length ? (
        <Empty icon="list" title="Nothing logged here">
          Changes appear as they are made.
        </Empty>
      ) : (
        <div className="adm-scroll overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full min-w-[640px]">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>When</th>
                <th className={th}>Who</th>
                <th className={th}>What was done</th>
                <th className={th}>On</th>
                <th className={th}>Result</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className={cx(td, "whitespace-nowrap text-slate-600")}>{fmtDateTime(r.createdAt)}</td>
                  <td className={td}>
                    <Badge tone={r.actor === "admin" ? "violet" : "sky"}>{r.actor === "admin" ? "Admin" : "Staff"}</Badge>
                  </td>
                  <td className={cx(td, "font-semibold text-slate-800")}>{label(r.action)}</td>
                  <td className={cx(td, "max-w-[260px] truncate text-slate-600")}>{r.target || "—"}</td>
                  <td className={td}>{r.outcome === "requested" ? <Badge tone="amber">Sent for approval</Badge> : <Badge tone="green">Done</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-slate-500">
          <span>
            {(safe - 1) * PAGE + 1}–{(safe - 1) * PAGE + slice.length} of {list.length}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={safe <= 1} onClick={() => setPage(safe - 1)} className="h-9 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">
              ← Prev
            </button>
            <span className="min-w-[96px] text-center font-semibold text-slate-700">
              Page {safe} of {pages}
            </span>
            <button type="button" disabled={safe >= pages} onClick={() => setPage(safe + 1)} className="h-9 rounded-xl bg-slate-100 px-4 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40">
              Next →
            </button>
          </span>
        </div>
      )}
    </Page>
  );
}
