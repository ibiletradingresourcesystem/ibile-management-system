/**
 * Archiving a product, in one place.
 *
 * "Delete" in this system archives instead of destroying, and an archived product has
 * to disappear everywhere it was on sale — the till and the web shop both read the same
 * product records. Setting `isArchived` is what hides it; `showOnWeb` is cleared as well
 * so anything that only looks at that flag also stops showing it. The old value is kept
 * in `archivedShowOnWeb`, so restoring puts the product back the way it was rather than
 * quietly republishing it to the shop.
 */

/** Fields to set when archiving. `product` is the record as it stands. */
export function archiveFields(product, reason = "manual-delete") {
  return {
    isArchived: true,
    archivedAt: new Date(),
    archivedReason: reason,
    // Stock in an archived product is not stock anyone can sell.
    quantity: 0,
    showOnWeb: false,
    archivedShowOnWeb: product?.showOnWeb !== false,
  };
}

/** Fields to set when restoring, putting web visibility back as it was. */
export function restoreFields(product) {
  return {
    isArchived: false,
    archivedAt: null,
    archivedReason: "",
    showOnWeb: product?.archivedShowOnWeb !== false,
    archivedShowOnWeb: undefined,
  };
}
