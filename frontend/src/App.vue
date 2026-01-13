<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <div class="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_45%),radial-gradient(circle_at_30%_30%,_rgba(248,113,113,0.12),_transparent_45%)]"></div>
    <header class="border-b border-slate-800/70">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div>
          <p class="text-xs uppercase tracking-[0.3em] text-cyan-300/70">Smart Copier</p>
          <h1 class="font-display text-3xl font-semibold">Control room</h1>
        </div>
        <div class="flex items-center gap-3">
          <span
            class="rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em]"
            :class="badgeClass"
          >
            {{ taskLabel }}
          </span>
        </div>
      </div>
      <div class="mx-auto flex max-w-6xl gap-3 px-6 pb-5">
        <button
          v-for="item in tabs"
          :key="item.key"
          class="rounded-full px-4 py-2 text-sm font-semibold transition"
          :class="
            activeTab === item.key
              ? 'bg-cyan-500/20 text-cyan-100'
              : 'text-slate-400 hover:text-slate-200'
          "
          @click="activeTab = item.key"
        >
          {{ item.label }}
        </button>
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-6 py-10">
      <DashboardView v-if="activeTab === 'dashboard'" />
      <HistoryView v-else-if="activeTab === 'history'" />
      <LogsView v-else />
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import DashboardView from "./components/DashboardView.vue";
import HistoryView from "./components/HistoryView.vue";
import LogsView from "./components/LogsView.vue";
import { connectSse, setConfig, state } from "./state.js";
import { fetchConfig } from "./api.js";

const activeTab = ref("dashboard");
const tabs = [
  { key: "dashboard", label: "Dashboard" },
  { key: "history", label: "Historique" },
  { key: "logs", label: "Logs" }
];

onMounted(async () => {
  const configResponse = await fetchConfig();
  setConfig(configResponse.config, configResponse.allowedRoots);
  connectSse();
});

const taskLabel = computed(() =>
  state.taskStatus === "running" && state.running ? "running" : "error"
);

const badgeClass = computed(() =>
  taskLabel.value === "running"
    ? "bg-emerald-500/20 text-emerald-200"
    : "bg-rose-500/20 text-rose-200"
);
</script>
