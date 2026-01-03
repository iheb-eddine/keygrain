# Keyboard Navigation — Keygrain Popup

## Behavior

| Key | Context | Action |
|-----|---------|--------|
| ArrowDown | Search focused | Move visual focus to first service row (or next) |
| ArrowUp | Service row focused | Move to previous row; if at top, return focus to search |
| ArrowDown | Service row focused | Move to next row |
| Enter | Service row focused | Fill password for that service |
| Escape | Dialog open | Close dialog |
| Escape | Search has text | Clear search |
| Escape | Otherwise | Close popup |

Arrow Left/Right/Up in the search input are never intercepted — normal cursor movement.

## ARIA Pattern (combobox + listbox)

- `#search`: `role="combobox"`, `aria-controls="service-list"`, `aria-expanded`, `aria-activedescendant`
- `#service-list`: `role="listbox"`
- Each `.service-item`: `role="option"`, `id="service-item-{idx}"`, `tabindex="-1"`, `aria-selected`

Only the visually focused row has `aria-selected="true"`. Screen readers announce it via `aria-activedescendant` on the search input.

## Visual

Focused row gets `.service-item.focused` — subtle background highlight (`#f0f4ff`).

## Implementation

- CSS: `.service-item.focused` style
- JS: Document keydown listener, `focusedIndex` state, reset on re-render
