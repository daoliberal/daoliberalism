/**
 * Fidelity Gate G1 exceptions: the only prototype lines the app may lack, and the only extras it may add.
 *
 * Rules (plan, Fidelity Gate G1): an entry is either (a) a design-tool artefact of the prototype file or (b) a deliberate,
 * reasoned deviation. Nothing else is accepted. Every entry needs a reason a reviewer can check.
 *
 * Keep it easy to append to: ONE entry per line, entries SORTED BY `screen` (the tests check the order). Add yours at the end
 * of your screen's block. `screen` is the prototype file name without `.dc.html`.
 *
 * - kind "omitted": a prototype line (exact text, or a RegExp tested against the whole line) that the app does not show
 *   as written. G1 skips it. Use it for values the app must produce differently.
 * - kind "added": text the app shows that the prototype does not. G1 only checks prototype -> app, so this is a record for
 *   the G4 human review and the final report, not something the gate reads.
 */
export type CopyException =
  | { screen: string; kind: "omitted"; line: string | RegExp; reason: string }
  | { screen: string; kind: "added"; text: string; reason: string };

export const COPY_EXCEPTIONS: readonly CopyException[] = [
  { screen: "C-03-Treasury", kind: "added", text: "EqualSplit · <splitRule> ↗ links to the splitRule address", reason: "The EqualSplit label names the split-rule contract, so its link goes to that address (the prototype's links are dead); the other four rule links go to the treasury." },
  { screen: "C-04-CreateTreasury", kind: "omitted", line: "Low overhead, two-week hold, equal shares for every member.", reason: "The prototype's prefilled description sits inside a textarea; a textarea's value is not page text (innerText). The value is asserted in tests/screens/createTreasury.test.tsx." },
  { screen: "C-05-DAOs", kind: "added", text: "Paper Lantern Translation", reason: "Owner decision 2026-10-21: C-05 lists 7 DAOs. The prototype C-03 lists Paper Lantern Translation under Commonwealth, C-05 omits it." },
  { screen: "C-05b-DAO", kind: "omitted", line: "Product and brand copy, drafted and reviewed by agents. Customers order on the studio's own website.", reason: "Owner decision 2026-10-21: one description; C-05 version (the detail page shows the same text as the list)." },
  { screen: "C-05b-DAO", kind: "added", text: "0x4f2a…91c0", reason: "Names are not identity (plan Global Constraints): the Works under section shows the treasury address next to its name, which the prototype does not." },
  { screen: "C-06-CreateDAO", kind: "omitted", line: "Customer-support drafting for small online shops.", reason: "The prototype's prefilled description sits inside a textarea; a textarea's value is not page text (innerText). The value is asserted in tests/screens/createDao.test.tsx." },
  { screen: "C-07-Agents", kind: "added", text: "Name", reason: "Owner decision 2026-10-21 (vision section 13): the register and edit forms take Name and Description (stored as a data: URI) and the Metadata URL is optional; the prototype has only the key and the Metadata URL." },
  { screen: "C-07-Agents", kind: "added", text: "Description", reason: "Owner decision 2026-10-21 (vision section 13): the register and edit forms take Name and Description (stored as a data: URI) and the Metadata URL is optional; the prototype has only the key and the Metadata URL." },
  { screen: "C-07-Agents", kind: "added", text: "Enter a name or a metadata address.", reason: "Owner decision (vision section 13): shown when both Name and Metadata URL are empty; plan T9 neutral text." },
  { screen: "C-07-Agents", kind: "added", text: "Change one thing at a time: the key, the name and description, or the metadata address.", reason: "Owner decision SS8: an edit changes one thing per signature, so the other fields lock; this line says why." },
  { screen: "C-07-Agents", kind: "added", text: "Enter a valid 0x address.", reason: "Plan T9 validation text; the prototype draws no error states." },
  { screen: "C-07-Agents", kind: "added", text: "Use 80 characters or fewer.", reason: "Plan T9 validation text (Name limit); the prototype draws no error states." },
  { screen: "C-07-Agents", kind: "added", text: "Use 500 characters or fewer.", reason: "Plan T9 validation text (Description limit); the prototype draws no error states." },
  { screen: "C-07-Agents", kind: "added", text: "Use an https:// or ipfs:// address.", reason: "Plan T9 validation text (Metadata URL); the prototype draws no error states." },
  { screen: "C-07-Agents", kind: "added", text: "Enter a name.", reason: "Neutral validation text for an emptied Name in the edit form; the prototype draws no error states." },
  { screen: "C-07-Agents", kind: "added", text: "Enter the metadata address.", reason: "Plan T9 validation text for an emptied Metadata URL in the edit form." },
  { screen: "C-07-Agents", kind: "added", text: "Saving stores the profile on-chain in place of your metadata address.", reason: "Final-review I2: editing the name or description of an agent whose profile is a URL replaces that URL with a data: profile; this neutral line says so (new copy, owner approval)." },
  { screen: "C-07-Agents", kind: "added", text: "This profile is too large to update here.", reason: "Final-review I2: merging the edit into a large stored profile can exceed the 8 KiB data: URI cap; neutral error text (new copy, owner approval)." },
  { screen: "C-07-Agents", kind: "added", text: "On-chain profile", reason: "Shown instead of the long data: URI for an agent registered from a Name; the prototype only has ipfs:// and https:// addresses." },
  { screen: "C-07-Agents", kind: "added", text: "You haven't registered an agent yet.", reason: "Plan T9 empty state; the prototype always shows three agents." },
  { screen: "C-08-Earnings", kind: "added", text: "Claimed", reason: "Status of a credit after it is claimed; the prototype's ledger only shows unclaimed credits." },
  { screen: "C-08-Earnings", kind: "added", text: "never releases", reason: "Plan T17 (N3): a hold that never ends is shown in the release slot instead of a date." },
  { screen: "C-08-Earnings", kind: "added", text: "No credits yet.", reason: "Plan T9 empty state; the prototype always shows five credits." },
  { screen: "C-08-Earnings", kind: "added", text: "No claims yet.", reason: "Plan T9 empty state; the prototype always shows three claims." },
  { screen: "C-08-Earnings", kind: "added", text: "1 credit", reason: "Singular of the prototype's '3 credits' (summary box, claim history) when exactly one credit is meant." },
  { screen: "C-08-Earnings", kind: "added", text: "1 claim", reason: "Singular of the prototype's '3 claims' when exactly one claim exists." },
  { screen: "C-09-Approval", kind: "omitted", line: "Prototype · preview action", reason: "Design-tool tab strip that switches the preview; not part of the product." },
  { screen: "C-09-Approval", kind: "omitted", line: "Join DAO", reason: "Design-tool tab strip label (preview action tab)." },
  { screen: "C-09-Approval", kind: "omitted", line: "Spend", reason: "Design-tool tab strip label (preview action tab)." },
  { screen: "C-09-Approval", kind: "omitted", line: "Deploy treasury", reason: "Design-tool tab strip label (preview action tab)." },
  { screen: "C-09-Approval", kind: "omitted", line: "Create DAO", reason: "Design-tool tab strip label (preview action tab)." },
  { screen: "C-09-Approval", kind: "omitted", line: "Register agent", reason: "Design-tool tab strip label (preview action tab)." },
  { screen: "C-09-Approval", kind: "omitted", line: "Claim", reason: "Design-tool tab strip label (preview action tab)." },
  { screen: "C-09-Approval", kind: "omitted", line: "DAO registry · 0x2b51…d7e0 ↗", reason: "N1: the dialog names the contract the transaction goes to; createDao is sent to the DAO factory, so the label reads DAO factory." },
  { screen: "C-09-Approval", kind: "omitted", line: "Commonwealth 0x4f2a…91c0 · Lean Guild 0x8c11…02ab ↗", reason: "N1: claim is sent to the payment router, not to the treasuries listed in the prototype; the treasuries move to the Rules that apply line." },
  { screen: "C-09-Approval", kind: "omitted", line: "Hold periods ended: 7 days (Commonwealth), 14 days (Lean Guild).", reason: "N1: the treasury addresses that the prototype shows in the contract line are shown here, after each treasury name." },
  { screen: "C-09-Approval", kind: "omitted", line: /^Transaction 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} ↗$/, reason: "The prototype shows a fixed sample hash; the app shows the hash of the transaction that was actually sent." },
  { screen: "C-09-Approval", kind: "omitted", line: "Ox‑Relay is registered. You can now join DAOs with it.", reason: "C8: the done text names the registered agent by the form name, or Agent #id when a Metadata URL was used; the prototype always says Ox‑Relay." },
  { screen: "C-09-Approval", kind: "omitted", line: "Agent key 0x0b97…e2C4 is linked to your wallet as its owner. Its profile is read from ipfs://bafy…oxrelay.json.", reason: "An agent registered from the Name form has a data: profile, so applies to the Name path only: the line reads the registration file for <name> (new copy, owner approval). The Metadata URL path shows the line as written, asserted in approval-agent.spec.ts." },
  { screen: "C-M2-Treasury", kind: "added", text: "Spending history opens a sheet with the balance and history, plus a Close button; on the phone each spend is a stacked block (date and amount, recipient below, no transaction link) instead of the table", reason: "Owner decision 2026-10-21: the phone layout has no balance section, so the Spending history link (dead in the prototype, pointing at the desktop page) opens a bottom sheet." },
];

/**
 * G2 touch-target exceptions (a control under 44px that the prototype draws that way). `selector` is matched against every
 * button, input, select and nav link under 44px; pass `touchAllow(screen)` to `expectTouchTargets`. One entry per line.
 */
export type TouchTargetException = { screen: string; selector: string; reason: string };

export const TOUCH_TARGET_EXCEPTIONS: readonly TouchTargetException[] = [
  { screen: "C-02-Treasuries", selector: "[role=group][aria-label=View] button", reason: "Segmented Cards / Side by side buttons are 40px in the prototype (C-02-Treasuries:55); the group around them is 46px and every button is reachable." },
  { screen: "C-02-Treasuries", selector: "article label > input[type=checkbox]", reason: "The 20px Compare checkbox (C-02-Treasuries:75) sits inside a label that is 44px tall; the whole label is the touch target." },
  { screen: "C-M2-Treasury", selector: 'button[data-touch-exempt="spending-history"]', reason: "Spending history is a 13px text link in C-M2-Treasury:62; here it is a button that opens the history sheet." },
];

export const touchAllow = (screen: string): string[] => TOUCH_TARGET_EXCEPTIONS.filter((e) => e.screen === screen).map((e) => e.selector);
