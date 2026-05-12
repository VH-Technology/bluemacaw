import { Footer } from '@/components/footer';
import { Header } from '@/components/header';

export default function PrivacyPage() {
    return (
        <>
            <Header />
            <main className="mx-auto max-w-3xl px-6 py-16">
                <article className="space-y-6 leading-relaxed text-fg/90 [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:mb-4 [&_h1]:text-4xl [&_h1]:font-black [&_h1]:tracking-tight [&_h1]:text-fg [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-fg [&_a]:font-semibold [&_a]:text-main [&_a:hover]:underline [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_strong]:font-bold [&_strong]:text-fg">
                    <h1>Privacy</h1>
                    <p>
                        Joe the bird is a desktop app. Your audio and your API keys never touch a
                        Joe the bird server because we don&apos;t run one.
                    </p>
                    <h2>API keys</h2>
                    <p>
                        Your provider API keys are stored in your OS&apos;s native credential
                        storage:
                    </p>
                    <ul>
                        <li>
                            <strong>macOS:</strong> Keychain Services (per-app ACL, hardware-backed
                            on Apple Silicon)
                        </li>
                        <li>
                            <strong>Windows:</strong> Credential Manager / DPAPI (per-user,
                            encrypted at rest with your login credentials)
                        </li>
                        <li>
                            <strong>Linux:</strong> Secret Service via gnome-keyring or KWallet
                            (per-user, encrypted at rest)
                        </li>
                    </ul>
                    <p>
                        Keys are fetched only at the moment of transcription, held in memory for the
                        duration of one HTTP request, and never written to disk outside the OS
                        credential store. Keys are never logged, never sent to Joe the bird&apos;s
                        servers (we don&apos;t have any), and the source code path that handles them
                        is open: <code>packages/desktop/src-tauri/src/secrets/</code>.
                    </p>
                    <h2>Audio</h2>
                    <p>
                        Audio is captured by <code>cpal</code> directly from your microphone, sent
                        only to the STT provider you chose, and never persisted by Joe the bird.
                    </p>
                    <h2>History</h2>
                    <p>
                        Transcribed text is stored locally in a SQLite database in your app data
                        directory. Default retention is a rolling 1-year window; you can change this
                        or disable history entirely in settings.
                    </p>
                    <h2>Telemetry</h2>
                    <p>
                        <strong>Zero telemetry.</strong> No analytics SDK installed, no error
                        reporting, no usage tracking. If we ever add any of these, it will be opt-in
                        with a settings toggle that defaults off.
                    </p>
                    <h2>Threat model</h2>
                    <p>
                        Any process running as your user account can ask the OS keychain for secrets
                        it knows about — this is a platform-level limitation on Windows and Linux,
                        not specific to Joe the bird. macOS Keychain provides stronger per-app
                        isolation. If you require stronger isolation on Windows or Linux, consider
                        running Joe the bird under a dedicated user account.
                    </p>
                    <p>
                        Joe the bird is open source under Apache 2.0. If you want to verify any of
                        the above, the code is at{' '}
                        <a href="https://github.com/programow/vox-era">
                            github.com/programow/vox-era
                        </a>
                        .
                    </p>
                </article>
            </main>
            <Footer version="0.0.0" />
        </>
    );
}
