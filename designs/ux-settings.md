# Settings Page

## Access
Gear icon (⚙) in the popup header bar, next to the lock button. Toggles an inline settings panel.

## Fields
| Field | Type | Default | Storage key |
|-------|------|---------|-------------|
| Auto-lock timeout | number (minutes, min 1) | 15 | settings.autoLockMinutes |
| Default password length | number (min 8) | 20 | settings.defaultLength |
| Default symbols | text | !@#$%&*-_=+? | settings.defaultSymbols |
| Server URL | text (https:// required) | https://keygrain.secbytech.com | settings.serverUrl |

## Storage
`chrome.storage.local` under key `"settings"` as a plain JSON object. Not encrypted — values are not sensitive.

## Integration
- **Add service dialog**: pre-fills length and symbols from settings
- **Sync (backup/restore)**: uses settings.serverUrl instead of hardcoded SYNC_SERVER
- **Auto-lock alarm**: background reads settings.autoLockMinutes on each alarm reset

## Validation
- Server URL must start with `https://`
- Auto-lock timeout must be ≥ 1
- Default length must be ≥ 8
- Default symbols must not be empty
