---
paths:
    - "e2e-tests/ios/**"
---

# iPhone tests

- `phone.type()` taps each key on iOS's keyboard, which takes about 3 s for a
  six-letter search. Use it only when the test is about typing (the keyboard
  appears, the keys reach the input) or when the typing is filmed (a recording).
  When text only prepares a test, set it with a script.
