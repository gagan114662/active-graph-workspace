# Skill: Adversary Regression

Use when a review or adversary pass finds a bug.

Steps:
1. Reproduce with literal command or minimal unit case.
2. Write a failing regression test.
3. Confirm it fails for the right reason.
4. Hand to Code Owner.
5. After fix, confirm the regression passes and full suite still passes.
6. Add bottleneck entry if the bug escaped prior gates.

Output:
- repro
- failing test hash
- fix verification hash

