// Forge tool: RESOLVER context routing. Given a repo file path, return the docs an
// agent should read before touching it (the "where information lives" primitive).
// Read-only; available to every role. Closes the token-tax of agents crawling the
// repo for context they could be handed directly (Pillar 5 + Brandon-A leverage).
import { resolveContext } from "../../resolve-context.mjs";

export default {
  name: "resolve_context",
  description: "RESOLVER: for a repo file path, return the focused context docs to read before editing it (instead of crawling the whole repo).",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "repo-relative file path you are about to work on" } },
    required: ["path"],
  },
  allowedRoles: ["*"],
  execute({ path }) {
    const r = resolveContext(path);
    return { path: r.path ?? path, matched: r.matched, globs: r.globs, docs: r.docs, why: r.why };
  },
};
