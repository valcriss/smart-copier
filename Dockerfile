# syntax=docker/dockerfile:1
FROM node:18-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build

FROM node:18-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend ./
COPY --from=frontend /app/frontend/dist ./public
EXPOSE 3000
CMD ["npm", "start"]
