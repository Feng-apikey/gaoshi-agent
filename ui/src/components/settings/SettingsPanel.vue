<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings'
import { useChatStore } from '../../stores/chat'
import ProviderForm from './ProviderForm.vue'
import RoutingTable from './RoutingTable.vue'

const { state: settings, loadProviders, loadRouting, toggleAutoApprove } = useSettingsStore()
const { state: chatState } = useChatStore()
</script>

<template>
  <div class="settings-panel">
    <h3>设置</h3>

    <section>
      <h4>Provider 配置</h4>
      <p class="desc">仅支持 OpenAI 兼容格式 API</p>
      <ProviderForm
        :providers="settings.providers"
        @refresh="loadProviders; loadRouting"
      />
    </section>

    <section>
      <h4>模型路由</h4>
      <RoutingTable
        :routing="settings.routing"
        :routingFull="settings.routingFull"
        :providers="settings.providers"
        @refresh="loadRouting"
      />
    </section>

    <section>
      <h4>行为</h4>
      <label class="toggle-row">
        <span>
          <span class="toggle-label">全自动执行</span>
          <span class="toggle-desc">所有工具直接执行，不弹确认卡片</span>
        </span>
        <input
          type="checkbox"
          :checked="settings.autoApprove"
          @change="toggleAutoApprove"
        />
      </label>
    </section>

    <section>
      <h4>统计</h4>
      <div class="stats">
        <div class="stat">
          <span class="stat-label">Token 累计消耗</span>
          <span class="stat-value">{{ chatState.totalTokens.toLocaleString() }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">版本</span>
          <span class="stat-value">v{{ settings.version }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-panel { display: flex; flex-direction: column; gap: 20px; }

h3 { font-size: 15px; font-weight: 600; }

section { display: flex; flex-direction: column; gap: 8px; }

h4 { font-size: 13px; font-weight: 600; color: var(--text-secondary); }

.desc { font-size: 11px; color: var(--text-muted); }

.stats {
  display: flex;
  gap: 12px;
}

.stat {
  flex: 1;
  padding: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label { font-size: 11px; color: var(--text-muted); }
.stat-value { font-size: 18px; font-weight: 700; color: var(--primary); }

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.toggle-label { font-size: 13px; }
.toggle-desc { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.toggle-row input[type="checkbox"] {
  width: 16px; height: 16px; accent-color: var(--primary);
}
</style>
