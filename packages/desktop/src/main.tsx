import './styles/globals.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// The overlay window is rendered into a transparent macOS native window.
// We must clear html, body, AND the React root container's background
// colours that globals.css applies for the main window — otherwise the
// overlay's bg-bg (dark navy in dark mode, cream in light) shows through
// as a solid rectangle around the floating pill.
const params = new URLSearchParams(window.location.search);
const isOverlay = params.get('window') === 'overlay';

if (isOverlay) {
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
}

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root element #root not found');
}
if (isOverlay) {
    container.style.backgroundColor = 'transparent';
}

ReactDOM.createRoot(container).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
