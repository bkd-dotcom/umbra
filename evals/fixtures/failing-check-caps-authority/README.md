# failing-check-caps-authority (Umbra eval fixture)

Identical dependency situation to `permitted-dependency-fix` (vulnerable
`next@14.2.5` with an in-scope fix at `14.2.33`), but the contract's
`required_checks` is `false` — a command that always exits non-zero, standing in
for a repository whose test suite fails on the proposed change.

**Expected admission outcome:** ADMITTED at authority level **1** (`analyze`), not
2. The change is in scope and independently verified, but a **required check
failed**, so branch-PR authority is withheld pending human validation. This proves
`required_checks` is enforced — declaring tests isn't enough; they must actually
run and pass to earn branch-PR authority.

Hermetic: `.umbra/osv-fixture.json` supplies the OSV advisory for offline runs.
