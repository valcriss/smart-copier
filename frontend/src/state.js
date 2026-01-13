import { reactive } from "vue";

export const state = reactive({
  running: false,
  taskStatus: "running",
  associations: [],
  logs: [],
  config: {
    associations: [],
    ignoredExtensions: [],
    scanIntervalSeconds: 60,
    dryRun: false
  },
  allowedRoots: {
    source: [],
    destination: []
  }
});

export function applyState(payload) {
  state.running = payload.running;
  state.taskStatus = payload.taskStatus ?? "running";
  state.associations = payload.associations ?? [];
  state.logs = payload.logs ?? [];
}

export function setConfig(config, allowedRoots) {
  state.config = config;
  state.allowedRoots = allowedRoots;
}

export function connectSse(eventSourceFactory = (url) => new EventSource(url)) {
  const source = eventSourceFactory("/api/events");
  source.addEventListener("state", (event) => {
    const data = JSON.parse(event.data);
    applyState(data);
  });
  return source;
}
