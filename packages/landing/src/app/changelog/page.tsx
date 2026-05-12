import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { fetchReleases } from '@/lib/github';

export default async function ChangelogPage() {
    const releases = await fetchReleases('programow/vox-era');
    return (
        <>
            <Header />
            <main className="mx-auto max-w-3xl px-6 py-16">
                <h1 className="mb-3 text-5xl font-black tracking-tight text-fg">Changelog</h1>
                <p className="mb-10 text-muted-foreground">
                    Releases of Joe the bird, published from the GitHub repo.
                </p>
                {releases.length === 0 ? (
                    <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
                        <p className="text-base font-semibold text-fg">No releases yet.</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            The first cut is on the way. Check back soon.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {releases.map((r) => (
                            <article
                                key={r.tag}
                                className="rounded-2xl bg-surface p-6 shadow-card transition-shadow hover:shadow-card-lg"
                            >
                                <h2 className="text-xl font-bold tracking-tight">
                                    <a href={r.htmlUrl} className="text-fg hover:text-main">
                                        {r.name || r.tag}
                                    </a>
                                </h2>
                                <time className="mt-1 block text-sm text-muted-foreground">
                                    {new Date(r.publishedAt).toLocaleDateString()}
                                </time>
                                <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg/85">
                                    {r.body}
                                </pre>
                            </article>
                        ))}
                    </div>
                )}
            </main>
            <Footer version="0.0.0" />
        </>
    );
}
