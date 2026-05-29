"""A deliberately VACUOUS oracle: ignores its input and always passes. The
Meta-Referee must REJECT it (its negative control will wrongly 'pass')."""
import sys
print("VACUOUS_PASS: ignores input, always passes"); sys.exit(0)
