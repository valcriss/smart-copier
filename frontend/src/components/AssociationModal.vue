<template>
  <div v-if="open" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-6">
    <div class="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
      <div class="flex items-center justify-between">
        <h3 class="font-display text-xl font-semibold text-slate-100">
          {{ mode === 'edit' ? 'Modifier association' : 'Ajouter association' }}
        </h3>
        <button class="text-slate-400 hover:text-slate-200" @click="$emit('close')">Close</button>
      </div>

      <div class="mt-6 space-y-4">
        <div>
          <label class="text-xs uppercase tracking-[0.3em] text-slate-400">Source</label>
          <select
            v-model="localInput"
            class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
          >
            <option v-for="root in allowedRoots.source" :key="root" :value="root">
              {{ root }}
            </option>
          </select>
        </div>
        <div>
          <label class="text-xs uppercase tracking-[0.3em] text-slate-400">Destination</label>
          <select
            v-model="localOutput"
            class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm"
          >
            <option v-for="root in allowedRoots.destination" :key="root" :value="root">
              {{ root }}
            </option>
          </select>
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-3">
        <button
          class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:border-slate-500"
          @click="$emit('close')"
        >
          Annuler
        </button>
        <button
          class="rounded-full bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100"
          @click="save"
        >
          Enregistrer
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  open: Boolean,
  mode: { type: String, default: "create" },
  association: { type: Object, default: null },
  allowedRoots: { type: Object, default: () => ({ source: [], destination: [] }) }
});

const emit = defineEmits(["save", "close"]);

const localInput = ref("");
const localOutput = ref("");

const defaultSource = computed(() => props.allowedRoots.source[0] ?? "");
const defaultDestination = computed(() => props.allowedRoots.destination[0] ?? "");

watch(
  () => props.open,
  () => {
    localInput.value = props.association?.input ?? defaultSource.value;
    localOutput.value = props.association?.output ?? defaultDestination.value;
  },
  { immediate: true }
);

function save() {
  emit("save", {
    id: props.association?.id ?? `assoc-${Date.now()}`,
    input: localInput.value,
    output: localOutput.value
  });
}
</script>