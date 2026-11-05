---
paths:
    - "e2e-tests/ios/**"
---

# iPhone tests

- `phone.type()` taps each key on iOS's keyboard, which takes about 3 s for a
  six-letter search. Use it only when the test is about typing (the keyboard
  appears, the keys reach the input) or when the typing is filmed (a recording).
  When text only prepares a test, set it with a script.
- **Set up the screen by script, the same in every run** (D-216). A real touch
  is only for what the test is about. A flick's glide ends somewhere else each
  run, so a flick for setup makes the test pass or fail by chance. Random real
  swipes belong in `e2e-tests/ios/explore/`.
