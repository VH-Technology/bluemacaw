// bluemacaw-apple-intelligence — sidecar that runs Apple's on-device
// foundation model (the model behind Apple Intelligence) for transcript
// cleanup. FoundationModels is Swift-only, so the Rust app talks to this tiny
// executable instead of linking Swift into the main binary. See
// `src/apple_intelligence/mod.rs` for the Rust side and the reasons.
//
// Protocol (one JSON object per invocation, printed to stdout):
//
//   bluemacaw-apple-intelligence status
//     {"status":"available"}
//     {"status":"unavailable","reason":"apple-intelligence-not-enabled"}
//
//   bluemacaw-apple-intelligence generate   (stdin: {"instructions":"…","prompt":"…"})
//     {"text":"…"}                              exit 0
//     {"error":"…"}                             exit 1
//
// The prompt travels over stdin rather than argv so transcripts never show up
// in `ps` output.

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

struct GenerateRequest: Decodable {
    let instructions: String
    let prompt: String
}

func emit(_ object: [String: String], exitCode: Int32) -> Never {
    // JSONSerialization can't fail on a [String: String] payload.
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(exitCode)
}

let command = CommandLine.arguments.dropFirst().first ?? ""

#if canImport(FoundationModels)

// Content-transformation guardrails: dictated text is rewritten, not
// answered, so the permissive profile avoids refusing to clean up transcripts
// that merely mention sensitive topics.
let model = SystemLanguageModel(useCase: .general, guardrails: .permissiveContentTransformations)

func unavailableReason(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .deviceNotEligible: return "device-not-eligible"
    case .appleIntelligenceNotEnabled: return "apple-intelligence-not-enabled"
    case .modelNotReady: return "model-not-ready"
    @unknown default: return "unknown"
    }
}

func greedyOptions() -> GenerationOptions {
    // Greedy decoding keeps copy-editing deterministic. The macOS 27 SDK
    // (FoundationModels 2.x) renamed the initializer; the old one still works
    // but is deprecated there, so pick whichever the SDK in use prefers.
    #if canImport(FoundationModels, _version: 2.0)
    return GenerationOptions(samplingMode: .greedy)
    #else
    return GenerationOptions(sampling: .greedy)
    #endif
}

switch command {
case "status":
    switch model.availability {
    case .available:
        emit(["status": "available"], exitCode: 0)
    case .unavailable(let reason):
        emit(["status": "unavailable", "reason": unavailableReason(reason)], exitCode: 0)
    }

case "generate":
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let request = try? JSONDecoder().decode(GenerateRequest.self, from: input) else {
        emit(["error": "invalid request: expected {\"instructions\",\"prompt\"} JSON on stdin"], exitCode: 1)
    }
    if case .unavailable(let reason) = model.availability {
        emit(["error": "Apple Intelligence is unavailable (\(unavailableReason(reason)))"], exitCode: 1)
    }
    do {
        let session = LanguageModelSession(model: model, instructions: request.instructions)
        let response = try await session.respond(to: request.prompt, options: greedyOptions())
        emit(["text": response.content], exitCode: 0)
    } catch {
        emit(["error": String(describing: error)], exitCode: 1)
    }

default:
    emit(["error": "usage: bluemacaw-apple-intelligence status|generate"], exitCode: 64)
}

#else

// Built against an SDK without FoundationModels (Xcode < 26). The app still
// bundles this stub so the sidecar always exists; it just reports that this
// build can't use Apple Intelligence.
switch command {
case "status":
    emit(["status": "unavailable", "reason": "unsupported-build"], exitCode: 0)
default:
    emit(["error": "this build of bluemacaw was compiled without Apple Intelligence support"], exitCode: 1)
}

#endif
