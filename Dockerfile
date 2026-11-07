# syntax=docker/dockerfile:1
FROM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
RUN npm install --global npm@12.2.2
COPY backend ./
COPY --from=frontend /app/frontend/dist ./public
EXPOSE 3000
CMD ["npm", "start"]
