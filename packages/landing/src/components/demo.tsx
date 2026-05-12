import Image from 'next/image';

export function Demo() {
    return (
        <section className="mx-auto max-w-5xl px-6 py-12">
            <div className="overflow-hidden rounded-3xl bg-brand-cream/40 p-3 shadow-pop dark:bg-brand-navy/30">
                <div className="overflow-hidden rounded-2xl">
                    <Image
                        src="/demo.gif"
                        alt="Joe the bird recording demo: shortcut press, dictation, paste"
                        width={1200}
                        height={675}
                        unoptimized
                        className="block w-full"
                    />
                </div>
            </div>
        </section>
    );
}
