<script setup lang="ts">
import { ref } from 'vue'
import type { ProviderConfig } from '../../types'
import { useSettingsStore } from '../../stores/settings'

const props = defineProps<{ providers: ProviderConfig[] }>()
const emit = defineEmits<{ refresh: [] }>()

const { addProvider, removeProvider } = useSettingsStore()

const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  { id: 'minimax', name: 'MiniMax', baseURL: 'https://api.minimax.chat/v1' },
  { id: 'zhipu', name: '智谱', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'moonshot', name: 'Kimi', baseURL: 'https://api.moonshot.cn/v1' },
  { id: 'xiaomi', name: '小米 MiMo', baseURL: 'https://api.xiaomimimo.com/v1' },
  { id: 'qwen', name: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', note: '图片生成和语音合成不支持 OpenAI 兼容格式，需走 DashScope 原生 API' },
]

const selectedPresetNote = ref('')

const showForm = ref(false)
const isCustom = ref(false)
const selectedPreset = ref('')
const formId = ref('')
const formName = ref('')
const formApiKey = ref('')
const formBaseURL = ref('')
const formEnabled = ref(true)

function openAdd() {
  isCustom.value = false
  selectedPreset.value = ''
  selectedPresetNote.value = ''
  formId.value = ''; formName.value = ''; formApiKey.value = ''; formBaseURL.value = ''; formEnabled.value = true
  showForm.value = true
}

function openCustom() {
  isCustom.value = true
  formId.value = ''; formName.value = ''; formApiKey.value = ''; formBaseURL.value = ''; formEnabled.value = true
  showForm.value = true
}

function openEdit(p: ProviderConfig) {
  const preset = PRESETS.find(pr => pr.id === p.id)
  if (preset) {
    isCustom.value = false
    selectedPreset.value = p.id
    selectedPresetNote.value = (preset as any).note ?? ''
    formApiKey.value = p.apiKey
    formEnabled.value = !!p.enabled
  } else {
    isCustom.value = true
    formId.value = p.id
    formName.value = p.name
    formApiKey.value = p.apiKey
    formBaseURL.value = p.baseURL
    formEnabled.value = !!p.enabled
  }
  showForm.value = true
}

function onPresetChange() {
  const preset = PRESETS.find(p => p.id === selectedPreset.value)
  if (preset) {
    formId.value = preset.id
    formName.value = preset.name
    formBaseURL.value = preset.baseURL
    selectedPresetNote.value = (preset as any).note ?? ''
  }
}

async function save() {
  const id = isCustom.value ? formId.value : selectedPreset.value
  if (!id) return
  const preset = !isCustom.value ? PRESETS.find(p => p.id === selectedPreset.value) : null
  try {
    await addProvider({
      id,
      name: isCustom.value ? formName.value : (preset?.name ?? ''),
      apiKey: formApiKey.value,
      baseURL: isCustom.value ? formBaseURL.value : (preset?.baseURL ?? ''),
      enabled: formEnabled.value,
    })
    showForm.value = false
    emit('refresh')
  } catch {}
}

async function del(id: string) {
  await removeProvider(id)
  emit('refresh')
}

function isPreset(id: string): boolean {
  return PRESETS.some(p => p.id === id)
}
</script>

