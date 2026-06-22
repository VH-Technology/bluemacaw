import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { APP_VERSION } from '@/lib/version';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Docs — bluemacaw',
    description:
        'Install bluemacaw on macOS or Windows. Configure an STT provider, pick a hotkey, and start dictating anywhere.',
};

export default function DocsPage() {
    return (
        <>
            <Header />
            <main className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
                <div className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_1fr]">
                    <DocsToc />
                    <article className="prose-docs space-y-12">
                        <header className="space-y-3">
                            <h1 className="text-4xl font-black tracking-tight text-fg sm:text-5xl">
                                Docs
                            </h1>
                            <p className="text-lg text-muted-foreground">
                                Everything you need to install bluemacaw, point it at an STT
                                provider, and start dictating. The full technical spec lives in the{' '}
                                <a
                                    href="https://github.com/VH-Technology/bluemacaw/tree/main/docs"
                                    className="font-semibold text-main hover:underline"
                                >
                                    /docs directory on GitHub
                                </a>
                                .
                            </p>
                        </header>

                        <QuickStart />
                        <InstallMacOS />
                        <InstallWindows />
                        <Configure />
                        <Hotkeys />
                        <Privacy />
                        <Troubleshooting />
                    </article>
                </div>
            </main>
            <Footer version={APP_VERSION} />
        </>
    );
}

const TOC: ReadonlyArray<{ id: string; label: string }> = [
    { id: 'quick-start', label: 'Quick start' },
    { id: 'install-macos', label: 'Install — macOS' },
    { id: 'install-windows', label: 'Install — Windows' },
    { id: 'configure', label: 'Configure a provider' },
    { id: 'hotkeys', label: 'Hotkeys' },
    { id: 'privacy', label: 'Privacy & security' },
    { id: 'troubleshooting', label: 'Troubleshooting' },
];

