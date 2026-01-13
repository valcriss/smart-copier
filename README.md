# Smart Copier

Smart Copier copie automatiquement les fichiers d'un repertoire source vers un repertoire destination une seule fois par empreinte de contenu, avec suivi temps reel via SSE et historique persistant SQLite.
La tache de surveillance demarre automatiquement au lancement du serveur.

## Structure
- `backend/` : API Express, moteur de copie, SQLite, watchers, SSE
- `frontend/` : Vue 3 + Tailwind UI

## Demarrage local

Backend :
```
cd backend
npm install
npm start
```

Frontend :
```
cd frontend
npm install
npm run dev
```

## Tests

Backend :
```
cd backend
npm test
```

Frontend :
```
cd frontend
npm test
```

## Variables d'environnement

Toutes les variables sont lues via `EnvironmentConfiguration`.

- `PORT` (defaut `3000`)
- `DB_PATH` (defaut `/data/smart-copier.db`)
- `FILE_STABILITY_WINDOW_SECONDS` (defaut `10`)
- `ALLOWED_SOURCE_ROOTS` (defaut `/sources`, separateur `,`)
- `ALLOWED_DEST_ROOTS` (defaut `/destinations`, separateur `,`)
- `IGNORED_EXTENSIONS` (ex: `.part,.crdownload,.tmp`)
- `SCAN_INTERVAL_SECONDS` (defaut `60`)
- `DRY_RUN` (`true` ou `false`)

Priorite : env > SQLite > valeurs par defaut.

## Docker

Build et lancement :
```
docker compose up --build
```

Volumes :
- `/sources` (lecture seule)
- `/destinations` (lecture/ecriture)
- `/data` (etat persistant)

## Compose dev/prod

- `docker-compose.dev.yml` : build local depuis les sources.
- `docker-compose.yml` : utilise l'image `ghcr.io/valcriss/smart-copier:latest`.

## API

- `GET /api/config`
- `PUT /api/config`
- `GET /api/status`
- `GET /api/history`
- `GET /api/events` (SSE)
