import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Joe the bird — cross-platform speech-to-text',
    description:
        'A dictation app you own. Press a shortcut, talk, get text pasted wherever your cursor is. Bring your own key for any of 9 STT providers. Open source.',
    icons: {
        icon: [
            { url: '/icon.svg', type: 'image/svg+xml' },
            { url: '/favicon.ico', sizes: 'any' },
        ],
    },
    openGraph: {
        title: 'Joe the bird — cross-platform speech-to-text',
        description:
            'A dictation app you own. Bring your own key, pick from 9 STT providers, ship text anywhere your cursor is.',
        type: 'website',
    },
};

// Runs before paint to set the `dark` class on <html>, avoiding a flash when
// the user's saved preference (or system preference) is dark. Kept inline
// because external scripts can't beat first paint.
const themeBootScript = `
(function(){try{
  var saved = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = saved ? saved === 'dark' : prefersDark;
  if (dark) document.documentElement.classList.add('dark');
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static
                    string we author here, injected so the dark class lands on
                    <html> before first paint (no FOUC). The alternative —
                    rendering the script tag with children — is stripped by
                    React's HTML escaping. */}
                <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
            </head>
            <body>{children}</body>
        </html>
    );
}
