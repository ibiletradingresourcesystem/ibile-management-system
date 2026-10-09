import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { ArrowLeft, Check, X, Printer, RotateCcw, PackagePlus, ClipboardList } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { Loader } from "@/components/ui";
import { groupMarketItems, quantityLabel } from "./marketGroups";

const errorText = (error, fallback) => error?.response?.data?.error || error?.message || fallback;
const when = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The market lists generated so far (the last 4). One opens as the list to take to the market:
 * sorted by market, section and vendor, printable, with each item ticked off as bought or not there.
 */
export default function MarketHistoryTab({ setup, openListId, onListChange, onCarried }) {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/market/history");
      setLists(data.lists || []);
    } catch (error) {
      await showAlertDialog({ title: "Market lists", message: errorText(error, "Could not load the market lists."), tone: "danger" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!openListId) load();
  }, [load, openListId]);

  if (openListId) {
    return <ListDetail listId={openListId} setup={setup} onBack={() => onListChange(null)} onCarried={onCarried} />;
  }

  if (loading) return <div className="content-card"><Loader size="sm" text="Loading market lists…" /></div>;
  if (lists.length === 0) {
    return (
      <div className="content-card py-10 text-center text-gray-500">
        <ClipboardList className="mx-auto mb-3 h-8 w-8 text-gray-300" aria-hidden="true" />
        No market list generated yet. Generate one from the next list when it is time to go to the market.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">The last 4 market lists are kept; older ones are removed by themselves.</p>
      {lists.map((list) => {
        const bought = list.counts?.bought || 0;
        const unavailable = list.counts?.unavailable || 0;
        return (
          <button
            key={list._id}
            type="button"
            onClick={() => onListChange(list._id)}
            className="content-card flex w-full flex-wrap items-center gap-3 text-left hover:shadow-md"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900">
                Market list #{list.number} <span className="font-normal text-gray-500">· {list.marketName || "All markets"}</span>
              </p>
              <p className="text-sm text-gray-500">{when(list.createdAt)}{list.generatedBy ? ` · by ${list.generatedBy}` : ""}</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold text-gray-800">{list.itemCount} item{list.itemCount === 1 ? "" : "s"}</p>
              <p className="text-gray-500">
                {bought} bought{unavailable ? ` · ${unavailable} not there` : ""}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ListDetail({ listId, setup, onBack, onCarried }) {
  const router = useRouter();
  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const backRef = useRef(onBack);
  backRef.current = onBack;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/api/market/history/${listId}`);
      setList(data.list);
      setItems(data.items || []);
    } catch (error) {
      await showAlertDialog({ title: "Market list", message: errorText(error, "Could not open that market list."), tone: "danger" });
      backRef.current();
    } finally {
      setLoading(false);
    }
  }, [listId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => groupMarketItems(items, setup.markets || []), [items, setup.markets]);
  const bought = items.filter((item) => item.status === "bought").length;
  const notBought = items.filter((item) => item.status !== "bought").length;

  const setStatus = async (item, status) => {
    const next = item.status === status ? "pending" : status;
    setItems((all) => all.map((entry) => (entry._id === item._id ? { ...entry, status: next } : entry)));
    try {
      await apiClient.put(`/api/market/list/${item._id}`, { status: next });
    } catch (error) {
      await showAlertDialog({ title: "Not saved", message: errorText(error, "Could not tick that item."), tone: "danger" });
      load();
    }
  };

  const carryOver = async () => {
    const ok = await showConfirmDialog({
      title: "Put the rest on the next list?",
      message: `${notBought} item${notBought === 1 ? "" : "s"} not marked bought go back on the next market list (joined to anything already there).`,
      confirmLabel: "Put on next list",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/api/market/history/${listId}`, { action: "carry-over" });
      onCarried?.(data.carried);
    } catch (error) {
      await showAlertDialog({ title: "Not carried over", message: errorText(error, "Could not put them on the next list."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  // Others are made products after buying: the product form comes back here and links them
  const addToSystem = (item) => {
    const back = `/manage/market?tab=history&list=${listId}&linkItem=${item._id}`;
    router.push(`/products/new?name=${encodeURIComponent(item.name)}&returnTo=${encodeURIComponent(back)}`);
  };

  const print = () => {
    const rows = groups
      .map((block) => {
        const vendorRows = (vendor) =>
          vendor.items
            .map((item) => `<tr><td class="box">☐</td><td>${escapeHtml(item.name)}${item.note ? ` <i>(${escapeHtml(item.note)})</i>` : ""}</td><td class="qty">${escapeHtml(quantityLabel(item))}</td><td class="price">${item.lastPrice ? escapeHtml(formatCurrency(item.lastPrice)) : ""}</td><td class="paid"></td></tr>`)
            .join("");
        const sections = block.sections
          .map((section) => `<h3>${escapeHtml(section.name)}</h3>${section.vendors.map((vendor) => `<h4>${escapeHtml(vendor.name)}</h4><table>${vendorRows(vendor)}</table>`).join("")}`)
          .join("");
        const extra = (title, list) => (list.length ? `<h3>${escapeHtml(title)}</h3><table>${vendorRows({ items: list })}</table>` : "");
        return `<h2>${escapeHtml(block.name)}</h2>${sections}${extra("No market vendor yet", block.noVendor)}${extra("Others (not in the system)", block.others)}`;
      })
      .join("");
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) {
      showAlertDialog({ title: "Print", message: "Allow pop-ups for this site to print the market list.", tone: "warning" });
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Market list #${list.number}</title>
<style>
body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:16px}
h1{font-size:18px;margin:0 0 2px}p.sub{margin:0 0 12px;color:#555}
h2{font-size:15px;margin:16px 0 4px;border-bottom:2px solid #111}
h3{font-size:12px;margin:10px 0 2px;text-transform:uppercase;color:#444}
h4{font-size:13px;margin:6px 0 2px}
table{width:100%;border-collapse:collapse}td{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}
td.box{width:18px}td.qty{width:90px;text-align:right}td.price{width:90px;text-align:right;color:#555}td.paid{width:90px;border-bottom:1px solid #111}
</style></head><body>
<h1>Market list #${list.number} · ${escapeHtml(list.marketName || "All markets")}</h1>
<p class="sub">${escapeHtml(when(list.createdAt))}${list.generatedBy ? ` · by ${escapeHtml(list.generatedBy)}` : ""} · ${items.length} items · last price shown, paid left blank</p>
${rows}
<script>window.onload=function(){window.print();}</script></body></html>`);
    win.document.close();
  };

  if (loading || !list) return <div className="content-card"><Loader size="sm" text="Opening the market list…" /></div>;

  const rowFor = (item) => (
    <li key={item._id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2 ${item.status === "bought" ? "opacity-60" : ""}`}>
      <div className="min-w-[10rem] flex-1">
        <p className={`font-medium leading-snug ${item.status === "bought" ? "text-gray-500 line-through" : "text-gray-900"}`}>{item.name}</p>
        <p className="text-xs text-gray-500">
          {quantityLabel(item)}
          {item.lastPrice ? ` · last ${formatCurrency(item.lastPrice)}` : ""}
          {item.note ? ` · “${item.note}”` : ""}
          {item.status === "unavailable" ? " · not there" : ""}
        </p>
      </div>
      {!item.product && (
        <button type="button" onClick={() => addToSystem(item)} className="btn-action btn-action-secondary btn-sm inline-flex items-center gap-1.5">
          <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" /> Add to system
        </button>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setStatus(item, "bought")}
          aria-pressed={item.status === "bought"}
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium ${item.status === "bought" ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
        >
          <Check className="h-4 w-4" aria-hidden="true" /> Bought
        </button>
        <button
          type="button"
          onClick={() => setStatus(item, "unavailable")}
          aria-pressed={item.status === "unavailable"}
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium ${item.status === "unavailable" ? "border-red-600 bg-red-600 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
        >
          <X className="h-4 w-4" aria-hidden="true" /> Not there
        </button>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="content-card !py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onBack} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label="Back to the market lists">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900">Market list #{list.number} · {list.marketName || "All markets"}</p>
            <p className="text-sm text-gray-500">{when(list.createdAt)}{list.generatedBy ? ` · by ${list.generatedBy}` : ""} · {bought} of {items.length} bought</p>
          </div>
          <button type="button" onClick={print} className="btn-action btn-action-secondary btn-sm inline-flex items-center gap-1.5">
            <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
          </button>
          {notBought > 0 && (
            <button type="button" onClick={carryOver} disabled={busy} className="btn-action btn-action-secondary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Rest to next list
            </button>
          )}
        </div>
      </div>

      {groups.map((block) => (
        <section key={block.key} className="content-card !p-0 overflow-hidden">
          <h2 className="border-b theme-border-soft bg-gray-50 px-4 py-2.5 text-base font-semibold text-gray-800">{block.name}</h2>
          {block.sections.map((section) => (
            <div key={section.key} className="border-b theme-border-soft px-4 pb-3 pt-3 last:border-b-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section.name}</p>
              {section.vendors.map((vendor) => (
                <div key={vendor.key} className="pt-1">
                  <p className="text-sm font-semibold text-gray-800">{vendor.name}</p>
                  <ul className="divide-y divide-gray-100">{vendor.items.map(rowFor)}</ul>
                </div>
              ))}
            </div>
          ))}
          {block.noVendor.length > 0 && (
            <div className="border-b theme-border-soft px-4 pb-3 pt-3 last:border-b-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">No market vendor yet</p>
              <ul className="divide-y divide-gray-100">{block.noVendor.map(rowFor)}</ul>
            </div>
          )}
          {block.others.length > 0 && (
            <div className="px-4 pb-3 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Others — not in the system</p>
              <ul className="divide-y divide-gray-100">{block.others.map(rowFor)}</ul>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
