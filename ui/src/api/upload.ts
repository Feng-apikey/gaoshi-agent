export async function uploadFile(file: File): Promise<{ id: string; name: string; category: string; description?: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  return res.json()
}

export function getUploadUrl(id: string): string {
  return `/api/upload/${id}`
}
