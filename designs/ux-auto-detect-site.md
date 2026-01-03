# Auto-Detect Current Site

## Summary

When the popup opens and the user is unlocked, detect the active tab's domain and either auto-filter matching services or offer to add the domain as a new service.

## Detection

After unlock (in the Init section and after `showMainScreen()`):

```js
const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
let currentHostname = null;
if (tab?.url) {
  try {
    currentHostname = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {}
}
```

Store `currentHostname` as module-level state for reuse by quick-add and other features.

## Matching Logic

Bidirectional case-insensitive contains:

```js
const matches = services.filter(s => {
  const name = s.name.toLowerCase();
  const host = currentHostname.toLowerCase();
  return name.includes(host) || host.includes(name);
});
```

**Known limitation:** Very short service names (e.g., "a") would match everything. Acceptable given typical service names are domains or brand names.

## Behavior

### Match found (≥1 service)

Set the search input to the hostname and re-render:

```js
searchInput.value = currentHostname;
renderServiceList();
```

The existing filter logic handles highlighting. User can clear the search to see all services.

### No match

Show a subtle link above the service list:

```
"Add [hostname]?" → click opens add-dialog with addName pre-filled to hostname
```

The link is removed if the user clears it or navigates away.

## State

| Variable | Scope | Purpose |
|----------|-------|---------|
| `currentHostname` | module-level | Reused by quick-add, fill suggestions |

## Permissions

No new permissions needed — `chrome.tabs.query` for the active tab is already available to the popup without the `tabs` permission (only URL access requires `activeTab`, which the extension already has for the fill feature).
