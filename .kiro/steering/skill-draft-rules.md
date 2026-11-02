# Skill Totem Draft — Anti-Softlock Rules

The training-cell totem draft (GDD §4A, implemented in `src/shared/draft.js`)
must satisfy the **strong** anti-softlock guarantee, not just the literal wording
of the GDD.

- GDD wording: "The 6 totems must ALWAYS offer at least four 0-Gold or affordable
  skills to ensure no player gets soft-locked without a 4-skill build."
- **Problem with the literal reading:** "4 individually affordable" is not enough.
  A player buying cheapest-first can still be stranded below 4 skills if the 4
  cheapest offered totems *collectively* cost more than their gold (e.g. four
  15-gold Earth skills = 60 > 50 starting gold).
- **Rule we enforce:** the **sum of the 4 cheapest offered totems must be ≤ the
  player's gold**. This makes a complete 4-skill build always reachable by
  buying cheapest-first.

Verified by `test/data.test.js` → "STRONG anti-softlock: the 4 cheapest totems
are COLLECTIVELY affordable" (2,500 drafts across all monsters; worst-case sum is
exactly the budget, never over).

When editing the draft generator, keep this property green.
