// Records the screen of an iPhone connected by USB, as QuickTime does, until
// stopped by SIGTERM or SIGINT. Saves every frame the phone sends, scaled to
// `width`, as a PNG named by the Unix time in ms when it arrived. Prints
// "capturing" with the first frame. iOS draws a clean status bar while it is
// recorded.
//
//   swift -O scripts/capture-iphone.swift <frames dir> <width>
//
// If started after a WebDriverAgent session, it drops that session's
// connection, so start it first.
import AVFoundation
import CoreImage
import CoreMediaIO
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("capture-iphone: \(message)\n".data(using: .utf8)!)
    exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 3, let width = Double(arguments[2]) else {
    fail("usage: capture-iphone.swift <frames dir> <width>")
}
let directory = URL(fileURLWithPath: arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

// Off by default. Without it, no iPhone is listed as a recording device.
var allow = CMIOObjectPropertyAddress(
    mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
    mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
    mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
var on: UInt32 = 1
CMIOObjectSetPropertyData(
    CMIOObjectID(kCMIOObjectSystemObject), &allow, 0, nil, UInt32(MemoryLayout<UInt32>.size), &on)

/**
 * The phone's screen, which is listed a few seconds after recording devices are
 * allowed.
 */
func iPhoneScreen() -> AVCaptureDevice? {
    for _ in 0..<100 {
        let found = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external], mediaType: .muxed, position: .unspecified
        ).devices.first { $0.modelID == "iOS Device" }
        if let found { return found }
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    return nil
}
guard let device = iPhoneScreen() else { fail("no iPhone screen to capture: is one on the cable, unlocked?") }

final class FrameWriter: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let context = CIContext()
    private let writes = DispatchQueue(label: "writes", attributes: .concurrent)
    let pending = DispatchGroup()
    private var started = false
    private let directory: URL
    private let width: Double

    init(to directory: URL, width: Double) {
        (self.directory, self.width) = (directory, width)
    }

    func captureOutput(_: AVCaptureOutput, didOutput sample: CMSampleBuffer, from _: AVCaptureConnection) {
        guard let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
        let arrived = Int((Date().timeIntervalSince1970 * 1000).rounded())
        let frame = CIImage(cvPixelBuffer: pixels)
        let scale = width / frame.extent.width
        let scaled = frame.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let image = context.createCGImage(scaled, from: scaled.extent) else { return }
        pending.enter()
        writes.async {
            let url = self.directory.appendingPathComponent("\(arrived).png")
            if let file = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) {
                CGImageDestinationAddImage(file, image, nil)
                CGImageDestinationFinalize(file)
            }
            self.pending.leave()
        }
        if !started {
            started = true
            print("capturing")
            fflush(stdout)
        }
    }
}

let session = AVCaptureSession()
session.addInput(try AVCaptureDeviceInput(device: device))
let output = AVCaptureVideoDataOutput()
output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
let writer = FrameWriter(to: directory, width: width)
let frames = DispatchQueue(label: "frames")
output.setSampleBufferDelegate(writer, queue: frames)
session.addOutput(output)

var stops: [DispatchSourceSignal] = []
for signalNumber in [SIGTERM, SIGINT] {
    signal(signalNumber, SIG_IGN)
    let stop = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    stop.setEventHandler {
        session.stopRunning()
        // The last frame has arrived, then every write has finished.
        frames.sync {}
        writer.pending.wait()
        exit(0)
    }
    stop.resume()
    stops.append(stop)
}
session.startRunning()
dispatchMain()
