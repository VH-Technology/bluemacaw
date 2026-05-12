import Image from 'next/image';

const PROVIDERS = [
    { id: 'assemblyai', name: 'AssemblyAI' },
    { id: 'azure-openai', name: 'Azure OpenAI' },
    { id: 'deepgram', name: 'Deepgram' },
    { id: 'elevenlabs', name: 'ElevenLabs' },
    { id: 'fal', name: 'Fal' },
    { id: 'gladia', name: 'Gladia' },
    { id: 'groq', name: 'Groq' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'revai', name: 'Rev.ai' },
];

export function ProvidersGrid() {
    return (
        <section className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-10 text-center">
                <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                    Pick a provider. Bring your key.
                </h2>
                <p className="mt-3 text-muted-foreground">
                    Nine STT providers wired up out of the box. Swap any time — keys stay on your
                    machine.
                </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {PROVIDERS.map((p) => (
                    <div
                        key={p.id}
                        className="flex flex-col items-center gap-3 rounded-2xl bg-muted p-5 transition-shadow hover:shadow-card"
                    >
                        <Image
                            src={`/logos/${p.id}.svg`}
                            alt={`${p.name} logo`}
                            width={48}
                            height={48}
                            className="opacity-90"
                        />
                        <span className="text-sm font-semibold text-fg">{p.name}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}
