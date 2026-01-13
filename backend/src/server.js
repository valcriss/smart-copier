import { createDatabase, initDatabase } from "./db.js";
import { EnvironmentConfiguration } from "./config/EnvironmentConfiguration.js";
import { ConfigRepository } from "./repositories/configRepository.js";
import { FileRepository } from "./repositories/fileRepository.js";
import { RuntimeState } from "./services/runtimeState.js";
import { createSseBroadcaster } from "./sse/broadcaster.js";
import { CopyService } from "./services/copyService.js";
import { WatcherService } from "./services/watcherService.js";
import { AssociationService } from "./services/associationService.js";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";

const logger = createLogger("server");
const envConfig = new EnvironmentConfiguration();
const db = createDatabase(envConfig.getDbPath());
await initDatabase(db);

const configRepository = new ConfigRepository(db);
const fileRepository = new FileRepository(db);
await fileRepository.failInProgress();

const runtimeState = new RuntimeState();
const broadcaster = createSseBroadcaster();
const associationService = new AssociationService({ configRepository, envConfig });

const copyService = new CopyService({
  fileRepository,
  envConfig,
  runtimeState,
  broadcaster
});
const watcherService = new WatcherService({
  copyService,
  runtimeState,
  broadcaster,
  fileRepository
});

const effectiveConfig = await associationService.getEffectiveConfig();
runtimeState.setAssociations(effectiveConfig.associations);
watcherService.start(effectiveConfig.associations, effectiveConfig);

const app = createApp({
  associationService,
  watcherService,
  runtimeState,
  fileRepository,
  envConfig,
  broadcaster
});

const port = envConfig.getPort();
app.listen(port, () => {
  logger.info(`Smart Copier backend listening on ${port}`);
});
