---
paths:
    - "docs/images/**"
    - "README.md"
    - "e2e-tests/screenshots.spec.ts"
    - "e2e-tests/recording.spec.ts"
    - "e2e-tests/screencast.ts"
    - "e2e-tests/ios/recording.spec.ts"
    - "e2e-tests/ios/screen-capture.ts"
    - "scripts/recording.mjs"
    - "scripts/capture-iphone.swift"
    - "scripts/draw-touches.swift"
---

# README captures

```bash
pnpm run capture:screenshots   # take the README's screenshots again, into docs/images/, from the demo vault
pnpm run capture:recording     # record only docs/images/demo-desktop.webp again, the README's desktop recording
pnpm run capture:recording:ios # record only docs/images/demo-phone.webp again, on the plugged-in iPhone
pnpm run capture:listing       # the desktop and mobile images for the plugin directory, into .dev/listing/cards/ (D-161)
```

- The directory images are uploaded by hand, under **Edit listing** on the
  directory's dashboard. `scripts/listing-cards.mjs` holds their headlines. It
  takes the raw screenshots in `.dev/listing/raw/` and lays them out as
  2400x1600 desktop images and 900x1600 mobile ones.

- Each desktop screenshot shows the stream's pane in a window 904 px wide and
  960 px tall, scrolled to a date. `scripts/window-still.mjs` draws a window
  frame around it. The desktop recording shows the whole window (D-126).
- The recordings are animated WebP files. They need `img2webp`
  (`brew install webp`), and the phone's recording needs `swift` (Xcode). D-116
  says why.
- The phone's screen is recorded over USB, starting before Appium connects,
  because starting a recording drops WebDriverAgent's connection. Only the
  frames between the first and last step of the scene are kept. iOS shows a
  Focus banner when the recording starts and stops.
- The scene does its search and jump once before the recording starts. The tests
  look up iOS's keyboard layout and the scene's buttons the first time they use
  them, and that would show as seconds where nothing moves.
- Touch circles are drawn onto the frames from the touches the tests sent
  (`draw-touches.swift`), not from the page's touch events: a touch that stops a
  scroll never reaches the page. Key taps get no circle, because iOS already
  shows a bubble over each key.
- `Phone.type` presses at most two keys at a time. WebDriverAgent presses the
  keys of one gesture about 30 ms apart, and each gesture takes about 560 ms.
