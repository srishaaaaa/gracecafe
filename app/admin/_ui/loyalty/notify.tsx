"use client";

/* WhatsApp messages for loyalty customers. The server prepares each message when something happens (a welcome, points
   earned, a gift claimed…) and keeps it in the customer's history. There is no automatic sender — a browser can't drive
   WhatsApp — so one tap here opens the chat with the message ready. WhatsApp doesn't tell us whether it was delivered, so
   a message is only ever shown as "Ready to send" or "Opened in WhatsApp", never as "Sent". */

import { useState } from "react";
import type { LoyaltyMessage } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Badge, Btn, Modal, WaIcon, fmtDateTime } from "../kit";

export const MSG_LABEL: Record<string, string> = {
  enrol: "Welcome",
  earned: "Points earned",
  redeemed: "Points used",
  unlock: "Reward unlocked",
  claimed: "Free gift claimed",
  milestone: "Spending reward unlocked",
  adjust: "Points adjusted",
};

export const waUrl = (m: Pick<LoyaltyMessage, "phone" | "text">) => `https://wa.me/${m.phone}?text=${encodeURIComponent(m.text)}`;

/** Opens WhatsApp with a message and records that staff did so. */
export function useSendMessage(onDone?: (m: LoyaltyMessage) => void) {
  const { act } = useAdmin();
  return async (m: LoyaltyMessage) => {
    const w = window.open("about:blank", "_blank"); // opened first so the browser doesn't block it
    const r = await act<LoyaltyMessage>("loyalty.msg.open", { id: m.id });
    if (r.ok) {
      if (w) w.location.href = waUrl(m);
      onDone?.(r.result);
    } else w?.close();
  };
}

export function StatusBadge({ m }: { m: Pick<LoyaltyMessage, "status" | "opens"> }) {
  if (m.status === "failed") return <Badge tone="red">Failed</Badge>;
  if (m.status === "opened") return <Badge tone="sky">Opened in WhatsApp{m.opens > 1 ? ` ×${m.opens}` : ""}</Badge>;
  return <Badge tone="amber">Ready to send</Badge>;
}

export function MessageRow({ m: given, onChanged }: { m: LoyaltyMessage; onChanged?: () => void }) {
  const { act, role } = useAdmin();
  const [local, setLocal] = useState<LoyaltyMessage | null>(null); // what this row last did, until the list reloads
  const m = local && local.id === given.id && local.opens >= given.opens ? local : given;
  const send = useSendMessage((x) => {
    setLocal(x);
    onChanged?.();
  });
  const retry = async () => {
    const r = await act<LoyaltyMessage>("loyalty.msg.retry", { id: m.id });
    if (r.ok) {
      setLocal(r.result);
      onChanged?.();
    }
  };
  return (
    <li className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <b className="text-[13px] text-slate-900">{MSG_LABEL[m.type] ?? m.type}</b>
          <StatusBadge m={m} />
        </span>
        <span className="text-[11.5px] text-slate-500">{fmtDateTime(m.createdAt)}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-snug text-slate-600">{m.text}</p>
      {m.status === "failed" && <p className="mt-1.5 text-[12px] font-semibold text-red-600">{m.error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {m.status !== "failed" && (
          <Btn size="sm" kind="green" onClick={() => send(m)}>
            <WaIcon size={14} /> {m.status === "opened" ? "Open again" : "Send on WhatsApp"}
          </Btn>
        )}
        {m.status === "failed" && role === "admin" && (
          <Btn size="sm" onClick={retry}>
            Retry
          </Btn>
        )}
      </div>
    </li>
  );
}

/** A small list of messages (a customer's history, or the ones prepared for one bill). */
export function MessageList({ messages, onChanged, empty = "No WhatsApp messages yet." }: { messages: LoyaltyMessage[]; onChanged?: () => void; empty?: string }) {
  if (!messages.length) return <p className="py-3 text-center text-[12.5px] text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-2">
      {messages.map((m) => (
        <MessageRow key={m.id} m={m} onChanged={onChanged} />
      ))}
    </ul>
  );
}

export type Joined = { id: string; name: string; message: LoyaltyMessage | null };

/** Shown right after a customer joins the loyalty programme. With a welcome message, it is ready to send. Without one
    (the customer didn't agree to WhatsApp messages), it says so and lets staff record their consent and prepare it. */
export function WelcomeStep({ joined, onClose }: { joined: Joined; onClose: () => void }) {
  const { act } = useAdmin();
  const [msg, setMsg] = useState<LoyaltyMessage | null>(joined.message);
  const [busy, setBusy] = useState(false);
  if (msg) return <MessageModal title="Send the welcome message" messages={[msg]} onClose={onClose} />;
  const ask = async () => {
    setBusy(true);
    const r = await act<LoyaltyMessage>("loyalty.welcome", { id: joined.id });
    setBusy(false);
    if (r.ok) setMsg(r.result);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Added to loyalty"
      footer={
        <>
          <Btn onClick={onClose}>Done</Btn>
          <Btn kind="green" disabled={busy} onClick={ask}>
            <WaIcon size={15} /> {busy ? "Preparing…" : "They agree — prepare welcome message"}
          </Btn>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-slate-700">
        <b>{joined.name}</b> is now in the loyalty programme. No welcome message was prepared, because they didn&apos;t agree to WhatsApp messages when they joined.
      </p>
      <p className="mt-2 text-[12.5px] text-slate-500">If they say yes now, press the green button — it records their agreement and prepares the welcome message for you to send.</p>
    </Modal>
  );
}

/** Pop-up shown right after something prepared a message (enrolment, a points adjustment). */
export function MessageModal({ messages, title, onClose }: { messages: LoyaltyMessage[]; title: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title} footer={<Btn onClick={onClose}>Done</Btn>}>
      <p className="mb-3 text-[12.5px] text-slate-500">This is saved in the customer&apos;s WhatsApp history too. WhatsApp can&apos;t confirm delivery, so it is marked &ldquo;Opened in WhatsApp&rdquo; once you open it.</p>
      <MessageList messages={messages} />
    </Modal>
  );
}
