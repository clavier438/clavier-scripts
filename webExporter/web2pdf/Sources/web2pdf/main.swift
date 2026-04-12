import AppKit
import WebKit
import Foundation

// MARK: - CLI Args

struct Config {
    var url: URL
    var width: CGFloat
    var outputPath: String
    var timeout: TimeInterval = 120
    var scrollTime: TimeInterval = 60
}

func parseArgs() -> Config? {
    var urlString: String?
    var width: CGFloat = 1440
    var output: String?
    var timeout: TimeInterval = 120
    var scrollTime: TimeInterval = 60

    var i = 1
    while i < CommandLine.arguments.count {
        let arg = CommandLine.arguments[i]
        switch arg {
        case "--width":
            i += 1
            if i < CommandLine.arguments.count { width = CGFloat(Double(CommandLine.arguments[i]) ?? 1440) }
        case "--output":
            i += 1
            if i < CommandLine.arguments.count { output = CommandLine.arguments[i] }
        case "--timeout":
            i += 1
            if i < CommandLine.arguments.count { timeout = Double(CommandLine.arguments[i]) ?? 120 }
        case "--scroll-time":
            i += 1
            if i < CommandLine.arguments.count { scrollTime = Double(CommandLine.arguments[i]) ?? 30 }
        default:
            if arg.hasPrefix("http") { urlString = arg }
        }
        i += 1
    }

    guard let us = urlString, let url = URL(string: us), let op = output else { return nil }
    return Config(url: url, width: width, outputPath: op, timeout: timeout, scrollTime: scrollTime)
}

guard let config = parseArgs() else {
    fputs("Usage: web2pdf <url> --width 1440 --output out.pdf [--timeout 120] [--scroll-time 30]\n", stderr)
    exit(1)
}

// MARK: - JavaScript (callAsyncJavaScript function bodies)

let jsAcceptCookies = """
    let tries = 0;
    await new Promise(resolve => {
        const poll = setInterval(() => {
            if (window.OneTrust) { try { OneTrust.AllowAll(); } catch(e) {} clearInterval(poll); resolve(); return; }
            if (window.Optanon) { try { Optanon.AllowAll(); } catch(e) {} clearInterval(poll); resolve(); return; }
            const cookiebotIds = [
                'CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                'CybotCookiebotDialogBodyButtonAccept'
            ];
            for (const id of cookiebotIds) {
                const el = document.getElementById(id);
                if (el) { el.click(); clearInterval(poll); resolve(); return; }
            }
            const TEXTS = new Set(['accept all','accept cookies','allow all','allow all cookies',
                                    'agree','agree to all','i agree','got it','ok','okay',
                                    '동의','허용','모두 수락','모두 허용']);
            for (const btn of document.querySelectorAll('button,[role="button"],a[role="button"]')) {
                const t = (btn.innerText || '').trim().toLowerCase();
                if (TEXTS.has(t) && btn.offsetParent !== null) {
                    btn.click(); clearInterval(poll); resolve(); return;
                }
            }
            if (++tries > 25) { clearInterval(poll); resolve(); }
        }, 200);
    });
"""

let jsDisableLazy = """
    document.querySelectorAll('img[loading="lazy"]').forEach(img => { img.loading = 'eager'; });
    document.querySelectorAll('img[data-src],img[data-lazy],img[data-original]').forEach(img => {
        const src = img.dataset.src || img.dataset.lazy || img.dataset.original;
        if (src && !img.src) img.src = src;
    });
"""

let jsRemoveBanners = """
    const sels = [
        '#onetrust-consent-sdk','#onetrust-banner-sdk','.onetrust-pc-dark-filter',
        '#CybotCookiebotDialog','.cc-window','.cookie-banner',
        '[class*="cookie"],[class*="consent"],[class*="gdpr"]',
        '[class*="modal"],[class*="popup"],[class*="overlay"]',
        '[class*="banner"],[class*="dialog"]',
        '[id*="cookie"],[id*="modal"],[id*="popup"]',
        '[role="dialog"],[role="alertdialog"]'
    ];
    for (const sel of sels) {
        try {
            for (const el of document.querySelectorAll(sel)) {
                const s = window.getComputedStyle(el);
                if (s.position === 'fixed' || s.position === 'absolute'
                    || el.id.toLowerCase().includes('onetrust')
                    || el.id.toLowerCase().includes('cookie')) {
                    el.remove();
                }
            }
        } catch(e) {}
    }
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
"""

