'use client';

import { initFirebase } from '@/lib/firebase';
import { useEffect } from 'react';

export function Analytics() {
    useEffect(() => {
        initFirebase();
    }, []);

    return null;
}