function DocsToc() {
    return (
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                On this page
            </p>
            <ul className="flex flex-col gap-1.5 text-sm">
                {TOC.map((item) => (
                    <li key={item.id}>
                        <a
                            href={`#${item.id}`}
                            className="block rounded-pill px-3 py-1.5 font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-fg"
                        >
                            {item.label}
                        </a>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

function QuickStart() {
    return (
        <section id="quick-start" className="space-y-3">
            <h2>Quick start</h2>
            <ol>
                <li>
                    <a href="#download">Download</a> the installer for your OS — macOS DMG, Windows
                    NSIS.
                </li>
                <li>Open the app and grant microphone access (and on macOS, Accessibility).</li>
                <li>
                    Add an API key for any of 10 supported STT providers (OpenAI, Groq, Grok (xAI),
                    Deepgram, AssemblyAI, ElevenLabs, Fal, Gladia, Azure OpenAI, Rev.ai).
                </li>
                <li>
                    Pick a hotkey — default <code>⌘⇧Space</code> on macOS, <code>Ctrl+⇧Space</code>{' '}
                    on Windows.
                </li>
                <li>
                    Hold the hotkey, dictate, release — your transcription pastes into the focused
                    app.
                </li>
            </ol>
        </section>
    );
}

function InstallMacOS() {
    return (
        <section id="install-macos" className="space-y-3">
            <h2>Install — macOS</h2>
            <p>
                <strong>Requirements:</strong> macOS 12 Monterey or later (Apple Silicon or Intel).
                The DMG is a single universal binary that runs natively on both.
            </p>
            <h3>Install</h3>
            <ol>
                <li>
                    Download <code>bluemacaw_x.y.z_universal.dmg</code> from the{' '}
                    <a href="https://github.com/VH-Technology/bluemacaw/releases/latest">
                        latest release
                    </a>
                    .
                </li>
                <li>Open the DMG and drag bluemacaw into Applications.</li>
                <li>
                    First launch: macOS Gatekeeper will check the notarization ticket — bluemacaw
                    releases are signed with an Apple Developer ID and notarized, so the app should
                    open without warnings. If you see “unidentified developer,” right-click the app
                    and choose <em>Open</em>.
                </li>
            </ol>
            <h3>Permissions</h3>
            <p>
                bluemacaw needs <strong>two</strong> permissions on macOS:
            </p>
            <ul>
                <li>
                    <strong>Microphone</strong> — prompted on first record. If you miss it: System
                    Settings → Privacy &amp; Security → Microphone → enable bluemacaw.
                </li>
                <li>
                    <strong>Accessibility</strong> — required for the global hotkey and to paste
                    transcripts into the focused app. Grant via System Settings → Privacy &amp;
                    Security → Accessibility. The onboarding flow will deep-link you there.
                </li>
            </ul>
            <p>
                See{' '}
                <a href="https://github.com/VH-Technology/bluemacaw/blob/main/docs/permissions.md">
                    docs/permissions.md
                </a>{' '}
                for the exact platform APIs used.
            </p>
        </section>
    );
}

function InstallWindows() {
    return (
        <section id="install-windows" className="space-y-3">
            <h2>Install — Windows</h2>
            <p>
                <strong>Requirements:</strong> Windows 10 1903+ or Windows 11. WebView2 runtime
                (auto-installed on Windows 11; bundled in the installer for 10).
            </p>
            <h3>Install</h3>
            <ol>
                <li>
                    Download <code>bluemacaw_x.y.z_x64-setup.exe</code> from the{' '}
                    <a href="https://github.com/VH-Technology/bluemacaw/releases/latest">
                        latest release
                    </a>
                    .
                </li>
                <li>
                    Run the installer. SmartScreen may show a “Windows protected your PC” dialog
                    because the current builds are unsigned — click <em>More info</em> →{' '}
                    <em>Run anyway</em>. (Code-signing certificate is on the roadmap.)
                </li>
                <li>
                    Launch bluemacaw from the Start menu. The first record triggers the Windows
                    microphone permission prompt.
                </li>
            </ol>
            <h3>Notes</h3>
            <ul>
                <li>
                    Hotkey paste uses synthetic keystrokes (<code>SendInput</code>) — no additional
                    permissions required.
                </li>
                <li>
                    API keys are stored in Windows Credential Manager (DPAPI under the hood,
                    per-user, encrypted at rest).
                </li>
            </ul>
        </section>
    );
}

function Configure() {
    return (
        <section id="configure" className="space-y-3">
            <h2>Configure a provider</h2>
            <p>
                bluemacaw is BYOK — it never talks to a bluemacaw backend (there isn't one), only to
                the STT provider you chose. Each provider has a free or low-cost tier that's enough
                to try the app.
            </p>
            <ol>
                <li>
                    Get an API key from your provider:{' '}
                    <a href="https://platform.openai.com/api-keys">OpenAI</a>,{' '}
                    <a href="https://console.groq.com/keys">Groq</a>,{' '}
                    <a href="https://console.x.ai/">Grok (xAI)</a>,{' '}
                    <a href="https://console.deepgram.com">Deepgram</a>,{' '}
                    <a href="https://www.assemblyai.com/dashboard/signup">AssemblyAI</a>,{' '}
                    <a href="https://elevenlabs.io/app/speech-to-text">ElevenLabs</a>,{' '}
                    <a href="https://fal.ai/dashboard/keys">Fal</a>,{' '}
                    <a href="https://app.gladia.io">Gladia</a>,{' '}
                    <a href="https://learn.microsoft.com/en-us/azure/ai-services/openai/">
                        Azure OpenAI
                    </a>
                    , or <a href="https://www.rev.ai">Rev.ai</a>.
                </li>
                <li>
                    Open bluemacaw → Settings → <strong>API keys</strong> → paste the key for your
                    provider. Keys go straight to the OS credential store.
                </li>
                <li>
                    Settings → <strong>Model configs</strong> → pick a model (e.g.{' '}
                    <code>gpt-4o-mini-transcribe</code> for OpenAI, <code>whisper-large-v3</code>{' '}
                    for Groq, <code>nova-3</code> for Deepgram).
                </li>
                <li>Activate one model config — that's the one your hotkey will use.</li>
            </ol>
            <p>
                Full provider details and pricing notes:{' '}
                <a href="https://github.com/VH-Technology/bluemacaw/blob/main/docs/providers.md">
                    docs/providers.md
                </a>
                .
            </p>
        </section>
    );
}

function Hotkeys() {
    return (
        <section id="hotkeys" className="space-y-3">
            <h2>Hotkeys</h2>
            <p>
                Settings → <strong>Recording</strong> lets you remap both the record hotkey and the
                cancel hotkey. Defaults:
            </p>
            <ul>
                <li>
                    <strong>macOS:</strong> <code>⌘⇧Space</code> to record, <code>⌘Esc</code> to
                    cancel.
                </li>
                <li>
                    <strong>Windows:</strong> <code>Ctrl+⇧Space</code> to record,{' '}
                    <code>Ctrl+Esc</code> to cancel.
                </li>
            </ul>
            <p>
                On macOS you can also bind to the <code>Fn</code> (🌐) key. Because macOS has its
                own system action on Fn, bluemacaw will offer to change “Press 🌐 key to” to{' '}
                <em>Do Nothing</em> when you switch to it, and restore your original value when you
                switch away.
            </p>
        </section>
    );
}

function Privacy() {
    return (
        <section id="privacy" className="space-y-3">
            <h2>Privacy &amp; security</h2>
            <p>
                Zero telemetry, no analytics, no error reporting. Audio is captured locally and sent
                only to the provider you chose. API keys live in the OS keychain. Transcribed text
                is stored locally in SQLite with a default 1-year rolling retention you can change
                in settings.
            </p>
            <p>
                Full threat model: <a href="/privacy/">privacy page</a> — source paths:{' '}
                <a href="https://github.com/VH-Technology/bluemacaw/blob/main/docs/secrets.md">
                    docs/secrets.md
                </a>
                .
            </p>
        </section>
    );
}

function Troubleshooting() {
    return (
        <section id="troubleshooting" className="space-y-3">
            <h2>Troubleshooting</h2>
            <h3>Hotkey doesn't fire</h3>
            <ul>
                <li>
                    macOS: make sure bluemacaw is granted <strong>Accessibility</strong> in System
                    Settings → Privacy &amp; Security.
                </li>
                <li>
                    Conflict with another app (e.g. Spotlight on <code>⌘Space</code>): rebind in
                    Settings → Recording.
                </li>
            </ul>
            <h3>Paste doesn't insert text</h3>
            <ul>
                <li>macOS: Accessibility permission required.</li>
            </ul>
            <h3>Microphone doesn't appear</h3>
            <ul>
                <li>
                    Restart bluemacaw after granting microphone permission — some platforms don't
                    refresh the device list mid-session.
                </li>
                <li>Pick a specific device in Settings → Recording → Microphone.</li>
            </ul>
            <p>
                If you hit something else, open an issue on{' '}
                <a href="https://github.com/VH-Technology/bluemacaw/issues">GitHub</a> or check the
                full troubleshooting log:{' '}
                <a href="https://github.com/VH-Technology/bluemacaw/blob/main/docs/troubleshooting.md">
                    docs/troubleshooting.md
                </a>
                .
            </p>
        </section>
    );
}
