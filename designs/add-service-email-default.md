# Design: Pre-fill Email Field in AddServiceDialog

## Summary

When adding a new service, the email field should default to the user's most common email (from `getMostCommonEmail()`). The user can still edit it freely. Edit mode is unaffected.

## Change

Add a `defaultEmail: String = ""` parameter to `AddServiceDialog`. Change the email state initialization from:

```kotlin
var email by remember { mutableStateOf(initialEntry?.email ?: "") }
```

to:

```kotlin
var email by remember { mutableStateOf(initialEntry?.email ?: defaultEmail) }
```

At the prefillSite call site (line 816), pass `defaultEmail = getMostCommonEmail()`. The edit call site (line 835) needs no change — `initialEntry` already provides the email.

---

## 1. Frozen Requirements

| # | Requirement |
|---|-------------|
| FR-1 | When AddServiceDialog opens for a **new** service, the email field MUST be pre-filled with the most common email across existing services. |
| FR-2 | The user MUST be able to edit the pre-filled email to any value. |
| FR-3 | When no services exist (empty list), the email field MUST default to empty string (current behavior preserved). |
| FR-4 | When editing an existing service, the email field MUST show that service's saved email, NOT the most common email. |

## 2. Invariants

| # | Invariant |
|---|-----------|
| INV-1 | `initialEntry?.email` always takes precedence over `defaultEmail` — edit mode is never affected by the default. |
| INV-2 | The email field remains a standard editable `TextField` — pre-filling does not lock or constrain input. |
| INV-3 | `getMostCommonEmail()` is pure (derives from `services` list) — no new state, no side effects. |
| INV-4 | If all services have distinct emails (no "most common"), the function returns one of them arbitrarily — this is acceptable since the user can edit. |

## 3. Scope Boundary

### In Scope

- Add `defaultEmail` parameter to `AddServiceDialog`
- Pass `getMostCommonEmail()` at the new-service call site (line 816)
- Update email state initialization to use `defaultEmail` as fallback

### Out of Scope

- Edit dialog behavior (line 835) — already correct
- WalletScreen — already has its own pattern
- Creating a new function — `getMostCommonEmail()` already exists
- Changing how `getMostCommonEmail()` computes the result
- Any UI changes beyond the initial value of the email field

## 4. Test Plan

All tests are manual (no UI test framework in scope).

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| T-1 | New service with existing services | Have 3+ services with same email. Tap add. | Email field shows that common email. |
| T-2 | User can edit pre-filled email | Open add dialog, change the pre-filled email. Save. | Service saved with the edited email. |
| T-3 | No existing services | Fresh app, no services. Tap add. | Email field is empty. |
| T-4 | Edit existing service | Long-press a service, tap edit. | Email field shows that service's email, not the most common one. |
| T-5 | Prefill site flow | Click a link that triggers prefillSite. | Email is pre-filled with most common email; site is pre-filled from the link. |
| T-6 | All unique emails | Have 3 services each with different email. Tap add. | Email field shows one of them (any is acceptable). |
| T-7 | Single service exists | Have 1 service. Tap add new. | Email field shows that service's email (it is the most common by default). |
