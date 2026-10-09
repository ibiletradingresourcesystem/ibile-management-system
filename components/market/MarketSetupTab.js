import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";

const errorText = (error, fallback) => error?.response?.data?.error || error?.message || fallback;
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

/**
 * Markets, their sections (in the order a buyer walks them) and the market vendors in each, with
 * the products each vendor sells. Basic staff see it; a manager changes it.
 */
export default function MarketSetupTab({ setup, reload, canSetup }) {
  const { markets = [], vendors = [] } = setup;
  const [newMarket, setNewMarket] = useState("");
  const [editing, setEditing] = useState(null); // vendor being edited, or {} for a new one
  const [vendorMarket, setVendorMarket] = useState("all");

  const addMarket = async () => {
    const name = newMarket.trim();
    if (!name) return;
    try {
      await apiClient.post("/api/market/markets", { name, sections: ["Market Entrance"] });
      setNewMarket("");
      reload();
    } catch (error) {
      showAlertDialog({ title: "Market not added", message: errorText(error, "Could not add the market."), tone: "danger" });
    }
  };

  if (editing) {
    return (
      <VendorEditor
        vendor={editing}
        markets={markets}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    );
  }

  const shownVendors = vendors.filter((vendor) => vendorMarket === "all" || String(vendor.market) === vendorMarket);

  return (
    <div className="space-y-4">
      {!canSetup && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Markets and market vendors are set up by a manager. You can still add to the market list.</p>
      )}

      <section className="content-card">
        <h2 className="text-lg font-semibold text-gray-800">Markets and sections</h2>
        <p className="mb-3 text-sm text-gray-500">Sections are the parts of a market you walk through, in that order — the list follows it.</p>
        {canSetup && (
          <div className="mb-4 flex gap-2">
            <input
              type="text"
              value={newMarket}
              onChange={(event) => setNewMarket(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addMarket()}
              placeholder="New market, e.g. Mile 12"
              className="form-input"
              aria-label="New market name"
            />
            <button type="button" onClick={addMarket} disabled={!newMarket.trim()} className="btn-action btn-action-primary inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add market
            </button>
          </div>
        )}
        {markets.length === 0 ? (
          <p className="text-sm text-gray-500">No markets yet.</p>
        ) : (
          <div className="space-y-3">
            {markets.map((market) => (
              <MarketCard key={market._id} market={market} vendorCount={vendors.filter((v) => String(v.market) === String(market._id)).length} canSetup={canSetup} reload={reload} />
            ))}
          </div>
        )}
      </section>

      <section className="content-card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-800">Market vendors</h2>
          {markets.length > 1 && (
            <select value={vendorMarket} onChange={(event) => setVendorMarket(event.target.value)} className="form-select !w-auto !py-1.5 text-sm" aria-label="Show vendors of">
              <option value="all">All markets</option>
              {markets.map((market) => (
                <option key={market._id} value={market._id}>{market.name}</option>
              ))}
            </select>
          )}
          {canSetup && markets.length > 0 && (
            <button type="button" onClick={() => setEditing({ market: vendorMarket !== "all" ? vendorMarket : markets[0]._id })} className="btn-action btn-action-primary btn-sm ml-auto inline-flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add vendor
            </button>
          )}
        </div>
        {markets.length === 0 ? (
          <p className="text-sm text-gray-500">Add a market first.</p>
        ) : shownVendors.length === 0 ? (
          <p className="text-sm text-gray-500">No market vendors yet. Add the people you buy from — “Vendor 1” is fine.</p>
        ) : (
          <VendorGroups markets={markets} vendors={shownVendors} canSetup={canSetup} onEdit={setEditing} reload={reload} />
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ a market */

function MarketCard({ market, vendorCount, canSetup, reload }) {
  const [name, setName] = useState(market.name);
  const [sections, setSections] = useState(market.sections || []);
  const [newSection, setNewSection] = useState("");
  useEffect(() => {
    setName(market.name);
    setSections([...(market.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0)));
  }, [market]);

  const save = async (changes) => {
    try {
      await apiClient.put(`/api/market/markets/${market._id}`, changes);
      reload();
    } catch (error) {
      showAlertDialog({ title: "Not saved", message: errorText(error, "Could not save the market."), tone: "danger" });
      reload();
    }
  };
  const saveSections = (next) => {
    setSections(next);
    save({ sections: next.map(({ _id, name: sectionName }) => ({ _id, name: sectionName })) });
  };
  const move = (index, step) => {
    const next = [...sections];
    const [section] = next.splice(index, 1);
    next.splice(index + step, 0, section);
    saveSections(next);
  };
  const remove = async () => {
    if (!(await showConfirmDialog({ title: `Delete ${market.name}?`, message: "Only a market with no vendors can be deleted.", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await apiClient.delete(`/api/market/markets/${market._id}`);
      reload();
    } catch (error) {
      showAlertDialog({ title: "Not deleted", message: errorText(error, "Could not delete the market."), tone: "danger" });
    }
  };

  return (
    <div className="rounded-xl border theme-border-soft p-3">
      <div className="flex flex-wrap items-center gap-2">
        {canSetup ? (
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => name.trim() && name.trim() !== market.name && save({ name: name.trim() })}
            className="form-input !w-auto flex-1 font-semibold"
            aria-label="Market name"
          />
        ) : (
          <p className="flex-1 font-semibold text-gray-900">{market.name}</p>
        )}
        <span className="text-xs text-gray-500">{vendorCount} vendor{vendorCount === 1 ? "" : "s"}</span>
        {canSetup && (
          <button type="button" onClick={remove} className="rounded-lg p-2 text-red-500 hover:bg-red-50" aria-label={`Delete ${market.name}`}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <label className={`mt-2 flex items-center gap-2 text-sm text-gray-700 ${canSetup ? "cursor-pointer" : ""}`}>
        <input
          type="checkbox"
          checked={market.autoAddLowStock !== false}
          disabled={!canSetup}
          onChange={(event) => save({ autoAddLowStock: event.target.checked })}
          className="h-4 w-4 p-0"
        />
        Put low-stock products from this market's vendors on the list by themselves
      </label>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sections, in walking order</p>
        <ul className="mt-1 space-y-1.5">
          {sections.map((section, index) => (
            <li key={section._id || index} className="flex items-center gap-1.5">
              {canSetup ? (
                <>
                  <input
                    type="text"
                    defaultValue={section.name}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value && value !== section.name) saveSections(sections.map((s, i) => (i === index ? { ...s, name: value } : s)));
                    }}
                    className="form-input !py-1.5 text-sm"
                    aria-label={`Section ${index + 1}`}
                  />
                  <button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30" aria-label="Move up">
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" disabled={index === sections.length - 1} onClick={() => move(index, 1)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30" aria-label="Move down">
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => saveSections(sections.filter((_, i) => i !== index))} className="rounded p-1.5 text-red-500 hover:bg-red-50" aria-label={`Remove ${section.name}`}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <span className="text-sm text-gray-700">{index + 1}. {section.name}</span>
              )}
            </li>
          ))}
        </ul>
        {canSetup && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={newSection}
              onChange={(event) => setNewSection(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newSection.trim()) {
                  saveSections([...sections, { name: newSection.trim() }]);
                  setNewSection("");
                }
              }}
              placeholder="New section, e.g. Back Row"
              className="form-input !py-1.5 text-sm"
              aria-label="New section name"
            />
            <button
              type="button"
              disabled={!newSection.trim()}
              onClick={() => {
                saveSections([...sections, { name: newSection.trim() }]);
                setNewSection("");
              }}
              className="btn-action btn-action-secondary btn-sm whitespace-nowrap disabled:opacity-50"
            >
              Add section
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ vendors by market and section */

function VendorGroups({ markets, vendors, canSetup, onEdit, reload }) {
  const groups = useMemo(
    () =>
      markets
        .map((market) => {
          const mine = vendors.filter((vendor) => String(vendor.market) === String(market._id));
          const sections = [...(market.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
          const bySection = sections.map((section) => ({ key: section._id, name: section.name, vendors: mine.filter((v) => String(v.section) === String(section._id)).sort(byName) }));
          const known = new Set(sections.map((s) => String(s._id)));
          const loose = mine.filter((v) => !v.section || !known.has(String(v.section))).sort(byName);
          if (loose.length) bySection.push({ key: "none", name: "No section", vendors: loose });
          return { market, sections: bySection.filter((section) => section.vendors.length) };
        })
        .filter((group) => group.sections.length),
    [markets, vendors]
  );

  const remove = async (vendor) => {
    if (!(await showConfirmDialog({ title: `Delete ${vendor.name}?`, message: "Anything on the next list under them stays, waiting for another vendor.", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await apiClient.delete(`/api/market/vendors/${vendor._id}`);
      reload();
    } catch (error) {
      showAlertDialog({ title: "Not deleted", message: errorText(error, "Could not delete the vendor."), tone: "danger" });
    }
  };

  return (
    <div className="space-y-4">
      {groups.map(({ market, sections }) => (
        <div key={market._id}>
          {markets.length > 1 && <p className="mb-1 font-semibold text-gray-800">{market.name}</p>}
          {sections.map((section) => (
            <div key={section.key} className="mb-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{section.name}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {section.vendors.map((vendor) => (
                  <div key={vendor._id} className="rounded-xl border theme-border-soft p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900">{vendor.name}</p>
                        <p className="text-xs text-gray-500">
                          {vendor.products?.length || 0} product{vendor.products?.length === 1 ? "" : "s"}
                          {vendor.phone ? ` · ${vendor.phone}` : ""}
                        </p>
                      </div>
                      {canSetup && (
                        <>
                          <button type="button" onClick={() => onEdit(vendor)} className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100" aria-label={`Edit ${vendor.name}`}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => remove(vendor)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" aria-label={`Delete ${vendor.name}`}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                    {vendor.products?.length > 0 && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-gray-600">
                        {vendor.products.map((line) => `${line.favourite ? "★ " : ""}${line.productName}`).join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ adding / editing a vendor */

function VendorEditor({ vendor, markets, onClose, onSaved }) {
  const isNew = !vendor._id;
  const [form, setForm] = useState({
    name: vendor.name || "",
    phone: vendor.phone || "",
    note: vendor.note || "",
    market: String(vendor.market || markets[0]?._id || ""),
    section: vendor.section ? String(vendor.section) : "",
  });
  const [lines, setLines] = useState((vendor.products || []).map((line) => ({ ...line, product: String(line.product) })));
  const [saving, setSaving] = useState(false);
  const market = markets.find((m) => String(m._id) === form.market);
  const sections = [...(market?.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setLine = (index, changes) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  const addProduct = (product) =>
    setLines((current) =>
      current.some((line) => line.product === String(product._id))
        ? current
        : [...current, { product: String(product._id), productName: product.name, unit: "", unitSize: 1, lastPrice: Number(product.costPrice) || 0, favourite: false }]
    );

  const save = async () => {
    if (!form.name.trim()) {
      showAlertDialog({ title: "Name needed", message: "Give the vendor a name — “Vendor 1” is fine.", tone: "warning" });
      return;
    }
    setSaving(true);
    try {
      const body = { ...form, section: form.section || null, products: lines };
      if (isNew) await apiClient.post("/api/market/vendors", body);
      else await apiClient.put(`/api/market/vendors/${vendor._id}`, body);
      onSaved();
    } catch (error) {
      showAlertDialog({ title: "Not saved", message: errorText(error, "Could not save the vendor."), tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="content-card space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-lg font-semibold text-gray-800">{isNew ? "Add a market vendor" : `Edit ${vendor.name}`}</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="form-label">Name</span>
          <input type="text" value={form.name} onChange={set("name")} placeholder="Vendor 1, or their name" className="form-input" />
        </label>
        <label className="block">
          <span className="form-label">Phone (optional)</span>
          <input type="tel" value={form.phone} onChange={set("phone")} className="form-input" />
        </label>
        <label className="block">
          <span className="form-label">Market</span>
          <select value={form.market} onChange={(event) => setForm((current) => ({ ...current, market: event.target.value, section: "" }))} className="form-select">
            {markets.map((m) => (
              <option key={m._id} value={m._id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="form-label">Section</span>
          <select value={form.section} onChange={set("section")} className="form-select">
            <option value="">No section</option>
            {sections.map((section) => (
              <option key={section._id} value={section._id}>{section.name}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="form-label">Note (optional)</span>
          <input type="text" value={form.note} onChange={set("note")} placeholder="e.g. stall by the gate, closes at 4" className="form-input" />
        </label>
      </div>

      <div>
        <p className="form-label">Products they sell</p>
        <ProductSearch onPick={addProduct} />
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">None yet. Search above to add the products you buy from them.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border theme-border-soft">
            {lines.map((line, index) => (
              <li key={line.product} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setLine(index, { favourite: !line.favourite })}
                  className={`rounded p-1 ${line.favourite ? "text-amber-500" : "text-gray-300 hover:text-gray-500"}`}
                  aria-pressed={Boolean(line.favourite)}
                  aria-label={`Favourite for ${line.productName}`}
                  title="Favourite: the product goes to this vendor by itself when several sell it"
                >
                  <Star className="h-4 w-4" fill={line.favourite ? "currentColor" : "none"} aria-hidden="true" />
                </button>
                <span className="min-w-[8rem] flex-1 text-sm font-medium text-gray-900">{line.productName}</span>
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  sold by
                  <input type="text" value={line.unit || ""} onChange={(event) => setLine(index, { unit: event.target.value })} placeholder="basket" className="form-input !w-24 !py-1 text-sm" />
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-500" title="How many of the product's own units one of these is">
                  =
                  <input type="number" min="0" step="any" value={line.unitSize ?? 1} onChange={(event) => setLine(index, { unitSize: event.target.value })} className="form-input !w-16 !py-1 text-center text-sm" />
                  units
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  last ₦
                  <input type="number" min="0" step="any" value={line.lastPrice ?? 0} onChange={(event) => setLine(index, { lastPrice: event.target.value })} className="form-input !w-24 !py-1 text-right text-sm" />
                </label>
                <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="rounded p-1.5 text-red-500 hover:bg-red-50" aria-label={`Remove ${line.productName}`}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t theme-border-soft pt-3">
        <button type="button" onClick={onClose} className="btn-action btn-action-secondary">Cancel</button>
        <button type="button" onClick={save} disabled={saving} className="btn-action btn-action-primary disabled:opacity-50">
          {saving ? "Saving…" : isNew ? "Add vendor" : "Save vendor"}
        </button>
      </div>
    </section>
  );
}

function ProductSearch({ onPick }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const boxRef = useRef(null);

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
        if (!cancelled) setResults(data?.data || (Array.isArray(data) ? data : []));
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  return (
    <div className="relative" ref={boxRef}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
      <input type="text" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search a product to add…" className="form-input pl-9" aria-label="Search a product to add" autoComplete="off" />
      {results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border theme-border-soft bg-white shadow-lg">
          {results.map((product) => (
            <li key={product._id}>
              <button
                type="button"
                onClick={() => {
                  onPick(product);
                  setTerm("");
                  setResults([]);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-100"
              >
                <span className="min-w-0 truncate font-medium text-gray-900">{product.name}</span>
                <span className="shrink-0 text-xs text-gray-500">{formatCurrency(product.costPrice || 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
