import { Demo } from '@/components/demo';
import { Download } from '@/components/download';
import { Features } from '@/components/features';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { Hero } from '@/components/hero';
import { PrivacyTeaser } from '@/components/privacy-teaser';
import { ProvidersGrid } from '@/components/providers-grid';

export default function HomePage() {
    return (
        <>
            <Header />
            <main>
                <Hero />
                <Demo />
                <Features />
                <ProvidersGrid />
                <PrivacyTeaser />
                <Download />
            </main>
            <Footer version="0.0.0" />
        </>
    );
}
