# Product Test Cases: Admin-Only Rental Manager

## Product Scope

The active product supports owner-operated work only: overview, room management, manual payment confirmation, meter rollover, Admin-issued invoices, and invoice history. Customer QR lookup, customer invoice requests, issue reports, and chat are removed from navigation and data loading. Some dormant markup/handlers remain in the source snapshot but have no active navigation or loaded inbox data. Legacy `invoiceRequests`, `issues`, and `chats` records are not deleted.

## Test Matrix

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| AUTH-01 | Open without an Admin session | Login screen is shown; Admin workspace stays hidden; customer route is not in the navigation. | Needs fresh browser session |
| AUTH-02 | Wrong Admin password | Remains on login; no management data is loaded. | Not run in shared browser; session was previously authenticated |
| NAV-01 | Inspect navigation | Exactly three tabs: overview, rooms, invoice history. Removed tab IDs are rejected. | PASS: source and static smoke test |
| NAV-02 | Switch tabs on desktop/mobile | Active state and page title change; mobile drawer opens/closes; no horizontal overflow. | Needs fresh browser viewport test |
| DATA-01 | Load workspace with legacy request/chat/issue data present | Active loader reads only `rooms` and `invoices`; legacy inbox records remain untouched in Firebase. | PASS: source inspection |
| ROOM-01 | Save an empty/whitespace-only or duplicate room name | Show validation message; make no database write. | Guard implemented; integration requires Emulator |
| ROOM-02 | Submit room 13 when 12 already exist, including direct submit | Reject; room count remains 12. | Guard implemented; integration requires Emulator |
| ROOM-03 | Save a rented room with missing tenant, 0/negative/fractional occupants | Reject; tenant required and occupants must be a positive integer. | Guard implemented; integration requires Emulator |
| ROOM-04 | Enter negative price/rate/service or a meter reading below the old reading | Reject before write. | Guard implemented; integration requires Emulator |
| BILL-01 | Attempt payment toggle or invoice for a vacant room | Payment and invoice controls disabled; direct handlers reject before write. | PASS: source guard present; integration requires Emulator |
| BILL-02 | Rent 1,500,000; electricity 100→110 at 4,000; two occupants; water 0→10; quota 4 m³/person at 14,000 and excess at 20,000 | Electricity 40,000 + water 152,000 + rent = **1,692,000**. | PASS: pure calculation fixture |
| BILL-03 | No water quota, two occupants, zero usage, normal rate 20,000 | Minimum water charge is **40,000**. | PASS: pure calculation fixture |
| CLOSE-01 | Close a month with new meter reading 0 | Store 0 as next opening reading; mark rooms unpaid; save the closed period on each room. | Guard logic implemented; write test requires Emulator |
| CLOSE-02 | Close same calendar period again, including after editing a room | Reject; a room's period marker persists through room edits and button remains disabled. | Guard logic implemented; write test requires Emulator; deleting every room removes these markers |
| REV-01 | Current month has a paid invoice and room currently marked paid | Count the paid room once using room state, not invoice plus room. Historical invoices are deduplicated per room/month. | PASS: source logic and duplicate guard |
| INV-01 | Admin issues an invoice for a rented room | Save history record with room ID and amount, then open the print dialog. | Write/print test requires Emulator |
| INV-02 | Inspect invoice history | History remains available for review; no single/all delete controls or delete handlers are exposed. | PASS: source inspection |
| ERR-01 | Firebase write fails while an action is locked | Show an error and restore loading/button state. | Error catch/finally implemented; failure simulation requires Emulator rules fixture |
| LEGACY-01 | Old request/issue/chat data exists | Loader does not read those branches and no inbox tabs are exposed; dormant legacy markup/handlers remain in source and should be removed in a dedicated cleanup. | PASS: active path checked; data untouched |

## Safe Test Boundary

Do not run CRUD, payment, invoice, or month-close tests against the configured production Realtime Database. `loadAllData` can normalize room records by writing them back. This workspace has no Firebase Emulator configuration, so all write-path test cases are marked Emulator-required and were not executed against production.
