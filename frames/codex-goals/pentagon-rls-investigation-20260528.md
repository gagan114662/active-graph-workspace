# Pentagon RLS blocker investigation (Gap A)

**Status:** investigation note, ready for operator action
**Created:** 2026-05-28
**Owner:** operator (RLS policies require Supabase project admin)
**Audit reference:** end-of-session pt.7 audit, marked "biggest single win available"

## The actual symptom

Per CLAUDE.md pt.7 closing report:
> A: Pentagon RLS blocks reviewer dispatch in production. Phoenix's fallback runs (direct commit, no review), but the eval-the-eval substrate has nothing real to grade until this is resolved.

Translated: when Phoenix calls `pentagon-rest.mjs::dispatchReviewer` to send Rowan a code-review prompt, the Supabase REST insert into `conversation_participants` (or `conversations`) returns 403 because the RLS policies on those tables only allow inserts where the authenticated user matches certain ownership criteria — and Phoenix's bridge-supplied JWT context doesn't satisfy them when the conversation is between two agents Phoenix itself doesn't "own."

The fallback path (`commitAndPushFromWorktree` runs without the review gate) ships SAFE code because pytest still passes, but skips the eval-the-eval-load-bearing Rowan verdict event entirely — making the per-judge-accuracy stats artificial.

## The exact failure modes (most-likely → least-likely)

Based on what `findOrCreateConversation` is doing + what `dispatchReviewer` adds:

### Mode 1 (most likely): conversation_participants INSERT 403
`findOrCreateConversation` first does a SELECT (succeeds via the daemon JWT), but if no exactly-2-party conv exists it POSTs to `/rest/v1/conversations` then `/rest/v1/conversation_participants`. The conversations table likely has an RLS policy like `INSERT WITH CHECK (owner_id = auth.uid())` — which works because we set `owner_id = operatorId()` from the bridge JWT. Good.

But `conversation_participants` likely has `INSERT WITH CHECK (user_id IN (auth.uid()) OR user_id IN (SELECT agent_id FROM operator_agents WHERE owner_id = auth.uid()))` or similar. If Phoenix's daemon JWT is the **operator's own session token** (which it is — bridge inherits operator JWT from the Pentagon plist), the operator should pass the agent-ownership check. But it might fail because:

- The agent_id Phoenix is inserting (Rowan = `c95dba90-...`, Theo = `1343cc84-...`) might not be in the operator's `operator_agents` table even though Pentagon ships them
- OR the policy compares `user_id` directly to `auth.uid()` and doesn't have the operator-owns-these-agents extension at all

### Mode 2: messages INSERT 403
Even if the conv + participants succeed, the `insertMessage` (POST `/rest/v1/messages`) could 403. Messages typically have `INSERT WITH CHECK (sender_id = auth.uid() OR sender_id IN (operator's agents))`. Same operator-ownership wrinkle.

### Mode 3: race condition where conv exists but participants are missing
If a prior dispatch created the conv but rolled back the participant inserts, future dispatches would find the conv (Mode 1 select passes) but find the participant set != 2 (Mode 1 select returns ≠ 2 rows). The code falls through to create a fresh one → same RLS wall.

### Mode 4: trigger-row visibility
Even if everything above succeeds, Pentagon's server-side function that auto-creates `agent_triggers` from `messages` MIGHT have RLS-incompatible service-role expectations. Test: did the message actually land?

## Reproducible test (operator runs this, no claude burn)

```bash
# Test 1: can the bridge JWT find Theo↔Rowan?
node -e "
import('./scripts/pentagon-rest.mjs').then(async ({findOrCreateConversation, request, AGENT_MAP, operatorId}) => {
  const theo = AGENT_MAP['theo'];
  const rowan = AGENT_MAP['rowan'];
  console.log('theo=', theo, 'rowan=', rowan, 'operator=', operatorId());
  try {
    const id = await findOrCreateConversation(theo, rowan);
    console.log('findOrCreate OK:', id);
  } catch (e) {
    console.log('findOrCreate FAILED:', e.message.slice(0, 500));
  }
});
"

# Test 2: dispatchReviewer end-to-end (sends a NULL diff so we can verify dispatch landed without burning cost)
node -e "
import('./scripts/pentagon-rest.mjs').then(async ({dispatchReviewer}) => {
  try {
    const r = await dispatchReviewer({
      reviewerAgentKey: 'rowan',
      todo: {id: 'test-rls-probe', title: 'rls test', failure_reason: 'test'},
      diff: '--- /dev/null\n+++ /dev/null\n',
      rationale: 'rls probe — operator initiated',
      testSummary: 'n/a',
    });
    console.log('dispatchReviewer OK:', JSON.stringify(r));
  } catch (e) {
    console.log('dispatchReviewer FAILED:', e.message.slice(0, 500));
  }
});
"
```

If Test 2 prints `OK` + a message_id, you'll see Pentagon create an agent_trigger for Rowan within ~1s and the bridge dispatch Rowan via claude.

