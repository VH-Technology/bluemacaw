import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCallback, useState } from 'react';
import { SettingsLocalModels } from './SettingsLocalModels';
import { SettingsModelConfigs } from './SettingsModelConfigs';

export function SettingsModels() {
    const [refreshToken, setRefreshToken] = useState(0);
    const bumpRefresh = useCallback(() => {
        setRefreshToken((value) => value + 1);
    }, []);

    return (
        <Card data-testid="settings-models">
            <CardHeader>
                <CardTitle>Models</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-8">
                <SettingsModelConfigs refreshToken={refreshToken} onActiveChange={bumpRefresh} />
                <div className="border-t border-border/70 pt-6">
                    <SettingsLocalModels refreshToken={refreshToken} onActiveChange={bumpRefresh} />
                </div>
            </CardContent>
        </Card>
    );
}
