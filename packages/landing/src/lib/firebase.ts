import { type Analytics, logEvent as fbLogEvent, getAnalytics } from 'firebase/analytics';
import { getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
    apiKey: 'AIzaSyCzqOglviWffKK1Ur9Lx_RuVCTcpw5kYp0',
    authDomain: 'bluemacaw-7b8a7.firebaseapp.com',
    projectId: 'bluemacaw-7b8a7',
    storageBucket: 'bluemacaw-7b8a7.firebasestorage.app',
    messagingSenderId: '1053930415920',
    appId: '1:1053930415920:web:0b1346446b50aca9b30af5',
    measurementId: 'G-LK83FBJKBJ',
};

let analytics: Analytics | null = null;

export function initFirebase() {
    if (typeof window === 'undefined') return null;

    try {
        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        if (!analytics) {
            analytics = getAnalytics(app);
        }
        return analytics;
    } catch (error) {
        console.error('Failed to initialize Firebase Analytics:', error);
        return null;
    }
}

export function logDownloadEvent(platform: string, url: string | null, label: string) {
    const analyticsInstance = initFirebase();
    if (analyticsInstance) {
        fbLogEvent(analyticsInstance, 'download_click', {
            platform,
            url: url || 'unknown',
            label,
        });
    }
}
