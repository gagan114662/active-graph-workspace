# Skill: Frame Registration

Use when opening a new gauntlet frame.

Steps:
1. Confirm previous frame status is closed.
2. Create `frames/<id>.yaml` with goal, constraints, permissions, owners,
   success criteria, and bottleneck seeds.
3. Create `frames/<id>.dispatch.log`.
4. Commit and push the frame before assigning owners.
5. DM owners with the frame hash and exact required artifacts.

Output:
- outer commit hash
- frame yaml path
- dispatch log path
- owner handoff list

