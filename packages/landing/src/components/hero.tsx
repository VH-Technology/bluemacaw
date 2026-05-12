import { RecordingPillDemo } from './recording-pill-demo';
import { Button } from './ui/button';

export function Hero() {
    return (
        <section className="relative overflow-hidden">
            {/* Soft brand gradient backdrop — anchored to the hero, fades into
                the page background below. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,hsl(var(--main)/0.10),transparent_55%),radial-gradient(circle_at_80%_30%,#F1B244_0%,transparent_45%)] opacity-60 dark:opacity-40"
            />

            <div className="mx-auto max-w-5xl px-6 pb-20 pt-16 sm:pt-24">
                <div className="flex flex-col items-center text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/logo.svg"
                        alt="Joe the bird"
                        className="mb-6 h-20 w-20 sm:h-24 sm:w-24"
                    />
                    <h1 className="max-w-3xl text-5xl font-black leading-[1.05] tracking-tight text-fg sm:text-6xl md:text-7xl">
                        Talk. Get text. Anywhere your cursor is.
                    </h1>
                    <p className="mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
                        Joe the bird is a cross-platform dictation app you actually own. Bring your
                        own API key for any of 9 STT providers. Open source. No backend.
                    </p>
                    <div className="mt-10 flex flex-wrap justify-center gap-3">
                        <Button asChild size="xl">
                            <a href="#download">Download for your OS</a>
                        </Button>
                        <Button asChild size="xl" variant="outline">
                            <a
                                href="https://github.com/programow/vox-era"
                                target="_blank"
                                rel="noreferrer"
                            >
                                Star on GitHub
                            </a>
                        </Button>
                    </div>

                    <div className="mt-14 flex justify-center" data-testid="hero-pill">
                        <RecordingPillDemo />
                    </div>
                </div>
            </div>
        </section>
    );
}