let jsAutoScroll = """
    const start = Date.now();
    let lastHeight = 0;
    let sameCount = 0;
    const MAX_MS = scrollTimeMs;

    while (Date.now() - start < MAX_MS) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(r => setTimeout(r, 800));
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
            sameCount++;
        } else {
            sameCount = 0;
        }
        lastHeight = newHeight;
        if (sameCount >= 4) break;
    }
    window.scrollTo(0, 0);
"""

let jsFixLinkStyles = """
    (function() {
        const style = document.createElement('style');
        style.setAttribute('data-web2pdf-link-style', 'true');
        style.textContent = `
            a, a:link, a:visited, a:hover, a:active {
                color: inherit !important;
                text-decoration: inherit !important;
            }
        `;
        document.head.appendChild(style);
    })();
"""

let jsWaitForImages = """
    await Promise.all(
        [...document.querySelectorAll('img')].map(img => {
            if (!img.src || img.src.startsWith('data:')) return Promise.resolve();
            if (img.naturalWidth > 0 && img.complete) return img.decode().catch(() => {});
            return new Promise(resolve => {
                img.onload = () => img.decode().then(resolve).catch(resolve);
                img.onerror = resolve;
                setTimeout(resolve, 10000);
            });
        })
    );
"""

let jsWaitForVideos = """
    for (const v of document.querySelectorAll('video')) {
        const lazySrc = v.dataset.src || v.dataset.lazy || v.dataset.videoSrc;
        if (lazySrc && !v.src) v.src = lazySrc;
        v.removeAttribute('lazy');
        v.preload = 'auto';
        v.muted = true;
    }
    await Promise.all(
        [...document.querySelectorAll('video')].map(v =>
            new Promise(r => {
                if (v.poster) { r(); return; }
                const done = () => { v.currentTime = 0.001; v.pause(); r(); };
                if (v.readyState >= 2) { done(); return; }
                v.addEventListener('loadeddata', done, {once: true});
                v.addEventListener('error', r, {once: true});
                if (v.readyState < 1) v.load();
                v.play().catch(() => {});
                setTimeout(r, 10000);
            })
        )
    );
"""

// MARK: - PDFExporter

@MainActor
class PDFExporter: NSObject, WKNavigationDelegate {
    let config: Config
    var webView: WKWebView!
    var loadContinuation: CheckedContinuation<Void, Error>?

    init(config: Config) {
        self.config = config
    }

