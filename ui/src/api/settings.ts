export interface AppSettings {
  autoApprove: boolean;
}

export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch('/api/settings');
  return res.json();
}

export async function updateSettings(data: Partial<AppSettings>): Promise<AppSettings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}
