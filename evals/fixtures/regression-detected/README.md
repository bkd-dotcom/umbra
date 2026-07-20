# regression-detected (Umbra eval fixture)

Vulnerable `next@14.2.5` with an in-scope fix at `14.2.33`. The contract's required
check is `make test`, backed by a `Makefile` whose `test` target passes only while
`package.json` still pins `14.2.5` — i.e. it **passes on the base commit** and
**fails after the dependency bump**, standing in for a repository whose suite is
green until the proposed change breaks it.

**Expected admission outcome:** ADMITTED at authority level **1** (`analyze`), with
`check_diagnosis.status == "regression"`. Baseline comparison (required checks run
on the pristine base commit *and* after the change) lets Umbra state that the
patch itself introduced the failure — distinct from `failing-check-caps-authority`,
where the suite was already red. Branch-PR authority is withheld either way; the
diagnosis just makes the reason precise.

Hermetic: `.umbra/osv-fixture.json` supplies the OSV advisory for offline runs.