    func run() async {
        // Timeout watchdog
        let timeoutTask = Task {
            try await Task.sleep(nanoseconds: UInt64(config.timeout * 1_000_000_000))
            fputs("✗ Timeout (\(Int(config.timeout))s): \(config.url)\n", stderr)
            exit(2)
        }
        defer { timeoutTask.cancel() }

        // WKWebView setup
        let wkConfig = WKWebViewConfiguration()
        wkConfig.mediaTypesRequiringUserActionForPlayback = []

        // Offscreen window (required for reliable rendering on some macOS versions)
        let frame = CGRect(x: 0, y: 0, width: config.width, height: 900)
        let window = NSWindow(contentRect: frame, styleMask: [], backing: .buffered, defer: false)
        webView = WKWebView(frame: frame, configuration: wkConfig)
        webView.navigationDelegate = self
        window.contentView = webView
        // Not shown (no makeKeyAndOrderFront)

        // Load page
        do {
            try await loadPage()
        } catch {
            fputs("✗ Load failed: \(error.localizedDescription)\n", stderr)
            exit(1)
        }

        // JS pipeline
        await callAsync(jsAcceptCookies)
        await eval(jsDisableLazy)
        await callAsync(jsAutoScroll, args: ["scrollTimeMs": config.scrollTime * 1000])

        // 바닥에서 한 번 더 — IntersectionObserver lazy-load 확실히 터뜨리기
        await eval("window.scrollTo(0, document.body.scrollHeight)")
        try? await Task.sleep(nanoseconds: 5_000_000_000) // 5s
        await callAsync(jsWaitForImages)
        await callAsync(jsWaitForVideos)
        await eval("window.scrollTo(0, 0)")

        // 배너 제거 + 링크 스타일 고정
        await callAsync(jsAcceptCookies)
        await eval(jsRemoveBanners)
        await eval(jsFixLinkStyles)
        await eval("document.fonts.ready")
        try? await Task.sleep(nanoseconds: 5_000_000_000) // 5s paint buffer

        // Get full content height
        let heightVal = await evalResult(
            "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)"
        ) as? Double ?? 900
        let contentHeight = CGFloat(heightVal)

        // Resize webView to full content height, let layout settle
        webView.frame = CGRect(x: 0, y: 0, width: config.width, height: contentHeight)
        window.setContentSize(NSSize(width: config.width, height: contentHeight))
        try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s

        // Generate PDF via WKWebView.createPDF — Safari engine, screen CSS, vector
        let pdfConfig = WKPDFConfiguration()
        pdfConfig.rect = CGRect(x: 0, y: 0, width: config.width, height: contentHeight)

        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            webView.createPDF(configuration: pdfConfig) { result in
                switch result {
                case .success(let data):
                    do {
                        try data.write(to: URL(fileURLWithPath: self.config.outputPath))
                        let kb = data.count / 1024
                        let name = URL(fileURLWithPath: self.config.outputPath).lastPathComponent
                        print("✓ \(name)  (\(Int(self.config.width))×\(Int(contentHeight))px)  \(kb)KB")
                        cont.resume()
                        exit(0)
                    } catch {
                        fputs("✗ Write failed: \(error)\n", stderr)
                        cont.resume()
                        exit(1)
                    }
                case .failure(let error):
                    fputs("✗ PDF failed: \(error)\n", stderr)
                    cont.resume()
                    exit(1)
                }
            }
        }
    }

    // MARK: - Load

    func loadPage() async throws {
        try await withCheckedThrowingContinuation { cont in
            self.loadContinuation = cont
            webView.load(URLRequest(url: config.url, timeoutInterval: config.timeout))
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            self.loadContinuation?.resume()
            self.loadContinuation = nil
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            self.loadContinuation?.resume(throwing: error)
            self.loadContinuation = nil
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            self.loadContinuation?.resume(throwing: error)
            self.loadContinuation = nil
        }
    }

    // MARK: - JS helpers

    /// Fire-and-forget evaluateJavaScript (sync JS, no await needed)
    @discardableResult
    func eval(_ js: String) async -> Any? {
        await withCheckedContinuation { cont in
            webView.evaluateJavaScript(js) { val, _ in cont.resume(returning: val) }
        }
    }

    @discardableResult
    func evalResult(_ js: String) async -> Any? {
        await withCheckedContinuation { cont in
            webView.evaluateJavaScript(js) { val, _ in cont.resume(returning: val) }
        }
    }

    /// callAsyncJavaScript — awaits Promise resolution
    @discardableResult
    func callAsync(_ js: String, args: [String: Any] = [:]) async -> Any? {
        await withCheckedContinuation { cont in
            webView.callAsyncJavaScript(js, arguments: args, in: nil, in: .page) { result in
                switch result {
                case .success(let val): cont.resume(returning: val)
                case .failure: cont.resume(returning: nil)
                }
            }
        }
    }
}

// MARK: - Entry Point

let app = NSApplication.shared
app.setActivationPolicy(.prohibited) // No dock icon

DispatchQueue.main.async {
    Task { @MainActor in
        let exporter = PDFExporter(config: config)
        await exporter.run()
    }
}

app.run()
