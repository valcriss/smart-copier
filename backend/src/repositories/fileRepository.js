export class FileRepository {
  constructor(db) {
    this.db = db;
  }

  async findByFingerprint(fingerprint, sourceRoot) {
    return this.db.get("SELECT * FROM files WHERE fingerprint = ? AND source_root = ?", [
      fingerprint,
      sourceRoot
    ]);
  }

  async insertPending(file) {
    await this.db.run(
      `
      INSERT INTO files (
        fingerprint,
        filename,
        source_path,
        source_root,
        destination_path,
        size,
        status,
        first_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        file.fingerprint,
        file.filename,
        file.sourcePath,
        file.sourceRoot,
        file.destinationPath,
        file.size,
        file.status,
        file.firstSeenAt
      ]
    );
  }

  async updateStatus(fingerprint, sourceRoot, status, fields = {}) {
    const copiedAt = fields.copiedAt ?? null;
    const destinationPath = fields.destinationPath ?? null;
    const errorMessage = fields.errorMessage ?? null;
    await this.db.run(
      `
      UPDATE files
      SET status = ?,
          copied_at = ?,
          destination_path = ?,
          error_message = ?
      WHERE fingerprint = ? AND source_root = ?
      `,
      [status, copiedAt, destinationPath, errorMessage, fingerprint, sourceRoot]
    );
  }

  async markCopying(fingerprint, sourceRoot) {
    await this.updateStatus(fingerprint, sourceRoot, "COPYING");
  }

  async markCopied(fingerprint, sourceRoot, destinationPath, copiedAt) {
    await this.updateStatus(fingerprint, sourceRoot, "COPIED", { destinationPath, copiedAt });
  }

  async markFailed(fingerprint, sourceRoot, errorMessage) {
    await this.updateStatus(fingerprint, sourceRoot, "FAILED", { errorMessage });
  }

  async listHistory(limit = 200) {
    return this.db.all(
      `
      SELECT * FROM files
      ORDER BY first_seen_at DESC
      LIMIT ?
      `,
      [limit]
    );
  }

  async failInProgress() {
    await this.db.run(
      "UPDATE files SET status = 'FAILED', error_message = 'Interrupted by restart' WHERE status = 'COPYING'"
    );
  }
}
