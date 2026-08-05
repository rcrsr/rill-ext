<!--
Keep the sections that carry weight for this change and delete the rest.
Summary and Verification are the two that always earn their place.

Prose beats bullet fragments here. Name files, symbols, and line numbers, and
show the command output you are claiming. A reviewer should be able to re-run
what you ran.
-->

## Summary

<!-- What the code does now, in a few sentences. Lead with the change, not the
file count. -->

## Why

<!-- The defect or gap this closes, and what a host embedding the extension
gains. If an issue already argues this, link it and keep this short. -->

## Approach

<!-- The judgement calls, not a file-by-file walkthrough. Cover anything a
reviewer would otherwise have to reconstruct: why this error atom, why this
return shape, what you rejected and what it cost.

If an issue settled a design, say where this follows it and where it departs.
An unflagged deviation costs a review cycle. -->

## Boundary surface

<!-- Delete if this changes no host function.

New or changed parameters, returned dict keys, and error atoms — the things a
rill script sees. Confirm every key is snake_case and every atom comes from
rill core's generic taxonomy rather than a new constant. -->

## Verification

<!-- Concrete commands and their real output. Numbers, not adjectives.

  pnpm check                                  exits 0
  pnpm --filter @rcrsr/rill-ext-<name> test   <N> passed

State what you did NOT verify as plainly as what you did. If a change has no
runtime surface to exercise, say so and say why. -->

## Risk

<!-- Behaviour that changes for existing consumers, new failure modes, anything
loud that used to be quiet. A change under packages/shared/ ships inside every
extension that bundles it — name them. Delete if genuinely none. -->

## Follow-up

<!-- Work this deliberately leaves out, and why it is out of scope here. Delete
if none. -->

---

Closes #

<!--
Before requesting review:

- `pnpm check` passes locally. CI repeats it across the Node matrix, plus
  CodeQL, dependency review, and the repository standards check.
- Tests execute and the count is what you expect. A suite that fails to import
  reports as a file-level failure, not as failing tests, so a broken import can
  read as "no failures" at a glance.
- New tests fail when the change is reverted. A test that passes without your
  implementation is measuring something else.
- For anything that gates, filters, or validates: the adversarial cases are
  covered, not only the happy path. See CONTRIBUTING.md.
- No credential reaches a return value, an error message, or an emitted event.
- Boundary dict keys and parameter names are snake_case.
- No new `EXT_*` error constants; provider specifics go in meta.provider and
  meta.raw.kind.
- No internal planning IDs (`AC-*`, `EC-*`, `IR-*`) in `src/`.
- `node_modules/@rcrsr/rill-dev` is unpatched. Fixes to the standards checker or
  the custom lint rules go upstream to rcrsr/rill, then arrive as a bump.
- `CHANGELOG.md` and every `version` field are unchanged. Maintainers handle
  releases.
-->
