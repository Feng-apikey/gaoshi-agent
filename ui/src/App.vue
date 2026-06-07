<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Sidebar from './components/layout/Sidebar.vue'
import ChatArea from './components/layout/ChatArea.vue'
import DraftPanel from './components/drafts/DraftPanel.vue'
import MaterialPanel from './components/materials/MaterialPanel.vue'
import SettingsPanel from './components/settings/SettingsPanel.vue'
import InspirePad from './components/mobile/InspirePad.vue'

const activeTab = ref<'drafts' | 'materials' | 'settings'>('drafts')
const isMobile = ref(false)

onMounted(() => {
  isMobile.value = /Mobi|Android/i.test(navigator.userAgent) || (window.innerWidth <= 768 && 'ontouchstart' in window)
})
</script>

<template>
  <InspirePad v-if="isMobile" />
  <div v-else class="app-shell">
    <Sidebar v-model:activeTab="activeTab">
      <DraftPanel v-if="activeTab === 'drafts'" />
      <MaterialPanel v-else-if="activeTab === 'materials'" />
      <SettingsPanel v-else />
    </Sidebar>
    <ChatArea />
  </div>
</template>

<style>
@import './style/variables.css';

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--text-primary);
  background: var(--bg);
  overflow: auto;
}

/* Desktop: lock scrolling, app-shell fills viewport */
@media (min-width: 769px) {
  body { overflow: hidden; }
}

.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  min-width: 0;
}

button {
  cursor: pointer;
  font-family: inherit;
}

input, textarea, select {
  font-family: inherit;
}

/* Responsive helpers */
img, video, audio { max-width: 100%; height: auto; }
pre { max-width: 100%; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
</style>
