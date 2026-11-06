import ExcelJS from "exceljs";
import { isAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { ingredientLedger } from "@/lib/ops";
import { ApiError } from "@/lib/store";

/* GET ?from&to&type&iid&q&page&size → one page of the ingredient ledger + period totals.
   Add ?export=xlsx to download the whole filtered period as a real .xlsx file
   (two sheets: Movements + Summary by ingredient). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const exportXlsx = sp.get("export") === "xlsx";

  if (!(await isAdmin())) {
    if (exportXlsx) return new Response("Signed out.", { status: 401 });
    return handle(async () => { throw new ApiError("Signed out.", 401); });
  }

  if (!exportXlsx) {
    return handle(async () => ingredientLedger(sp));
  }

  const { rows, perIngredient, stats } = await ingredientLedger(sp);
  const TYPE: Record<string, string> = { purchase: "Purchased", use: "Batch use", waste: "Wasted", adjust: "Adjustment" };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Grace cafe POS";
  wb.created = new Date();

  /* ---------- Sheet 1: Movements ---------- */
  const moves = wb.addWorksheet("Movements", { views: [{ state: "frozen", ySplit: 1 }] });
  moves.columns = [
    { header: "When", key: "when", width: 20 },
    { header: "Ingredient", key: "name", width: 22 },
    { header: "Type", key: "type", width: 14 },
    { header: "Qty", key: "qty", width: 10 },
    { header: "Unit", key: "unit", width: 7 },
    { header: "Cost (₹)", key: "cost", width: 12 },
    { header: "Balance after", key: "balance", width: 14 },
    { header: "Batch", key: "batch", width: 16 },
    { header: "Made (where it was used)", key: "madeFor", width: 26 },
    { header: "Batch note", key: "batchNote", width: 30 },
    { header: "Note", key: "note", width: 40 },
  ];
  for (const r of rows) {
    moves.addRow({
      when: new Date(r.createdAt),
      name: r.ingredientName,
      type: TYPE[r.type] ?? r.type,
      qty: r.qty,
      unit: r.unit,
      cost: r.cost,
      balance: r.balanceAfter,
      batch: r.batchName || "",
      madeFor: r.madeFor || "",
      batchNote: r.batchNote || "",
      note: r.note,
    });
  }
  moves.getColumn("when").numFmt = "yyyy-mm-dd hh:mm:ss";
  moves.getColumn("qty").numFmt = "#,##0.###";
  moves.getColumn("cost").numFmt = "₹#,##0.00";
  moves.getColumn("balance").numFmt = "#,##0.###";
  moves.getRow(1).font = { bold: true };
  moves.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  moves.getRow(1).alignment = { vertical: "middle" };

  /* ---------- Sheet 2: Summary by ingredient ---------- */
  const sum = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 1 }] });
  sum.columns = [
    { header: "Ingredient", key: "name", width: 24 },
    { header: "Unit", key: "unit", width: 7 },
    { header: "Purchased", key: "purchased", width: 12 },
    { header: "Used", key: "used", width: 12 },
    { header: "Wasted", key: "wasted", width: 12 },
    { header: "Closing stock", key: "close", width: 14 },
  ];
  for (const p of perIngredient) sum.addRow({ name: p.name, unit: p.unit, purchased: p.in, used: p.used, wasted: p.wasted, close: p.close });
  for (const c of ["purchased", "used", "wasted", "close"] as const) sum.getColumn(c).numFmt = "#,##0.###";
  sum.getRow(1).font = { bold: true };
  sum.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

  /* Period totals strip at the bottom of the Summary sheet, in a muted band. */
  sum.addRow([]);
  const totalRow = sum.addRow({
    name: "Period totals (₹)",
    unit: "",
    purchased: stats.purchased.cost,
    used: stats.used.cost,
    wasted: stats.wasted.cost,
    close: "",
  });
  for (const c of ["purchased", "used", "wasted"] as const) sum.getCell(`${sum.getColumn(c).letter}${totalRow.number}`).numFmt = "₹#,##0.00";
  totalRow.font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buf as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="ingredient-ledger-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