<template>
  <div class="provider-form">
    <div v-for="p in providers" :key="p.id" class="provider-item">
      <div class="info">
        <span class="name">{{ p.name }}</span>
        <span v-if="isPreset(p.id)" class="badge-preset">预置</span>
        <span v-else class="badge-custom">自定义</span>
        <span :class="['status-dot', p.enabled ? 'on' : 'off']" />
      </div>
      <div class="actions">
        <button class="act-btn" @click="openEdit(p)" title="编辑">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 10.5V12h1.5l7.5-7.5-1.5-1.5L2 10.5zM11.5 2c-.4 0-.8.15-1.1.45L9 3.85l1.5 1.5 1.4-1.4c.3-.3.3-.8 0-1.1l-.3-.4C11.3 2.15 10.9 2 11.5 2z" fill="currentColor"/></svg>
        </button>
        <button class="act-btn del" @click="del(p.id)" title="删除">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>

    <div class="add-btns">
      <button class="add-btn" @click="openAdd">+ 添加预置 Provider</button>
      <button class="add-btn" @click="openCustom">+ 添加自定义 Provider</button>
    </div>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
        <div class="modal">
          <h4>{{ providers.some(p => p.id === formId && formId) ? '编辑' : '新增' }} Provider</h4>

          <p v-if="!isCustom" class="hint">选择已适配的国内模型提供商，只需填写 API Key 即可。</p>
          <p v-else class="hint">仅支持 OpenAI 兼容格式（/v1/chat/completions 端点）。</p>

          <!-- Preset mode: dropdown -->
          <template v-if="!isCustom">
            <label class="field">
              <span>Provider</span>
              <select v-model="selectedPreset" class="field-select" @change="onPresetChange">
                <option value="">-- 选择提供商 --</option>
                <option v-for="pr in PRESETS" :key="pr.id" :value="pr.id">{{ pr.name }} ({{ pr.id }})</option>
              </select>
            </label>
            <p v-if="selectedPresetNote" class="preset-note">{{ selectedPresetNote }}</p>
          </template>

          <!-- Custom mode: free-form inputs -->
          <template v-else>
            <label class="field">
              <span>ID</span>
              <input v-model="formId" placeholder="my-provider" />
            </label>
            <label class="field">
              <span>名称</span>
              <input v-model="formName" placeholder="自定义" />
            </label>
            <label class="field">
              <span>Base URL</span>
              <input v-model="formBaseURL" placeholder="https://api.example.com/v1" />
            </label>
          </template>

          <label class="field">
            <span>API Key</span>
            <input v-model="formApiKey" placeholder="sk-..." type="password" />
          </label>
          <label class="field-check">
            <input type="checkbox" v-model="formEnabled" />
            <span>启用</span>
          </label>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showForm = false">取消</button>
            <button class="btn-save" @click="save">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.provider-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 4px;
}

.info { display: flex; align-items: center; gap: 6px; }
.name { font-size: 13px; font-weight: 600; }

.badge-preset, .badge-custom {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
}
.badge-preset { background: #F5F3FF; color: var(--primary); }
.badge-custom { background: #FEF3C7; color: #92400E; }

.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.status-dot.on { background: var(--success); }
.status-dot.off { background: var(--text-muted); }

.actions { display: flex; gap: 2px; opacity: 0; }
.provider-item:hover .actions { opacity: 1; }

.act-btn {
  width: 26px; height: 26px;
  border: none; background: transparent; border-radius: 4px;
  color: var(--text-muted); display: flex; align-items: center; justify-content: center;
}
.act-btn:hover { background: var(--hover); }
.act-btn.del:hover { color: var(--error); }

.add-btns { display: flex; gap: 6px; }

.add-btn {
  flex: 1;
  padding: 8px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
}

.add-btn:hover { border-color: var(--primary); color: var(--primary); }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 380px;
  max-width: 90vw;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal h4 { font-size: 15px; }

.field { display: flex; flex-direction: column; gap: 4px; }
.field span { font-size: 12px; color: var(--text-secondary); }
.field input, .field-select {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
}
.field input:focus, .field-select:focus { outline: none; border-color: var(--primary); }

.hint { font-size: 12px; color: var(--text-muted); margin: 0; }
.preset-note { font-size: 12px; color: #D97706; background: #FEF3C7; padding: 6px 8px; border-radius: var(--radius); margin: 0; }

.field-check { display: flex; align-items: center; gap: 6px; font-size: 13px; }

.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }

.btn-cancel, .btn-save {
  padding: 7px 18px; border-radius: var(--radius); font-size: 13px; border: none;
}
.btn-cancel { background: var(--hover); color: var(--text-primary); }
.btn-save { background: var(--primary); color: #fff; }
.btn-save:hover { background: var(--primary-hover); }
</style>
