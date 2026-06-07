<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { ModelRoute, ProviderConfig } from '../../types'
import { useSettingsStore } from '../../stores/settings'
import { fetchPresets, type ProviderPreset } from '../../api/presets'

const props = defineProps<{
  routing: Record<string, string>
  routingFull: ModelRoute[]
  providers: ProviderConfig[]
}>()
const emit = defineEmits<{ refresh: [] }>()

const { saveRouting } = useSettingsStore()

const capabilities = ['text', 'vision', 'video', 'image', 'tts', 'music'] as const
const CAP_LABELS: Record<string, string> = { text: '对话', vision: '图片理解', video: '视频理解', image: '图片生成', tts: '语音合成', music: '音乐生成' }

const presets = ref<ProviderPreset[]>([])

onMounted(async () => {
  try { presets.value = await fetchPresets() } catch {}
})

const presetModels = computed(() => {
  const map: Record<string, Record<string, string[]>> = {}
  for (const p of presets.value) {
    const byCap: Record<string, string[]> = {}
    for (const m of p.models) {
      for (const cap of m.capabilities) {
        if (!byCap[cap]) byCap[cap] = []
        byCap[cap].push(m.name)
      }
    }
    map[p.id] = byCap
  }
  return map
})

const editing = ref<string | null>(null)
const editProviderId = ref('')
const editModel = ref('')
const customModel = ref('')
const editBaseURL = ref('')
const editApiKey = ref('')

const availableModels = computed(() => {
  if (!editProviderId.value || !editing.value) return []
  return presetModels.value[editProviderId.value]?.[editing.value] ?? []
})

const enabledProviders = computed(() =>
  props.providers.filter(p => p.enabled)
)

function openEdit(cap: string) {
  const r = props.routingFull.find(r => r.capability === cap)
  editProviderId.value = r?.providerId ?? ''
  editModel.value = r?.model ?? ''
  customModel.value = ''
  editBaseURL.value = r?.baseURL || ''
  editApiKey.value = r?.apiKey || ''
  editing.value = cap
}

function onProviderChange() {
  const p = presets.value.find(pr => pr.id === editProviderId.value)
  editBaseURL.value = p?.baseURL ?? ''
  editModel.value = availableModels.value[0] ?? ''
  editApiKey.value = ''
}

async function save() {
  if (!editing.value) return
  const model = customModel.value || editModel.value
  // Allow empty model to reset/clear this capability
  await saveRouting(editing.value, editProviderId.value, model, editBaseURL.value || undefined, editApiKey.value || undefined)
  editing.value = null
  emit('refresh')
}

async function resetCap(cap: string) {
  await saveRouting(cap, '', '', undefined, undefined)
  emit('refresh')
}

function getProviderName(cap: string): string {
  const r = props.routingFull.find(r => r.capability === cap)
  if (!r) return ''
  if (r.baseURL && r.apiKey) return '自定义'
  return props.providers.find(p => p.id === r.providerId)?.name ?? r.providerId
}

function isInlineConfig(cap: string): boolean {
  const r = props.routingFull.find(r => r.capability === cap)
  return !!(r?.baseURL && r?.apiKey)
}
</script>

<template>
  <div class="routing-table">
    <p class="desc">双击配置，可直接填 baseURL + 模型 + Key，也可选择预设 Provider</p>
    <div v-for="cap in capabilities" :key="cap" class="route-row" @dblclick="openEdit(cap)">
      <span class="capability">{{ CAP_LABELS[cap] ?? cap }}</span>
      <div class="route-value">
        <template v-if="routing[cap]">
          <span class="badge" :class="isInlineConfig(cap) ? 'badge-inline' : 'badge-provider'">
            {{ isInlineConfig(cap) ? '自定义' : getProviderName(cap) }}
          </span>
          <span class="model">{{ routing[cap] }}</span>
        </template>
        <template v-else>
          <span class="auto-hint">自动匹配</span>
        </template>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="editing" class="modal-overlay" @click.self="editing = null">
        <div class="modal">
          <h4>配置「{{ CAP_LABELS[editing] }}」</h4>

          <label class="field">
            <span>Provider（可选快捷填充）</span>
            <select v-model="editProviderId" @change="onProviderChange">
              <option value="">-- 直接填写下方 --</option>
              <option v-for="p in enabledProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>

          <label class="field">
            <span>baseURL</span>
            <input v-model="editBaseURL" placeholder="https://api.example.com/v1" />
          </label>

          <label class="field">
            <span>API Key</span>
            <input v-model="editApiKey" type="password" placeholder="sk-..." />
          </label>

          <label class="field">
            <span>模型</span>
            <select v-model="editModel" @change="customModel = ''">
              <option value="">-- 选择 --</option>
              <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
              <option value="__custom__">自定义模型名...</option>
            </select>
          </label>
          <label v-if="editModel === '__custom__'" class="field">
            <input v-model="customModel" placeholder="输入模型名" />
          </label>

          <div class="modal-actions">
            <button class="btn-cancel" @click="editing = null">取消</button>
            <button class="btn-save" @click="save">确定</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.desc { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }

.routing-table { display: flex; flex-direction: column; gap: 4px; }

.route-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.15s;
  overflow: hidden;
}

.route-row:hover { border-color: var(--primary); }

.capability { font-size: 13px; font-weight: 600; flex-shrink: 0; }

.route-value { display: flex; align-items: center; gap: 4px; overflow: hidden; }

.badge { font-size: 11px; padding: 1px 6px; border-radius: 3px; flex-shrink: 0; }
.badge-provider { background: var(--hover); color: var(--text-secondary); }
.badge-inline { background: rgba(94, 106, 210, 0.1); color: var(--primary); }

.model { font-size: 13px; color: var(--primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.auto-hint { font-size: 12px; color: var(--text-muted); }

.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1001;
}

.modal {
  background: var(--bg);
  border-radius: var(--radius-lg);
  padding: 24px; width: 400px; max-width: 90vw;
  box-shadow: var(--shadow-md);
  display: flex; flex-direction: column; gap: 14px;
}

.modal h4 { font-size: 15px; }

.field { display: flex; flex-direction: column; gap: 4px; }
.field span { font-size: 12px; color: var(--text-secondary); }
.field select, .field input {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px; background: var(--bg);
}
.field select:focus, .field input:focus { outline: none; border-color: var(--primary); }

.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }

.btn-cancel, .btn-save { padding: 7px 18px; border-radius: var(--radius); font-size: 13px; border: none; }
.btn-cancel { background: var(--hover); color: var(--text-primary); }
.btn-save { background: var(--primary); color: #fff; }
.btn-save:hover { background: var(--primary-hover); }
</style>
