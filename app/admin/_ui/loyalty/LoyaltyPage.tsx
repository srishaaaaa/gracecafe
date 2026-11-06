"use client";

import { useEffect, useMemo, useState } from "react";
import { rangeOf, type Period } from "@/lib/analytics";
import type { LedgerEntry } from "@/lib/loyalty/types";
import { shopDate } from "@/lib/loyalty/engine";
import { useAdmin } from "../Store";
import { Btn, DateRange, Page, PageHead, Pills, Tabs, fmtDate } from "../kit";
import { EARN_TYPES, Stat, USE_TYPES, useLoyaltyState, within, type PeriodData } from "./shared";
import Customers from "./Customers";
import Crm from "./Crm";
import Dashboard from "./Dashboard";
import RewardRecords from "./RewardRecords";
import Rewards from "./Rewards";
import SettingsTab from "./Settings";

type Tab = "dashboard" | "customers" | "rewards" | "records" | "crm" | "settings";

/* Loyalty: Dashboard, Customers, Free Gifts & Rewards, Rewards earned, Customer CRM and Settings. Staff see Customers (look up, register, see points and rewards); the owner also sets up the
   gifts and the settings. */
export default function LoyaltyPage() {
  const { role, act, s, now } = useAdmin();
  const admin = role === "admin";
  const [tab, setTab] = useState<Tab>(admin ? "dashboard" : "customers");
  const { data, error, reload } = useLoyaltyState();

  /* the period filter, as on Analytics: it narrows everything on every tab to that time */
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo(() => rangeOf(period, from, to, new Date(now)), [period, from, to, now]);
  const label = period === "all" ? "All time" : period === "today" ? "Today" : period === "week" ? "This week" : period === "month" ? "This month" : period === "year" ? "This year" : `${from ? fmtDate(new Date(`${from}T00:00:00`).getTime()) : "…"} to ${to ? fmtDate(new Date(`${to}T00:00:00`).getTime()) : "…"}`;
  const [ledgerRows, setLedgerRows] = useState<LedgerEntry[] | null>(null);
  const rFrom = range && Number.isFinite(range.from) ? range.from : 0;
  const rTo = range && Number.isFinite(range.to) ? range.to : 0;
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/loyalty/ledger?size=5000${rFrom ? `&from=${rFrom}` : ""}${rTo ? `&to=${rTo}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((x) => live && setLedgerRows(x.rows ?? []))
      .catch(() => live && setLedgerRows([]));
    return () => {
      live = false;
    };
  }, [rFrom, rTo, s.version, data?.totals.earned, data?.totals.redeemed]);
  const pd: PeriodData = { range, label, ledger: ledgerRows ?? [] };

  // housekeeping once a day per browser: tidy the records of bills that were deleted
  useEffect(() => {
    const k = "clc-loyalty-maintain-3";
    const today = shopDate(Date.now());
    try {
      if (localStorage.getItem(k) === today) return;
      localStorage.setItem(k, today);
    } catch {}
    void act("loyalty.maintain");
  }, [act]);

  const tabs: { v: Tab; t: string }[] = admin
    ? [
        { v: "dashboard", t: "Dashboard" },
        { v: "customers", t: "Customers" },
        { v: "rewards", t: "Free Gifts & Rewards" },
        { v: "records", t: "Rewards earned" },
        { v: "crm", t: "Customer CRM" },
        { v: "settings", t: "Settings" },
      ]
    : [{ v: "customers", t: "Customers" }];

  return (
    <Page>
      <PageHead
        title="Loyalty"
        sub={data ? (data.config.enabled ? "Points, free gifts and rewards for your regular customers." : "The programme is switched off — turn it on in Settings.") : "Loading…"}
        right={
          <Btn icon="refresh" onClick={reload} className="h-10">
            Refresh
          </Btn>
        }
      />
      {error && !data && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">{error}</p>}
      {!data && !error && <p className="py-16 text-center text-[13px] text-slate-400">Loading loyalty data…</p>}
      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Loyalty customers" value={data.customers.length.toLocaleString("en-IN")} hint={range ? `${data.customers.filter((c) => within(c.createdAt, range)).length} joined · ${label}` : undefined} />
            <Stat label="Points earned" value={sumPts(pd.ledger, EARN_TYPES).toLocaleString("en-IN")} tone="green" hint={label} />
            <Stat label="Points redeemed" value={(0 - sumPts(pd.ledger, USE_TYPES)).toLocaleString("en-IN")} tone="red" hint={label} />
            <Stat label="Available points" value={data.totals.outstanding.toLocaleString("en-IN")} tone="amber" hint="held by customers now" />
            <Stat label="Free gifts given" value={giftsIn(s.bills, range).toLocaleString("en-IN")} hint={`on paid bills · ${label}`} />
          </div>
          {data.mismatched.length > 0 && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">{data.mismatched.length} customer balance(s) don&apos;t match their points history — please tell your developer.</p>}
          {tabs.length > 1 && <Tabs value={tab} options={tabs} onChange={setTab} />}
          {tab !== "rewards" && tab !== "settings" && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Pills
              label="Period:"
              value={period}
              onChange={setPeriod}
              options={[
                { v: "all", t: "All time" },
                { v: "today", t: "Today" },
                { v: "week", t: "This week" },
                { v: "month", t: "This month" },
                { v: "year", t: "This year" },
                { v: "custom", t: "Custom" },
              ]}
            />
            {period === "custom" && <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />}
          </div>
          )}
          {admin && tab === "dashboard" && <Dashboard d={data} pd={pd} onOpen={setTab} />}
          {tab === "customers" && <Customers d={data} pd={pd} reload={reload} />}
          {admin && tab === "rewards" && <Rewards d={data} />}
          {admin && tab === "records" && <RewardRecords d={data} pd={pd} />}
          {admin && tab === "crm" && <Crm d={data} pd={pd} />}
          {admin && tab === "settings" && <SettingsTab d={data} />}
        </>
      )}
    </Page>
  );
}

const sumPts = (rows: LedgerEntry[], types: string[]) => rows.filter((r) => types.includes(r.type)).reduce((a, r) => a + r.points, 0);
const giftsIn = (bills: import("@/lib/types").Bill[], range: PeriodData["range"]) => bills.filter((b) => b.status === "completed" && within(b.createdAt, range)).reduce((a, b) => a + b.items.filter((i) => i.free).reduce((x, i) => x + i.qty, 0), 0);