If it prints `FAILED 403`, the error message will reveal WHICH policy fired (usually mentioning the table name + policy name).

## Three operator-side options to unblock

### Option A: extend Phoenix's auth path with a service-role JWT

**Cost:** highest. Risk: medium (service role bypasses ALL RLS — must scope carefully).

Add `FACTORY_SERVICE_ROLE_JWT` env var to Phoenix's plist. Pentagon-rest gains a second auth path:

```js
// pentagon-rest.mjs
export async function request(path, opts = {}) {
  // ...
  const auth = opts.useServiceRole && process.env.FACTORY_SERVICE_ROLE_JWT
    ? `Bearer ${process.env.FACTORY_SERVICE_ROLE_JWT}`
    : `Bearer ${state.accessToken}`;
  // ...
}
```

`dispatchReviewer` passes `useServiceRole: true`. **WARNING**: rotation pain — service role JWTs don't rotate, they're long-lived. Compromised JWT = total db access.

### Option B (recommended): add a Postgres function `dispatch_to_agent(target_agent_id, content)` invoked from the daemon

Operator writes a `SECURITY DEFINER` Postgres function that bypasses RLS for this one path. Phoenix calls `POST /rest/v1/rpc/dispatch_to_agent { target_agent_id, content }`. The function itself does the conv+participants+message inserts as the operator, all checked at compile time. Tight scope.

```sql
CREATE OR REPLACE FUNCTION dispatch_to_agent(
  target_agent_id UUID,
  message_content TEXT,
  sender_agent_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_conv_id UUID;
  v_sender UUID := COALESCE(sender_agent_id, '<theo-uuid>');
  v_owner UUID := auth.uid();
  v_message_id UUID;
BEGIN
  -- find or create 2-party conv
  SELECT cp1.conversation_id INTO v_conv_id
  FROM conversation_participants cp1
  JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
  WHERE cp1.user_id = v_sender AND cp2.user_id = target_agent_id
    AND cp1.left_at IS NULL AND cp2.left_at IS NULL
    AND (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = cp1.conversation_id AND left_at IS NULL) = 2;

  IF v_conv_id IS NULL THEN
    INSERT INTO conversations (title, owner_id)
    VALUES ('flywheel:' || substr(v_sender::text,1,8) || '<->' || substr(target_agent_id::text,1,8), v_owner)
    RETURNING id INTO v_conv_id;
    INSERT INTO conversation_participants (conversation_id, user_id, owner_id)
    VALUES (v_conv_id, v_sender, v_owner), (v_conv_id, target_agent_id, v_owner);
  END IF;

  INSERT INTO messages (conversation_id, sender_id, content)
  VALUES (v_conv_id, v_sender, message_content)
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION dispatch_to_agent TO authenticated;
```

Phoenix's `dispatchReviewer` then becomes:
```js
const msgId = await request("/rest/v1/rpc/dispatch_to_agent", {
  method: "POST",
  body: { target_agent_id: reviewerId, message_content: content, sender_agent_id: senderId },
});
```

Tight scope, single replaceable function, no env-var secrets to rotate.

### Option C: just add Phoenix as an agent that owns the inserts

Pentagon may already have a notion of "system agents" that can insert into conversations across owners. If `Theo` (the SENDER_AGENT_KEY) is already a system agent, the existing path might just be broken at the participant-insert step. Cheapest: try POSTing to `conversation_participants` with the operator's `Authorization` JWT + see what specifically errors. If the message says "policy X failed" then the policy is the blocker; if it says "auth.uid() returned null" or similar, the JWT itself is the problem (rotated/expired).

## Why I (Claude) can't just fix this

- Modifying Supabase RLS policies requires Supabase project admin access (operator's account)
- Creating SQL functions like Option B requires `service_role` privileges
- Neither is exposed to a daemon's auth token — by design

## Recommended next-session order

1. **Operator runs Test 1 + Test 2** above. The exact error message reveals which policy fires.
2. Pick **Option B** (Postgres function) — tight scope, no JWT rotation pain.
3. Once the function exists, edit `pentagon-rest.mjs::dispatchReviewer` to use the RPC.
4. End-to-end test: emit a real (not synthetic) failure that routes to flywheel. Watch judge-error-detector + Phoenix complete loop with REAL Rowan verdict.
5. After ≥5 real Rowan PASS verdicts land (with their downstream commit + test green), the eval-the-eval substrate has its first real accuracy numbers.

## Workaround already in place

CLAUDE.md pt.7 audit fix #C (`handleReviewMalformed` subscribes to `flywheel.review.malformed`) means when dispatchReviewer fails for ANY reason (RLS, network, missing rubric), Phoenix doesn't stall — it falls back to direct commit. Loop stays closed; quality gate is just degraded.

So this is NOT a "factory broken" gap — it's a "factory at 60% of quality potential" gap. Real but bounded.
