/**
 * The filter behind `<Combobox>`: a case-insensitive **substring** match over
 * an option's visible label.
 *
 * Substring, which is the opposite of the prefix match `findTypeaheadMatch`
 * does for the listbox and the menu, and the two are right for opposite
 * reasons. A typeahead is a shortcut to somewhere in a list you can already
 * see, so it matches the way you would read down it — "n" takes you to the
 * next thing starting with N. A combobox's filter is a search over a list you
 * cannot see, and "york" failing to find "New York" is the single most common
 * complaint about a filter that anchors to the start.
 *
 * It lives in `lib/` rather than beside the component because a module that
 * exports both a component and a plain function loses Fast Refresh for the
 * component — `react-refresh/only-export-components`, which this repository
 * lints as an error.
 *
 * Constrained to `{ label: string }` rather than typed against
 * `ListboxOption`, so `shared/lib` keeps its habit of importing nothing from
 * the slices above it, and so the returned array stays the caller's element
 * type instead of being widened to the constraint.
 */
export function filterOptions<TOption extends { label: string }>(
  options: readonly TOption[],
  query: string,
): readonly TOption[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return options;
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}
