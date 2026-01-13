import { isPathWithinRoots } from "../util/pathGuard.js";
import path from "path";

export class AssociationService {
  constructor({ configRepository, envConfig }) {
    this.configRepository = configRepository;
    this.envConfig = envConfig;
  }

  async getEffectiveConfig() {
    const stored = await this.configRepository.getConfig();
    return this.envConfig.resolveConfig(stored);
  }

  async updateConfig(payload) {
    const sourceRoots = this.envConfig.getAllowedSourceRoots();
    const destinationRoots = this.envConfig.getAllowedDestinationRoots();

    const associations = (payload.associations ?? []).map((assoc) => ({
      id: assoc.id,
      input: assoc.input,
      output: assoc.output
    }));

    for (const assoc of associations) {
      if (!isPathWithinRoots(assoc.input, sourceRoots)) {
        throw new Error("Input path is outside allowed roots");
      }
      if (!isSubdirectoryOfRoots(assoc.input, sourceRoots)) {
        throw new Error("Input path must be a subdirectory of allowed roots");
      }
      if (!isPathWithinRoots(assoc.output, destinationRoots)) {
        throw new Error("Output path is outside allowed roots");
      }
      if (!isSubdirectoryOfRoots(assoc.output, destinationRoots)) {
        throw new Error("Output path must be a subdirectory of allowed roots");
      }
    }

    const stored = {
      associations,
      ignoredExtensions: payload.ignoredExtensions ?? undefined,
      scanIntervalSeconds: payload.scanIntervalSeconds ?? undefined,
      dryRun: payload.dryRun ?? undefined
    };

    await this.configRepository.setConfig(stored);
    return stored;
  }
}

function isSubdirectoryOfRoots(targetPath, roots) {
  const resolvedTarget = path.resolve(targetPath);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
  });
}
