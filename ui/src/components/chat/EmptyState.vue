<script setup lang="ts">
</script>

<template>
  <div class="empty-state">
    <div class="logo">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect width="48" height="48" rx="12" fill="var(--primary)" opacity="0.1"/>
        <path d="M14 16h20M14 24h14M14 32h8" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    </div>
    <h2>稿事</h2>
    <p>AI 内容创作工作站</p>
  </div>
</template>

<style scoped>
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
}

.logo { margin-bottom: 8px; }

h2 {
  font-size: 22px;
  color: var(--text-primary);
  font-weight: 700;
}

p {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

</style>
