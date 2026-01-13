<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="font-display text-2xl font-semibold">Dashboard</h2>
        <p class="text-sm text-slate-400">Suivi temps reel des copies en cours.</p>
      </div>
      <button
        class="rounded-full bg-cyan-500/20 px-5 py-2 text-sm font-semibold text-cyan-100"
        @click="openCreate"
      >
        Ajouter une association
      </button>
    </div>

    <div v-if="!hasActiveCopy" class="rounded-2xl border border-slate-800/70 bg-slate-900/60 px-6 py-8">
      <p class="text-sm font-semibold text-slate-300">aucune copie en cours</p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <article
        v-for="assoc in state.associations"
        :key="assoc.id"
        class="rounded-2xl border border-slate-800/70 bg-slate-900/60 p-5"
      >
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-display text-lg font-semibold text-slate-100">{{ assoc.input }}</h3>
            <p class="text-xs uppercase tracking-[0.3em] text-slate-500">{{ assoc.output }}</p>
          </div>
          <span
            class="rounded-full px-3 py-1 text-xs font-semibold"
            :class="statusClasses(assoc)"
          >
            {{ statusLabel(assoc) }}
          </span>
        </div>

        <div v-if="assoc.currentFile" class="mt-4 space-y-2">
          <p class="text-sm font-semibold text-slate-200">{{ assoc.currentFile.filename }}</p>
          <div class="h-2 w-full rounded-full bg-slate-800">
            <div
              class="h-2 rounded-full bg-cyan-400"
              :style="{ width: `${assoc.currentFile.percent}%` }"
            ></div>
          </div>
          <div class="flex flex-wrap gap-3 text-xs text-slate-400">
            <span>{{ assoc.currentFile.percent }}%</span>
            <span>{{ assoc.currentFile.copiedBytes }} / {{ assoc.currentFile.size }} bytes</span>
            <span>{{ assoc.currentFile.speedBytesPerSecond }} B/s</span>
            <span v-if="assoc.currentFile.etaSeconds !== null">ETA {{ assoc.currentFile.etaSeconds }}s</span>
          </div>
        </div>

        <div class="mt-5 flex gap-3">
          <button
            class="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:border-slate-500"
            @click="openEdit(assoc)"
          >
            Modifier
          </button>
          <button
            class="rounded-full border border-rose-500/40 px-4 py-2 text-xs font-semibold text-rose-200 hover:border-rose-500"
            @click="removeAssociation(assoc)"
          >
            Supprimer
          </button>
        </div>
      </article>
    </div>
  </section>

  <AssociationModal
    :open="modalOpen"
    :mode="editing ? 'edit' : 'create'"
    :association="editing"
    :allowed-roots="state.allowedRoots"
    @close="closeModal"
    @save="saveAssociation"
  />
</template>

<script setup>
import { computed, ref } from "vue";
import AssociationModal from "./AssociationModal.vue";
import { state, setConfig } from "../state.js";
import { updateConfig } from "../api.js";

const modalOpen = ref(false);
const editing = ref(null);

const hasActiveCopy = computed(() => state.associations.some((assoc) => assoc.status === "copying"));

function statusClasses(assoc) {
  if (assoc.status === "copying") {
    return "bg-cyan-500/20 text-cyan-200";
  }
  if (assoc.status === "error") {
    return "bg-rose-500/20 text-rose-200";
  }
  if (assoc.pendingCount > 0) {
    return "bg-amber-500/20 text-amber-200";
  }
  return "bg-slate-800 text-slate-300";
}

function statusLabel(assoc) {
  if (assoc.status === "copying") {
    return "copying";
  }
  if (assoc.status === "error") {
    return "error";
  }
  if (assoc.pendingCount > 0) {
    return `${assoc.pendingCount} fichiers en attente`;
  }
  return "idle";
}

function openCreate() {
  editing.value = null;
  modalOpen.value = true;
}

function openEdit(assoc) {
  editing.value = assoc;
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function saveAssociation(association) {
  const currentAssociations = state.associations.map((item) => ({
    id: item.id,
    input: item.input,
    output: item.output
  }));
  const nextAssociations = currentAssociations
    .filter((item) => item.id !== association.id)
    .concat(association);

  const response = await updateConfig({
    associations: nextAssociations,
    ignoredExtensions: state.config.ignoredExtensions,
    scanIntervalSeconds: state.config.scanIntervalSeconds,
    dryRun: state.config.dryRun
  });

  setConfig(response.config, state.allowedRoots);
  modalOpen.value = false;
}

async function removeAssociation(association) {
  const currentAssociations = state.associations.map((item) => ({
    id: item.id,
    input: item.input,
    output: item.output
  }));
  const nextAssociations = currentAssociations.filter((item) => item.id !== association.id);
  const response = await updateConfig({
    associations: nextAssociations,
    ignoredExtensions: state.config.ignoredExtensions,
    scanIntervalSeconds: state.config.scanIntervalSeconds,
    dryRun: state.config.dryRun
  });
  setConfig(response.config, state.allowedRoots);
}
</script>
