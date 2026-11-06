"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Btn, Field, Icon, cx, inputCls } from "../_ui/kit";

export default function LoginForm({ logo = "" }: { logo?: string }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await fetch("/api/admin/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error ?? "Couldn't sign in.");
      router.replace("/admin");
      router.refresh();
    } catch {
      setErr("Network problem — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="adm-in w-full max-w-[400px] rounded-[28px] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,.06),0_20px_50px_-20px_rgba(15,23,42,.25)] sm:p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo || "/logo.png"} alt="" style={{ height: 56, width: "auto", maxWidth: "100%", objectFit: "contain" }} />
        <h1 className="adm-title mt-4 text-[28px] leading-none text-slate-900 sm:text-[32px]">Sign in</h1>
        <p className="mt-1 text-[14px] text-slate-500">Grace cafe · orders &amp; billing</p>
        <div className="mt-6 space-y-4">
          <Field label="Password">
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                className={cx(inputCls, "pr-11")}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
                minLength={1}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-slate-700"
                aria-label={show ? "Hide password" : "Show password"}
                aria-pressed={show}
                tabIndex={-1}
              >
                <Icon name={show ? "eyeoff" : "eye"} size={17} />
              </button>
            </div>
          </Field>
        </div>
        {err && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700" role="alert">
            {err}
          </p>
        )}
        <Btn type="submit" kind="red" size="lg" className="mt-6 w-full uppercase tracking-wide" disabled={busy || !pw}>
          {busy ? "Please wait…" : "Sign in"}
        </Btn>
      </form>
    </main>
  );
}
