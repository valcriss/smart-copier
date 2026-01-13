<template>
  <section class="space-y-6">
    <div>
      <h2 class="font-display text-2xl font-semibold">Historique</h2>
      <p class="text-sm text-slate-400">Trace persistante des fichiers traites.</p>
    </div>

    <div v-if="items.length === 0" class="rounded-2xl border border-slate-800/70 bg-slate-900/60 px-6 py-8">
      <p class="text-sm text-slate-300">Aucun fichier traite.</p>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="item in items"
        :key="item.id"
        class="rounded-2xl border border-slate-800/70 bg-slate-900/60 p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-slate-200">{{ item.filename }}</p>
            <p class="text-xs uppercase tracking-[0.3em] text-slate-500">{{ item.status }}</p>
          </div>
          <p class="text-xs text-slate-400">{{ item.first_seen_at }}</p>
        </div>
        <p class="mt-3 text-xs text-slate-400">{{ item.source_path }}</p>
        <p class="text-xs text-slate-500">{{ item.destination_path }}</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { fetchHistory } from "../api.js";

const items = ref([]);

onMounted(async () => {
  const response = await fetchHistory();
  items.value = response.items;
});
</script>