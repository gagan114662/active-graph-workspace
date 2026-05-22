# Skill: Provider Parity

Use for cross-provider LLM/tool work.

Rules:
1. No live network in tests.
2. Use provider-native fake clients, not only scripted providers.
3. Compare normalized event sequences, not just final output.
4. Inspect second-turn provider messages after tool calls.
5. Preserve existing reason taxonomy unless CONTRACT changes.

Output:
- provider fixture matrix
- normalized event comparison
- failure-path matrix

