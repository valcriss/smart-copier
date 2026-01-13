<template>
  <section class="space-y-6">
    <div>
      <h2 class="font-display text-2xl font-semibold">Logs</h2>
      <p class="text-sm text-slate-400">Erreurs et evenements recents.</p>
    </div>

    <div v-if="state.logs.length === 0" class="rounded-2xl border border-slate-800/70 bg-slate-900/60 px-6 py-8">
      <p class="text-sm text-slate-300">Aucun log pour le moment.</p>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="entry in state.logs"
        :key="entry.time + entry.message"
        class="rounded-2xl border border-slate-800/70 bg-slate-900/60 p-5"
      >
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-slate-200">{{ entry.message }}</p>
          <span class="text-xs text-slate-500">{{ entry.time }}</span>
        </div>
        <p class="text-xs uppercase tracking-[0.3em] text-slate-500">{{ entry.level }}</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { state } from "../state.js";
</script>