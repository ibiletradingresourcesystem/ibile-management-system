import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { getCachedCategories } from "@/lib/categoriesCache";

const LIST_LIMIT = 200;

function formatQty(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? String(parseFloat(n.toFixed(2))) : "0";
}

/**
 * Pick a product: choose a category, then open the product dropdown or type to search it.
 *
 * @param {boolean}  packsOnly     only list pack products (possible parents)
 * @param {function} getStatus     candidate → { disabled, note } shown on each option
 * @param {object}   selected      the chosen product (controlled)
 * @param {function} onSelect      called with the product, or null when cleared
 */
export default function ProductPicker({ packsOnly = false, getStatus, selected, onSelect, placeholder }) {
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    getCachedCategories()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setCategories([...list].sort((a, b) => String(a.name).localeCompare(String(b.name))));
      })
      .catch(() => {});
  }, []);

  // Load the list for the chosen category; typing narrows it on the server
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ lookup: "true", limit: String(LIST_LIMIT) });
        if (packsOnly) params.set("packsOnly", "true");
        if (category) params.set("category", category);
        if (term.trim()) params.set("search", term.trim());
        const res = await axios.get(`/api/products?${params.toString()}`, { signal: controller.signal });
        setOptions(Array.isArray(res.data?.data) ? res.data.data : []);
        setTotal(Number(res.data?.total) || 0);
        setActiveIndex(-1);
      } catch (err) {
        if (!axios.isCancel(err)) {
          setOptions([]);
          setTotal(0);
        }
      } finally {
        setLoading(false);
      }
    }, term ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, category, term, packsOnly]);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const statusFor = (candidate) => getStatus?.(candidate) || { disabled: false, note: "" };

  function choose(candidate) {
    if (statusFor(candidate).disabled) return;
    onSelect(candidate);
    setTerm("");
    setOpen(false);
  }

  function moveActive(step) {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + step + options.length) % options.length;
      if (!statusFor(options[next]).disabled) break;
    }
    setActiveIndex(next);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && activeIndex >= 0) choose(options[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div className="form-group">
        <label className="form-label">Category</label>
        <select
          className="form-select"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setOpen(true);
          }}
        >
          <option value="">All categories</option>
          <option value="Top Level">Top Level</option>
          {categories.map((cat) => (
            <option key={cat._id} value={cat._id}>{cat.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group relative">
        <label className="form-label">Product</label>
        <div className="relative">
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            className="form-input !pr-16"
            placeholder={selected ? selected.name : placeholder || "Pick from the list or type to search…"}
            value={open ? term : selected?.name || ""}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="absolute inset-y-0 right-2 flex items-center gap-1">
            {selected && (
              <button
                type="button"
                aria-label="Clear selection"
                className="px-1 text-lg leading-none text-gray-400 hover:text-gray-700"
                onClick={() => {
                  onSelect(null);
                  setTerm("");
                }}
              >
                ×
              </button>
            )}
            <button
              type="button"
              aria-label={open ? "Close list" : "Open list"}
              className="px-1 text-gray-500 hover:text-gray-800"
              onClick={() => setOpen((prev) => !prev)}
            >
              ▾
            </button>
          </div>
        </div>

        {open && (
          <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {loading && options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500">Loading products…</p>
            ) : options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500">
                {packsOnly ? "No pack products match." : "No products match."}
              </p>
            ) : (
              <ul ref={listRef} role="listbox" className="max-h-72 overflow-y-auto">
                {options.map((candidate, index) => {
                  const status = statusFor(candidate);
                  const isActive = index === activeIndex;
                  const isSelected = String(selected?._id) === String(candidate._id);
                  return (
                    <li
                      key={candidate._id}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={status.disabled}
                      onMouseEnter={() => !status.disabled && setActiveIndex(index)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(candidate);
                      }}
                      className={`flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 ${
                        status.disabled
                          ? "cursor-not-allowed bg-gray-50 text-gray-400"
                          : isActive
                          ? "cursor-pointer bg-blue-50"
                          : "cursor-pointer hover:bg-blue-50"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className={`block truncate font-medium ${isSelected ? "text-blue-700" : ""}`}>
                          {candidate.name}
                        </span>
                        {candidate.barcode && (
                          <span className="block truncate font-mono text-xs text-gray-500">{candidate.barcode}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-right text-xs text-gray-500">
                        {status.note || (candidate.packType === "pack" ? `Pack of ${candidate.qtyPerPack} · ` : "")}
                        {!status.note && `Stock ${formatQty(candidate.quantity)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {total > options.length && (
              <p className="border-t bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
                Showing {options.length} of {total} — type to narrow the list
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
