// Printed part numbers. Parts are referenced by their stable ids from layout.js,
// and the label each one prints with is resolved per document.

import { createContext, useContext } from "react";
import { SCRIPT_PARTS } from "./layout";

// handles build part labels
// Maps each included part id to the number it prints as.
export function buildPartLabels(parts) {
  return Object.fromEntries(parts.map((part) => [part, String(part)]));
}

// handles format part title
export function formatPartTitle(part, labels) {
  const label = labels[part];
  return label ? `Part ${label} – ${SCRIPT_PARTS[part].name}` : null;
}

export const PartLabelsContext = createContext({});

// handles use part title
// Returns null when the part is not in the current document.
export function usePartTitle(part) {
  return formatPartTitle(part, useContext(PartLabelsContext));
}
