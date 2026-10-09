import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Trash2, StickyNote, Sparkles, ClipboardList, Store } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog, showPromptDialog } from "@/lib/dialogs";
import { Loader } from "@/components/ui";
import { groupMarketItems, vendorChoices } from "./marketGroups";

const errorText = (error, fallback) => error?.response?.data?.error || error?.message || fallback;

/**
 * The next market list: anyone adds to it; each product lands under its market vendor, products with
 * no vendor yet and things not in the system wait at the end of their market. Generating it closes
 * it into a list to take to the market.
 */
export default function MarketListTab({ setup, onGenerated, onOpenSetup, canSetup }) {
  const { markets = [], vendors = [] } = setup;
  const [items, setItems] = useState([]);
  const [removedCount, setRemovedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [marketFilter, setMarketFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/market/list");
      setItems(data.items || []);
      setRemovedCount(data.removed || 0);
    } catch (error) {
      setNotice(errorText(error, "Could not load the market list."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const replaceItem = (updated) =>
    setItems((list) => {
      const others = list.filter((item) => item._id !== updated._id);
      return [...others, updated];
    });

  const shown = useMemo(
    () => (marketFilter === "all" ? items : items.filter((item) => !item.market || item.market === marketFilter)),
    [items, marketFilter]
  );
  const groups = useMemo(() => groupMarketItems(shown, markets), [shown, markets]);
  const lowStockCount = shown.filter((item) => item.source === "low-stock").length;
  const orderedCount = shown.filter((item) => item.onSupplierOrder).length;
  const chosenMarket = markets.find((market) => String(market._id) === marketFilter) || null;

  /* ---- actions ---- */

  const addItem = async (payload) => {
    setBusy("add");
    try {
      const { data } = await apiClient.post("/api/market/list", {
        ...payload,
        marketId: marketFilter !== "all" ? marketFilter : undefined,
      });
      // Adding the same product again raises its quantity: one line, not two
      setItems((list) => [...list.filter((item) => item._id !== data.item._id), data.item]);
      const where = data.item.vendorName ? `${data.item.vendorName}${data.item.sectionName ? ` · ${data.item.sectionName}` : ""}` : data.item.product ? "No market vendor yet" : "Others";
      setNotice(`Added ${data.item.name} → ${where}`);
      return true;
    } catch (error) {
      await showAlertDialog({ title: "Not added", message: errorText(error, "Could not add it to the list."), tone: "danger" });
      return false;
    } finally {
      setBusy("");
    }
  };

  const updateItem = async (item, changes) => {
    try {
      const { data } = await apiClient.put(`/api/market/list/${item._id}`, changes);
      if (data.item._id !== item._id) setItems((list) => list.filter((entry) => entry._id !== item._id));
      replaceItem(data.item);
    } catch (error) {
      await showAlertDialog({ title: "Not changed", message: errorText(error, "Could not change that item."), tone: "danger" });
      load();
    }
  };

  const removeItem = async (item) => {
    setItems((list) => list.filter((entry) => entry._id !== item._id));
    try {
      await apiClient.delete(`/api/market/list/${item._id}`);
      if (item.source === "low-stock") setRemovedCount((count) => count + 1);
    } catch (error) {
      await showAlertDialog({ title: "Not removed", message: errorText(error, "Could not remove that item."), tone: "danger" });
      load();
    }
  };

  const changeVendor = async (item, vendorId) => {
    if (!vendorId) return updateItem(item, { vendorId: null });
    const vendor = vendors.find((entry) => String(entry._id) === vendorId);
    let rememberVendor = false;
    if (item.product && item.vendor) {
      rememberVendor =
        (await showConfirmDialog({
          title: "Buy from this vendor every time?",
          message: `${item.name} will be on ${vendor?.name || "this vendor"}'s list. Make them its favourite, so it goes to them by itself next time too?`,
          confirmLabel: "Every time",
          cancelLabel: "Just this list",
        })) === true;
    }
    return updateItem(item, { vendorId, rememberVendor });
  };

  const editNote = async (item) => {
    const note = await showPromptDialog({
      title: `Note for ${item.name}`,
      message: "Size, ripeness, a brand — whatever the buyer should know.",
      defaultValue: item.note || "",
      placeholder: "e.g. big ones, not too ripe",
      confirmLabel: "Save note",
    });
    if (note === null || note === undefined) return;
    updateItem(item, { note: String(note) });
  };

  const addLowStock = async () => {
    setBusy("low-stock");
    try {
      const { data } = await apiClient.post("/api/market/list/low-stock", { marketId: marketFilter !== "all" ? marketFilter : undefined });
      await load();
      setNotice(data.added ? `${data.added} low-stock item${data.added === 1 ? "" : "s"} added` : "No low-stock items to add — or they are already on the list or ordered from a supplier");
    } catch (error) {
      await showAlertDialog({ title: "Low stock", message: errorText(error, "Could not add low-stock items."), tone: "danger" });
    } finally {
      setBusy("");
    }
  };

  const generate = async () => {
    const scope = chosenMarket ? chosenMarket.name : markets.length > 1 ? "all markets" : markets[0]?.name || "the market";
    const ok = await showConfirmDialog({
      title: "Generate the market list?",
      message:
        `${shown.length} item${shown.length === 1 ? "" : "s"} for ${scope} go on a list to take to the market. ` +
        "This list then closes: anything added from now on goes on the next one. The last 4 lists are kept.",
      confirmLabel: "Generate list",
    });
    if (!ok) return;
    setBusy("generate");
    try {
      const { data } = await apiClient.post("/api/market/list/generate", { marketId: chosenMarket ? chosenMarket._id : undefined });
      await load();
      onGenerated?.(data.list);
    } catch (error) {
      await showAlertDialog({ title: "Not generated", message: errorText(error, "Could not generate the market list."), tone: "danger" });
    } finally {
      setBusy("");
    }
  };

  /* ---- render ---- */

  return (
    <div className="space-y-4">
      <AddBox vendors={vendors} busy={busy === "add"} onAdd={addItem} />

      <div className="content-card !py-3">
        <div className="flex flex-wrap items-center gap-2">
          {markets.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Market">
              {[{ _id: "all", name: "All markets" }, ...markets].map((market) => (
                <button
                  key={market._id}
                  type="button"
                  onClick={() => setMarketFilter(String(market._id))}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${marketFilter === String(market._id) ? "theme-badge-soft border-transparent" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                >
                  {market.name}
                </button>
              ))}
            </div>
          )}
          <p className="text-sm text-gray-500">
            {shown.length} item{shown.length === 1 ? "" : "s"}
            {lowStockCount > 0 && ` · ${lowStockCount} for low stock`}
            {orderedCount > 0 && ` · ${orderedCount} already ordered from a supplier`}
            {removedCount > 0 && ` · ${removedCount} low-stock removed`}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={addLowStock} disabled={Boolean(busy)} className="btn-action btn-action-secondary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {busy === "low-stock" ? "Adding…" : "Add low-stock items"}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={Boolean(busy) || shown.length === 0}
              className="btn-action btn-action-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" /> {busy === "generate" ? "Generating…" : "Generate market list"}
            </button>
          </div>
        </div>
        {notice && <p className="mt-2 text-sm text-emerald-700" role="status">{notice}</p>}
      </div>

      {loading ? (
        <div className="content-card"><Loader size="sm" text="Loading the market list…" /></div>
      ) : markets.length === 0 && items.length === 0 ? (
        <div className="content-card text-center py-10">
          <Store className="mx-auto mb-3 h-8 w-8 text-gray-300" aria-hidden="true" />
          <p className="font-medium text-gray-700">No markets set up yet</p>
          <p className="mt-1 text-sm text-gray-500">Add a market, its sections and the vendors you buy from — then items sort themselves.</p>
          {canSetup && (
            <button type="button" onClick={onOpenSetup} className="btn-action btn-action-primary btn-sm mt-4">Set up markets</button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="content-card text-center py-10 text-gray-500">
          Nothing on the next list yet. Search a product above, or type anything to buy.
        </div>
      ) : (
        groups.map((block) => (
          <section key={block.key} className="content-card !p-0 overflow-hidden">
            <h2 className="border-b theme-border-soft bg-gray-50 px-4 py-2.5 text-base font-semibold text-gray-800">{block.name}</h2>
            {block.sections.map((section) => (
              <div key={section.key} className="border-b theme-border-soft last:border-b-0">
                <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{section.name}</p>
                {section.vendors.map((vendor) => (
                  <div key={vendor.key} className="px-4 pb-3 pt-1">
                    <p className="text-sm font-semibold text-gray-800">{vendor.name}</p>
                    <ul className="divide-y divide-gray-100">
                      {vendor.items.map((item) => (
                        <ItemRow key={item._id} item={item} vendors={vendors} onQuantity={(quantity) => updateItem(item, { quantity })} onVendor={(id) => changeVendor(item, id)} onNote={() => editNote(item)} onRemove={() => removeItem(item)} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
            {block.noVendor.length > 0 && (
              <div className="border-b theme-border-soft px-4 pb-3 pt-3 last:border-b-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">No market vendor yet — pick one and it is remembered</p>
                <ul className="divide-y divide-gray-100">
                  {block.noVendor.map((item) => (
                    <ItemRow key={item._id} item={item} vendors={vendors} onQuantity={(quantity) => updateItem(item, { quantity })} onVendor={(id) => changeVendor(item, id)} onNote={() => editNote(item)} onRemove={() => removeItem(item)} />
                  ))}
                </ul>
              </div>
            )}
            {block.others.length > 0 && (
              <div className="px-4 pb-3 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Others — not in the system yet (add them after buying)</p>
                <ul className="divide-y divide-gray-100">
                  {block.others.map((item) => (
                    <ItemRow key={item._id} item={item} vendors={vendors} onQuantity={(quantity) => updateItem(item, { quantity })} onVendor={(id) => changeVendor(item, id)} onNote={() => editNote(item)} onRemove={() => removeItem(item)} />
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ add box */

function AddBox({ vendors, busy, onAdd }) {
  const [term, setTerm] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  // Which vendor each product would go to, to show it before it is added
  const placement = useMemo(() => {
    const map = new Map();
    for (const vendor of vendors.filter((v) => v.isActive !== false)) {
      for (const line of vendor.products || []) {
        const key = String(line.product);
        if (!map.has(key) || line.favourite) map.set(key, vendor.name);
      }
    }
    return map;
  }, [vendors]);

  useEffect(() => {
    const text = term.trim();
    if (text.length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await apiClient.get(`/api/products?search=${encodeURIComponent(text)}&limit=8`);
        if (!cancelled) {
          setResults(data?.data || (Array.isArray(data) ? data : []));
          setActive(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    const close = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const options = [
    ...results.map((product) => ({ type: "product", product })),
    ...(term.trim().length >= 2 ? [{ type: "other", name: term.trim() }] : []),
  ];

  const choose = async (option) => {
    if (!option) return;
    const added = await onAdd(
      option.type === "product"
        ? { productId: option.product._id, quantity }
        : { name: option.name, quantity }
    );
    if (added) {
      setTerm("");
      setQuantity("1");
      setResults([]);
      setOpen(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="content-card">
      <label htmlFor="market-add" className="form-label mb-1.5">Add to the next market list</label>
      <div className="flex flex-col gap-2 sm:flex-row" ref={boxRef}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            id="market-add"
            ref={inputRef}
            type="text"
            value={term}
            autoComplete="off"
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, options.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(options[active] || options[options.length - 1]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Search a product, or type anything to buy…"
            className="form-input pl-9"
          />
          {open && options.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border theme-border-soft bg-white shadow-lg" role="listbox">
              {options.map((option, index) => (
                <li key={option.type === "product" ? option.product._id : "other"}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${index === active ? "bg-gray-100" : ""}`}
                  >
                    {option.type === "product" ? (
                      <>
                        <span className="min-w-0 truncate font-medium text-gray-900">{option.product.name}</span>
                        <span className={`shrink-0 text-xs ${placement.has(String(option.product._id)) ? "text-gray-500" : "text-amber-600"}`}>
                          {placement.get(String(option.product._id)) || "no market vendor yet"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 truncate">Add “{option.name}”</span>
                        <span className="shrink-0 text-xs text-gray-500">not in the system → Others</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-label="Quantity"
            className="form-input !w-24 text-center"
          />
          <button
            type="button"
            onClick={() => choose(options[active] || options[options.length - 1])}
            disabled={busy || options.length === 0}
            className="btn-action btn-action-primary inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-gray-500">A product goes under its market vendor by itself; adding it again raises the quantity.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ one item */

function ItemRow({ item, vendors, onQuantity, onVendor, onNote, onRemove }) {
  const [quantity, setQuantity] = useState(String(item.quantity ?? 1));
  useEffect(() => setQuantity(String(item.quantity ?? 1)), [item.quantity]);
  const { listing, rest } = vendorChoices(item, vendors);
  const marketOf = (vendor) => (vendor.market && String(vendor.market) !== String(item.market) ? " (other market)" : "");

  const commit = () => {
    const value = Number(quantity);
    if (!Number.isFinite(value) || value <= 0) {
      setQuantity(String(item.quantity ?? 1));
      return;
    }
    if (value !== Number(item.quantity)) onQuantity(value);
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <div className="min-w-[10rem] flex-1">
        <p className="font-medium leading-snug text-gray-900">{item.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {item.source === "low-stock" && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">Low stock</span>}
          {item.onSupplierOrder && (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700" title="A supplier vendor already has this on order">
              Ordered from {item.onSupplierOrder}
            </span>
          )}
          {item.note && <span className="text-gray-500">“{item.note}”</span>}
          {item.addedBy && item.source !== "low-stock" && <span className="text-gray-400">by {item.addedBy}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          aria-label={`Quantity of ${item.name}`}
          className="form-input !w-20 !py-1.5 text-center"
        />
        {item.unit && <span className="text-sm text-gray-500">{item.unit}</span>}
      </div>
      <select
        value={item.vendor || ""}
        onChange={(event) => onVendor(event.target.value)}
        aria-label={`Market vendor for ${item.name}`}
        className="form-select !w-auto !py-1.5 max-w-[13rem] text-sm"
      >
        <option value="">{item.product ? "Pick a vendor…" : "Any vendor"}</option>
        {listing.length > 0 && (
          <optgroup label="Sells it">
            {listing.map((vendor) => (
              <option key={vendor._id} value={vendor._id}>{vendor.name}{marketOf(vendor)}</option>
            ))}
          </optgroup>
        )}
        {rest.length > 0 && (
          <optgroup label={listing.length ? "Other vendors" : "Vendors"}>
            {rest.map((vendor) => (
              <option key={vendor._id} value={vendor._id}>{vendor.name}{marketOf(vendor)}</option>
            ))}
          </optgroup>
        )}
      </select>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onNote} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={`Note for ${item.name}`} title="Add a note">
          <StickyNote className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={onRemove} className="rounded-lg p-2 text-red-500 hover:bg-red-50" aria-label={`Remove ${item.name}`} title="Remove from the list">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
