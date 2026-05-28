# RLS unblock kit (Gap A / P2a) — copy-paste executable

> **CORRECTION (2026-05-28, verified):** the bridge talks to **`auth.pentagon.run`** — Pentagon's
> **managed/hosted Supabase**, not the operator's own project. So **Option B (admin SQL) is almost
> certainly NOT available to the operator** — only Pentagon (the vendor) can run DDL on it. Verified
> locally: no service-role key, no `DATABASE_URL`, no logged-in supabase CLI; the REST path the daemon
> has is exactly what's RLS-blocked. **⇒ Option 0 (UX-seed via the Pentagon desktop app) is the real,
> only operator-accessible path** — it works because the app authenticates with the operator's full
> workspace/org membership (the auth context the RLS policies want), which the daemon JWT lacks.
> Option B below is kept only IF you (or Pentagon) ever get admin DB access. The `rpcDispatchToAgent`
> code path is harmless either way (it 404s → falls back to the REST path, which Option 0 unblocks).

Two ways to unblock reviewer dispatch. **Do Option 0 first (5 min, no SQL); Option B is the durable
fallback.** The code is already wired for both: `pentagon-rest.mjs::dispatchReviewer` now tries the
`dispatch_to_agent` RPC first (Option B) and falls back to the REST path (works after Option 0).

Root cause (confirmed in `pentagon-rls-investigation-20260528.md`): `INSERT INTO conversations`
returns RLS 403; READ conversations + INSERT messages into an existing conv both WORK.

---

## Option 0 — UX-seed the 2-party conversations (RECOMMENDED, 5 min, no SQL)
Once the convs exist, `findOrCreateConversation` short-circuits on the SELECT path and never hits the
blocked INSERT.

1. Open Pentagon.app.
2. Start a 2-party DM **Theo ↔ Rowan**; send any seed message ("flywheel dispatch seed").
3. Repeat **Theo ↔ Grace**, **Theo ↔ Theo** (self, optional).
4. Verify (no claude burn):
   ```
   node -e "import('./scripts/pentagon-rest.mjs').then(async ({findOrCreateConversation,AGENT_MAP})=>{ \
     console.log(await findOrCreateConversation(AGENT_MAP['theo'], AGENT_MAP['rowan'])); })"
   ```
   Prints a conversation id → unblocked. Reviewer dispatch now works via the REST fallback path.

---

## Option B — SECURITY DEFINER RPC (durable; survives new reviewer pairs automatically)
Run this in the Supabase SQL editor (project admin). It bypasses the conversations-INSERT RLS by
running as the function owner. The code already calls it first.

```sql
create or replace function public.dispatch_to_agent(
  p_sender_id uuid,
  p_target_id uuid,
  p_content   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv_id uuid;
  v_msg_id  uuid;
begin
  -- find an existing active EXACTLY-2-party conversation between sender + target
  select c.id into v_conv_id
  from conversations c
  where c.deleted_at is null
    and (select count(*) from conversation_participants p
         where p.conversation_id = c.id and p.left_at is null and p.deleted_at is null) = 2
    and exists (select 1 from conversation_participants p
         where p.conversation_id = c.id and p.user_id = p_sender_id and p.left_at is null)
    and exists (select 1 from conversation_participants p
         where p.conversation_id = c.id and p.user_id = p_target_id and p.left_at is null)
  limit 1;

  if v_conv_id is null then
    insert into conversations (title)
      values ('flywheel:' || left(p_sender_id::text,8) || '<->' || left(p_target_id::text,8))
      returning id into v_conv_id;
    insert into conversation_participants (conversation_id, user_id)
      values (v_conv_id, p_sender_id), (v_conv_id, p_target_id);
  end if;

  -- ⚠ VERIFY messages column names against your schema before running:
  --   this assumes (conversation_id, sender_id, content). Adjust if different.
  insert into messages (conversation_id, sender_id, content)
    values (v_conv_id, p_sender_id, p_content)
    returning id into v_msg_id;

  return jsonb_build_object('conversation_id', v_conv_id, 'message_id', v_msg_id);
end;
$$;

grant execute on function public.dispatch_to_agent(uuid, uuid, text) to authenticated;
```

### Assumptions to verify before running (the schema isn't fully exposed via PostgREST)
1. **`messages` columns** — the function assumes `(conversation_id, sender_id, content)`. If your
   schema uses `body` instead of `content`, or a different sender column, edit the INSERT.
2. **`conversation_participants` columns** — assumes `(conversation_id, user_id, left_at, deleted_at)`.
   The REST code also sets `owner_id`; if that column exists + is NOT NULL, add it to the INSERT.
3. **Trigger creation** — confirmed: inserting a message auto-creates an `agent_triggers` row (the
   probe proved it). No extra step needed.
4. **Function owner** — `security definer` runs as the role that OWNS the function. Create it as a
   role that bypasses RLS on these tables (typically the table owner / `postgres`), else it'll still
   hit RLS. If unsure, create as the Supabase owner role.

### Verify after creating it
```
node -e "import('./scripts/pentagon-rest.mjs').then(async ({rpcDispatchToAgent,AGENT_MAP})=>{ \
  console.log(await rpcDispatchToAgent(AGENT_MAP['theo'], AGENT_MAP['rowan'], 'rls rpc probe')); })"
```
Non-null `{conversation_id, message_id}` → working. Then `dispatchReviewer` reports
`dispatch_path: "rpc_security_definer"`.

---

## After EITHER option
Reviewer dispatch (Rowan/Theo/Grace) goes live → `flywheel.review.completed` events fire →
`judge-error-detector` + the eval loop (P19/P20) finally have REAL reviews to grade (not synthetic) →
the per-judge accuracy stats become real. This is the keystone that opens the eval-the-eval half.
