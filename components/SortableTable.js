/**
 * Shared table sorting.
 *
 * Every data table in the app used to render a plain <th>, so the only way to
 * reorder a list was to change a filter. `useTableSort` keeps the sort state and
 * returns the sorted rows; `SortableTh` renders the clickable header with the
 * right arrow and the `aria-sort` attribute screen readers need.
 *
 *   const { sorted, sortKey, sortDir, toggleSort } = useTableSort(rows, "name");
 *   <SortableTh sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>
 *     Product
 *   </SortableTh>
 */
import { useCallback, useMemo, useState } from "react";

/** Pull a possibly-nested value: getValue(row, "vendor.name"). */
export function getFieldValue(row, key) {
  if (!row || !key) return undefined;
  if (typeof key === "function") return key(row);
  if (!key.includes(".")) return row[key];
  return key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), row);
}

const DATE_KEY = /(date|_at|At|time|Time)$/;

/**
 * Compare two cell values. Numbers sort numerically, dates chronologically and
 * everything else with a locale-aware, numeric-friendly string compare so
 * "Item 10" lands after "Item 9" instead of before it.
 */
export function compareValues(a, b, key) {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // blanks always sink to the bottom
  if (bEmpty) return -1;

  if (typeof a === "boolean" || typeof b === "boolean") {
    return (a === b ? 0 : a ? -1 : 1);
  }

  const aNum = typeof a === "number" ? a : Number(String(a).replace(/[₦$,\s%]/g, ""));
  const bNum = typeof b === "number" ? b : Number(String(b).replace(/[₦$,\s%]/g, ""));
  const bothNumeric = Number.isFinite(aNum) && Number.isFinite(bNum);

  // A key that names a date sorts as a date even when the value is numeric-ish
  const looksLikeDate = typeof key === "string" && DATE_KEY.test(key);
  if (looksLikeDate || a instanceof Date || b instanceof Date) {
    const aTime = a instanceof Date ? a.getTime() : Date.parse(a);
    const bTime = b instanceof Date ? b.getTime() : Date.parse(b);
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
  }

  if (bothNumeric) return aNum - bNum;

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * @param {Array} rows            the list to sort
 * @param {string|null} initialKey column to sort by on first render
 * @param {"asc"|"desc"} initialDir
 * @param {Object} accessors      optional { columnKey: (row) => value } overrides
 */
export function useTableSort(rows, initialKey = null, initialDir = "asc", accessors = {}) {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDir, setSortDir] = useState(initialDir);

  const toggleSort = useCallback((key) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const clearSort = useCallback(() => {
    setSortKey(null);
    setSortDir("asc");
  }, []);

  const sorted = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    if (!sortKey) return list;

    const accessor = accessors[sortKey];
    // Sort a copy — mutating the caller's array would fight React state.
    return [...list].sort((rowA, rowB) => {
      const a = accessor ? accessor(rowA) : getFieldValue(rowA, sortKey);
      const b = accessor ? accessor(rowB) : getFieldValue(rowB, sortKey);
      const result = compareValues(a, b, sortKey);
      return sortDir === "asc" ? result : -result;
    });
    // `accessors` is usually an inline object literal, so depending on it
    // directly would re-sort on every render; its key list stands in for it.
  }, [rows, sortKey, sortDir, Object.keys(accessors).join("|")]);

  return { sorted, sortKey, sortDir, toggleSort, setSortKey, setSortDir, clearSort };
}

function SortIcon({ state }) {
  return (
    <span className="th-sort-icon" aria-hidden="true">
      <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M6 2L9 6H3L6 2Z"
          fill="currentColor"
          opacity={state === "asc" ? 1 : 0.35}
        />
      </svg>
      <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M6 10L3 6H9L6 10Z"
          fill="currentColor"
          opacity={state === "desc" ? 1 : 0.35}
        />
      </svg>
    </span>
  );
}

/**
 * A clickable table header cell.
 *
 * @param {string} sortKey    the column this header sorts by
 * @param {string} activeKey  the currently sorted column
 * @param {string} dir        "asc" | "desc"
 * @param {Function} onSort   toggleSort from useTableSort
 * @param {"left"|"right"|"center"} align
 */
export function SortableTh({
  sortKey,
  activeKey,
  dir,
  onSort,
  children,
  align = "left",
  className = "",
  title,
  ...rest
}) {
  const isActive = activeKey === sortKey;
  const state = isActive ? dir : null;
  const ariaSort = isActive ? (dir === "asc" ? "ascending" : "descending") : "none";
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";

  return (
    <th
      scope="col"
      className={`th-sortable ${className}`}
      aria-sort={ariaSort}
      tabIndex={0}
      role="columnheader"
      title={title || `Sort by ${typeof children === "string" ? children : sortKey}`}
      onClick={() => onSort(sortKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(sortKey);
        }
      }}
      style={{ textAlign: align }}
      {...rest}
    >
      <span className="th-sortable-inner" style={{ justifyContent: justify }}>
        {children}
        <SortIcon state={state} />
      </span>
    </th>
  );
}

export default SortableTh;
