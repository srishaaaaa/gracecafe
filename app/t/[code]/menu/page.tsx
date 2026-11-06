import { redirect } from "next/navigation";

/* Old per-table QR cards pointed here. Tables are gone — everyone orders from `/`. */
export default function OldTableLink() {
  redirect("/");
}
