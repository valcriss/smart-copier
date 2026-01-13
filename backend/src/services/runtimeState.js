export class RuntimeState {
  constructor() {
    this.running = false;
    this.taskStatus = "running";
    this.associations = [];
    this.logs = [];
  }

  setAssociations(associations) {
    this.associations = associations.map((assoc) => ({
      id: assoc.id,
      input: assoc.input,
      output: assoc.output,
      status: "idle",
      pendingCount: 0,
      toCopyCount: 0,
      currentFile: null
    }));
  }

  setRunning(isRunning) {
    this.running = isRunning;
  }

  setTaskStatus(status) {
    this.taskStatus = status;
  }

  setAssociationStatus(id, status, currentFile) {
    const assoc = this.associations.find((item) => item.id === id);
    if (assoc) {
      assoc.status = status;
      assoc.currentFile = currentFile ?? null;
    }
  }

  setAssociationPendingCount(id, count) {
    const assoc = this.associations.find((item) => item.id === id);
    if (assoc) {
      assoc.pendingCount = count;
    }
  }

  setAssociationToCopyCount(id, count) {
    const assoc = this.associations.find((item) => item.id === id);
    if (assoc) {
      assoc.toCopyCount = count;
    }
  }

  addLog(entry) {
    this.logs.unshift(entry);
    if (this.logs.length > 200) {
      this.logs.pop();
    }
  }

  snapshot() {
    return {
      running: this.running,
      taskStatus: this.taskStatus,
      associations: this.associations,
      logs: this.logs
    };
  }
}
