# Known Issues

## Glob Matching

The simulator now aligns with Romulus for the common cases that matter most in real configs:

- file-name-only matching
- lowercase matching
- literal parentheses like `(Japan)`
- literal leading `!` and `#`
- leading-dot file names
- no Bash extglob support

There are still a few edge cases where the simulator's `minimatch` behavior can differ from the Android app's JDK glob behavior:

- POSIX character classes like `[[:alpha:]]`
- `[^a]` inside bracket expressions
- nested brace groups like `a{b,{c,d}}e`

If a glob depends on one of those patterns, treat the simulator result as advisory and verify it in the Android app
