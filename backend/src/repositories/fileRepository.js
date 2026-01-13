export class FileRepository {
  constructor(db) {
    this.db = db;
  }

  async findByFingerprint(fingerprint) {
    return this.db.get("SELECT * FROM files WHERE fingerprint = ?", [fingerprint]);
  }

  async insertPending(file) {
    await this.db.run(
      `
      INSERT INTO files (
        fingerprint,
        filename,
        source_path,
        destination_path,
        size,
        status,
        first_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        file.fingerprint,
        file.filename,
        file.sourcePath,
        file.destinationPath,
        file.size,
        file.status,
        file.firstSeenAt
      ]
    );
  }

  async updateStatus(fingerprint, status, fields = {}) {
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
      WHERE fingerprint = ?
      `,
      [status, copiedAt, destinationPath, errorMessage, fingerprint]
    );
  }

  async markCopying(fingerprint) {
    await this.updateStatus(fingerprint, "COPYING");
  }

  async markCopied(fingerprint, destinationPath, copiedAt) {
    await this.updateStatus(fingerprint, "COPIED", { destinationPath, copiedAt });
  }

  async markFailed(fingerprint, errorMessage) {
    await this.updateStatus(fingerprint, "FAILED", { errorMessage });
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