// Draws each touch the tests sent onto the iPhone frames that show it: a circle
// under the finger, which moves along a stroke, stays for a moment after the
// finger lifts, and then fades. iOS draws none, and the page sees too few
// touches to draw its own, because a touch that catches a glide stays with
// iOS.
//
//   swift -O scripts/draw-touches.swift <frames dir> <touches.json> <screen width in points> <shift ms>
//
// Frames are PNGs named by the Unix ms when they arrived. Each touch is
// `{ from: {x, y}, to: {x, y}, start, ms }`, in points and Unix ms. `shift`
// moves every touch later, by how long a frame takes to arrive.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Spot: Decodable { let x: Double; let y: Double }
struct Touch: Decodable { let from: Spot; let to: Spot; let start: Double; let ms: Double }

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("draw-touches: \(message)\n".data(using: .utf8)!)
    exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 5, let points = Double(arguments[3]), let shift = Double(arguments[4]) else {
    fail("usage: draw-touches.swift <frames dir> <touches.json> <screen width in points> <shift ms>")
}
let directory = URL(fileURLWithPath: arguments[1])
let touches = try JSONDecoder().decode([Touch].self, from: Data(contentsOf: URL(fileURLWithPath: arguments[2])))

/**
 * Shown for this long after the finger lifts, then faded. Otherwise a tap would
 * only show for a moment.
 */
let linger = 100.0
let fade = 150.0
let radius = 22.0

/** Where a touch's circle is at `time`, and how opaque it is, if it shows. */
func disc(_ touch: Touch, at time: Double) -> (x: Double, y: Double, alpha: Double)? {
    let start = touch.start + shift
    let lift = start + touch.ms
    guard time >= start, time <= lift + linger + fade else { return nil }
    let progress = touch.ms > 0 ? min(1, (time - start) / touch.ms) : 1
    let alpha = time <= lift + linger ? 1 : 1 - (time - lift - linger) / fade
    return (
        touch.from.x + (touch.to.x - touch.from.x) * progress,
        touch.from.y + (touch.to.y - touch.from.y) * progress,
        alpha
    )
}

for name in try FileManager.default.contentsOfDirectory(atPath: directory.path) where name.hasSuffix(".png") {
    guard let time = Double(name.dropLast(4)) else { continue }
    let shown = touches.compactMap { disc($0, at: time) }
    if shown.isEmpty { continue }
    let url = directory.appendingPathComponent(name)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let frame = CGImageSourceCreateImageAtIndex(source, 0, nil),
        let context = CGContext(
            data: nil, width: frame.width, height: frame.height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { fail("cannot read \(name)") }
    let height = Double(frame.height)
    context.draw(frame, in: CGRect(x: 0, y: 0, width: frame.width, height: frame.height))
    let scale = Double(frame.width) / points
    for (x, y, alpha) in shown {
        let size = radius * 2 * scale
        // Core Graphics counts y upwards from the bottom.
        let box = CGRect(x: x * scale - size / 2, y: height - y * scale - size / 2, width: size, height: size)
        context.setFillColor(CGColor(gray: 0.47, alpha: 0.35 * alpha))
        context.fillEllipse(in: box)
        context.setStrokeColor(CGColor(gray: 1, alpha: 0.85 * alpha))
        context.setLineWidth(2 * scale)
        context.strokeEllipse(in: box.insetBy(dx: scale, dy: scale))
    }
    guard let drawn = context.makeImage(),
        let file = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fail("cannot write \(name)") }
    CGImageDestinationAddImage(file, drawn, nil)
    CGImageDestinationFinalize(file)
}
