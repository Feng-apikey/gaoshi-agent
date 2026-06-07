const DB = 'gaoshi-offline'
const STORE = 'inspirations'
const DB_VERSION = 1

export interface Inspiration {
  id?: number
  title: string
  content: string
  images: string[]
  video: string
  platform: string
  type: string
  tags: string[]
  savedAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('savedAt', 'savedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function useOfflineSync() {
  async function saveLocally(data: Omit<Inspiration, 'id' | 'savedAt'>): Promise<void> {
    const db = await openDB()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add({ ...data, savedAt: Date.now() })
    return new Promise((resolve) => { tx.oncomplete = () => resolve() })
  }

  async function getAll(): Promise<Inspiration[]> {
    const db = await openDB()
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).index('savedAt').getAll()
    return new Promise((resolve) => { tx.oncomplete = () => resolve(req.result ?? []) })
  }

  async function remove(id: number): Promise<void> {
    const db = await openDB()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    return new Promise((resolve) => { tx.oncomplete = () => resolve() })
  }

  async function queueLength(): Promise<number> {
    const db = await openDB()
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).count()
    return new Promise((resolve) => { tx.oncomplete = () => resolve(req.result) })
  }

  return { saveLocally, getAll, remove, queueLength }
}
