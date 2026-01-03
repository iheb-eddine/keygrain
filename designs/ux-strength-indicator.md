# Password Strength Indicator

## Summary

A thin colored bar below each service name indicating password strength based on configured length.

## Strength Tiers

| Length | Label  | Color        | Bar Width |
|--------|--------|--------------|-----------|
| 8–12   | Fair   | #e67e22 (orange) | 40%   |
| 13–19  | Good   | #8bc34a (yellow-green) | 70% |
| 20+    | Strong | #27ae60 (green) | 100%  |

## Rationale

Keygrain always includes uppercase, lowercase, digits, and symbols — so charset diversity is constant. Strength reduces to password length.

## Implementation

- CSS: `.strength-bar` with height 3px, border-radius, transition
- JS: In `renderServiceList`, append a strength bar div inside `.service-info` based on `svc.length`
- Accessibility: `aria-label` on the bar element (e.g., "Password strength: Strong")
