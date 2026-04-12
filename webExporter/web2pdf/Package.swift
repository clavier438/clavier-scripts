// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "web2pdf",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "web2pdf",
            path: "Sources/web2pdf"
        )
    ]
)
